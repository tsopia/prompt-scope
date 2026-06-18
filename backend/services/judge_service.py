import os
import json
import logging
from typing import Dict, Any
import httpx
from models.database import save_compare_result, get_compare_result

logger = logging.getLogger(__name__)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")


async def judge_candidates(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    """
    调用 OpenAI 进行 LLM Judge 评估
    先查本地缓存，没有则调用 API
    """
    # 先查缓存
    cached = get_compare_result(a["id"], b["id"])
    if cached:
        return {
            "candidate_a": cached["candidate_a"],
            "candidate_b": cached["candidate_b"],
            "replaceable": bool(cached["replaceable"]),
            "score_a": cached["score_a"],
            "score_b": cached["score_b"],
            "cost_diff": cached["cost_diff"],
            "reason": cached["reason"],
            "from_cache": True,
        }

    prompt = f"""你是评估专家，负责评估两个 LLM 输出是否可以互相替代。

参考答案（B）：
{b["output"]}

候选答案（A）：
{a["output"]}

任务：
1. 判断候选答案（A）是否可以替代参考答案（B）：true/false
2. 分别给两个答案打分（1-10分，10分为最好）
3. 简要说明理由

请返回以下 JSON 格式：
{{
  "replaceable": true,
  "score_a": 8.2,
  "score_b": 9.0,
  "reason": "候选答案虽然略有不同，但核心信息一致，可以替代。"
}}

请确保返回的是有效 JSON，不要包含其他内容。"""

    result = None
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{OPENAI_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.3,
                },
                timeout=60.0,
            )
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            result = json.loads(content)
    except Exception as e:
        logger.warning(f"OpenAI judge failed ({e}), using mock result")
        result = None

    cost_diff = b["cost"] - a["cost"]

    if result:
        compare_result = {
            "candidate_a": a["id"],
            "candidate_b": b["id"],
            "replaceable": result.get("replaceable", False),
            "score_a": float(result.get("score_a", 0)),
            "score_b": float(result.get("score_b", 0)),
            "cost_diff": cost_diff,
            "reason": result.get("reason", ""),
        }
    else:
        # Mock judge result
        compare_result = {
            "candidate_a": a["id"],
            "candidate_b": b["id"],
            "replaceable": True,
            "score_a": 7.5,
            "score_b": 8.5,
            "cost_diff": cost_diff,
            "reason": "[Mock] 候选答案与参考答案核心内容一致，可以替代。",
        }

    save_compare_result(compare_result)
    compare_result["from_cache"] = False
    return compare_result
