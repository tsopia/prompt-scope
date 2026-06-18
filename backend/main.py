import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from models.database import init_db, get_sync_status
from models.schemas import Candidate, CompareRequest, CompareResult, SyncStatus
from services.candidate_service import get_all_candidates, group_by_experiment, sync_candidates_from_langfuse
from services.judge_service import judge_candidates
from services.sync_service import start_sync_scheduler, stop_sync_scheduler

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    init_db()
    # 启动时先同步一次数据
    try:
        count = await sync_candidates_from_langfuse()
        logger.info(f"Initial sync: {count} candidates loaded")
    except Exception as e:
        logger.error(f"Initial sync failed: {e}")
    start_sync_scheduler(interval_minutes=5)
    yield
    stop_sync_scheduler()


app = FastAPI(
    title="PromptScope API",
    description="LLM 对比与成本优化平台",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/candidates", response_model=list[Candidate])
async def get_candidates():
    """获取所有 candidates"""
    candidates = get_all_candidates()
    return candidates


@app.get("/api/experiments", response_model=dict[str, list[Candidate]])
async def get_experiments():
    """按 experiment 分组获取 candidates"""
    candidates = get_all_candidates()
    experiments = group_by_experiment(candidates)
    return experiments


@app.post("/api/compare", response_model=CompareResult)
async def compare_candidates(request: CompareRequest):
    """对比两个 candidate"""
    candidates = get_all_candidates()
    candidate_map = {c["id"]: c for c in candidates}

    a = candidate_map.get(request.candidate_a)
    b = candidate_map.get(request.candidate_b)

    if not a or not b:
        raise HTTPException(status_code=404, detail="Candidate not found")

    result = await judge_candidates(a, b)
    return CompareResult(**result)


@app.post("/api/sync")
async def sync_data():
    """手动触发同步"""
    count = await sync_candidates_from_langfuse()
    return {"message": f"Synced {count} candidates", "count": count}


@app.get("/api/sync/status", response_model=SyncStatus)
async def get_sync_state():
    """获取同步状态"""
    status = get_sync_status()
    return SyncStatus(**status)


@app.get("/api/health")
async def health_check():
    """健康检查"""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
