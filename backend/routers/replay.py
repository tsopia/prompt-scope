from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ReplayRun, Trace
from schemas.replay import (BatchReplayItem, BatchReplayRequest,
                            BatchReplayResponse, ReplayRequest, ReplayRunOut)
import services.replay_service as replay_service

router = APIRouter(tags=["replay"])


def _run_one(db: Session, source_trace_id: str,
            override_model: str | None,
            override_model_params: dict | None,
            override_prompt_text: str | None,
            override_prompt_version_id: str | None,
            target_observation_id: str | None = None) -> ReplayRun:
    source = db.get(Trace, source_trace_id)
    if source is None:
        raise HTTPException(status_code=404, detail="source trace not found")
    if source.origin != "live":
        raise HTTPException(status_code=400,
                            detail="replay 产出的 trace 不能再次回放（请回放其源 trace）")
    run = ReplayRun(
        project_id=source.project_id,
        source_trace_id=source_trace_id,
        target_observation_id=target_observation_id,
        override_model=override_model,
        override_model_params=override_model_params,
        override_prompt_text=override_prompt_text,
        override_prompt_version_id=override_prompt_version_id,
        status="pending",
    )
    db.add(run)
    db.commit()
    try:
        return replay_service.execute_replay(db, run)
    except HTTPException as e:
        db.rollback()
        run.status = "failed"
        run.error = str(e.detail)
        db.commit()
        raise
    except Exception as e:
        db.rollback()
        run.status = "failed"
        run.error = f"unexpected error: {e}"
        db.commit()
        raise HTTPException(status_code=500, detail=run.error) from e


@router.post("/replays", response_model=ReplayRunOut)
def create_replay(payload: ReplayRequest, db: Session = Depends(get_db)):
    return _run_one(
        db, payload.source_trace_id,
        override_model=payload.override_model,
        override_model_params=payload.override_model_params,
        override_prompt_text=payload.override_prompt_text,
        override_prompt_version_id=payload.override_prompt_version_id,
        target_observation_id=payload.target_observation_id,
    )


@router.post("/replays/batch", response_model=BatchReplayResponse)
def batch_replay(payload: BatchReplayRequest, db: Session = Depends(get_db)):
    results = []
    for source_trace_id in payload.source_trace_ids:
        try:
            run = _run_one(
                db, source_trace_id,
                override_model=payload.override_model,
                override_model_params=payload.override_model_params,
                override_prompt_text=payload.override_prompt_text,
                override_prompt_version_id=payload.override_prompt_version_id,
            )
            results.append(BatchReplayItem(
                source_trace_id=source_trace_id, status="ok",
                run=ReplayRunOut.model_validate(run)))
        except HTTPException as e:
            results.append(BatchReplayItem(
                source_trace_id=source_trace_id, status="error",
                error=str(e.detail)))
        except Exception as e:  # noqa: BLE001 — 单条回放的意外错误不应中断批次
            db.rollback()
            results.append(BatchReplayItem(
                source_trace_id=source_trace_id, status="error",
                error=f"unexpected error: {e}"))
    return BatchReplayResponse(results=results)


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
