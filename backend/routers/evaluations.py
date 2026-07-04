from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Evaluation, Trace, User
from schemas.evaluations import (BatchEvaluateItem, BatchEvaluateRequest,
                                 BatchEvaluateResponse, EvaluateRequest,
                                 EvaluateResponse, EvaluationOut, JudgeRunResult)
from services.authz import assert_member, get_current_user
import services.judge_service as judge_service

router = APIRouter(tags=["evaluations"])


def _project_for_trace(db: Session, trace_id: str) -> str:
    t = db.get(Trace, trace_id)
    if t is None:
        raise HTTPException(status_code=404, detail="trace not found")
    return t.project_id


@router.post("/evaluations", response_model=EvaluateResponse)
def evaluate(payload: EvaluateRequest, db: Session = Depends(get_db),
            user: User = Depends(get_current_user)):
    assert_member(db, user, _project_for_trace(db, payload.subject_trace_id))
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
            db.rollback()  # 避免 session 进入 pending-rollback 拖垮同批后续 judge
            results.append(JudgeRunResult(
                judge_model=judge_model, status="error",
                error=f"unexpected error: {e}"))
    return EvaluateResponse(results=results)


@router.post("/evaluations/batch", response_model=BatchEvaluateResponse)
def batch_evaluate(payload: BatchEvaluateRequest, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    results = []
    for subject_trace_id in payload.subject_trace_ids:
        for judge_model in payload.judge_models:
            try:
                assert_member(db, user, _project_for_trace(db, subject_trace_id))
                ev = judge_service.run_judge(
                    db, subject_trace_id, judge_model,
                    compare_trace_id=None,
                    context_mode=payload.context_mode, force=payload.force)
                results.append(BatchEvaluateItem(
                    subject_trace_id=subject_trace_id, judge_model=judge_model,
                    status="ok", evaluation=EvaluationOut.model_validate(ev)))
            except HTTPException as e:
                results.append(BatchEvaluateItem(
                    subject_trace_id=subject_trace_id, judge_model=judge_model,
                    status="error", error=str(e.detail)))
            except Exception as e:  # noqa: BLE001 — 单个组合的意外错误不应中断批次
                db.rollback()
                results.append(BatchEvaluateItem(
                    subject_trace_id=subject_trace_id, judge_model=judge_model,
                    status="error", error=f"unexpected error: {e}"))
    return BatchEvaluateResponse(results=results)


@router.get("/evaluations", response_model=list[EvaluationOut])
def list_evaluations(subject_trace_id: str,
                     compare_trace_id: str | None = None,
                     db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)):
    assert_member(db, user, _project_for_trace(db, subject_trace_id))
    q = db.query(Evaluation).filter(
        Evaluation.subject_trace_id == subject_trace_id,
        Evaluation.compare_trace_id == compare_trace_id)
    return q.order_by(Evaluation.created_at.desc()).all()
