from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import JudgeTemplate, User
from schemas.judge_templates import (JudgeTemplateIn, JudgeTemplateOut,
                                     JudgeTemplateUpdate)
from services.authz import assert_member, assert_resource_manager, get_current_user

router = APIRouter(tags=["judge-templates"])


def _creator_names(db: Session, created_by_ids: set[str]) -> dict[str, str]:
    """Batched creator-id -> display_name lookup, one `in_` query regardless
    of how many rows are being rendered (avoids N+1 in list endpoints)."""
    ids = {cid for cid in created_by_ids if cid}
    if not ids:
        return {}
    return dict(db.query(User.id, User.display_name).filter(User.id.in_(ids)).all())


def _template_out(t: JudgeTemplate, creator_names: dict[str, str]) -> JudgeTemplateOut:
    return JudgeTemplateOut(id=t.id, project_id=t.project_id, name=t.name,
                            content=t.content, created_by=t.created_by,
                            created_by_name=creator_names.get(t.created_by),
                            created_at=t.created_at)


@router.get("/judge-templates", response_model=list[JudgeTemplateOut])
def list_judge_templates(project_id: str, db: Session = Depends(get_db),
                         user: User = Depends(get_current_user)):
    assert_member(db, user, project_id)
    rows = (db.query(JudgeTemplate).filter(JudgeTemplate.project_id == project_id)
            .order_by(JudgeTemplate.created_at).all())
    names = _creator_names(db, {t.created_by for t in rows})
    return [_template_out(t, names) for t in rows]


@router.post("/judge-templates", response_model=JudgeTemplateOut)
def create_judge_template(payload: JudgeTemplateIn, db: Session = Depends(get_db),
                          user: User = Depends(get_current_user)):
    assert_member(db, user, payload.project_id)
    if db.query(JudgeTemplate).filter(
            JudgeTemplate.project_id == payload.project_id,
            JudgeTemplate.name == payload.name).first():
        raise HTTPException(status_code=409, detail="judge template name already exists")
    t = JudgeTemplate(project_id=payload.project_id, name=payload.name,
                      content=payload.content, created_by=user.id)
    db.add(t)
    db.commit()
    return _template_out(t, _creator_names(db, {user.id}))


@router.put("/judge-templates/{template_id}", response_model=JudgeTemplateOut)
def update_judge_template(template_id: str, payload: JudgeTemplateUpdate,
                          db: Session = Depends(get_db),
                          user: User = Depends(get_current_user)):
    t = db.get(JudgeTemplate, template_id)
    if t is None:
        raise HTTPException(status_code=404, detail="judge template not found")
    assert_resource_manager(db, user, t.project_id, t.created_by)
    if payload.name is not None and payload.name != t.name and db.query(JudgeTemplate).filter(
            JudgeTemplate.project_id == t.project_id,
            JudgeTemplate.name == payload.name).first():
        raise HTTPException(status_code=409, detail="judge template name already exists")
    if payload.name is not None:
        t.name = payload.name
    if payload.content is not None:
        t.content = payload.content
    db.commit()
    return _template_out(t, _creator_names(db, {t.created_by}))


@router.delete("/judge-templates/{template_id}")
def delete_judge_template(template_id: str, db: Session = Depends(get_db),
                          user: User = Depends(get_current_user)):
    t = db.get(JudgeTemplate, template_id)
    if t is None:
        raise HTTPException(status_code=404, detail="judge template not found")
    assert_resource_manager(db, user, t.project_id, t.created_by)
    db.delete(t)
    db.commit()
    return {"deleted": True}
