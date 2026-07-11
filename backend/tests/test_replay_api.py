import pytest

from models.entities import Project, ProjectMember, ReplayRun, Trace, utcnow
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
    db_session.add(Trace(id="src-1", project_id=p.id, name="run"))
    db_session.commit()
    return p


def test_post_replay_executes_and_returns_run(client, db_session, seeded, monkeypatch):
    def fake_execute(db, run, client=None):
        run.status = "success"
        run.result_trace_id = "result-1"
        run.divergences = []
        run.finished_at = utcnow()
        return run

    monkeypatch.setattr(replay_service, "execute_replay", fake_execute)
    resp = client.post("/api/replays", json={
        "source_trace_id": "src-1", "override_model": "cheap-model"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "success"
    assert body["result_trace_id"] == "result-1"
    assert db_session.query(ReplayRun).count() == 1


def test_post_replay_missing_source_404(client, seeded):
    resp = client.post("/api/replays", json={"source_trace_id": "nope"})
    assert resp.status_code == 404


def test_get_replays_by_source(client, db_session, seeded):
    db_session.add(ReplayRun(project_id=seeded.id, source_trace_id="src-1",
                             status="success", divergences=[]))
    db_session.commit()
    resp = client.get("/api/replays?source_trace_id=src-1")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    # no result trace → cost/latency null
    assert resp.json()[0]["result_cost"] is None
    assert resp.json()[0]["result_latency_ms"] is None

    rid = resp.json()[0]["id"]
    single = client.get(f"/api/replays/{rid}").json()
    assert single["id"] == rid
    assert single["result_cost"] is None
    assert single["result_latency_ms"] is None
    assert client.get("/api/replays/nope").status_code == 404


def test_replay_run_exposes_result_trace_cost_and_latency(client, db_session, seeded):
    db_session.add(Trace(id="result-1", project_id=seeded.id, name="replayed",
                         origin="replay", total_cost=0.0042, latency_ms=1234))
    db_session.add(ReplayRun(project_id=seeded.id, source_trace_id="src-1",
                             result_trace_id="result-1",
                             status="success", divergences=[]))
    db_session.commit()

    list_resp = client.get("/api/replays?source_trace_id=src-1")
    assert list_resp.status_code == 200
    item = list_resp.json()[0]
    assert item["result_cost"] == pytest.approx(0.0042)
    assert item["result_latency_ms"] == 1234

    rid = item["id"]
    single = client.get(f"/api/replays/{rid}").json()
    assert single["result_cost"] == pytest.approx(0.0042)
    assert single["result_latency_ms"] == 1234


def test_post_replay_validation_failure_marks_run_failed(client, db_session, seeded):
    # 源 trace 没有 llm observation → execute_replay 400；run 不得停留在 pending
    resp = client.post("/api/replays", json={
        "source_trace_id": "src-1", "override_model": "whatever"})
    assert resp.status_code in (400, 404)
    runs = db_session.query(ReplayRun).all()
    assert len(runs) == 1
    assert runs[0].status == "failed"
    assert runs[0].error


def test_post_replay_rejects_replay_origin_source(client, db_session, seeded):
    db_session.add(Trace(id="replay-src", project_id=seeded.id,
                         name="r", origin="replay"))
    db_session.commit()
    resp = client.post("/api/replays", json={"source_trace_id": "replay-src"})
    assert resp.status_code == 400
    assert "replay" in resp.json()["detail"]


def test_replay_hidden_from_non_member(client, db_session):
    # a project the logged-in user is NOT a member of
    other = Project(name="other-grp")
    db_session.add(other)
    db_session.flush()
    db_session.add(Trace(id="other-src", project_id=other.id, name="run"))
    run = ReplayRun(project_id=other.id, source_trace_id="other-src",
                    status="success", divergences=[])
    db_session.add(run)
    db_session.commit()

    assert client.post("/api/replays",
                       json={"source_trace_id": "other-src"}).status_code == 403
    assert client.get(
        f"/api/replays?source_trace_id=other-src").status_code == 403
    assert client.get(f"/api/replays/{run.id}").status_code == 403
