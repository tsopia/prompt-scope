import json

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.entities import Evaluation, Trace
from services.ingest_service import compute_cost
from services.llm_client import LLMClientError, chat_completion
from services.providers import resolve_provider

MAX_FIELD_CHARS = 4000
MAX_STEP_CHARS = 200
MAX_CONTEXT_STEPS = 50

PAIR_PROMPT = """你是严格的 LLM 输出质量评审。任务输入与两个候选（A 为基准，B 为候选替代）的输出如下。

【任务输入】
{input}

【A 的输出】(模型: {model_a})
{output_a}

【B 的输出】(模型: {model_b})
{output_b}
{trace_context}
请评估 B 能否替代 A：分别打分（0-10，质量维度：正确性、完整性、指令遵循），并给出结论。
只输出 JSON，不要任何其他文字：
{{"score_a": <number>, "score_b": <number>, "verdict": "replaceable" 或 "not_replaceable", "reasoning": "<中文理由>"}}"""

SINGLE_PROMPT = """你是严格的 LLM 输出质量评审。任务输入与输出如下。

【任务输入】
{input}

【输出】(模型: {model})
{output}
{trace_context}
请打分（0-10）并判断是否合格。只输出 JSON，不要任何其他文字：
{{"score": <number>, "verdict": "pass" 或 "fail", "reasoning": "<中文理由>"}}"""


def _dump(value) -> str:
    text = value if isinstance(value, str) else json.dumps(
        value, ensure_ascii=False, default=str)
    return text[:MAX_FIELD_CHARS]


def _trace_models(trace: Trace) -> str:
    models = sorted({o.model for o in trace.observations
                     if o.type == "llm" and o.model})
    return ", ".join(models) or "unknown"


def _trace_context(trace: Trace, other: Trace | None) -> str:
    lines = ["", "【A 的调用链】" if other is not None else "【调用链】"]
    for i, ob in enumerate(trace.observations):
        if i >= MAX_CONTEXT_STEPS:
            lines.append(f"…（共 {len(trace.observations)} 步，仅展示前 {MAX_CONTEXT_STEPS} 步）")
            break
        detail = ""
        if ob.type == "tool":
            detail = (f" 入参={_dump(ob.tool_input)[:MAX_STEP_CHARS]}"
                      f" 结果={_dump(ob.tool_output)[:MAX_STEP_CHARS]}")
        lines.append(f"{ob.seq}. [{ob.type}] {ob.name}{detail}")
    if other is not None:
        lines.append("【B 的调用链】")
        for i, ob in enumerate(other.observations):
            if i >= MAX_CONTEXT_STEPS:
                lines.append(f"…（共 {len(other.observations)} 步，仅展示前 {MAX_CONTEXT_STEPS} 步）")
                break
            detail = ""
            if ob.type == "tool":
                detail = (f" 入参={_dump(ob.tool_input)[:MAX_STEP_CHARS]}"
                          f" 结果={_dump(ob.tool_output)[:MAX_STEP_CHARS]}")
            lines.append(f"{ob.seq}. [{ob.type}] {ob.name}{detail}")
    lines.append("")
    return "\n".join(lines)


def _extract_json(content: str) -> dict:
    start, end = content.find("{"), content.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in judge output")
    return json.loads(content[start:end + 1])


def run_judge(db: Session, subject_trace_id: str, judge_model: str,
              compare_trace_id: str | None = None,
              context_mode: str = "output_only", force: bool = False,
              client=None) -> Evaluation:
    subject = db.get(Trace, subject_trace_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="subject trace not found")
    compare = None
    if compare_trace_id is not None:
        compare = db.get(Trace, compare_trace_id)
        if compare is None:
            raise HTTPException(status_code=404, detail="compare trace not found")

    if not force:
        cached = db.query(Evaluation).filter(
            Evaluation.subject_trace_id == subject_trace_id,
            Evaluation.compare_trace_id == compare_trace_id,
            Evaluation.judge_model == judge_model,
            Evaluation.context_mode == context_mode,
        ).first()
        if cached is not None:
            return cached

    provider = resolve_provider(db, judge_model)
    trace_context = (_trace_context(subject, compare)
                     if context_mode == "with_trace" else "")
    if compare is not None:
        prompt = PAIR_PROMPT.format(
            input=_dump(subject.input), model_a=_trace_models(subject),
            output_a=_dump(subject.output), model_b=_trace_models(compare),
            output_b=_dump(compare.output), trace_context=trace_context)
    else:
        prompt = SINGLE_PROMPT.format(
            input=_dump(subject.input), model=_trace_models(subject),
            output=_dump(subject.output), trace_context=trace_context)

    try:
        result = chat_completion(provider, judge_model,
                                 [{"role": "user", "content": prompt}],
                                 client=client)
    except LLMClientError as e:
        raise HTTPException(status_code=502,
                            detail=f"judge 调用失败: {e}") from e

    if not result.get("content"):
        raise HTTPException(status_code=502,
                            detail="judge 返回空内容（模型可能触发了 tool_call 或 refusal）")

    try:
        parsed = _extract_json(result["content"])
        verdict = str(parsed["verdict"])
        if compare is not None:
            score, score_b = float(parsed["score_a"]), float(parsed["score_b"])
        else:
            score, score_b = float(parsed["score"]), None
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
        raise HTTPException(
            status_code=502,
            detail=f"judge 输出无法解析: {result['content'][:300]}") from e

    evaluation = Evaluation(
        project_id=subject.project_id, subject_trace_id=subject_trace_id,
        compare_trace_id=compare_trace_id, judge_model=judge_model,
        context_mode=context_mode, score=score, score_b=score_b,
        verdict=verdict, reasoning=str(parsed.get("reasoning", "")),
        cost=compute_cost(db, judge_model, result["input_tokens"],
                          result["output_tokens"]))
    db.add(evaluation)
    db.commit()
    return evaluation
