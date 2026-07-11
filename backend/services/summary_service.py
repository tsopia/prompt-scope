import json
import logging

from sqlalchemy.orm import Session

from models.entities import Project, Trace
from services.llm_client import chat_completion
from services.providers import resolve_provider

MAX_INPUT_CHARS = 1500
MAX_OUTPUT_CHARS = 800
MAX_SUMMARY_CHARS = 120

SUMMARY_PROMPT = """用一句话（不超过40字）概括这次 agent 运行做了什么，直接输出结论，不要加引号。

【输入】
{input}

【输出】
{output}"""


def _dump(value, limit: int) -> str:
    text = value if isinstance(value, str) else json.dumps(
        value, ensure_ascii=False, default=str)
    return text[:limit]


def generate_trace_summary(db: Session, trace_id: str) -> None:
    """为一条 trace 生成模型摘要（增强能力，非核心功能）。

    - 项目未配置 summary_model：跳过，不调用任何 LLM。
    - trace 已有 summary：幂等跳过，不重复花钱。
    - 任何异常（provider 未配置、LLM 调用失败、返回内容异常等）都只记录
      warning 并直接返回，绝不向上抛出——摘要生成失败不能影响 ingest 主流程。
    - 本次调用产生的 token 花费不计入 Evaluation/成本统计，只是一次性的
      辅助 LLM 调用，目前没有为它单独记账（诚实说明，不做隐藏假装）。
    """
    try:
        trace = db.get(Trace, trace_id)
        if trace is None:
            return
        project = db.get(Project, trace.project_id)
        if project is None or not project.summary_model:
            return
        if trace.summary:
            return

        provider = resolve_provider(db, project.summary_model, project.id)
        prompt = SUMMARY_PROMPT.format(
            input=_dump(trace.input, MAX_INPUT_CHARS),
            output=_dump(trace.output, MAX_OUTPUT_CHARS))
        result = chat_completion(
            provider, project.summary_model,
            [{"role": "user", "content": prompt}],
            model_params={"max_tokens": 80})
        content = result.get("content")
        if not content:
            logging.warning("trace summary generation for %s: empty LLM content",
                            trace_id)
            return
        trace.summary = content.strip()[:MAX_SUMMARY_CHARS]
        db.commit()
    except Exception as e:  # noqa: BLE001 - 摘要是增强能力，任何失败都不能向上抛出
        logging.warning("trace summary generation failed for trace %s: %s",
                        trace_id, e)
