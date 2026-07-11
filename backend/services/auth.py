import hashlib
import secrets

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ApiKey, Project, utcnow


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    raw = "ps-" + secrets.token_urlsafe(32)
    return raw, hash_key(raw), raw[:7]


def resolve_api_key(db: Session, raw: str) -> Project:
    row = db.query(ApiKey).filter(ApiKey.key_hash == hash_key(raw)).first()
    if row is None or row.revoked_at is not None:
        raise HTTPException(status_code=401, detail="invalid or revoked API key")
    row.last_used_at = utcnow()
    db.commit()
    return row.project


def require_api_key(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Project:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing Authorization bearer token")
    return resolve_api_key(db, authorization.removeprefix("Bearer "))
