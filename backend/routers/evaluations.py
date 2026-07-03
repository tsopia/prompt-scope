from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Evaluation
from schemas.evaluations import (EvaluateRequest, EvaluateResponse,
                                 EvaluationOut, JudgeRunResult)
import services.judge_service as judge_service

router = APIRouter(tags=["evaluations"])


@router.post("/evaluations", response_model=EvaluateResponse)
def evaluate(payload: EvaluateRequest, db: Session = Depends(get_db)):
    results = []
    for judge_model in payload.judge_models:
        try:
            ev = judge_service.run_judge(
                db, payload.subject_trace_id, judge_model,
                compare_trace_id=payload.compare_trace_id,
                context_mode=payload.context_mode, force=payload.force)
            results.append(JudgeRunResult(
                judge_model=judge_model, status="ok",
                evaluation=EvaluationOut.model_validate(ev)))
        except HTTPException as e:
            results.append(JudgeRunResult(
                judge_model=judge_model, status="error", error=str(e.detail)))
        except Exception as e:  # noqa: BLE001 — 单个 judge 的意外错误不应中断批次
            results.append(JudgeRunResult(
                judge_model=judge_model, status="error",
                error=f"unexpected error: {e}"))
    return EvaluateResponse(results=results)


@router.get("/evaluations", response_model=list[EvaluationOut])
def list_evaluations(subject_trace_id: str,
                     compare_trace_id: str | None = None,
                     db: Session = Depends(get_db)):
    q = db.query(Evaluation).filter(
        Evaluation.subject_trace_id == subject_trace_id,
        Evaluation.compare_trace_id == compare_trace_id)
    return q.order_by(Evaluation.created_at.desc()).all()
