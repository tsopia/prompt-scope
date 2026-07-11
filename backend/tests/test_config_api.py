import pytest

from models.entities import ModelProvider, Project, ProjectMember
from services.crypto import decrypt_secret, is_encrypted


@pytest.fixture()
def client(user_client):
    return user_client


@pytest.fixture()
def project(db_session, client):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    db_session.add(ProjectMember(project_id=p.id, user_id=client.user_id, role="owner"))
    db_session.commit()
    return p


def test_provider_crud_and_key_masking(client, project):
    resp = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "openai", "base_url": "https://api.openai.com/v1",
        "api_key": "sk-secret", "provider_type": "openai"})
    assert resp.status_code == 200
    body = resp.json()
    pid = body["id"]
    assert body["project_id"] == project.id
    assert body["api_key_set"] is True
    assert "sk-secret" not in resp.text

    assert client.post("/api/providers", json={
        "project_id": project.id,
        "name": "openai", "base_url": "x", "api_key": "y",
        "provider_type": "openai"}).status_code == 409

    resp = client.put(f"/api/providers/{pid}", json={
        "project_id": project.id,
        "name": "openai-2", "base_url": "https://api.openai.com/v1",
        "provider_type": "openai"})
    assert resp.json()["name"] == "openai-2"
    assert resp.json()["api_key_set"] is True  # key 保留

    assert client.get(f"/api/providers?project_id={project.id}").json()[0]["name"] == "openai-2"
    assert client.delete(f"/api/providers/{pid}").json() == {"deleted": True}
    assert client.get(f"/api/providers?project_id={project.id}").json() == []


def test_pricing_crud_and_judge_models(client, project):
    pid = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "openai", "base_url": "https://api.openai.com/v1",
        "api_key": "sk-x", "provider_type": "openai"}).json()["id"]

    resp = client.post("/api/pricing", json={
        "project_id": project.id,
        "model": "gpt-4o", "input_price_per_1k": 0.005,
        "output_price_per_1k": 0.015, "provider_id": pid})
    assert resp.status_code == 200
    price_id = resp.json()["id"]

    assert client.post("/api/pricing", json={
        "project_id": project.id,
        "model": "gpt-4o", "input_price_per_1k": 1,
        "output_price_per_1k": 1}).status_code == 409

    client.post("/api/pricing", json={
        "project_id": project.id,
        "model": "no-provider-model", "input_price_per_1k": 0.001,
        "output_price_per_1k": 0.002})

    judge_models = client.get(f"/api/judge-models?project_id={project.id}").json()
    assert judge_models == [{"model": "gpt-4o", "provider_name": "openai"}]

    resp = client.put(f"/api/pricing/{price_id}", json={
        "project_id": project.id,
        "model": "gpt-4o", "input_price_per_1k": 0.006,
        "output_price_per_1k": 0.015, "provider_id": pid})
    assert resp.json()["input_price_per_1k"] == 0.006

    client.delete(f"/api/pricing/{price_id}")
    assert client.get(f"/api/judge-models?project_id={project.id}").json() == []


def test_provider_kind_and_note_roundtrip(client, project):
    resp = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "openrouter", "base_url": "https://openrouter.ai/api/v1",
        "api_key": "sk-x", "provider_type": "openai",
        "kind": "aggregator", "note": "聚合 200+ 模型"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "aggregator"
    assert body["note"] == "聚合 200+ 模型"
    pid = body["id"]

    # default kind when omitted
    default_resp = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "openai-official", "base_url": "https://api.openai.com/v1",
        "api_key": "sk-y", "provider_type": "openai"})
    assert default_resp.json()["kind"] == "official"
    assert default_resp.json()["note"] is None

    updated = client.put(f"/api/providers/{pid}", json={
        "project_id": project.id,
        "name": "openrouter", "base_url": "https://openrouter.ai/api/v1",
        "provider_type": "openai", "kind": "official", "note": "改为官方"})
    assert updated.json()["kind"] == "official"
    assert updated.json()["note"] == "改为官方"


def test_update_provider_name_collision_409(client, project):
    client.post("/api/providers", json={
        "project_id": project.id,
        "name": "provider-a", "base_url": "u", "api_key": "k",
        "provider_type": "openai"})
    pid_b = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "provider-b", "base_url": "u", "api_key": "k",
        "provider_type": "openai"}).json()["id"]

    resp = client.put(f"/api/providers/{pid_b}", json={
        "project_id": project.id,
        "name": "provider-a", "base_url": "u", "provider_type": "openai"})
    assert resp.status_code == 409


