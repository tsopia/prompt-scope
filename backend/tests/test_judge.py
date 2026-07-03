import json

import httpx
import pytest
from fastapi.testclient import TestClient

from db import get_db
from models.entities import Evaluation, ModelPricing, ModelProvider, Project, Trace
import services.judge_service as judge_service


@pytest.fixture()
def client(db_session):
    from main import app

    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def seeded(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    provider = ModelProvider(name="oai", base_url="https://api.test.com/v1",
                             api_key="sk-x", provider_type="openai")
    db_session.add(provider)
    db_session.flush()
    db_session.add(ModelPricing(model="judge-model", input_price_per_1k=0.001,
                                output_price_per_1k=0.002,
                                provider_id=provider.id))
    db_session.add_all([
        Trace(id="tr-a", project_id=p.id, name="a", input={"q": "1"},
              output={"a": "x"}),
        Trace(id="tr-b", project_id=p.id, name="b", input={"q": "1"},
              output={"a": "y"}),
    ])
    db_session.commit()
    return p


def judge_http_client(payload: dict):
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps(payload)}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50}})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_pair_judge_persists_evaluation(db_session, seeded):
    ev = judge_service.run_judge(
        db_session, "tr-a", "judge-model", compare_trace_id="tr-b",
        client=judge_http_client({"score_a": 7.5, "score_b": 8.0,
                                  "verdict": "replaceable", "reasoning": "ok"}))
    assert ev.score == 7.5 and ev.score_b == 8.0
    assert ev.verdict == "replaceable"
    assert ev.cost == pytest.approx(100 / 1000 * 0.001 + 50 / 1000 * 0.002)
    assert db_session.query(Evaluation).count() == 1


def test_judge_cache_hit_skips_llm(db_session, seeded):
    c = judge_http_client({"score_a": 7.0, "score_b": 8.0,
                           "verdict": "replaceable", "reasoning": "r"})
    first = judge_service.run_judge(db_session, "tr-a", "judge-model",
                                    compare_trace_id="tr-b", client=c)

    def exploding_handler(request):
        raise AssertionError("LLM should not be called on cache hit")

    second = judge_service.run_judge(
        db_session, "tr-a", "judge-model", compare_trace_id="tr-b",
        client=httpx.Client(transport=httpx.MockTransport(exploding_handler)))
    assert second.id == first.id


def test_judge_force_then_cache_returns_latest(db_session, seeded):
    c1 = judge_http_client({"score_a": 5.0, "score_b": 5.0,
                            "verdict": "not_replaceable", "reasoning": "first"})
    first = judge_service.run_judge(db_session, "tr-a", "judge-model",
                                    compare_trace_id="tr-b", client=c1)
    import time
    time.sleep(0.01)  # 保证 created_at 有序
    c2 = judge_http_client({"score_a": 9.0, "score_b": 9.0,
                            "verdict": "replaceable", "reasoning": "second"})
    second = judge_service.run_judge(db_session, "tr-a", "judge-model",
                                     compare_trace_id="tr-b", force=True,
                                     client=c2)
    cached = judge_service.run_judge(db_session, "tr-a", "judge-model",
                                     compare_trace_id="tr-b")
    assert cached.id == second.id
    assert cached.reasoning == "second"


def test_judge_unparseable_output_returns_502(db_session, seeded):
    from fastapi import HTTPException

    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "not json at all"}}],
            "usage": {}})

    with pytest.raises(HTTPException) as exc:
        judge_service.run_judge(
            db_session, "tr-a", "judge-model", compare_trace_id="tr-b",
            client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert exc.value.status_code == 502
    assert db_session.query(Evaluation).count() == 0  # 失败不落库


def test_judge_null_content_returns_clean_502(db_session, seeded):
    from fastapi import HTTPException

    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": None}}], "usage": {}})

    with pytest.raises(HTTPException) as exc:
        judge_service.run_judge(
            db_session, "tr-a", "judge-model", compare_trace_id="tr-b",
            client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert exc.value.status_code == 502
    assert db_session.query(Evaluation).count() == 0


def test_judge_unconfigured_model_400(db_session, seeded):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        judge_service.run_judge(db_session, "tr-a", "nope-model")
    assert exc.value.status_code == 400


def test_evaluations_endpoint_partial_failure(client, db_session, seeded, monkeypatch):
    def fake_run_judge(db, subject_trace_id, judge_model, **kwargs):
        from fastapi import HTTPException
        from models.entities import utcnow
        if judge_model == "bad-model":
            raise HTTPException(status_code=400, detail="judge model 未配置 provider")
        return Evaluation(id="ev1", project_id=seeded.id,
                          subject_trace_id=subject_trace_id,
                          compare_trace_id=kwargs.get("compare_trace_id"),
                          judge_model=judge_model, context_mode="output_only",
                          score=9.0, verdict="pass", reasoning="fine",
                          created_at=utcnow())  # 未入库对象无 Python 默认值，需显式给

    monkeypatch.setattr(judge_service, "run_judge", fake_run_judge)
    resp = client.post("/api/evaluations", json={
        "subject_trace_id": "tr-a", "compare_trace_id": "tr-b",
        "judge_models": ["judge-model", "bad-model"]})
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert results[0]["status"] == "ok"
    assert results[0]["evaluation"]["score"] == 9.0
    assert results[1]["status"] == "error"
    assert "未配置" in results[1]["error"]


def test_get_evaluations_filter(client, db_session, seeded):
    db_session.add(Evaluation(project_id=seeded.id, subject_trace_id="tr-a",
                              compare_trace_id="tr-b", judge_model="m",
                              context_mode="output_only", score=5.0,
                              verdict="replaceable", reasoning="r"))
    db_session.commit()
    resp = client.get("/api/evaluations?subject_trace_id=tr-a&compare_trace_id=tr-b")
    assert len(resp.json()) == 1
    assert resp.json()[0]["score"] == 5.0


def test_trace_context_caps_step_count(db_session, seeded):
    from models.entities import Observation, Trace
    t = db_session.get(Trace, "tr-a")
    for i in range(60):
        db_session.add(Observation(id=f"ob-{i}", trace_id="tr-a", type="span",
                                   name=f"step-{i}", seq=i))
    db_session.commit()
    db_session.refresh(t)
    ctx = judge_service._trace_context(t, None)
    assert "step-49" in ctx
    assert "step-50" not in ctx
    assert "共 60 步" in ctx


def test_evaluations_endpoint_survives_unexpected_error(client, db_session, seeded, monkeypatch):
    def exploding_run_judge(db, subject_trace_id, judge_model, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(judge_service, "run_judge", exploding_run_judge)
    resp = client.post("/api/evaluations", json={
        "subject_trace_id": "tr-a", "judge_models": ["judge-model"]})
    assert resp.status_code == 200
    assert resp.json()["results"][0]["status"] == "error"
    assert "boom" in resp.json()["results"][0]["error"]
