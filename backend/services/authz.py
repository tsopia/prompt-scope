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


def assert_resource_manager(db: Session, user: User, project_id: str,
                            created_by: str | None) -> ProjectMember:
    """写权限收窄至资源的创建者或所属 project 的 owner。

    ModelProvider.base_url 可写意味着一个恶意/被盗账号的成员能把 base_url 改到
    自己控制的服务器上——出站调用（services.llm_client）会带着解密后的 api_key
    请求这个被替换的地址，等于把密钥原样递出去。把 provider/pricing 的写权限
    收窄到 creator∨owner 就堵住了这条跨成员窃密路径，同时不必让所有写操作都
    经过 owner 审批（创建者仍可自行维护自己接入的 provider/pricing）。

    先走 assert_member 保留既有的 404/403 语义（project 不存在 → 404，非成员
    → 403），再判断 created_by 匹配或 owner 角色；历史行 created_by 为 NULL 时
    只有 owner 能改。
    """
    m = assert_member(db, user, project_id)
    if user.id == created_by or m.role == "owner":
        return m
    raise HTTPException(status_code=403, detail="仅创建者或项目 owner 可修改")


def assert_trace_access(db: Session, user: User, trace_id: str) -> Trace:
    t = db.get(Trace, trace_id)
    if t is None:
        raise HTTPException(status_code=404, detail="trace not found")
    assert_member(db, user, t.project_id)
    return t
