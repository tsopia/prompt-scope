from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Observation, Prompt, PromptVersion, Trace
from schemas.prompts import (PromptCreate, PromptDetail, PromptSummary,
                             VersionCreate, VersionOut, VersionTraceOut)

router = APIRouter(tags=["prompts"])


@router.get("/prompts", response_model=list[PromptSummary])
def list_prompts(project_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Prompt)
    if project_id:
        q = q.filter(Prompt.project_id == project_id)
    out = []
    for p in q.order_by(Prompt.created_at.desc()).all():
        # Explicitly fetch versions to ensure they're fresh
        versions = db.query(PromptVersion).filter(
            PromptVersion.prompt_id == p.id).order_by(PromptVersion.version).all()
        out.append(PromptSummary(
            id=p.id, name=p.name, version_count=len(versions),
            latest_version=versions[-1].version if versions else 0,
            created_at=p.created_at))
    return out


@router.post("/prompts", response_model=PromptDetail)
def create_prompt(payload: PromptCreate, db: Session = Depends(get_db)):
    exists = db.query(Prompt).filter(
        Prompt.project_id == payload.project_id,
        Prompt.name == payload.name).first()
    if exists:
        raise HTTPException(status_code=409, detail="prompt name already exists")
    p = Prompt(project_id=payload.project_id, name=payload.name)
    db.add(p)
    db.flush()
    db.add(PromptVersion(prompt_id=p.id, version=1, content=payload.content))
    db.commit()
    return _detail(db, p)


def _detail(db: Session, p: Prompt) -> PromptDetail:
    # Explicitly fetch versions to ensure they're fresh
    versions = db.query(PromptVersion).filter(
        PromptVersion.prompt_id == p.id).order_by(PromptVersion.version).all()
    return PromptDetail(
        id=p.id, name=p.name, project_id=p.project_id,
        versions=[VersionOut.model_validate(v) for v in versions])


@router.get("/prompts/{prompt_id}", response_model=PromptDetail)
def get_prompt(prompt_id: str, db: Session = Depends(get_db)):
    p = db.get(Prompt, prompt_id)
    if p is None:
        raise HTTPException(status_code=404, detail="prompt not found")
    return _detail(db, p)


@router.post("/prompts/{prompt_id}/versions", response_model=VersionOut)
def add_version(prompt_id: str, payload: VersionCreate,
                db: Session = Depends(get_db)):
    p = db.get(Prompt, prompt_id)
    if p is None:
        raise HTTPException(status_code=404, detail="prompt not found")
    next_version = (max((v.version for v in p.versions), default=0) + 1)
    v = PromptVersion(prompt_id=p.id, version=next_version,
                      content=payload.content)
    db.add(v)
    db.commit()
    return VersionOut.model_validate(v)


@router.get("/prompt-versions/{version_id}/traces",
            response_model=list[VersionTraceOut])
def version_traces(version_id: str, db: Session = Depends(get_db)):
    direct = db.query(Trace).filter(Trace.prompt_version_id == version_id)
    via_obs = (db.query(Trace).join(Observation,
                                    Observation.trace_id == Trace.id)
               .filter(Observation.prompt_version_id == version_id))
    seen: dict[str, Trace] = {}
    for t in direct.all() + via_obs.all():
        seen[t.id] = t
    # Sort by created_at descending, handling potential timezone mismatches
    rows = sorted(seen.values(),
                  key=lambda t: (t.created_at.replace(tzinfo=None)
                                 if t.created_at and t.created_at.tzinfo else t.created_at),
                  reverse=True)[:100]
    return [VersionTraceOut(id=t.id, name=t.name, origin=t.origin,
                            total_cost=t.total_cost, created_at=t.created_at)
            for t in rows]
