from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ApiKey, Project, utcnow
from schemas.projects import KeyCreated, KeyOut, ProjectCreate, ProjectOut2
from services.auth import generate_api_key

router = APIRouter(tags=["projects"])


@router.post("/projects", response_model=ProjectOut2)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    exists = db.query(Project).filter(Project.name == payload.name).first()
    if exists:
        raise HTTPException(status_code=409, detail="project name already exists")
    p = Project(name=payload.name)
    db.add(p)
    db.commit()
    return ProjectOut2.model_validate(p)


@router.get("/projects/{project_id}/keys", response_model=list[KeyOut])
def list_keys(project_id: str, db: Session = Depends(get_db)):
    p = db.get(Project, project_id)
    if p is None:
        raise HTTPException(status_code=404, detail="project not found")
    keys = (db.query(ApiKey).filter(ApiKey.project_id == project_id)
            .order_by(ApiKey.created_at.desc()).all())
    return [KeyOut.model_validate(k) for k in keys]


@router.post("/projects/{project_id}/keys", response_model=KeyCreated)
def create_key(project_id: str, db: Session = Depends(get_db)):
    p = db.get(Project, project_id)
    if p is None:
        raise HTTPException(status_code=404, detail="project not found")
    raw, key_hash, prefix = generate_api_key()
    k = ApiKey(project_id=project_id, key_hash=key_hash, prefix=prefix)
    db.add(k)
    db.commit()
    return KeyCreated(id=k.id, prefix=k.prefix, key=raw)


@router.delete("/keys/{key_id}")
def revoke_key(key_id: str, db: Session = Depends(get_db)):
    k = db.get(ApiKey, key_id)
    if k is None:
        raise HTTPException(status_code=404, detail="key not found")
    if k.revoked_at is None:
        k.revoked_at = utcnow()
        db.commit()
    return {"revoked": True}
