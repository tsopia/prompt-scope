import json
from collections import defaultdict, deque

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.entities import Observation, PromptVersion, ReplayRun, Trace, gen_id, utcnow
from schemas.ingest import IngestRequest, ObservationIn, TraceIn
from services.ingest_service import ingest
from services.llm_client import LLMClientError, chat_completion
from services.providers import resolve_provider

MAX_REPLAY_STEPS = 15
MAX_REPLAY_WALL_SECONDS = 240


def stable_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str)


class RecordedTools:
    """源 trace 的工具调用录制，按工具名 FIFO 消费。"""

    def __init__(self, tool_observations):
        self.queues = defaultdict(deque)
        for ob in tool_observations:
            self.queues[ob.name].append(ob)

    def take(self, name):
        q = self.queues.get(name)
        return q.popleft() if q else None


def _find_entry_llm(trace: Trace):
    for ob in trace.observations:
        if ob.type == "llm":
            return ob
    raise HTTPException(status_code=400,
                        detail="源 trace 没有 llm observation，无法回放")


def _resolve_target(db: Session, source: Trace, target_observation_id: str):
    target = db.get(Observation, target_observation_id)
    if (target is None or target.trace_id != source.id
            or target.type != "llm"):
        raise HTTPException(status_code=400,
                            detail="target_observation_id 必须是源 trace 的 llm observation")
    return target


def _initial_messages(entry, override_prompt: str | None,
                      truncate: bool = True) -> list[dict]:
    msgs = [dict(m) for m in (entry.messages or [])]
    if truncate:
        cut = len(msgs)
        for i, m in enumerate(msgs):
            if m.get("role") in ("assistant", "tool"):
                cut = i
                break
        msgs = msgs[:cut]
    if override_prompt is not None:
        for m in msgs:
            if m.get("role") == "system":
                m["content"] = override_prompt
                break
        else:
            msgs.insert(0, {"role": "system", "content": override_prompt})
    return msgs


def _normalize_tools(tool_definitions) -> list | None:
    if not tool_definitions:
        return None
    tools = []
    for d in tool_definitions:
        tools.append(d if d.get("type") == "function"
                     else {"type": "function", "function": d})
    return tools


def _resolve_prompt_override(db: Session, run: ReplayRun) -> str | None:
    if run.override_prompt_version_id:
        version = db.get(PromptVersion, run.override_prompt_version_id)
        if version is None:
            raise HTTPException(status_code=404,
                                detail="prompt version not found")
        return version.content
    return run.override_prompt_text


def _persist_result(db, run, source, result_trace_id, observations,
                    final_content, started_at, entry=None) -> None:
    """先落 trace 再把 result_trace_id 写回 run——顺序不能反：
    ReplayRun.result_trace_id 有 FK，trace 不存在时提前 commit 会在 Postgres 上外键违约。"""
    metadata = {"replay_run_id": run.id, "source_trace_id": source.id}
    if run.target_observation_id:
        name_suffix = f"(replay:step-{entry.seq})"
        metadata["target_observation_id"] = run.target_observation_id
    else:
        name_suffix = "(replay)"
    trace_in = TraceIn(
        id=result_trace_id,
        name=f"{source.name or source.id[:8]} {name_suffix}",
        origin="replay",
        status="success" if final_content is not None else "error",
        input=source.input,
        output=final_content,
        metadata=metadata,
        prompt_version_id=run.override_prompt_version_id,
        started_at=started_at,
        ended_at=utcnow(),
    )
    ingest(db, source.project_id,
           IngestRequest(trace=trace_in, observations=observations))
    run.result_trace_id = result_trace_id


