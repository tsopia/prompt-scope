import json

import httpx
import pytest

from models.entities import (Evaluation, JudgeTemplate, ModelPricing,
                             ModelProvider, Project, ProjectMember, Trace)
import services.judge_service as judge_service


@pytest.fixture()
def client(user_client):
    return user_client


@pytest.fixture()
def project(db_session, client):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    db_session.add(ProjectMember(project_id=p.id, user_id=client.user_id, role="owner"))
    db_session.commit()
    return p


def _login_as(client, email, password="pw123456"):
    client.post("/api/auth/logout")
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text


def _add_member(client, project_id, email, display_name):
    client.post("/api/auth/register", json={
        "email": email, "password": "pw123456", "display_name": display_name})
    _login_as(client, "owner@x.com")
    resp = client.post(f"/api/projects/{project_id}/members", json={"email": email})
    assert resp.status_code == 200, resp.text
    return next(m["user_id"] for m in resp.json() if m["email"] == email)


# --- CRUD --------------------------------------------------------------

def test_member_create_list_and_created_by(client, project):
    resp = client.post("/api/judge-templates", json={
        "project_id": project.id, "name": "严格版", "content": "你是严厉的评审"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "严格版"
    assert body["created_by"] == client.user_id
    assert body["created_by_name"] == "Owner"

    lst = client.get(f"/api/judge-templates?project_id={project.id}").json()
    assert len(lst) == 1
    assert lst[0]["created_by_name"] == "Owner"


def test_create_dup_name_409(client, project):
    client.post("/api/judge-templates", json={
        "project_id": project.id, "name": "dup", "content": "a"})
    resp = client.post("/api/judge-templates", json={
        "project_id": project.id, "name": "dup", "content": "b"})
    assert resp.status_code == 409


def test_content_over_max_length_422(client, project):
    resp = client.post("/api/judge-templates", json={
        "project_id": project.id, "name": "too-long", "content": "x" * 8001})
    assert resp.status_code == 422


def test_creator_can_edit_own_template(client, project):
    _add_member(client, project.id, "membera@x.com", "MemberA")
    _login_as(client, "membera@x.com")
    tid = client.post("/api/judge-templates", json={
        "project_id": project.id, "name": "t1", "content": "c1"}).json()["id"]

    resp = client.put(f"/api/judge-templates/{tid}", json={"content": "c1-edited"})
    assert resp.status_code == 200
    assert resp.json()["content"] == "c1-edited"
    assert client.delete(f"/api/judge-templates/{tid}").json() == {"deleted": True}


def test_non_creator_member_403_on_edit_and_delete(client, project):
    _add_member(client, project.id, "membera@x.com", "MemberA")
    _add_member(client, project.id, "memberb@x.com", "MemberB")

    _login_as(client, "membera@x.com")
    tid = client.post("/api/judge-templates", json={
        "project_id": project.id, "name": "t1", "content": "c1"}).json()["id"]

    _login_as(client, "memberb@x.com")
    resp = client.put(f"/api/judge-templates/{tid}", json={"content": "hijack"})
    assert resp.status_code == 403
    assert client.delete(f"/api/judge-templates/{tid}").status_code == 403


def test_owner_can_edit_and_delete_any_template(client, project):
    _add_member(client, project.id, "membera@x.com", "MemberA")
    _login_as(client, "membera@x.com")
    tid = client.post("/api/judge-templates", json={
        "project_id": project.id, "name": "t1", "content": "c1"}).json()["id"]

    _login_as(client, "owner@x.com")
    resp = client.put(f"/api/judge-templates/{tid}", json={"content": "by-owner"})
    assert resp.status_code == 200
    assert client.delete(f"/api/judge-templates/{tid}").json() == {"deleted": True}


def test_update_dup_name_409(client, project):
    client.post("/api/judge-templates", json={
        "project_id": project.id, "name": "a", "content": "x"})
    tid_b = client.post("/api/judge-templates", json={
        "project_id": project.id, "name": "b", "content": "y"}).json()["id"]
    resp = client.put(f"/api/judge-templates/{tid_b}", json={"name": "a"})
    assert resp.status_code == 409


def test_templates_hidden_from_non_member(client, db_session):
    other = Project(name="other-grp")
    db_session.add(other)
    db_session.commit()
    assert client.get(f"/api/judge-templates?project_id={other.id}").status_code == 403
    assert client.post("/api/judge-templates", json={
        "project_id": other.id, "name": "x", "content": "y"}).status_code == 403


# --- composition ---------------------------------------------------------

def test_default_rubric_contains_identity_and_criteria():
    assert "评审" in judge_service.DEFAULT_RUBRIC
    for bullet in ["正确性", "完整性", "遵循指令", "简洁性"]:
        assert bullet in judge_service.DEFAULT_RUBRIC


def test_compose_judge_prompt_locks_json_tail_and_keeps_task_sections():
    single = judge_service.compose_judge_prompt(
        judge_service.DEFAULT_RUBRIC, pair=False).format(
        input="IN", model="M", output="OUT", metrics="MET", trace_context="")
    assert judge_service.DEFAULT_RUBRIC in single
    assert "【任务输入】" in single and "IN" in single
    assert "【候选输出】" in single and "OUT" in single
    assert '"score": <number>' in single
    assert '"verdict": "pass" 或 "fail"' in single
    assert '"reasoning": "<中文理由>"' in single
    assert '"dimensions"' in single
    assert '"evidence"' in single and '"evidence_step"' in single
    assert '"confidence"' in single

    pair = judge_service.compose_judge_prompt(
        judge_service.DEFAULT_RUBRIC, pair=True).format(
        input="IN", model_a="MA", output_a="OA", metrics_a="MA-MET",
        model_b="MB", output_b="OB", metrics_b="MB-MET", trace_context="")
    assert judge_service.DEFAULT_RUBRIC in pair
    assert "【候选输出 A】" in pair and "【候选输出 B】" in pair
    assert '"score_a": <number>' in pair and '"score_b": <number>' in pair
    assert '"verdict": "replaceable" 或 "not_replaceable"' in pair
    assert '"reasoning": "<中文理由>"' in pair
    assert '"dimensions"' in pair
    assert '"evidence"' in pair and '"evidence_step"' in pair
    assert '"confidence"' in pair


def test_skeletons_mention_every_judge_dimension():
    # 骨架里 JSON 尾部的维度名是字面写死的（不是从 JUDGE_DIMENSIONS 动态拼出来
    # 的），这个测试防止两者未来漂移。
    for dim in judge_service.JUDGE_DIMENSIONS:
        assert dim in judge_service.SINGLE_SKELETON
        assert dim in judge_service.PAIR_SKELETON


def test_custom_rubric_replaces_default_in_composed_prompt():
    custom = "你是宽松的评审，只关心结论对不对。"
    prompt = judge_service.compose_judge_prompt(custom, pair=False).format(
        input="IN", model="M", output="OUT", metrics="MET", trace_context="")
    assert custom in prompt
    assert judge_service.DEFAULT_RUBRIC not in prompt
    # locked JSON tail unaffected by rubric swap
    assert '"verdict": "pass" 或 "fail"' in prompt
    assert '"dimensions"' in prompt


def test_builtin_fingerprint_is_stable_sha256_prefix():
    import hashlib
    expected = hashlib.sha256(
        f"{judge_service.SKELETON_VERSION}:{judge_service.DEFAULT_RUBRIC}".encode()
    ).hexdigest()[:16]
    assert judge_service.builtin_fingerprint() == expected
    assert len(judge_service.builtin_fingerprint()) == 16


# --- scoring integration --------------------------------------------------

@pytest.fixture()
def seeded(db_session, project):
    provider = ModelProvider(project_id=project.id, name="oai",
                             base_url="https://api.test.com/v1",
                             api_key="sk-x", provider_type="openai")
    db_session.add(provider)
    db_session.flush()
    db_session.add(ModelPricing(project_id=project.id, model="judge-model",
                                input_price_per_1k=0.001,
                                output_price_per_1k=0.002,
                                provider_id=provider.id))
    db_session.add_all([
        Trace(id="tr-a", project_id=project.id, name="a", input={"q": "1"},
              output={"a": "x"}),
        Trace(id="tr-b", project_id=project.id, name="b", input={"q": "1"},
              output={"a": "y"}),
    ])
    db_session.commit()
    return project


def judge_http_client(payload: dict):
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps(payload)}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50}})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_evaluate_with_cross_project_template_400(db_session, client, seeded):
    other = Project(name="other")
    db_session.add(other)
    db_session.flush()
    tid = JudgeTemplate(project_id=other.id, name="foreign", content="x")
    db_session.add(tid)
    db_session.commit()

    with pytest.raises(Exception):
        judge_service.run_judge(
            db_session, "tr-a", "judge-model", judge_template_id=tid.id,
            client=judge_http_client({"score": 1, "verdict": "pass", "reasoning": "r"}))


