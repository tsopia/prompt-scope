import pytest


@pytest.fixture()
def client(user_client):
    return user_client


@pytest.fixture()
def project(client):
    return client.post("/api/projects", json={"name": "grp"}).json()


def _register_second(client):
    client.post("/api/auth/register", json={
        "email": "member2@x.com", "password": "pw123456", "display_name": "M2"})
    # registering logs the second user in; log back in as owner afterward
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={
        "email": "owner@x.com", "password": "pw123456"})


def test_owner_lists_self_as_member(client, project):
    r = client.get(f"/api/projects/{project['id']}/members")
    assert r.status_code == 200
    members = r.json()
    assert len(members) == 1 and members[0]["role"] == "owner"
    assert members[0]["email"] == "owner@x.com"


def test_add_existing_user_as_member(client, project):
    _register_second(client)
    r = client.post(f"/api/projects/{project['id']}/members",
                    json={"email": "member2@x.com"})
    assert r.status_code == 200
    roles = {m["email"]: m["role"]
             for m in client.get(f"/api/projects/{project['id']}/members").json()}
    assert roles == {"owner@x.com": "owner", "member2@x.com": "member"}


def test_add_unregistered_email_404(client, project):
    assert client.post(f"/api/projects/{project['id']}/members",
                       json={"email": "ghost@x.com"}).status_code == 404


def test_add_duplicate_member_409(client, project):
    _register_second(client)
    client.post(f"/api/projects/{project['id']}/members",
                json={"email": "member2@x.com"})
    assert client.post(f"/api/projects/{project['id']}/members",
                       json={"email": "member2@x.com"}).status_code == 409


def test_cannot_remove_last_owner(client, project):
    owner_id = client.get("/api/auth/me").json()["id"]
    r = client.delete(f"/api/projects/{project['id']}/members/{owner_id}")
    assert r.status_code == 400
