import pytest

from models.entities import Project, ProjectMember


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