def test_update_pricing_model_collision_409(client, project):
    client.post("/api/pricing", json={
        "project_id": project.id,
        "model": "model-a", "input_price_per_1k": 1, "output_price_per_1k": 1})
    price_id_b = client.post("/api/pricing", json={
        "project_id": project.id,
        "model": "model-b", "input_price_per_1k": 1,
        "output_price_per_1k": 1}).json()["id"]

    resp = client.put(f"/api/pricing/{price_id_b}", json={
        "project_id": project.id,
        "model": "model-a", "input_price_per_1k": 1, "output_price_per_1k": 1})
    assert resp.status_code == 409


def test_provider_delete_clears_pricing_reference(client, project):
    pid = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "p", "base_url": "u", "api_key": "k",
        "provider_type": "openai"}).json()["id"]
    client.post("/api/pricing", json={
        "project_id": project.id,
        "model": "m1", "input_price_per_1k": 1, "output_price_per_1k": 1,
        "provider_id": pid})
    client.delete(f"/api/providers/{pid}")
    assert client.get(f"/api/pricing?project_id={project.id}").json()[0]["provider_id"] is None


def test_provider_and_pricing_isolated_per_project(db_session, client, project):
    other = Project(name="other-workspace")
    db_session.add(other)
    db_session.commit()
    # not a member of `other` -> 403 on any config endpoint scoped to it
    assert client.get(f"/api/providers?project_id={other.id}").status_code == 403
    assert client.get(f"/api/pricing?project_id={other.id}").status_code == 403
    assert client.get(f"/api/judge-models?project_id={other.id}").status_code == 403
    assert client.post("/api/providers", json={
        "project_id": other.id, "name": "x", "base_url": "u",
        "api_key": "k", "provider_type": "openai"}).status_code == 403
    assert client.post("/api/pricing", json={
        "project_id": other.id, "model": "m", "input_price_per_1k": 1,
        "output_price_per_1k": 1}).status_code == 403

    # create in project A; make other a member so we can prove it's still
    # not visible when listing under `other.id` (real cross-project isolation,
    # not just an authz gate)
    client.post("/api/providers", json={
        "project_id": project.id, "name": "a-provider", "base_url": "u",
        "api_key": "k", "provider_type": "openai"})
    client.post("/api/pricing", json={
        "project_id": project.id, "model": "a-model",
        "input_price_per_1k": 1, "output_price_per_1k": 1})

    db_session.add(ProjectMember(project_id=other.id, user_id=client.user_id,
                                 role="owner"))
    db_session.commit()
    assert client.get(f"/api/providers?project_id={other.id}").json() == []
    assert client.get(f"/api/pricing?project_id={other.id}").json() == []
    assert client.get(f"/api/providers?project_id={project.id}").json()[0]["name"] == "a-provider"
    assert client.get(f"/api/pricing?project_id={project.id}").json()[0]["model"] == "a-model"


def test_pricing_rejects_cross_project_provider_id(db_session, client, project):
    # Create provider P in project A
    pid_a = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "provider-a", "base_url": "https://api.example.com",
        "api_key": "key-a", "provider_type": "openai"}).json()["id"]

    # Create project B and make client a member
    project_b = Project(name="project-b")
    db_session.add(project_b)
    db_session.flush()
    db_session.add(ProjectMember(project_id=project_b.id, user_id=client.user_id,
                                 role="owner"))
    db_session.commit()

    # Try to create pricing in project B with provider_id from project A -> 400
    resp = client.post("/api/pricing", json={
        "project_id": project_b.id,
        "model": "gpt-4o",
        "input_price_per_1k": 0.005,
        "output_price_per_1k": 0.015,
        "provider_id": pid_a})
    assert resp.status_code == 400
    assert "provider_id 不属于该 project" in resp.json()["detail"]

    # Try to update existing pricing in project B with cross-project provider_id -> 400
    price_id_b = client.post("/api/pricing", json={
        "project_id": project_b.id,
        "model": "gpt-4o",
        "input_price_per_1k": 0.001,
        "output_price_per_1k": 0.002}).json()["id"]

    resp = client.put(f"/api/pricing/{price_id_b}", json={
        "project_id": project_b.id,
        "model": "gpt-4o",
        "input_price_per_1k": 0.005,
        "output_price_per_1k": 0.015,
        "provider_id": pid_a})
    assert resp.status_code == 400
    assert "provider_id 不属于该 project" in resp.json()["detail"]


def test_create_provider_stores_encrypted_api_key(db_session, client, project):
    resp = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "openai", "base_url": "https://api.openai.com/v1",
        "api_key": "sk-secret", "provider_type": "openai"})
    pid = resp.json()["id"]
    assert resp.json()["api_key_set"] is True
    assert "sk-secret" not in resp.text

    row = db_session.get(ModelProvider, pid)
    assert is_encrypted(row.api_key)
    assert row.api_key != "sk-secret"
    assert decrypt_secret(row.api_key) == "sk-secret"


