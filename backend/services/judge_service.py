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
MAX_EVIDENCE_CHARS = 200
MAX_EVIDENCE_STEP_CHARS = 160
VALID_CONFIDENCE = (1, 2, 3)

JUDGE_DIMENSIONS = ["正确性", "意图一致", "成本效率"]
# 固定的分维度打分维度集合。骨架里的 JSON 输出格式尾部按这三个维度的名字
# 字面写死（见 PAIR_SKELETON/SINGLE_SKELETON），下面的
# test_skeletons_mention_every_judge_dimension 保证两者不会漂移。

SKELETON_VERSION = 2
# 骨架版本号：本次改动让 SKELETON（不是 rubric）也变了——所有 judge 现在都被
# 要求多输出 dimensions/evidence/evidence_step/confidence——但 prompt_fingerprint
# 历史上只哈希 rubric，不哈希骨架本身，于是骨架变了、fingerprint 却不变，会让
# 所有历史缓存被当成命中而复用旧格式的评分（没有新字段）。把 SKELETON_VERSION
# 拼进 fingerprint 计算（见 _fingerprint()）后，所有旧评分的 fingerprint 都会
# 变化，从而一次性失效重新打分；未来再改骨架时把这个数字加一即可。

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
【A 整体指标】{metrics_a}

【候选输出 B】(候选替代，模型: {model_b})
{output_b}
【B 整体指标】{metrics_b}
{trace_context}
请给出：
1. dimensions：对「正确性」「意图一致」「成本效率」三个维度分别给 A、B 打 0-10 分；
   「成本效率」请依据上方【整体指标】给出的真实成本/延迟/token 数据打分，不要凭空猜测。
2. 总体 score_a、score_b（0-10），并给出结论 verdict：若 B 在以上维度不劣于 A 则判 replaceable；
   若两者质量相当且 B 没有明显缺陷，也可判 replaceable；否则判 not_replaceable。
3. evidence：从材料中挑选最具决定性的一条具体证据（例如某个工具调用入参的差异、成本或延迟的
   差值），不超过 200 字；如果确实没有可引用的具体证据，填 null。
4. evidence_step：evidence 的出处（例如"步骤 3 · param_mismatch"、"全链路 · 成本对比"）；
   evidence 为 null 时这里也是 null。
5. confidence：你对以上判断的置信度，整数 1（低）到 3（高）。

只输出 JSON，不要任何其他文字：
{{"score_a": <number>, "score_b": <number>, "verdict": "replaceable" 或 "not_replaceable", "reasoning": "<中文理由>", "dimensions": [{{"name": "正确性", "score_a": <0-10>, "score_b": <0-10>}}, {{"name": "意图一致", "score_a": <0-10>, "score_b": <0-10>}}, {{"name": "成本效率", "score_a": <0-10>, "score_b": <0-10>}}], "evidence": "<string 或 null>", "evidence_step": "<string 或 null>", "confidence": <1-3 的整数>}}"""

SINGLE_SKELETON = """{rubric}

请基于以下材料评估该输出是否合格。

【任务输入】
{input}

【候选输出】(模型: {model})
{output}
【整体指标】{metrics}
{trace_context}
请给出：
1. dimensions：对「正确性」「意图一致」「成本效率」三个维度分别打 0-10 分；
   「成本效率」请依据上方【整体指标】给出的真实成本/延迟/token 数据打分，不要凭空猜测。
2. 总体 score（0-10）并判断是否合格 verdict（pass/fail）。
3. evidence：挑选最具决定性的一条具体证据，不超过 200 字；如果没有可引用的具体证据，填 null。
4. evidence_step：evidence 的出处；evidence 为 null 时这里也是 null。
5. confidence：你对以上判断的置信度，整数 1（低）到 3（高）。

