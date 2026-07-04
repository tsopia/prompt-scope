import pytest
from fastapi.testclient import TestClient

from db import get_db
from models.entities import Project


@pytest.fixture()
def client(db_session):
    from main import app

    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def project(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.commit()
    return p


def test_create_project_and_duplicate_409(client):
    resp = client.post("/api/projects", json={"name": "acme"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "acme"
    assert "id" in body and "created_at" in body

    assert client.post("/api/projects", json={"name": "acme"}).status_code == 409


def test_create_key_returns_plaintext_once_and_list_hides_it(client, project):
    resp = client.post(f"/api/projects/{project.id}/keys")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"id", "prefix", "key"}
    plaintext_key = body["key"]
    assert plaintext_key.startswith("ps-")
    assert body["prefix"] == plaintext_key[:7]

    resp2 = client.post(f"/api/projects/{project.id}/keys")
    plaintext_key2 = resp2.json()["key"]

    list_resp = client.get(f"/api/projects/{project.id}/keys")
    assert list_resp.status_code == 200
    assert plaintext_key not in list_resp.text
    assert plaintext_key2 not in list_resp.text

    keys = list_resp.json()
    assert [k["id"] for k in keys] == [resp2.json()["id"], body["id"]]
    for k in keys:
        assert set(k.keys()) == {"id", "prefix", "created_at", "revoked_at"}
        assert k["revoked_at"] is None


def test_revoke_key_is_idempotent(client, project):
    key_id = client.post(f"/api/projects/{project.id}/keys").json()["id"]

    resp = client.delete(f"/api/keys/{key_id}")
    assert resp.status_code == 200
    assert resp.json() == {"revoked": True}

    revoked_at_1 = client.get(f"/api/projects/{project.id}/keys").json()[0]["revoked_at"]
    assert revoked_at_1 is not None

    resp2 = client.delete(f"/api/keys/{key_id}")
    assert resp2.status_code == 200
    assert resp2.json() == {"revoked": True}

    revoked_at_2 = client.get(f"/api/projects/{project.id}/keys").json()[0]["revoked_at"]
    assert revoked_at_2 == revoked_at_1


def test_create_key_missing_project_404_and_delete_unknown_key_404(client):
    assert client.post("/api/projects/nope/keys").status_code == 404
    assert client.delete("/api/keys/nope").status_code == 404
