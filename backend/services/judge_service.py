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

# ============================================================
# 评分 prompt 模板在此维护/调优（"在哪改评分 prompt" 的答案）。
# 调优措辞、评审标准、语气都可以自由改，但修改后必须保持输出 JSON 契约不变：
#   - 单一评审 SINGLE_PROMPT:
#     {"score": <number>, "verdict": "pass" 或 "fail", "reasoning": "<string>"}
#   - 成对评审 PAIR_PROMPT:
#     {"score_a": <number>, "score_b": <number>,
#      "verdict": "replaceable" 或 "not_replaceable", "reasoning": "<string>"}
# `_extract_json` 以及 tests/test_judge.py 都依赖以上字段名和取值集合，
# 调整措辞/结构时注意保留 {{...}} 占位的 JSON 输出格式段落与 .format() 用到的
# 具名占位符（input/model/output/model_a/output_a/model_b/output_b/trace_context）。
# ============================================================

PAIR_PROMPT = """你是严格的 LLM 输出质量评审。请基于以下材料评估「B 能否替代 A」。

【任务输入】
{input}

【候选输出 A】(基准，模型: {model_a})
{output_a}

【候选输出 B】(候选替代，模型: {model_b})
{output_b}
{trace_context}
【评审标准】（综合权衡以下维度，不要求逐项加权算分）
- 正确性：结论/事实/代码逻辑是否有误
- 完整性：是否覆盖任务要求的所有要点，有无遗漏
- 遵循指令：是否符合任务输入中的约束和格式要求
- 简洁性：在满足以上前提下是否啰嗦或有冗余

请分别给 A、B 打分（0-10），并给出结论：若 B 在以上维度不劣于 A 则判 replaceable；
若两者质量相当且 B 没有明显缺陷，也可判 replaceable；否则判 not_replaceable。

只输出 JSON，不要任何其他文字：
{{"score_a": <number>, "score_b": <number>, "verdict": "replaceable" 或 "not_replaceable", "reasoning": "<中文理由>"}}"""

SINGLE_PROMPT = """你是严格的 LLM 输出质量评审。请基于以下材料评估该输出是否合格。

【任务输入】
{input}

【候选输出】(模型: {model})
{output}
{trace_context}
【评审标准】（综合权衡以下维度，不要求逐项加权算分）
- 正确性：结论/事实/代码逻辑是否有误
- 完整性：是否覆盖任务要求的所有要点，有无遗漏
- 遵循指令：是否符合任务输入中的约束和格式要求
- 简洁性：在满足以上前提下是否啰嗦或有冗余

请打分（0-10）并判断是否合格。

只输出 JSON，不要任何其他文字：
{{"score": <number>, "verdict": "pass" 或 "fail", "reasoning": "<中文理由>"}}"""


def _is_message_list(value) -> bool:
    """粗略判断是不是一段对话消息（[{"role": ..., "content": ...}, ...]）。"""
    return bool(
        isinstance(value, list) and value
        and all(isinstance(m, dict) and "role" in m for m in value))


def _dump_messages(messages: list) -> str:
    lines = []
    for m in messages:
        role = m.get("role", "?")
        content = m.get("content", "")
        if not isinstance(content, str):
            content = json.dumps(content, ensure_ascii=False, default=str)
        lines.append(f"[{role}] {content}")
    return "\n".join(lines)


def _dump(value) -> str:
    """把任意字段格式化成 judge 更容易阅读的文本。

    - 纯字符串：原样透传。
    - 消息列表（含 role 字段的 dict 列表）：按 [role] content 逐行展开，
      而不是丢一坨转义后的原始 JSON 给 judge。
    - 其他 dict/list：json.dumps(indent=2) 缩进美化，比压缩单行 JSON 好读。
    - 超过 MAX_FIELD_CHARS 时截断，并在末尾追加 …(截断) 标记，避免 judge
      误以为内容本来就在那里结束。
    """
    if isinstance(value, str):
        text = value
    elif _is_message_list(value):
        text = _dump_messages(value)
    elif isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False, indent=2, default=str)
    else:
        text = json.dumps(value, ensure_ascii=False, default=str)
    if len(text) <= MAX_FIELD_CHARS:
        return text
    return text[:MAX_FIELD_CHARS] + "…(截断)"


def _trace_models(trace: Trace) -> str:
    models = sorted({o.model for o in trace.observations
                     if o.type == "llm" and o.model})
    return ", ".join(models) or "unknown"


def _step_line(ob) -> str:
    label = f"第{ob.seq}步 [{ob.type}] {ob.name}"
    if ob.type == "tool":
        detail = (f"入参={_dump(ob.tool_input)[:MAX_STEP_CHARS]} "
                  f"结果={_dump(ob.tool_output)[:MAX_STEP_CHARS]}")
        return f"{label}: {detail}"
    if ob.type == "llm":
        return f"{label}: 模型={ob.model or 'unknown'}"
    return label


def _dump_steps(observations, limit: int) -> list[str]:
    lines = []
    for i, ob in enumerate(observations):
        if i >= limit:
            lines.append(f"…（共 {len(observations)} 步，仅展示前 {limit} 步）")
            break
        lines.append(_step_line(ob))
    return lines


def _trace_context(trace: Trace, other: Trace | None) -> str:
    lines = ["", "【A 的调用链】" if other is not None else "【调用链】"]
    lines.extend(_dump_steps(trace.observations, MAX_CONTEXT_STEPS))
    if other is not None:
        lines.append("【B 的调用链】")
        lines.extend(_dump_steps(other.observations, MAX_CONTEXT_STEPS))
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
        ).order_by(Evaluation.created_at.desc()).first()
        if cached is not None:
            return cached

    provider = resolve_provider(db, judge_model, subject.project_id)
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
                          result["output_tokens"], subject.project_id))
    db.add(evaluation)
    db.commit()
    return evaluation
