import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session as DbSession

from config import SESSION_TTL_DAYS
from models.entities import Session as UserSession, User, utcnow
from services.auth import hash_key


def create_session(db: DbSession, user_id: str) -> str:
    raw = "pss-" + secrets.token_urlsafe(32)
    row = UserSession(
        token_hash=hash_key(raw),
        user_id=user_id,
        expires_at=utcnow() + timedelta(days=SESSION_TTL_DAYS),
    )
    db.add(row)
    db.commit()
    return raw


def resolve_session(db: DbSession, raw: str | None) -> User | None:
    if not raw:
        return None
    row = db.query(UserSession).filter(
        UserSession.token_hash == hash_key(raw)).first()
    if row is None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        return None
    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        return None
    return user


def delete_session(db: DbSession, raw: str) -> None:
    row = db.query(UserSession).filter(
        UserSession.token_hash == hash_key(raw)).first()
    if row is not None:
        db.delete(row)
        db.commit()
