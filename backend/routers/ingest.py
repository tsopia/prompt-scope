from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from db import SessionLocal, get_db
from models.entities import Project
from schemas.ingest import IngestRequest
from services.auth import require_api_key
from services.ingest_service import ingest
from services.summary_service import generate_trace_summary

router = APIRouter(tags=["ingest"])


def _summarize_in_fresh_session(trace_id: str) -> None:
    # 请求的 db session 在响应返回后就被 get_db() 关闭了，后台任务必须开
    # 一个自己的会话，用完即关，不能复用请求作用域的 session。
    db = SessionLocal()
    try:
        generate_trace_summary(db, trace_id)
    finally:
        db.close()


@router.post("/ingest")
def ingest_endpoint(
    payload: IngestRequest,
    background_tasks: BackgroundTasks,
    project: Project = Depends(require_api_key),
    db: Session = Depends(get_db),
):
    trace = ingest(db, project.id, payload)
    if project.summary_model:
        background_tasks.add_task(_summarize_in_fresh_session, trace.id)
    return {"trace_id": trace.id, "observation_count": len(payload.observations)}
