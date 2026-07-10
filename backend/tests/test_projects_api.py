import pytest


@pytest.fixture()
def client(user_client):
    return user_client


@pytest.fixture()
def project(client):
    return client.post("/api/projects", json={"name": "demo"}).json()


def test_create_project_and_duplicate_409(client):
    resp = client.post("/api/projects", json={"name": "acme"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "acme"
    assert "id" in body and "created_at" in body
    assert client.post("/api/projects", json={"name": "acme"}).status_code == 409


def test_anonymous_cannot_create_project(db_session):
    from fastapi.testclient import TestClient
    from db import get_db
    from main import app
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        assert c.post("/api/projects", json={"name": "x"}).status_code == 401
    app.dependency_overrides.clear()


def test_create_key_returns_plaintext_once_and_list_hides_it(client, project):
    pid = project["id"]
    resp = client.post(f"/api/projects/{pid}/keys")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"id", "prefix", "name", "key"}
    plaintext_key = body["key"]
    assert plaintext_key.startswith("ps-")
    assert body["prefix"] == plaintext_key[:7]

    resp2 = client.post(f"/api/projects/{pid}/keys")
    plaintext_key2 = resp2.json()["key"]

    list_resp = client.get(f"/api/projects/{pid}/keys")
    assert list_resp.status_code == 200
    assert plaintext_key not in list_resp.text
    assert plaintext_key2 not in list_resp.text
    keys = list_resp.json()
    assert [k["id"] for k in keys] == [resp2.json()["id"], body["id"]]


def test_revoke_key_is_idempotent(client, project):
    pid = project["id"]
    key_id = client.post(f"/api/projects/{pid}/keys").json()["id"]
    assert client.delete(f"/api/keys/{key_id}").json() == {"revoked": True}
    revoked_at_1 = client.get(f"/api/projects/{pid}/keys").json()[0]["revoked_at"]
    assert revoked_at_1 is not None
    assert client.delete(f"/api/keys/{key_id}").json() == {"revoked": True}
    revoked_at_2 = client.get(f"/api/projects/{pid}/keys").json()[0]["revoked_at"]
    assert revoked_at_2 == revoked_at_1


def test_non_owner_cannot_touch_keys(client, project):
    # second user is not a member → 403 (404 if project resolution hides it)
    client.post("/api/auth/logout")
    client.post("/api/auth/register", json={
        "email": "intruder@x.com", "password": "pw123456", "display_name": "I"})
    assert client.post(f"/api/projects/{project['id']}/keys").status_code == 403


def test_create_key_missing_project_404_and_delete_unknown_key_404(client):
    assert client.post("/api/projects/nope/keys").status_code == 404
    assert client.delete("/api/keys/nope").status_code == 404


def test_create_key_with_name_roundtrips_and_last_used_touched_on_use(client, project, db_session):
    pid = project["id"]
    created = client.post(f"/api/projects/{pid}/keys", json={"name": "生产上报"}).json()
    assert created["name"] == "生产上报"

    listed = client.get(f"/api/projects/{pid}/keys").json()
    assert listed[0]["name"] == "生产上报"
    assert listed[0]["last_used_at"] is None

    # authenticating an ingest call with the raw key should touch last_used_at
    from services.auth import resolve_api_key
    resolve_api_key(db_session, created["key"])
    listed_after = client.get(f"/api/projects/{pid}/keys").json()
    assert listed_after[0]["last_used_at"] is not None


def test_key_without_name_defaults_to_none(client, project):
    pid = project["id"]
    created = client.post(f"/api/projects/{pid}/keys", json={}).json()
    assert created["name"] is None
    created2 = client.post(f"/api/projects/{pid}/keys").json()
    assert created2["name"] is None


def test_rename_project_success_and_duplicate_409(client, project):
    other = client.post("/api/projects", json={"name": "other"}).json()
    resp = client.put(f"/api/projects/{project['id']}", json={"name": "renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "renamed"
    assert client.get("/api/projects").json()  # sanity: still listable

    dup = client.put(f"/api/projects/{project['id']}", json={"name": other["name"]})
    assert dup.status_code == 409


def test_rename_project_requires_owner(client, project):
    client.post("/api/auth/register", json={
        "email": "member2@x.com", "password": "pw123456", "display_name": "M2"})
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email": "owner@x.com", "password": "pw123456"})
    client.post(f"/api/projects/{project['id']}/members", json={"email": "member2@x.com"})

    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email": "member2@x.com", "password": "pw123456"})
    resp = client.put(f"/api/projects/{project['id']}", json={"name": "hijacked"})
    assert resp.status_code == 403


def test_rename_project_missing_404(client):
    assert client.put("/api/projects/nope", json={"name": "x"}).status_code == 404
