import pytest
from fastapi.testclient import TestClient

from db import get_db
from models.entities import Project, ReplayRun, Trace, utcnow
import services.replay_service as replay_service


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

    rid = resp.json()[0]["id"]
    assert client.get(f"/api/replays/{rid}").json()["id"] == rid
    assert client.get("/api/replays/nope").status_code == 404


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
