import pytest

from models.entities import Observation, Project, ProjectMember, ReplayRun, Trace
from routers.query import derive_input_preview, derive_replay_source


@pytest.fixture()
def client(user_client):
    return user_client


# -- derive_input_preview -----------------------------------------------

def test_derive_input_preview_none():
    assert derive_input_preview(None) is None


def test_derive_input_preview_str_stripped_and_truncated():
    assert derive_input_preview("  北京天气如何  ") == "北京天气如何"
    assert derive_input_preview("x" * 200) == "x" * 120


def test_derive_input_preview_dict_prefers_common_keys():
    assert derive_input_preview({"query": "北京天气", "extra": "ignored"}) == "北京天气"
    assert derive_input_preview({"question": "q"}) == "q"
    assert derive_input_preview({"input": "i"}) == "i"
    assert derive_input_preview({"text": "t"}) == "t"
    # 优先级：query > question > input > text
    assert derive_input_preview({"text": "t", "query": "q"}) == "q"


def test_derive_input_preview_dict_other_falls_back_to_compact_json():
    result = derive_input_preview({"a": 1, "b": 2})
    assert result == '{"a":1,"b":2}'


def test_derive_input_preview_empty_string_is_none():
    assert derive_input_preview("   ") is None


# -- derive_replay_source -------------------------------------------------

def test_derive_replay_source_none_without_source_trace_id():
    assert derive_replay_source(None) is None
    assert derive_replay_source({"foo": "bar"}) is None


def test_derive_replay_source_minimal():
    assert derive_replay_source({"source_trace_id": "tr-1"}) == {
        "source_trace_id": "tr-1"}


def test_derive_replay_source_full():
    meta = {"source_trace_id": "tr-1", "source_trace_name": "run-a",
            "override_model": "gpt-4o", "thinking": "enabled",
            "replay_run_id": "rr-1"}
    assert derive_replay_source(meta) == {
        "source_trace_id": "tr-1", "source_trace_name": "run-a",
        "override_model": "gpt-4o", "thinking": "enabled"}


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


def test_list_traces_divergence_count(client, db_session, seeded):
    # live trace with no replay run pointing at it -> 0
    # tr-2 (replay origin) is the *result* of a replay run with 2 divergences
    db_session.add(ReplayRun(
        id="rr-1", project_id=seeded.id, source_trace_id="tr-1",
        result_trace_id="tr-2", status="success",
        divergences=[{"type": "param_mismatch", "step": 1},
                     {"type": "unrecorded_call", "step": 2}]))
    db_session.commit()

    resp = client.get(f"/api/traces?project_id={seeded.id}")
    body = resp.json()
    tr1 = next(i for i in body["items"] if i["id"] == "tr-1")
    tr2 = next(i for i in body["items"] if i["id"] == "tr-2")
    assert tr1["divergence_count"] == 0
    assert tr2["divergence_count"] == 2


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


def test_list_traces_exposes_summary_input_preview_replay_source(client, db_session, seeded):
    t1 = db_session.get(Trace, "tr-1")
    t1.input = {"query": "北京天气怎么样"}
    t1.summary = "查询了北京天气"
    t2 = db_session.get(Trace, "tr-2")
    t2.meta = {"replay_run_id": "rr-1", "source_trace_id": "tr-1",
              "source_trace_name": "run-a", "override_model": "gpt-4o-mini",
              "thinking": "enabled"}
    db_session.commit()

    resp = client.get(f"/api/traces?project_id={seeded.id}")
    body = resp.json()
    tr1 = next(i for i in body["items"] if i["id"] == "tr-1")
    tr2 = next(i for i in body["items"] if i["id"] == "tr-2")

    assert tr1["summary"] == "查询了北京天气"
    assert tr1["input_preview"] == "北京天气怎么样"
    assert tr1["replay_source"] is None

    assert tr2["summary"] is None
    assert tr2["replay_source"] == {
        "source_trace_id": "tr-1", "source_trace_name": "run-a",
        "override_model": "gpt-4o-mini", "thinking": "enabled"}


def test_trace_detail_exposes_summary(client, seeded, db_session):
    t1 = db_session.get(Trace, "tr-1")
    t1.summary = "一句话摘要"
    db_session.commit()
    resp = client.get("/api/traces/tr-1")
    assert resp.json()["summary"] == "一句话摘要"


def test_traces_hidden_from_non_member(user_client, db_session):
    # a project the logged-in user is NOT a member of
    other = Project(name="other-grp")
    db_session.add(other)
    db_session.flush()
    db_session.add(Trace(id="secret", project_id=other.id, name="secret"))
    db_session.commit()
    assert user_client.get("/api/traces/secret").status_code == 403
    r = user_client.get(f"/api/traces?project_id={other.id}")
    assert r.status_code == 403
