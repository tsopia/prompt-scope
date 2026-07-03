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


def test_provider_crud_and_key_masking(client):
    resp = client.post("/api/providers", json={
        "name": "openai", "base_url": "https://api.openai.com/v1",
        "api_key": "sk-secret", "provider_type": "openai"})
    assert resp.status_code == 200
    body = resp.json()
    pid = body["id"]
    assert body["api_key_set"] is True
    assert "sk-secret" not in resp.text

    assert client.post("/api/providers", json={
        "name": "openai", "base_url": "x", "api_key": "y",
        "provider_type": "openai"}).status_code == 409

    resp = client.put(f"/api/providers/{pid}", json={
        "name": "openai-2", "base_url": "https://api.openai.com/v1",
        "provider_type": "openai"})
    assert resp.json()["name"] == "openai-2"
    assert resp.json()["api_key_set"] is True  # key 保留

    assert client.get("/api/providers").json()[0]["name"] == "openai-2"
    assert client.delete(f"/api/providers/{pid}").json() == {"deleted": True}
    assert client.get("/api/providers").json() == []


def test_pricing_crud_and_judge_models(client):
    pid = client.post("/api/providers", json={
        "name": "openai", "base_url": "https://api.openai.com/v1",
        "api_key": "sk-x", "provider_type": "openai"}).json()["id"]

    resp = client.post("/api/pricing", json={
        "model": "gpt-4o", "input_price_per_1k": 0.005,
        "output_price_per_1k": 0.015, "provider_id": pid})
    assert resp.status_code == 200
    price_id = resp.json()["id"]

    assert client.post("/api/pricing", json={
        "model": "gpt-4o", "input_price_per_1k": 1,
        "output_price_per_1k": 1}).status_code == 409

    client.post("/api/pricing", json={
        "model": "no-provider-model", "input_price_per_1k": 0.001,
        "output_price_per_1k": 0.002})

    judge_models = client.get("/api/judge-models").json()
    assert judge_models == [{"model": "gpt-4o", "provider_name": "openai"}]

    resp = client.put(f"/api/pricing/{price_id}", json={
        "model": "gpt-4o", "input_price_per_1k": 0.006,
        "output_price_per_1k": 0.015, "provider_id": pid})
    assert resp.json()["input_price_per_1k"] == 0.006

    client.delete(f"/api/pricing/{price_id}")
    assert client.get("/api/judge-models").json() == []


def test_provider_delete_clears_pricing_reference(client):
    pid = client.post("/api/providers", json={
        "name": "p", "base_url": "u", "api_key": "k",
        "provider_type": "openai"}).json()["id"]
    client.post("/api/pricing", json={
        "model": "m1", "input_price_per_1k": 1, "output_price_per_1k": 1,
        "provider_id": pid})
    client.delete(f"/api/providers/{pid}")
    assert client.get("/api/pricing").json()[0]["provider_id"] is None
