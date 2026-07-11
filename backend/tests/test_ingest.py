import pytest
from fastapi.testclient import TestClient

from db import get_db
from models.entities import ApiKey, ModelPricing, ModelProvider, Observation, Project, Trace
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
    db_session.add(ModelPricing(project_id=p.id, model="gpt-4o",
                                input_price_per_1k=0.005,
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


def test_trace_name_over_max_length_is_rejected(client, api_key):
    raw, _ = api_key
    bad = {**PAYLOAD, "trace": {**PAYLOAD["trace"], "name": "x" * 300}}
    resp = client.post("/api/ingest", json=bad,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 422


def test_ingest_cannot_hijack_other_projects_trace(client, db_session, api_key):
    raw_a, _ = api_key
    client.post("/api/ingest", json=PAYLOAD, headers={"Authorization": f"Bearer {raw_a}"})

    from models.entities import ApiKey, Project
    from services.auth import generate_api_key
    p2 = Project(name="other")
    db_session.add(p2)
    db_session.flush()
    raw_b, key_hash_b, prefix_b = generate_api_key()
    db_session.add(ApiKey(project_id=p2.id, key_hash=key_hash_b, prefix=prefix_b))
    db_session.commit()

    resp = client.post("/api/ingest", json=PAYLOAD,
                       headers={"Authorization": f"Bearer {raw_b}"})
    assert resp.status_code == 409
    from models.entities import Trace
    assert db_session.get(Trace, "tr-1").project_id != p2.id


def test_ingest_cannot_move_observation_across_traces(client, db_session, api_key):
    raw, _ = api_key
    h = {"Authorization": f"Bearer {raw}"}
    client.post("/api/ingest", json=PAYLOAD, headers=h)
    other = {"trace": {"id": "tr-other", "name": "second"},
             "observations": [{"id": "ob-1", "type": "span", "name": "steal"}]}
    resp = client.post("/api/ingest", json=other, headers=h)
    assert resp.status_code == 409


def _bind_ingest_background_session_to_test_engine(monkeypatch, db_session):
    """后台任务用 SessionLocal() 开自己的会话（生产环境下指向同一个全局
    engine）；测试里 db_session 走的是每个测试独立的内存 sqlite engine，
    这里把 routers.ingest.SessionLocal 重新绑定到同一个 engine 上，让后台
    任务在测试里也能看到通过 db_session 落库的数据。"""
    from sqlalchemy.orm import sessionmaker

    import routers.ingest as ingest_router
    monkeypatch.setattr(
        ingest_router, "SessionLocal",
        sessionmaker(bind=db_session.get_bind(), expire_on_commit=False))


def test_ingest_with_summary_model_triggers_background_summary(
        client, db_session, api_key, monkeypatch):
    raw, project = api_key
    provider = ModelProvider(project_id=project.id, name="oai",
                             base_url="https://api.test.com/v1",
                             api_key="sk-x", provider_type="openai")
    db_session.add(provider)
    db_session.flush()
    db_session.query(ModelPricing).filter(
        ModelPricing.project_id == project.id, ModelPricing.model == "gpt-4o"
    ).update({"provider_id": provider.id})
    project.summary_model = "gpt-4o"
    db_session.commit()
    _bind_ingest_background_session_to_test_engine(monkeypatch, db_session)

    import services.summary_service as summary_service

    def fake_chat_completion(provider, model, messages, model_params=None, client=None):
        return {"content": "总结：一次问答式调用。", "input_tokens": 5, "output_tokens": 5}

    monkeypatch.setattr(summary_service, "chat_completion", fake_chat_completion)

    resp = client.post("/api/ingest", json=PAYLOAD,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 200, resp.text

    # TestClient 会同步跑完 BackgroundTasks 再返回，因此响应返回时摘要应已写入
    t = db_session.get(Trace, "tr-1")
    assert t.summary == "总结：一次问答式调用。"


def test_ingest_without_summary_model_skips_background_task(
        client, db_session, api_key, monkeypatch):
    raw, project = api_key  # summary_model unset by default
    _bind_ingest_background_session_to_test_engine(monkeypatch, db_session)

    import services.summary_service as summary_service
    called = {"n": 0}

    def fake_chat_completion(*a, **kw):
        called["n"] += 1
        return {"content": "x", "input_tokens": 1, "output_tokens": 1}

    monkeypatch.setattr(summary_service, "chat_completion", fake_chat_completion)

    resp = client.post("/api/ingest", json=PAYLOAD,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 200
    assert called["n"] == 0
    assert db_session.get(Trace, "tr-1").summary is None


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
