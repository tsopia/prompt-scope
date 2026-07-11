import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, selectinload

from db import get_db
from models.entities import Observation, Project, ReplayRun, Trace, User
from schemas.query import (ObservationNode, ProjectOut, TraceDetail,
                           TraceListOut, TraceSummary)
from services.authz import (assert_member, assert_trace_access,
                            get_current_user, member_project_ids)

router = APIRouter(tags=["query"])

INPUT_PREVIEW_MAX_CHARS = 120
_INPUT_PREVIEW_KEYS = ("query", "question", "input", "text")


def derive_input_preview(value) -> str | None:
    """工程兜底：从 trace.input 派生一句话预览（非 LLM 摘要）。"""
    if value is None:
        return None
    if isinstance(value, str):
        text = value
    elif isinstance(value, dict):
        text = None
        for key in _INPUT_PREVIEW_KEYS:
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                text = candidate
                break
        if text is None:
            text = json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                              default=str)
    else:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                          default=str)
    text = text.strip()
    return text[:INPUT_PREVIEW_MAX_CHARS] if text else None


_REPLAY_SOURCE_OPTIONAL_KEYS = ("source_trace_name", "override_model", "thinking")


def derive_replay_source(meta: dict | None) -> dict | None:
    """从 trace.meta 中抽取回放血缘的展示子集，非回放结果 trace 返回 None。"""
    if not meta or "source_trace_id" not in meta:
        return None
    result = {"source_trace_id": meta["source_trace_id"]}
    for key in _REPLAY_SOURCE_OPTIONAL_KEYS:
        if key in meta:
            result[key] = meta[key]
    return result


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    ids = member_project_ids(db, user)
    if not ids:
        return []
    return (db.query(Project).filter(Project.id.in_(ids))
            .order_by(Project.created_at).all())


@router.get("/traces", response_model=TraceListOut)
def list_traces(
    project_id: str | None = None,
    origin: str | None = None,
    search: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if project_id:
        assert_member(db, user, project_id)
        allowed = [project_id]
    else:
        allowed = member_project_ids(db, user)
    q = db.query(Trace).filter(Trace.project_id.in_(allowed)) if allowed \
        else db.query(Trace).filter(False)
    if origin:
        q = q.filter(Trace.origin == origin)
    if search:
        q = q.filter(Trace.name.ilike(f"%{search}%"))
    total = q.count()
    rows = (q.options(selectinload(Trace.observations))
            .order_by(Trace.created_at.desc()).offset(offset).limit(limit).all())

    divergence_counts: dict[str, int] = {}
    if rows:
        ids = [t.id for t in rows]
        for result_trace_id, divergences in (
                db.query(ReplayRun.result_trace_id, ReplayRun.divergences)
                .filter(ReplayRun.result_trace_id.in_(ids)).all()):
            divergence_counts[result_trace_id] = len(divergences or [])

    items = []
    for t in rows:
        obs = t.observations
        models = sorted({o.model for o in obs if o.type == "llm" and o.model})
        items.append(TraceSummary(
            id=t.id, name=t.name, origin=t.origin, status=t.status,
            model_summary=", ".join(models), observation_count=len(obs),
            total_input_tokens=t.total_input_tokens,
            total_output_tokens=t.total_output_tokens,
            total_cost=t.total_cost, latency_ms=t.latency_ms,
            started_at=t.started_at, created_at=t.created_at,
            divergence_count=divergence_counts.get(t.id, 0),
            summary=t.summary,
            input_preview=derive_input_preview(t.input),
            replay_source=derive_replay_source(t.meta),
        ))
    return TraceListOut(items=items, total=total)


def build_tree(observations: list[Observation]) -> list[ObservationNode]:
    nodes = {o.id: ObservationNode.model_validate(o) for o in observations}
    roots: list[ObservationNode] = []
    for o in sorted(observations, key=lambda x: x.seq):
        node = nodes[o.id]
        if o.parent_id and o.parent_id in nodes:
            nodes[o.parent_id].children.append(node)
        else:
            roots.append(node)
    return roots


@router.get("/traces/{trace_id}", response_model=TraceDetail)
def get_trace(trace_id: str, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    t = assert_trace_access(db, user, trace_id)
    replay_run = (db.query(ReplayRun)
                  .filter(ReplayRun.result_trace_id == trace_id).first())
    return TraceDetail.model_validate({
        **{c: getattr(t, c) for c in (
            "id", "project_id", "name", "origin", "status", "input", "output",
            "started_at", "ended_at", "latency_ms", "total_input_tokens",
            "total_output_tokens", "total_cost", "created_at")},
        "metadata": t.meta,
        "divergence_count": len(replay_run.divergences or []) if replay_run else 0,
        "summary": t.summary,
        "observations": build_tree(list(t.observations)),
    })
