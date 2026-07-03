import pytest
from fastapi.testclient import TestClient

from db import get_db
from models.entities import Observation, Project, Trace


@pytest.fixture()
def client(db_session):
    from main import app

    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def project(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.commit()
    return p


def test_prompt_create_and_versioning(client, project):
    resp = client.post("/api/prompts", json={
        "project_id": project.id, "name": "qa-bot", "content": "v1 内容"})
    assert resp.status_code == 200
    pid = resp.json()["id"]

    assert client.post("/api/prompts", json={
        "project_id": project.id, "name": "qa-bot",
        "content": "x"}).status_code == 409

    client.post(f"/api/prompts/{pid}/versions", json={"content": "v2 内容"})
    detail = client.get(f"/api/prompts/{pid}").json()
    assert [v["version"] for v in detail["versions"]] == [1, 2]
    assert detail["versions"][1]["content"] == "v2 内容"

    lst = client.get(f"/api/prompts?project_id={project.id}").json()
    assert lst[0]["version_count"] == 2
    assert lst[0]["latest_version"] == 2


def test_prompt_detail_404(client, project):
    assert client.get("/api/prompts/nope").status_code == 404


def test_version_traces_lookup(client, db_session, project):
    pid = client.post("/api/prompts", json={
        "project_id": project.id, "name": "p", "content": "c"}).json()["id"]
    vid = client.get(f"/api/prompts/{pid}").json()["versions"][0]["id"]

    db_session.add(Trace(id="t1", project_id=project.id, name="via-trace",
                         prompt_version_id=vid))
    t2 = Trace(id="t2", project_id=project.id, name="via-observation")
    db_session.add(t2)
    db_session.add(Observation(id="o1", trace_id="t2", type="llm", name="x",
                               model="m", messages=[], prompt_version_id=vid))
    db_session.add(Trace(id="t3", project_id=project.id, name="unrelated"))
    db_session.commit()

    ids = {t["id"] for t in
           client.get(f"/api/prompt-versions/{vid}/traces").json()}
    assert ids == {"t1", "t2"}
