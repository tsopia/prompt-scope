import uuid

import pytest
from fastapi.testclient import TestClient

from db import get_db
from models.entities import ApiKey, ModelPricing, Project
from services.auth import generate_api_key


@pytest.fixture()
def client(db_session):
    from main import app

    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_full_agent_run_roundtrip(client, db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    raw, key_hash, prefix = generate_api_key()
    db_session.add(ApiKey(project_id=p.id, key_hash=key_hash, prefix=prefix))
    db_session.add(ModelPricing(model="gpt-4o", input_price_per_1k=0.005,
                                output_price_per_1k=0.015))
    db_session.commit()

    trace_id = uuid.uuid4().hex
    llm1, tool1, llm2 = (uuid.uuid4().hex for _ in range(3))
    payload = {
        "trace": {"id": trace_id, "name": "weather-agent",
                  "input": {"q": "北京天气"}, "output": {"a": "晴 32°C"},
                  "started_at": "2026-07-04T10:00:00Z",
                  "ended_at": "2026-07-04T10:00:05Z"},
        "observations": [
            {"id": llm1, "type": "llm", "name": "plan", "seq": 0, "model": "gpt-4o",
             "messages": [{"role": "system", "content": "you are a weather agent"},
                          {"role": "user", "content": "北京天气"}],
             "tool_definitions": [{"name": "get_weather",
                                   "parameters": {"city": "string"}}],
             "tool_calls": [{"name": "get_weather", "arguments": {"city": "北京"}}],
             "input_tokens": 120, "output_tokens": 30},
            {"id": tool1, "parent_id": llm1, "type": "tool", "name": "get_weather",
             "seq": 1, "tool_input": {"city": "北京"},
             "tool_output": {"weather": "晴", "temp": 32}},
            {"id": llm2, "type": "llm", "name": "answer", "seq": 2, "model": "gpt-4o",
             "messages": [{"role": "tool", "content": "{\"weather\": \"晴\"}"}],
             "completion": "晴 32°C", "input_tokens": 200, "output_tokens": 40},
        ],
    }
    resp = client.post("/api/ingest", json=payload,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 200

    detail = client.get(f"/api/traces/{trace_id}").json()
    assert detail["total_input_tokens"] == 320
    assert detail["total_cost"] == pytest.approx(320 / 1000 * 0.005 + 70 / 1000 * 0.015)
    assert len(detail["observations"]) == 2  # llm1(含 child tool) + llm2
    assert detail["observations"][0]["children"][0]["name"] == "get_weather"
