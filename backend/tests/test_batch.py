import pytest
from fastapi import HTTPException

from models.entities import (Evaluation, ModelPricing, ModelProvider, Project,
                             ProjectMember, Trace, utcnow)
import services.judge_service as judge_service
import services.replay_service as replay_service


@pytest.fixture()
def client(user_client):
    return user_client


@pytest.fixture()
def seeded(db_session, client):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    db_session.add(ProjectMember(project_id=p.id, user_id=client.user_id, role="owner"))
    provider = ModelProvider(project_id=p.id, name="oai",
                             base_url="https://api.test.com/v1",
                             api_key="sk-x", provider_type="openai")
    db_session.add(provider)
    db_session.flush()
    db_session.add(ModelPricing(project_id=p.id, model="judge-model",
                                input_price_per_1k=0.001,
                                output_price_per_1k=0.002,
                                provider_id=provider.id))
    db_session.add_all([
        Trace(id="src-1", project_id=p.id, name="run"),
        Trace(id="tr-a", project_id=p.id, name="a", input={"q": "1"},
              output={"a": "x"}),
        Trace(id="tr-b", project_id=p.id, name="b", input={"q": "1"},
              output={"a": "y"}),
    ])
    db_session.commit()
    return p


def test_batch_replay_mixed_results(client, db_session, seeded, monkeypatch):
    def fake_execute(db, run, client=None):
        run.status = "success"
        run.result_trace_id = "result-1"
        run.divergences = []
        run.finished_at = utcnow()
        return run

    monkeypatch.setattr(replay_service, "execute_replay", fake_execute)
    resp = client.post("/api/replays/batch", json={
        "source_trace_ids": ["src-1", "nope"],
        "override_model": "cheap-model"})
    assert resp.status_code == 200, resp.text
    results = resp.json()["results"]
    assert len(results) == 2
    assert results[0]["status"] == "ok"
    assert results[0]["source_trace_id"] == "src-1"
    assert results[0]["run"]["status"] == "success"
    assert results[1]["status"] == "error"
    assert results[1]["source_trace_id"] == "nope"
    assert "not found" in results[1]["error"]


def test_batch_replay_too_many_ids_422(client, seeded):
    resp = client.post("/api/replays/batch", json={
        "source_trace_ids": [f"id-{i}" for i in range(21)]})
    assert resp.status_code == 422


def test_batch_evaluate_mixed_results(client, db_session, seeded, monkeypatch):
    def fake_run_judge(db, subject_trace_id, judge_model, **kwargs):
        if judge_model == "bad-model":
            raise HTTPException(status_code=400, detail="judge model 未配置 provider")
        return Evaluation(id=f"ev-{subject_trace_id}-{judge_model}",
                          project_id=seeded.id,
                          subject_trace_id=subject_trace_id,
                          compare_trace_id=kwargs.get("compare_trace_id"),
                          judge_model=judge_model, context_mode="output_only",
                          score=9.0, verdict="pass", reasoning="fine",
                          created_at=utcnow())

    monkeypatch.setattr(judge_service, "run_judge", fake_run_judge)
    resp = client.post("/api/evaluations/batch", json={
        "subject_trace_ids": ["tr-a", "tr-b"],
        "judge_models": ["judge-model", "bad-model"]})
    assert resp.status_code == 200, resp.text
    results = resp.json()["results"]
    assert len(results) == 4
    ok_results = [r for r in results if r["status"] == "ok"]
    error_results = [r for r in results if r["status"] == "error"]
    assert len(ok_results) == 2
    assert len(error_results) == 2
    for r in ok_results:
        assert r["judge_model"] == "judge-model"
        assert r["evaluation"]["score"] == 9.0
    for r in error_results:
        assert r["judge_model"] == "bad-model"
        assert "未配置" in r["error"]


def test_batch_evaluate_too_many_ids_422(client, seeded):
    resp = client.post("/api/evaluations/batch", json={
        "subject_trace_ids": [f"tr-{i}" for i in range(51)],
        "judge_models": ["judge-model"]})
    assert resp.status_code == 422
