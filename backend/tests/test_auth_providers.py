from models.entities import User
from services.passwords import hash_password
from services.auth_providers import (
    UserIdentity, LocalPasswordProvider, get_or_create_user)


def test_local_provider_authenticates_valid_credentials(db_session):
    db_session.add(User(email="a@x.com", display_name="A", auth_source="local",
                        password_hash=hash_password("pw123456")))
    db_session.commit()
    ident = LocalPasswordProvider().authenticate(
        db_session, {"email": "a@x.com", "password": "pw123456"})
    assert ident is not None and ident.email == "a@x.com"
    assert ident.auth_source == "local"


def test_local_provider_rejects_bad_password(db_session):
    db_session.add(User(email="a@x.com", display_name="A", auth_source="local",
                        password_hash=hash_password("pw123456")))
    db_session.commit()
    assert LocalPasswordProvider().authenticate(
        db_session, {"email": "a@x.com", "password": "wrong"}) is None
    assert LocalPasswordProvider().authenticate(
        db_session, {"email": "ghost@x.com", "password": "pw123456"}) is None


def test_get_or_create_local_never_creates(db_session):
    ident = UserIdentity(email="new@x.com", display_name="N",
                         auth_source="local", external_id=None)
    assert get_or_create_user(db_session, ident) is None


def test_get_or_create_sso_jit_provisions(db_session):
    ident = UserIdentity(email="sso@x.com", display_name="SSO",
                         auth_source="oidc", external_id="sub-123")
    u1 = get_or_create_user(db_session, ident)
    assert u1 is not None and u1.password_hash is None
    u2 = get_or_create_user(db_session, ident)
    assert u2.id == u1.id  # idempotent on (auth_source, external_id)