def execute_replay(db: Session, run: ReplayRun, client=None) -> ReplayRun:
    source = db.get(Trace, run.source_trace_id)
    if source is None:
        raise HTTPException(status_code=404, detail="source trace not found")
    if run.target_observation_id:
        entry = _resolve_target(db, source, run.target_observation_id)
    else:
        entry = _find_entry_llm(source)

    model = run.override_model or entry.model
    if not model:
        raise HTTPException(status_code=400, detail="无法确定回放模型")
    provider = resolve_provider(db, model)

    messages = _initial_messages(entry, _resolve_prompt_override(db, run),
                                 truncate=not run.target_observation_id)
    model_params = {**(entry.model_params or {}),
                    **(run.override_model_params or {})}
    tools = _normalize_tools(entry.tool_definitions)
    if tools and provider.provider_type == "anthropic":
        raise HTTPException(status_code=400,
                            detail="anthropic provider 暂不支持工具回放")

    if run.target_observation_id:
        tool_observations = [o for o in source.observations
                             if o.type == "tool" and o.parent_id == entry.id]
    else:
        tool_observations = [o for o in source.observations if o.type == "tool"]
    recorded = RecordedTools(tool_observations)
    divergences: list[dict] = []
    observations: list[ObservationIn] = []
    result_trace_id = gen_id()  # 先本地持有，trace 落库后才写回 run（FK 约束）
    run.status = "running"
    db.commit()

    started_at = utcnow()
    seq = 0
    final_content = None
    try:
        for step in range(MAX_REPLAY_STEPS):
            if (utcnow() - started_at).total_seconds() > MAX_REPLAY_WALL_SECONDS:
                divergences.append({"type": "wall_clock_exceeded", "step": step})
                break
            t0 = utcnow()
            result = chat_completion(provider, model, messages,
                                     model_params=model_params or None,
                                     tools=tools, client=client)
            llm_ob = ObservationIn(
                id=gen_id(), type="llm", name=f"llm-step-{step}", seq=seq,
                model=model, model_params=model_params or None,
                messages=[dict(m) for m in messages],
                tool_definitions=entry.tool_definitions,
                tool_calls=result["tool_calls"],
                completion=result["content"],
                input_tokens=result["input_tokens"],
                output_tokens=result["output_tokens"],
                started_at=t0, ended_at=utcnow(),
            )
            observations.append(llm_ob)
            seq += 1

            if not result["tool_calls"]:
                final_content = result["content"]
                break

            messages.append(result["raw_message"])
            for tc in result["tool_calls"]:
                rec = recorded.take(tc["name"])
                if rec is None:
                    divergences.append({
                        "type": "unrecorded_call", "tool": tc["name"],
                        "step": step, "arguments": tc["arguments"]})
                    tool_output = {"error": "工具结果不可用：录制中不存在该调用"}
                    status, error_txt, rec_input = "error", "unrecorded tool call", None
                else:
                    rec_input = rec.tool_input
                    if stable_json(tc["arguments"]) != stable_json(rec.tool_input):
                        divergences.append({
                            "type": "param_mismatch", "tool": tc["name"],
                            "step": step, "recorded_input": rec.tool_input,
                            "actual_input": tc["arguments"]})
                    tool_output = rec.tool_output
                    status, error_txt = "success", None
                observations.append(ObservationIn(
                    id=gen_id(), parent_id=llm_ob.id, type="tool",
                    name=tc["name"], seq=seq, status=status, error=error_txt,
                    tool_input=tc["arguments"] if tc["arguments"] is not None else {},
                    tool_output=tool_output,
                    metadata={"mocked": True, "recorded_input": rec_input},
                ))
                seq += 1
                messages.append({
                    "role": "tool", "tool_call_id": tc.get("id") or "",
                    "content": json.dumps(tool_output, ensure_ascii=False,
                                          default=str)})
        else:
            divergences.append({"type": "max_steps_exceeded",
                                "step": MAX_REPLAY_STEPS})

        _persist_result(db, run, source, result_trace_id, observations,
                        final_content, started_at, entry=entry)
        run.divergences = divergences
        if final_content is not None:
            run.status = "success"
        else:
            run.status = "failed"
            if divergences and divergences[-1]["type"] == "wall_clock_exceeded":
                run.error = f"超过最大回放时长（{MAX_REPLAY_WALL_SECONDS} 秒）仍未产出最终回答"
            else:
                run.error = f"达到最大步数（{MAX_REPLAY_STEPS}）仍未产出最终回答"
    except LLMClientError as e:
        if observations:
            _persist_result(db, run, source, result_trace_id, observations,
                            None, started_at, entry=entry)
        run.divergences = divergences
        run.status = "failed"
        run.error = str(e)

    run.finished_at = utcnow()
    db.commit()
    return run