def test_evaluate_with_cross_project_template_via_api_400(client, seeded):
    # a template that lives in a *different* project the user is also a
    # member of (owner, via POST /api/projects) but is not the subject
    # trace's project
    resp_other = client.post("/api/projects", json={"name": "other-3"})
    assert resp_other.status_code == 200
    other_project_id = resp_other.json()["id"]
    tid = client.post("/api/judge-templates", json={
        "project_id": other_project_id, "name": "foreign", "content": "x"}).json()["id"]

    resp = client.post("/api/evaluations", json={
        "subject_trace_id": "tr-a", "judge_models": ["judge-model"],
        "judge_template_id": tid})
    assert resp.status_code == 200
    result = resp.json()["results"][0]
    assert result["status"] == "error"
    assert "不属于该项目" in result["error"]


def test_builtin_and_template_evaluations_are_cached_distinctly(db_session, seeded):
    tid = JudgeTemplate(project_id=seeded.id, name="strict", content="严格评审内容")
    db_session.add(tid)
    db_session.commit()

    builtin_ev = judge_service.run_judge(
        db_session, "tr-a", "judge-model",
        client=judge_http_client({"score": 5, "verdict": "pass", "reasoning": "builtin"}))
    assert builtin_ev.judge_template_id is None
    assert builtin_ev.prompt_fingerprint == judge_service.builtin_fingerprint()

    template_ev = judge_service.run_judge(
        db_session, "tr-a", "judge-model", judge_template_id=tid.id,
        client=judge_http_client({"score": 9, "verdict": "pass", "reasoning": "template"}))
    assert template_ev.id != builtin_ev.id
    assert template_ev.judge_template_id == tid.id
    assert template_ev.prompt_fingerprint != builtin_ev.prompt_fingerprint

    # re-running the builtin (no template) with a new client that would
    # explode if called proves the builtin evaluation was cache-hit, not
    # confused with the template's cached row.
    def exploding_handler(request):
        raise AssertionError("should not call LLM: builtin cache should hit")

    cached_builtin = judge_service.run_judge(
        db_session, "tr-a", "judge-model",
        client=httpx.Client(transport=httpx.MockTransport(exploding_handler)))
    assert cached_builtin.id == builtin_ev.id


