from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ApiKey, Project, ProjectMember, User, utcnow
from schemas.projects import (KeyCreated, KeyCreateIn, KeyOut, ProjectCreate,
                              ProjectOut2, ProjectRename)
from services.auth import generate_api_key
from services.authz import assert_owner, get_current_user
from services.providers import resolve_provider

router = APIRouter(tags=["projects"])


@router.post("/projects", response_model=ProjectOut2)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    if db.query(Project).filter(Project.name == payload.name).first():
        raise HTTPException(status_code=409, detail="project name already exists")
    p = Project(name=payload.name, owner_id=user.id)
    db.add(p)
    db.flush()
    db.add(ProjectMember(project_id=p.id, user_id=user.id, role="owner"))
    db.commit()
    return ProjectOut2.model_validate(p)


@router.put("/projects/{project_id}", response_model=ProjectOut2)
def rename_project(project_id: str, payload: ProjectRename,
                   db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    assert_owner(db, user, project_id)
    p = db.get(Project, project_id)
    if payload.name != p.name and db.query(Project).filter(
            Project.name == payload.name).first():
        raise HTTPException(status_code=409, detail="project name already exists")
    p.name = payload.name
    if "summary_model" in payload.model_fields_set:
        if payload.summary_model:
            # 复用 GET /api/judge-models 的解析逻辑：必须有带 provider 的 pricing 行
            resolve_provider(db, payload.summary_model, project_id)
            p.summary_model = payload.summary_model
        else:
            p.summary_model = None
    db.commit()
    return ProjectOut2.model_validate(p)


@router.get("/projects/{project_id}/keys", response_model=list[KeyOut])
def list_keys(project_id: str, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    assert_owner(db, user, project_id)
    keys = (db.query(ApiKey).filter(ApiKey.project_id == project_id)
            .order_by(ApiKey.created_at.desc()).all())
    return [KeyOut.model_validate(k) for k in keys]


@router.post("/projects/{project_id}/keys", response_model=KeyCreated)
def create_key(project_id: str, payload: KeyCreateIn | None = Body(default=None),
               db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    assert_owner(db, user, project_id)
    raw, key_hash, prefix = generate_api_key()
    name = payload.name if payload else None
    k = ApiKey(project_id=project_id, key_hash=key_hash, prefix=prefix, name=name)
    db.add(k)
    db.commit()
    return KeyCreated(id=k.id, prefix=k.prefix, name=k.name, key=raw)


@router.delete("/keys/{key_id}")
def revoke_key(key_id: str, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    k = db.get(ApiKey, key_id)
    if k is None:
        raise HTTPException(status_code=404, detail="key not found")
    assert_owner(db, user, k.project_id)
    if k.revoked_at is None:
        k.revoked_at = utcnow()
        db.commit()
    return {"revoked": True}
