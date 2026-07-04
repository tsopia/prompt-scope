from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from db import get_db
from models.entities import Observation, Project, Trace
from schemas.query import ObservationNode, ProjectOut, TraceDetail, TraceListOut, TraceSummary

router = APIRouter(tags=["query"])


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.created_at).all()


@router.get("/traces", response_model=TraceListOut)
def list_traces(
    project_id: str | None = None,
    origin: str | None = None,
    search: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(Trace)
    if project_id:
        q = q.filter(Trace.project_id == project_id)
    if origin:
        q = q.filter(Trace.origin == origin)
    if search:
        q = q.filter(Trace.name.ilike(f"%{search}%"))
    total = q.count()
    rows = (q.options(selectinload(Trace.observations))
            .order_by(Trace.created_at.desc()).offset(offset).limit(limit).all())

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
def get_trace(trace_id: str, db: Session = Depends(get_db)):
    t = db.get(Trace, trace_id)
    if t is None:
        raise HTTPException(status_code=404, detail="trace not found")
    detail = TraceDetail.model_validate({
        **{c: getattr(t, c) for c in (
            "id", "project_id", "name", "origin", "status", "input", "output",
            "started_at", "ended_at", "latency_ms", "total_input_tokens",
            "total_output_tokens", "total_cost", "created_at")},
        "metadata": t.meta,
        "observations": build_tree(list(t.observations)),
    })
    return detail
