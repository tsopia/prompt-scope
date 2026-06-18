import logging
from typing import List, Dict, Any
from services.langfuse_client import fetch_generations
from services.mock_data import generate_mock_candidates
from models.database import get_candidates, save_candidates, update_sync_status

logger = logging.getLogger(__name__)

# 内置模型定价表（每 1K tokens 美元）
# 可通过环境变量覆盖
MODEL_PRICING = {
    "gpt-4o": {"input": 0.005, "output": 0.015},
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "gpt-4-turbo": {"input": 0.01, "output": 0.03},
    "gpt-4": {"input": 0.03, "output": 0.06},
    "claude-3-5-sonnet": {"input": 0.003, "output": 0.015},
    "claude-3-opus": {"input": 0.015, "output": 0.075},
    "claude-3-haiku": {"input": 0.00025, "output": 0.00125},
    "deepseek-chat": {"input": 0.00014, "output": 0.00028},
    "gemini-1.5-pro": {"input": 0.00125, "output": 0.005},
    "gemini-1.5-flash": {"input": 0.000075, "output": 0.0003},
}


def calculate_cost(model: str, usage: Dict[str, Any]) -> float:
    """计算单次调用的成本"""
    pricing = MODEL_PRICING.get(model, {"input": 0.01, "output": 0.03})
    input_tokens = usage.get("input", 0) or usage.get("promptTokens", 0)
    output_tokens = usage.get("output", 0) or usage.get("completionTokens", 0)
    return (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1000


def generation_to_candidate(gen: Dict[str, Any]) -> Dict[str, Any]:
    """将 Langfuse generation 转换为 Candidate"""
    metadata = gen.get("metadata", {}) or {}
    usage = gen.get("usage", {}) or {}
    model = gen.get("model", "unknown")

    return {
        "id": gen.get("id", ""),
        "experiment_id": gen.get("traceId", ""),
        "input": gen.get("input", ""),
        "prompt_id": metadata.get("prompt_id", ""),
        "prompt_version": metadata.get("prompt_version"),
        "model": model,
        "output": gen.get("output", ""),
        "cost": calculate_cost(model, usage),
        "latency": gen.get("latency", 0) or 0,
        "score": None,
    }


async def sync_candidates_from_langfuse(limit: int = 100) -> int:
    """从 Langfuse 同步 candidates 到本地数据库，失败时使用 mock 数据"""
    try:
        generations = await fetch_generations(limit)
        candidates = [generation_to_candidate(g) for g in generations]
        save_candidates(candidates)
        update_sync_status(len(candidates), "success")
        logger.info(f"Synced {len(candidates)} candidates from Langfuse")
        return len(candidates)
    except Exception as e:
        logger.warning(f"Failed to fetch from Langfuse ({e}), falling back to mock data")
        candidates = generate_mock_candidates()
        save_candidates(candidates)
        update_sync_status(len(candidates), "mock")
        logger.info(f"Loaded {len(candidates)} mock candidates")
        return len(candidates)


def get_all_candidates() -> List[Dict[str, Any]]:
    """获取所有本地缓存的 candidates"""
    return get_candidates()


def group_by_experiment(candidates: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """按 experiment_id 分组 candidates"""
    experiments = {}
    for c in candidates:
        exp_id = c["experiment_id"]
        if exp_id not in experiments:
            experiments[exp_id] = []
        experiments[exp_id].append(c)
    return experiments
