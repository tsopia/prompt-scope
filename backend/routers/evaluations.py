from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Evaluation, JudgeTemplate, Trace, User
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


def _evaluation_out(db: Session, ev: Evaluation, template_name: str | None) -> EvaluationOut:
    out = EvaluationOut.model_validate(ev)
    out.judge_template_name = template_name
    return out


def _resolve_template_name(db: Session, judge_template_id: str | None) -> str | None:
    """单次查询解析一个请求里共用的 judge_template_id -> name，
    而不是每个 judge_model/subject_trace 结果各查一次（避免 N+1）。"""
    if judge_template_id is None:
        return None
    t = db.get(JudgeTemplate, judge_template_id)
    return t.name if t is not None else None


@router.post("/evaluations", response_model=EvaluateResponse)
def evaluate(payload: EvaluateRequest, db: Session = Depends(get_db),
            user: User = Depends(get_current_user)):
    assert_member(db, user, _project_for_trace(db, payload.subject_trace_id))
    template_name = _resolve_template_name(db, payload.judge_template_id)
    results = []
    for judge_model in payload.judge_models:
        try:
            ev = judge_service.run_judge(
                db, payload.subject_trace_id, judge_model,
                compare_trace_id=payload.compare_trace_id,
                context_mode=payload.context_mode, force=payload.force,
                judge_template_id=payload.judge_template_id)
            results.append(JudgeRunResult(
                judge_model=judge_model, status="ok",
                evaluation=_evaluation_out(db, ev, template_name)))
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
    template_name = _resolve_template_name(db, payload.judge_template_id)
    results = []
    for subject_trace_id in payload.subject_trace_ids:
        for judge_model in payload.judge_models:
            try:
                assert_member(db, user, _project_for_trace(db, subject_trace_id))
                ev = judge_service.run_judge(
                    db, subject_trace_id, judge_model,
                    compare_trace_id=None,
                    context_mode=payload.context_mode, force=payload.force,
                    judge_template_id=payload.judge_template_id)
                results.append(BatchEvaluateItem(
                    subject_trace_id=subject_trace_id, judge_model=judge_model,
                    status="ok", evaluation=_evaluation_out(db, ev, template_name)))
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
    # outerjoin 一次性拿到 judge_template_name，避免每行各查一次模板名（N+1）。
    rows = (db.query(Evaluation, JudgeTemplate.name)
            .outerjoin(JudgeTemplate, Evaluation.judge_template_id == JudgeTemplate.id)
            .filter(Evaluation.subject_trace_id == subject_trace_id,
                   Evaluation.compare_trace_id == compare_trace_id)
            .order_by(Evaluation.created_at.desc()).all())
    return [_evaluation_out(db, ev, name) for ev, name in rows]
