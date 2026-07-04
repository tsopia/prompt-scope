from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from config import SESSION_COOKIE_NAME
from db import get_db
from models.entities import Project, ProjectMember, Trace, User
from services.sessions import resolve_session


def get_current_user(
    ps_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> User:
    user = resolve_session(db, ps_session)
    if user is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return user


def member_project_ids(db: Session, user: User) -> list[str]:
    rows = db.query(ProjectMember.project_id).filter(
        ProjectMember.user_id == user.id).all()
    return [r[0] for r in rows]


def assert_member(db: Session, user: User, project_id: str) -> ProjectMember:
    if db.get(Project, project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    m = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user.id).first()
    if m is None:
        raise HTTPException(status_code=403, detail="not a workspace member")
    return m


def assert_owner(db: Session, user: User, project_id: str) -> ProjectMember:
    m = assert_member(db, user, project_id)
    if m.role != "owner":
        raise HTTPException(status_code=403, detail="owner role required")
    return m


def assert_trace_access(db: Session, user: User, trace_id: str) -> Trace:
    t = db.get(Trace, trace_id)
    if t is None:
        raise HTTPException(status_code=404, detail="trace not found")
    assert_member(db, user, t.project_id)
    return t
