from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ReplayRun, Trace
from schemas.replay import ReplayRequest, ReplayRunOut
import services.replay_service as replay_service

router = APIRouter(tags=["replay"])


@router.post("/replays", response_model=ReplayRunOut)
def create_replay(payload: ReplayRequest, db: Session = Depends(get_db)):
    source = db.get(Trace, payload.source_trace_id)
    if source is None:
        raise HTTPException(status_code=404, detail="source trace not found")
    run = ReplayRun(
        project_id=source.project_id,
        source_trace_id=payload.source_trace_id,
        override_model=payload.override_model,
        override_model_params=payload.override_model_params,
        override_prompt_text=payload.override_prompt_text,
        override_prompt_version_id=payload.override_prompt_version_id,
        status="pending",
    )
    db.add(run)
    db.commit()
    return replay_service.execute_replay(db, run)


@router.get("/replays/{replay_id}", response_model=ReplayRunOut)
def get_replay(replay_id: str, db: Session = Depends(get_db)):
    run = db.get(ReplayRun, replay_id)
    if run is None:
        raise HTTPException(status_code=404, detail="replay run not found")
    return run


@router.get("/replays", response_model=list[ReplayRunOut])
def list_replays(source_trace_id: str, db: Session = Depends(get_db)):
    return (db.query(ReplayRun)
            .filter(ReplayRun.source_trace_id == source_trace_id)
            .order_by(ReplayRun.created_at.desc()).all())
