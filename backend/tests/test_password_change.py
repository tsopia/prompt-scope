import pytest
from fastapi.testclient import TestClient

from db import get_db
from models.entities import User


@pytest.fixture()
def client(db_session):
    from main import app
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _register(client, email="a@x.com", password="pw123456"):
    return client.post("/api/auth/register", json={
        "email": email, "password": password, "display_name": "A"})


def test_change_password_success_old_fails_new_succeeds(client):
    _register(client)

    resp = client.post("/api/auth/change-password", json={
        "current_password": "pw123456", "new_password": "newpw12345"})
    assert resp.status_code == 200
    assert resp.json() == {"changed": True}

    client.post("/api/auth/logout")
    old = client.post("/api/auth/login", json={
        "email": "a@x.com", "password": "pw123456"})
    assert old.status_code == 401
    new = client.post("/api/auth/login", json={
        "email": "a@x.com", "password": "newpw12345"})
    assert new.status_code == 200


def test_change_password_wrong_current_400(client):
    _register(client)
    resp = client.post("/api/auth/change-password", json={
        "current_password": "wrongpw", "new_password": "newpw12345"})
    assert resp.status_code == 400


def test_change_password_short_new_422(client):
    _register(client)
    resp = client.post("/api/auth/change-password", json={
        "current_password": "pw123456", "new_password": "short"})
    assert resp.status_code == 422


def test_change_password_revokes_other_sessions_keeps_current(db_session):
    from main import app
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        with TestClient(app) as client_a, TestClient(app) as client_b:
            client_a.post("/api/auth/register", json={
                "email": "a@x.com", "password": "pw123456", "display_name": "A"})
            # second session for the same user, sharing the same db
            client_b.post("/api/auth/login", json={
                "email": "a@x.com", "password": "pw123456"})

            resp = client_a.post("/api/auth/change-password", json={
                "current_password": "pw123456", "new_password": "newpw12345"})
            assert resp.status_code == 200

            assert client_b.get("/api/auth/me").status_code == 401
            assert client_a.get("/api/auth/me").status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_change_password_sso_user_400(client, db_session):
    from services.sessions import create_session

    user = User(email="sso@x.com", display_name="SSO", auth_source="oidc",
                external_id="ext-1")
    db_session.add(user)
    db_session.commit()

    raw = create_session(db_session, user.id)
    client.cookies.set("ps_session", raw)

    resp = client.post("/api/auth/change-password", json={
        "current_password": "whatever", "new_password": "newpw12345"})
    assert resp.status_code == 400
    assert "SSO" in resp.json()["detail"]