def test_update_provider_stores_encrypted_api_key(db_session, client, project):
    pid = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "openai", "base_url": "https://api.openai.com/v1",
        "api_key": "sk-old", "provider_type": "openai"}).json()["id"]

    resp = client.put(f"/api/providers/{pid}", json={
        "project_id": project.id,
        "name": "openai", "base_url": "https://api.openai.com/v1",
        "provider_type": "openai", "api_key": "sk-new"})
    assert resp.json()["api_key_set"] is True
    assert "sk-new" not in resp.text

    row = db_session.get(ModelProvider, pid)
    assert is_encrypted(row.api_key)
    assert decrypt_secret(row.api_key) == "sk-new"


def test_update_provider_omitting_api_key_preserves_encrypted_value(db_session, client, project):
    pid = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "openai", "base_url": "https://api.openai.com/v1",
        "api_key": "sk-keep", "provider_type": "openai"}).json()["id"]
    row = db_session.get(ModelProvider, pid)
    stored_before = row.api_key

    resp = client.put(f"/api/providers/{pid}", json={
        "project_id": project.id,
        "name": "openai", "base_url": "https://api.openai.com/v1",
        "provider_type": "openai"})
    assert resp.json()["api_key_set"] is True

    db_session.refresh(row)
    assert row.api_key == stored_before
    assert decrypt_secret(row.api_key) == "sk-keep"


# --- creator-or-owner write scoping (Phase 9c) ------------------------------

def _login_as(client, email, password="pw123456"):
    client.post("/api/auth/logout")
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text


def _add_member(client, project_id, email, display_name):
    """Registers `email` as a new user and adds them to project_id as an
    ordinary member, leaving the session logged back in as the project
    owner (owner@x.com, from the `user_client` fixture) afterward."""
    client.post("/api/auth/register", json={
        "email": email, "password": "pw123456", "display_name": display_name})
    _login_as(client, "owner@x.com")
    resp = client.post(f"/api/projects/{project_id}/members", json={"email": email})
    assert resp.status_code == 200, resp.text
    return next(m["user_id"] for m in resp.json() if m["email"] == email)


def test_created_by_recorded_on_create_provider(client, project):
    resp = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "p1", "base_url": "u", "api_key": "k", "provider_type": "openai"})
    body = resp.json()
    assert body["created_by"] == client.user_id
    assert body["created_by_name"] == "Owner"


def test_created_by_recorded_on_create_pricing(client, project):
    resp = client.post("/api/pricing", json={
        "project_id": project.id,
        "model": "m1", "input_price_per_1k": 1, "output_price_per_1k": 1})
    body = resp.json()
    assert body["created_by"] == client.user_id
    assert body["created_by_name"] == "Owner"


def test_list_providers_and_pricing_expose_created_by_name(client, project):
    _add_member(client, project.id, "membera@x.com", "MemberA")
    _login_as(client, "membera@x.com")
    client.post("/api/providers", json={
        "project_id": project.id,
        "name": "p1", "base_url": "u", "api_key": "k", "provider_type": "openai"})
    client.post("/api/pricing", json={
        "project_id": project.id,
        "model": "m1", "input_price_per_1k": 1, "output_price_per_1k": 1})

    _login_as(client, "owner@x.com")
    providers = client.get(f"/api/providers?project_id={project.id}").json()
    assert providers[0]["created_by_name"] == "MemberA"
    pricing = client.get(f"/api/pricing?project_id={project.id}").json()
    assert pricing[0]["created_by_name"] == "MemberA"


def test_creator_can_edit_and_delete_own_provider(client, project):
    _add_member(client, project.id, "membera@x.com", "MemberA")
    _login_as(client, "membera@x.com")
    pid = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "p1", "base_url": "u", "api_key": "k", "provider_type": "openai"}).json()["id"]

    resp = client.put(f"/api/providers/{pid}", json={
        "project_id": project.id,
        "name": "p1-renamed", "base_url": "u", "provider_type": "openai"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "p1-renamed"
    assert client.delete(f"/api/providers/{pid}").json() == {"deleted": True}


def test_non_creator_member_cannot_edit_or_delete_provider(client, project):
    _add_member(client, project.id, "membera@x.com", "MemberA")
    _add_member(client, project.id, "memberb@x.com", "MemberB")

    _login_as(client, "membera@x.com")
    pid = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "p1", "base_url": "u", "api_key": "k", "provider_type": "openai"}).json()["id"]

    _login_as(client, "memberb@x.com")
    resp = client.put(f"/api/providers/{pid}", json={
        "project_id": project.id,
        "name": "p1-hijacked", "base_url": "u", "provider_type": "openai"})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "仅创建者或项目 owner 可修改"
    assert client.delete(f"/api/providers/{pid}").status_code == 403


