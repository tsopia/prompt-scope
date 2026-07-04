from datetime import timedelta

from models.entities import User, Session as UserSession, utcnow
from services.sessions import create_session, resolve_session, delete_session


def _user(db):
    u = User(email="s@x.com", display_name="S", auth_source="local")
    db.add(u)
    db.commit()
    return u


def test_create_and_resolve_session(db_session):
    u = _user(db_session)
    raw = create_session(db_session, u.id)
    assert isinstance(raw, str) and len(raw) > 20
    assert resolve_session(db_session, raw).id == u.id
    assert resolve_session(db_session, "nope") is None
    assert resolve_session(db_session, None) is None


def test_expired_session_rejected(db_session):
    u = _user(db_session)
    raw = create_session(db_session, u.id)
    row = db_session.query(UserSession).one()
    row.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()
    assert resolve_session(db_session, raw) is None


def test_delete_session(db_session):
    u = _user(db_session)
    raw = create_session(db_session, u.id)
    delete_session(db_session, raw)
    assert resolve_session(db_session, raw) is None
