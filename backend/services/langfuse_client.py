import os
import httpx
from typing import List, Dict, Any

LANGFUSE_HOST = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
LANGFUSE_PUBLIC_KEY = os.getenv("LANGFUSE_PUBLIC_KEY")
LANGFUSE_SECRET_KEY = os.getenv("LANGFUSE_SECRET_KEY")


async def fetch_generations(limit: int = 100) -> List[Dict[str, Any]]:
    """从 Langfuse API 获取 generations 数据"""
    if not LANGFUSE_PUBLIC_KEY or not LANGFUSE_SECRET_KEY:
        raise ValueError("LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set")

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{LANGFUSE_HOST}/api/public/generations",
            auth=(LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY),
            params={"limit": limit},
            timeout=30.0
        )
        response.raise_for_status()
        data = response.json()
        return data.get("data", [])
