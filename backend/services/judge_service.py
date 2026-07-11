import hashlib
import json

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.entities import Evaluation, JudgeTemplate, Trace
from services.ingest_service import compute_cost
from services.llm_client import LLMClientError, chat_completion
from services.providers import resolve_provider

MAX_FIELD_CHARS = 4000
MAX_STEP_CHARS = 200
MAX_CONTEXT_STEPS = 50

# ============================================================
# 评分 prompt 由两部分拼装（多评分模板 / Phase 10）：
#   - DEFAULT_RUBRIC：可编辑的部分（评审身份 + 评审标准），单/成对评审共用同一份，
#     用户在项目内维护的 JudgeTemplate.content 就是这部分的替代品。
#   - SINGLE_SKELETON / PAIR_SKELETON：任务输入/输出骨架 + 锁定的 JSON 输出格式
#     尾部，用户不可修改。`compose_judge_prompt()` 把 rubric 拼进骨架里的
#     {rubric} 占位符（纯字符串替换，不经过 .format，避免和骨架自身尚未填充的
#     {input}/{model}/... 占位符冲突），返回的仍是一个待 .format(...) 的模板。
# 修改 rubric 措辞可以自由改，但骨架里锁定的 JSON 输出格式段落
#   - 单一评审: {"score": <number>, "verdict": "pass" 或 "fail", "reasoning": "<string>"}
#   - 成对评审: {"score_a": <number>, "score_b": <number>,
#                "verdict": "replaceable" 或 "not_replaceable", "reasoning": "<string>"}
# 不能破坏 —— `_extract_json` 以及 tests/test_judge.py 都依赖以上字段名和取值集合。
#
# 注：本次重构把「评审标准」bullets 从原先"候选输出之后"挪到了 rubric 顶部
# （紧跟评审身份句，任务专属的"请基于以下材料评估..."句挪进了骨架），使得
# rubric 对单/成对评审是同一份连续文本，可作为一个整体被用户编辑替换——因此
# 默认组合后的 prompt 与重构前的 PAIR_PROMPT/SINGLE_PROMPT 语义等价但不再逐字
# 节相同（原文本身把 rubric 拆成了首尾两段，不适合作为一个可编辑整体）。
# ============================================================

DEFAULT_RUBRIC = """你是严格的 LLM 输出质量评审。

【评审标准】（综合权衡以下维度，不要求逐项加权算分）
- 正确性：结论/事实/代码逻辑是否有误
- 完整性：是否覆盖任务要求的所有要点，有无遗漏
- 遵循指令：是否符合任务输入中的约束和格式要求
- 简洁性：在满足以上前提下是否啰嗦或有冗余"""

PAIR_SKELETON = """{rubric}

请基于以下材料评估「B 能否替代 A」。

【任务输入】
{input}

【候选输出 A】(基准，模型: {model_a})
{output_a}

【候选输出 B】(候选替代，模型: {model_b})
{output_b}
{trace_context}
请分别给 A、B 打分（0-10），并给出结论：若 B 在以上维度不劣于 A 则判 replaceable；
若两者质量相当且 B 没有明显缺陷，也可判 replaceable；否则判 not_replaceable。

只输出 JSON，不要任何其他文字：
{{"score_a": <number>, "score_b": <number>, "verdict": "replaceable" 或 "not_replaceable", "reasoning": "<中文理由>"}}"""

SINGLE_SKELETON = """{rubric}

请基于以下材料评估该输出是否合格。

【任务输入】
{input}

【候选输出】(模型: {model})
{output}
{trace_context}
请打分（0-10）并判断是否合格。

只输出 JSON，不要任何其他文字：
{{"score": <number>, "verdict": "pass" 或 "fail", "reasoning": "<中文理由>"}}"""


def compose_judge_prompt(rubric: str, *, pair: bool) -> str:
    """把可编辑的 rubric 拼进锁定骨架，返回仍待 `.format(input=..., ...)` 的模板。

    用 str.replace 而非 str.format 做拼装，是因为骨架里还留着
    input/model/output/... 等尚未填充的具名占位符，以及 JSON 尾部为了在
    调用方后续 .format() 时输出字面花括号而写的 {{ }} 转义——这两者都不能被
    这一步的拼装提前消费掉。
    """
    skeleton = PAIR_SKELETON if pair else SINGLE_SKELETON
    return skeleton.replace("{rubric}", rubric, 1)


def builtin_fingerprint() -> str:
    return hashlib.sha256(DEFAULT_RUBRIC.encode()).hexdigest()[:16]


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
              judge_template_id: str | None = None,
              client=None) -> Evaluation:
    subject = db.get(Trace, subject_trace_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="subject trace not found")
    compare = None
    if compare_trace_id is not None:
        compare = db.get(Trace, compare_trace_id)
        if compare is None:
            raise HTTPException(status_code=404, detail="compare trace not found")

    template = None
    if judge_template_id is not None:
        template = db.get(JudgeTemplate, judge_template_id)
        if template is None or template.project_id != subject.project_id:
            raise HTTPException(status_code=400, detail="评分模板不属于该项目")
    rubric = template.content if template is not None else DEFAULT_RUBRIC
    fingerprint = hashlib.sha256(rubric.encode()).hexdigest()[:16]
    # fingerprint 恰好等于 builtin_fingerprint() 时（模板未指定或内容与默认
    # rubric 相同），无需特判——两者都是同一份内容的 sha256[:16]。

    if not force:
        # 缓存按内容指纹而非 judge_template_id 比较：模板被编辑后指纹变化，
        # 即使 judge_template_id 不变也会 miss 重新打分；反过来两个不同模板若
        # 内容恰好相同也会共享缓存，这是有意的设计（缓存的是"用什么 rubric
        # 评的"，不是"用哪个模板 id 评的"）。历史行 prompt_fingerprint 为
        # NULL，SQL 的 NULL == <非空值> 恒为假，因此老评分永远不会被当作命中
        # ——这是一次有意的、一次性的缓存重置（本次重构引入 fingerprint 之前
        # 落库的 Evaluation 都会被视为"从未评过"，重新花一次 token 打分）。
        cached = db.query(Evaluation).filter(
            Evaluation.subject_trace_id == subject_trace_id,
            Evaluation.compare_trace_id == compare_trace_id,
            Evaluation.judge_model == judge_model,
            Evaluation.context_mode == context_mode,
            Evaluation.prompt_fingerprint == fingerprint,
        ).order_by(Evaluation.created_at.desc()).first()
        if cached is not None:
            return cached

    provider = resolve_provider(db, judge_model, subject.project_id)
    trace_context = (_trace_context(subject, compare)
                     if context_mode == "with_trace" else "")
    if compare is not None:
        prompt = compose_judge_prompt(rubric, pair=True).format(
            input=_dump(subject.input), model_a=_trace_models(subject),
            output_a=_dump(subject.output), model_b=_trace_models(compare),
            output_b=_dump(compare.output), trace_context=trace_context)
    else:
        prompt = compose_judge_prompt(rubric, pair=False).format(
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
                          result["output_tokens"], subject.project_id),
        judge_template_id=judge_template_id, prompt_fingerprint=fingerprint)
    db.add(evaluation)
    db.commit()
    return evaluation
