import pytest

from models.entities import Observation, Project, ProjectMember, Trace


@pytest.fixture()
def client(user_client):
    return user_client


@pytest.fixture()
def seeded(db_session, client):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    db_session.add(ProjectMember(project_id=p.id, user_id=client.user_id, role="owner"))
    t1 = Trace(id="tr-1", project_id=p.id, name="run-a", origin="live",
               total_cost=0.01, latency_ms=1200)
    t2 = Trace(id="tr-2", project_id=p.id, name="run-b", origin="replay")
    db_session.add_all([
        t1, t2,
        Observation(id="ob-1", trace_id="tr-1", type="llm", name="loop",
                    model="gpt-4o", messages=[], seq=0),
        Observation(id="ob-2", trace_id="tr-1", parent_id="ob-1", type="tool",
                    name="search", tool_input={}, tool_output={}, seq=1),
        Observation(id="ob-3", trace_id="tr-1", parent_id="ob-1", type="tool",
                    name="fetch", tool_input={}, tool_output={}, seq=2),
    ])
    db_session.commit()
    return p


def test_list_projects(client, seeded):
    resp = client.get("/api/projects")
    assert resp.status_code == 200
    assert resp.json()[0]["name"] == "demo"


def test_list_traces_with_filter(client, seeded):
    resp = client.get(f"/api/traces?project_id={seeded.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    tr1 = next(i for i in body["items"] if i["id"] == "tr-1")
    assert tr1["model_summary"] == "gpt-4o"
    assert tr1["observation_count"] == 3

    resp = client.get(f"/api/traces?project_id={seeded.id}&origin=replay")
    assert resp.json()["total"] == 1

    resp = client.get(f"/api/traces?project_id={seeded.id}&search=run-a")
    assert resp.json()["total"] == 1


def test_trace_detail_tree(client, seeded):
    resp = client.get("/api/traces/tr-1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "run-a"
    roots = body["observations"]
    assert len(roots) == 1
    assert roots[0]["id"] == "ob-1"
    assert [c["name"] for c in roots[0]["children"]] == ["search", "fetch"]


def test_trace_detail_404(client, seeded):
    assert client.get("/api/traces/nope").status_code == 404


def test_trace_detail_exposes_metadata(client, db_session):
    p = Project(name="demo2")
    db_session.add(p)
    db_session.flush()
    db_session.add(ProjectMember(project_id=p.id, user_id=client.user_id, role="owner"))
    t = Trace(id="tr-meta", project_id=p.id, name="run-meta", origin="replay",
               meta={"source_trace_id": "x"})
    db_session.add_all([
        t,
        Observation(id="ob-meta", trace_id="tr-meta", type="tool", name="search",
                    tool_input={}, tool_output={}, seq=0, meta={"mocked": True}),
    ])
    db_session.commit()

    resp = client.get("/api/traces/tr-meta")
    assert resp.status_code == 200
    body = resp.json()
    assert body["metadata"]["source_trace_id"] == "x"
    assert body["observations"][0]["metadata"]["mocked"] is True


def test_traces_hidden_from_non_member(user_client, db_session):
    from models.entities import Project, Trace, ProjectMember
    # a project the logged-in user is NOT a member of
    other = Project(name="other-grp")
    db_session.add(other)
    db_session.flush()
    db_session.add(Trace(id="secret", project_id=other.id, name="secret"))
    db_session.commit()
    assert user_client.get("/api/traces/secret").status_code == 403
    r = user_client.get(f"/api/traces?project_id={other.id}")
    assert r.status_code == 403
