import pytest
from fastapi.testclient import TestClient

from db import get_db


@pytest.fixture()
def client(db_session):
    from main import app
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_register_sets_cookie_and_me_works(client):
    r = client.post("/api/auth/register", json={
        "email": "a@x.com", "password": "pw123456", "display_name": "A"})
    assert r.status_code == 200
    assert r.json()["email"] == "a@x.com"
    assert client.cookies.get("ps_session")

    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["email"] == "a@x.com"


def test_duplicate_email_409(client):
    body = {"email": "a@x.com", "password": "pw123456", "display_name": "A"}
    assert client.post("/api/auth/register", json=body).status_code == 200
    assert client.post("/api/auth/register", json=body).status_code == 409


def test_login_wrong_password_401(client):
    client.post("/api/auth/register", json={
        "email": "a@x.com", "password": "pw123456", "display_name": "A"})
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={
        "email": "a@x.com", "password": "nope"}).status_code == 401
    ok = client.post("/api/auth/login", json={
        "email": "a@x.com", "password": "pw123456"})
    assert ok.status_code == 200


def test_me_without_session_401(client):
    assert client.get("/api/auth/me").status_code == 401


def test_logout_clears_session(client):
    client.post("/api/auth/register", json={
        "email": "a@x.com", "password": "pw123456", "display_name": "A"})
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