def test_same_template_content_hits_cache(db_session, seeded):
    tid = JudgeTemplate(project_id=seeded.id, name="strict", content="固定内容")
    db_session.add(tid)
    db_session.commit()

    first = judge_service.run_judge(
        db_session, "tr-a", "judge-model", judge_template_id=tid.id,
        client=judge_http_client({"score": 7, "verdict": "pass", "reasoning": "first"}))

    def exploding_handler(request):
        raise AssertionError("LLM should not be called on cache hit")

    second = judge_service.run_judge(
        db_session, "tr-a", "judge-model", judge_template_id=tid.id,
        client=httpx.Client(transport=httpx.MockTransport(exploding_handler)))
    assert second.id == first.id


def test_editing_template_content_misses_cache_and_rescoring(db_session, seeded):
    tid = JudgeTemplate(project_id=seeded.id, name="strict", content="初始内容")
    db_session.add(tid)
    db_session.commit()

    first = judge_service.run_judge(
        db_session, "tr-a", "judge-model", judge_template_id=tid.id,
        client=judge_http_client({"score": 6, "verdict": "pass", "reasoning": "before-edit"}))

    tid.content = "编辑后的内容"
    db_session.commit()

    second = judge_service.run_judge(
        db_session, "tr-a", "judge-model", judge_template_id=tid.id,
        client=judge_http_client({"score": 8, "verdict": "pass", "reasoning": "after-edit"}))

    assert second.id != first.id
    assert second.reasoning == "after-edit"
    assert second.prompt_fingerprint != first.prompt_fingerprint
    assert db_session.query(Evaluation).count() == 2


def test_evaluation_persists_template_id_and_fingerprint_via_api(client, seeded, monkeypatch):
    tid = client.post("/api/judge-templates", json={
        "project_id": seeded.id, "name": "api-tpl", "content": "api rubric"}).json()["id"]

    def fake_run_judge(db, subject_trace_id, judge_model, **kwargs):
        from models.entities import utcnow
        return Evaluation(id="ev-api", project_id=seeded.id,
                          subject_trace_id=subject_trace_id,
                          compare_trace_id=kwargs.get("compare_trace_id"),
                          judge_model=judge_model, context_mode="output_only",
                          score=9.0, verdict="pass", reasoning="fine",
                          judge_template_id=kwargs.get("judge_template_id"),
                          prompt_fingerprint="fingerprintabc123",
                          created_at=utcnow())

    monkeypatch.setattr(judge_service, "run_judge", fake_run_judge)
    resp = client.post("/api/evaluations", json={
        "subject_trace_id": "tr-a", "judge_models": ["judge-model"],
        "judge_template_id": tid})
    assert resp.status_code == 200
    ev_out = resp.json()["results"][0]["evaluation"]
    assert ev_out["judge_template_id"] == tid
    assert ev_out["judge_template_name"] == "api-tpl"


def test_get_evaluations_lists_template_name_via_join(client, db_session, seeded):
    tid = JudgeTemplate(project_id=seeded.id, name="join-tpl", content="c")
    db_session.add(tid)
    db_session.flush()
    db_session.add(Evaluation(project_id=seeded.id, subject_trace_id="tr-a",
                              compare_trace_id=None, judge_model="m",
                              context_mode="output_only", score=5.0,
                              verdict="pass", reasoning="r",
                              judge_template_id=tid.id,
                              prompt_fingerprint="abc"))
    db_session.commit()
    resp = client.get("/api/evaluations?subject_trace_id=tr-a")
    assert resp.status_code == 200
    body = resp.json()
    assert body[0]["judge_template_id"] == tid.id
    assert body[0]["judge_template_name"] == "join-tpl"
