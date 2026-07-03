import pytest
from fastapi.testclient import TestClient

from db import get_db
from models.entities import ApiKey, ModelPricing, Observation, Project, Trace
from services.auth import generate_api_key


@pytest.fixture()
def client(db_session):
    from main import app

    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def api_key(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    raw, key_hash, prefix = generate_api_key()
    db_session.add(ApiKey(project_id=p.id, key_hash=key_hash, prefix=prefix))
    db_session.add(ModelPricing(model="gpt-4o", input_price_per_1k=0.005,
                                output_price_per_1k=0.015))
    db_session.commit()
    return raw, p


PAYLOAD = {
    "trace": {
        "id": "tr-1", "name": "qa-run",
        "input": {"question": "hi"}, "output": {"answer": "hello"},
        "started_at": "2026-07-04T10:00:00Z", "ended_at": "2026-07-04T10:00:03Z",
    },
    "observations": [
        {
            "id": "ob-1", "type": "llm", "name": "agent-loop", "seq": 0,
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "hi"}],
            "tool_definitions": [{"name": "search", "parameters": {}}],
            "tool_calls": [{"name": "search", "arguments": {"q": "hi"}}],
            "completion": "hello",
            "input_tokens": 100, "output_tokens": 50,
        },
        {
            "id": "ob-2", "parent_id": "ob-1", "type": "tool", "name": "search",
            "seq": 1, "tool_input": {"q": "hi"}, "tool_output": {"hits": []},
        },
    ],
}


def test_ingest_requires_auth(client):
    assert client.post("/api/ingest", json=PAYLOAD).status_code == 401


def test_ingest_creates_trace_with_cost(client, db_session, api_key):
    raw, project = api_key
    resp = client.post("/api/ingest", json=PAYLOAD,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"trace_id": "tr-1", "observation_count": 2}

    t = db_session.get(Trace, "tr-1")
    assert t.project_id == project.id
    assert t.latency_ms == 3000
    assert t.total_input_tokens == 100
    # cost = 100/1000*0.005 + 50/1000*0.015
    assert t.total_cost == pytest.approx(0.00125)
    ob = db_session.get(Observation, "ob-1")
    assert ob.cost == pytest.approx(0.00125)


def test_ingest_is_idempotent(client, db_session, api_key):
    raw, _ = api_key
    h = {"Authorization": f"Bearer {raw}"}
    client.post("/api/ingest", json=PAYLOAD, headers=h)
    payload2 = {**PAYLOAD, "trace": {**PAYLOAD["trace"], "output": {"answer": "updated"}}}
    resp = client.post("/api/ingest", json=payload2, headers=h)
    assert resp.status_code == 200
    assert db_session.query(Trace).count() == 1
    assert db_session.query(Observation).count() == 2
    assert db_session.get(Trace, "tr-1").output == {"answer": "updated"}


def test_llm_observation_requires_messages_and_model(client, api_key):
    raw, _ = api_key
    bad = {"trace": {"id": "tr-2", "name": "x"},
           "observations": [{"id": "ob-x", "type": "llm", "name": "call"}]}
    resp = client.post("/api/ingest", json=bad,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 422
    assert "messages" in resp.text
    locs = [tuple(e["loc"]) for e in resp.json()["detail"]]
    assert any(loc[-1] == "messages" for loc in locs)
    assert any(loc[-1] == "model" for loc in locs)


def test_tool_observation_requires_input_and_result(client, api_key):
    raw, _ = api_key
    bad = {"trace": {"id": "tr-3", "name": "x"},
           "observations": [{"id": "ob-y", "type": "tool", "name": "search"}]}
    resp = client.post("/api/ingest", json=bad,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 422
    locs = [tuple(e["loc"]) for e in resp.json()["detail"]]
    assert any(loc[-1] == "tool_input" for loc in locs)


def test_unknown_model_cost_is_null(client, db_session, api_key):
    raw, _ = api_key
    payload = {
        "trace": {"id": "tr-4", "name": "x"},
        "observations": [{"id": "ob-z", "type": "llm", "name": "call",
                          "model": "unknown-model",
                          "messages": [{"role": "user", "content": "hi"}],
                          "input_tokens": 10, "output_tokens": 10}],
    }
    resp = client.post("/api/ingest", json=payload,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 200
    assert db_session.get(Trace, "tr-4").total_cost is None
