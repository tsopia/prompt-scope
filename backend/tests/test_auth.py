import pytest
from fastapi import HTTPException

from models.entities import ApiKey, Project
from services.auth import generate_api_key, hash_key, resolve_api_key


def test_generate_api_key_format():
    raw, key_hash, prefix = generate_api_key()
    assert raw.startswith("ps-")
    assert len(key_hash) == 64
    assert prefix == raw[:7]
    assert hash_key(raw) == key_hash


def test_resolve_api_key(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    raw, key_hash, prefix = generate_api_key()
    db_session.add(ApiKey(project_id=p.id, key_hash=key_hash, prefix=prefix))
    db_session.commit()

    assert resolve_api_key(db_session, raw).id == p.id

    with pytest.raises(HTTPException) as exc:
        resolve_api_key(db_session, "ps-invalid")
    assert exc.value.status_code == 401


def test_revoked_key_rejected(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    raw, key_hash, prefix = generate_api_key()
    from models.entities import utcnow
    db_session.add(ApiKey(project_id=p.id, key_hash=key_hash, prefix=prefix,
                          revoked_at=utcnow()))
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        resolve_api_key(db_session, raw)
    assert exc.value.status_code == 401