只输出 JSON，不要任何其他文字：
{{"score": <number>, "verdict": "pass" 或 "fail", "reasoning": "<中文理由>", "dimensions": [{{"name": "正确性", "score": <0-10>}}, {{"name": "意图一致", "score": <0-10>}}, {{"name": "成本效率", "score": <0-10>}}], "evidence": "<string 或 null>", "evidence_step": "<string 或 null>", "confidence": <1-3 的整数>}}"""


def compose_judge_prompt(rubric: str, *, pair: bool) -> str:
    """把可编辑的 rubric 拼进锁定骨架，返回仍待 `.format(input=..., ...)` 的模板。

    用 str.replace 而非 str.format 做拼装，是因为骨架里还留着
    input/model/output/... 等尚未填充的具名占位符，以及 JSON 尾部为了在
    调用方后续 .format() 时输出字面花括号而写的 {{ }} 转义——这两者都不能被
    这一步的拼装提前消费掉。
    """
    skeleton = PAIR_SKELETON if pair else SINGLE_SKELETON
    return skeleton.replace("{rubric}", rubric, 1)


def _fingerprint(rubric: str) -> str:
    """rubric 内容 + 骨架版本号的 sha256[:16]。

    拼上 SKELETON_VERSION 而不是只哈希 rubric，是因为缓存命中与否既取决于
    "用什么评审标准评的"，也取决于"骨架本身要求 judge 输出什么格式"——骨架变了
    （比如这次新增 dimensions/evidence/confidence 字段的要求），哪怕 rubric
    一字未改，历史评分也已经不满足新契约，必须失效重评。
    """
    return hashlib.sha256(f"{SKELETON_VERSION}:{rubric}".encode()).hexdigest()[:16]


def builtin_fingerprint() -> str:
    return _fingerprint(DEFAULT_RUBRIC)


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


def _trace_metrics(trace: Trace) -> str:
    """trace 的整体聚合指标（成本/延迟/token），供骨架里的【整体指标】占位符使用，
    让 judge 的「成本效率」维度打分和 evidence 引用真实数字，而不是凭空猜测。"""
    cost = "未知" if trace.total_cost is None else f"${trace.total_cost:.4f}"
    latency = "未知" if trace.latency_ms is None else f"{trace.latency_ms}ms"
    return (f"成本={cost} 延迟={latency} "
            f"输入tokens={trace.total_input_tokens} 输出tokens={trace.total_output_tokens}")


def _tool_step_line(ob) -> str:
    return (f"[{ob.name}] 入参={_dump(ob.tool_input)[:MAX_STEP_CHARS]} "
            f"结果={_dump(ob.tool_output)[:MAX_STEP_CHARS]}")


def _dump_tool_calls(observations, limit: int) -> list[str]:
    tools = [o for o in observations if o.type == "tool"]
    if not tools:
        return ["（无工具调用）"]
    lines = []
    for i, ob in enumerate(tools):
        if i >= limit:
            lines.append(f"…（共 {len(tools)} 个工具调用，仅展示前 {limit} 个）")
            break
        lines.append(_tool_step_line(ob))
    return lines


def _tools_aligned_context(trace: Trace, other: Trace | None) -> str:
    """context_mode="tools_aligned"：只给 judge 看两条 trace 的工具调用
    （名称+入参+出参），不含 LLM 消息本身，方便对齐 A/B 的工具使用差异。"""
    lines = ["", "【A 的工具调用】" if other is not None else "【工具调用】"]
    lines.extend(_dump_tool_calls(trace.observations, MAX_CONTEXT_STEPS))
    if other is not None:
        lines.append("【B 的工具调用】")
        lines.extend(_dump_tool_calls(other.observations, MAX_CONTEXT_STEPS))
    lines.append("")
    return "\n".join(lines)


def _extract_json(content: str) -> dict:
    start, end = content.find("{"), content.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in judge output")
    return json.loads(content[start:end + 1])


def _clamp_score(value: float) -> float:
    return max(0.0, min(10.0, value))


def _extract_dimensions(value, *, pair: bool) -> list[dict] | None:
    """防御性解析 dimensions：绝不为了凑格式而编造分数——任何解析不出的地方
    宁可整体为 None（单条目宁可被丢弃），也不能塞假的 0 分。

    - value 不是非空 list：整体判定为没有分维度数据，返回 None。
    - 逐条目校验：必须是 dict，name 必须属于 JUDGE_DIMENSIONS，对应的分数
      字段（单一评审 score；成对评审 score_a + score_b）必须都能转成
      float——任何一条不满足就丢弃这一条，不中断其他条目的解析。
    - 分数一律 clamp 到 [0, 10]（judge 偶尔会给出超范围的数）。
    - 过滤后一条都不剩（全部畸形）等价于没有可用数据，同样返回 None。
    """
    if not isinstance(value, list) or not value:
        return None
    score_keys = ("score_a", "score_b") if pair else ("score",)
    result = []
    for item in value:
        if not isinstance(item, dict) or item.get("name") not in JUDGE_DIMENSIONS:
            continue
        try:
            scores = {k: _clamp_score(float(item[k])) for k in score_keys}
        except (KeyError, TypeError, ValueError):
            continue
        result.append({"name": item["name"], **scores})
    return result or None


def _extract_confidence(value) -> int | None:
    try:
        confidence = int(value)
    except (TypeError, ValueError):
        return None
    return confidence if confidence in VALID_CONFIDENCE else None


def _extract_bounded_text(value, max_chars: int) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:max_chars] if value else None


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
    fingerprint = _fingerprint(rubric)
    # fingerprint 恰好等于 builtin_fingerprint() 时（模板未指定或内容与默认
    # rubric 相同），无需特判——两者都是同一份内容+骨架版本号的 sha256[:16]。

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
    if context_mode == "with_trace":
        trace_context = _trace_context(subject, compare)
    elif context_mode == "tools_aligned":
        trace_context = _tools_aligned_context(subject, compare)
    else:
        trace_context = ""
    if compare is not None:
        prompt = compose_judge_prompt(rubric, pair=True).format(
            input=_dump(subject.input), model_a=_trace_models(subject),
            output_a=_dump(subject.output), metrics_a=_trace_metrics(subject),
            model_b=_trace_models(compare), output_b=_dump(compare.output),
            metrics_b=_trace_metrics(compare), trace_context=trace_context)
    else:
        prompt = compose_judge_prompt(rubric, pair=False).format(
            input=_dump(subject.input), model=_trace_models(subject),
            output=_dump(subject.output), metrics=_trace_metrics(subject),
            trace_context=trace_context)

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

    # 新字段（dimensions/evidence/evidence_step/confidence）的解析都在核心
    # verdict/score 解析成功之后进行，且各自都是防御性的（绝不抛异常）——
    # 一个只返回旧字段的 judge 必须仍然评分成功，新字段全部落 NULL，这是
    # 优雅降级路径，不是错误。
    dimensions = _extract_dimensions(parsed.get("dimensions"), pair=compare is not None)
    evidence = _extract_bounded_text(parsed.get("evidence"), MAX_EVIDENCE_CHARS)
    evidence_step = _extract_bounded_text(parsed.get("evidence_step"), MAX_EVIDENCE_STEP_CHARS)
    confidence = _extract_confidence(parsed.get("confidence"))

    evaluation = Evaluation(
        project_id=subject.project_id, subject_trace_id=subject_trace_id,
        compare_trace_id=compare_trace_id, judge_model=judge_model,
        context_mode=context_mode, score=score, score_b=score_b,
        verdict=verdict, reasoning=str(parsed.get("reasoning", "")),
        cost=compute_cost(db, judge_model, result["input_tokens"],
                          result["output_tokens"], subject.project_id),
        judge_template_id=judge_template_id, prompt_fingerprint=fingerprint,
        dimensions=dimensions, evidence=evidence, evidence_step=evidence_step,
        confidence=confidence)
    db.add(evaluation)
    db.commit()
    return evaluation
