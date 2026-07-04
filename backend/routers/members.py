from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ProjectMember, User
from schemas.members import MemberAddIn, MemberOut
from services.authz import assert_member, assert_owner, get_current_user

router = APIRouter(tags=["members"])


@router.get("/projects/{project_id}/members", response_model=list[MemberOut])
def list_members(project_id: str, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    assert_member(db, user, project_id)
    rows = (db.query(ProjectMember, User)
            .join(User, ProjectMember.user_id == User.id)
            .filter(ProjectMember.project_id == project_id)
            .order_by(ProjectMember.created_at).all())
    return [MemberOut(user_id=u.id, email=u.email, display_name=u.display_name,
                      role=m.role, created_at=m.created_at) for m, u in rows]


@router.post("/projects/{project_id}/members", response_model=list[MemberOut])
def add_member(project_id: str, payload: MemberAddIn,
               db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    assert_owner(db, user, project_id)
    target = db.query(User).filter(
        User.email == payload.email.strip().lower()).first()
    if target is None:
        raise HTTPException(status_code=404, detail="no registered user with that email")
    exists = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == target.id).first()
    if exists:
        raise HTTPException(status_code=409, detail="already a member")
    db.add(ProjectMember(project_id=project_id, user_id=target.id, role="member"))
    db.commit()
    return list_members(project_id, db, user)


@router.delete("/projects/{project_id}/members/{user_id}")
def remove_member(project_id: str, user_id: str, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    assert_owner(db, user, project_id)
    m = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user_id).first()
    if m is None:
        raise HTTPException(status_code=404, detail="member not found")
    if m.role == "owner":
        owner_count = db.query(ProjectMember).filter(
            ProjectMember.project_id == project_id,
            ProjectMember.role == "owner").count()
        if owner_count <= 1:
            raise HTTPException(status_code=400, detail="cannot remove the last owner")
    db.delete(m)
    db.commit()
    return {"removed": True}