def test_owner_can_edit_and_delete_any_provider(client, project):
    _add_member(client, project.id, "membera@x.com", "MemberA")
    _login_as(client, "membera@x.com")
    pid = client.post("/api/providers", json={
        "project_id": project.id,
        "name": "p1", "base_url": "u", "api_key": "k", "provider_type": "openai"}).json()["id"]

    _login_as(client, "owner@x.com")
    resp = client.put(f"/api/providers/{pid}", json={
        "project_id": project.id,
        "name": "p1-by-owner", "base_url": "u", "provider_type": "openai"})
    assert resp.status_code == 200
    assert client.delete(f"/api/providers/{pid}").json() == {"deleted": True}


def test_legacy_null_created_by_provider_member_403_owner_ok(client, project, db_session):
    legacy = ModelProvider(project_id=project.id, name="legacy", base_url="u",
                          api_key="k", provider_type="openai", created_by=None)
    db_session.add(legacy)
    db_session.commit()

    _add_member(client, project.id, "membera@x.com", "MemberA")
    _login_as(client, "membera@x.com")
    resp = client.put(f"/api/providers/{legacy.id}", json={
        "project_id": project.id,
        "name": "legacy-renamed", "base_url": "u", "provider_type": "openai"})
    assert resp.status_code == 403

    _login_as(client, "owner@x.com")
    resp = client.put(f"/api/providers/{legacy.id}", json={
        "project_id": project.id,
        "name": "legacy-renamed", "base_url": "u", "provider_type": "openai"})
    assert resp.status_code == 200
    assert client.delete(f"/api/providers/{legacy.id}").json() == {"deleted": True}


def test_creator_can_edit_and_delete_own_pricing(client, project):
    _add_member(client, project.id, "membera@x.com", "MemberA")
    _login_as(client, "membera@x.com")
    price_id = client.post("/api/pricing", json={
        "project_id": project.id,
        "model": "m1", "input_price_per_1k": 1, "output_price_per_1k": 1}).json()["id"]

    resp = client.put(f"/api/pricing/{price_id}", json={
        "project_id": project.id,
        "model": "m1", "input_price_per_1k": 2, "output_price_per_1k": 2})
    assert resp.status_code == 200
    assert resp.json()["input_price_per_1k"] == 2
    assert client.delete(f"/api/pricing/{price_id}").json() == {"deleted": True}


def test_non_creator_member_cannot_edit_or_delete_pricing(client, project):
    _add_member(client, project.id, "membera@x.com", "MemberA")
    _add_member(client, project.id, "memberb@x.com", "MemberB")

    _login_as(client, "membera@x.com")
    price_id = client.post("/api/pricing", json={
        "project_id": project.id,
        "model": "m1", "input_price_per_1k": 1, "output_price_per_1k": 1}).json()["id"]

    _login_as(client, "memberb@x.com")
    resp = client.put(f"/api/pricing/{price_id}", json={
        "project_id": project.id,
        "model": "m1", "input_price_per_1k": 9, "output_price_per_1k": 9})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "仅创建者或项目 owner 可修改"
    assert client.delete(f"/api/pricing/{price_id}").status_code == 403


def test_owner_can_edit_and_delete_any_pricing(client, project):
    _add_member(client, project.id, "membera@x.com", "MemberA")
    _login_as(client, "membera@x.com")
    price_id = client.post("/api/pricing", json={
        "project_id": project.id,
        "model": "m1", "input_price_per_1k": 1, "output_price_per_1k": 1}).json()["id"]

    _login_as(client, "owner@x.com")
    resp = client.put(f"/api/pricing/{price_id}", json={
        "project_id": project.id,
        "model": "m1", "input_price_per_1k": 3, "output_price_per_1k": 3})
    assert resp.status_code == 200
    assert client.delete(f"/api/pricing/{price_id}").json() == {"deleted": True}


def test_legacy_null_created_by_pricing_member_403_owner_ok(client, project, db_session):
    from models.entities import ModelPricing

    legacy = ModelPricing(project_id=project.id, model="legacy-model",
                          input_price_per_1k=1, output_price_per_1k=1, created_by=None)
    db_session.add(legacy)
    db_session.commit()

    _add_member(client, project.id, "membera@x.com", "MemberA")
    _login_as(client, "membera@x.com")
    resp = client.put(f"/api/pricing/{legacy.id}", json={
        "project_id": project.id,
        "model": "legacy-model", "input_price_per_1k": 5, "output_price_per_1k": 5})
    assert resp.status_code == 403

    _login_as(client, "owner@x.com")
    resp = client.put(f"/api/pricing/{legacy.id}", json={
        "project_id": project.id,
        "model": "legacy-model", "input_price_per_1k": 5, "output_price_per_1k": 5})
    assert resp.status_code == 200
    assert client.delete(f"/api/pricing/{legacy.id}").json() == {"deleted": True}
