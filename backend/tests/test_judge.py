import json

import httpx
import pytest

from models.entities import (Evaluation, ModelPricing, ModelProvider, Project,
                             ProjectMember, Trace)
import services.judge_service as judge_service


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


def test_evaluate_endpoint_exposes_structured_fields(client, db_session, seeded):
    resp = client.post("/api/evaluations", json={
        "subject_trace_id": "tr-a", "compare_trace_id": "tr-b",
        "judge_models": ["judge-model"]})
    # 走真实 run_judge（未 monkeypatch），但 provider 未配置真实 client——
    # 这里只验证响应结构本身携带新字段键（值可以是 error/None），
    # 真正的落库+序列化由下面基于 GET 列表的测试覆盖。
    assert resp.status_code == 200

    ev = Evaluation(project_id=seeded.id, subject_trace_id="tr-a",
                    compare_trace_id="tr-b", judge_model="m",
                    context_mode="output_only", score=7.0, score_b=8.0,
                    verdict="replaceable", reasoning="r",
                    dimensions=[{"name": "正确性", "score_a": 7.0, "score_b": 8.0}],
                    evidence="ev", evidence_step="步骤 1", confidence=3)
    db_session.add(ev)
    db_session.commit()
    listed = client.get("/api/evaluations?subject_trace_id=tr-a&compare_trace_id=tr-b").json()
    row = next(r for r in listed if r["id"] == ev.id)
    assert row["dimensions"] == [{"name": "正确性", "score": None,
                                  "score_a": 7.0, "score_b": 8.0}]
    assert row["evidence"] == "ev"
    assert row["evidence_step"] == "步骤 1"
    assert row["confidence"] == 3


def test_evaluate_endpoint_returns_structured_fields_from_mocked_run_judge(
        client, db_session, seeded, monkeypatch):
    def fake_run_judge(db, subject_trace_id, judge_model, **kwargs):
        from models.entities import utcnow
        return Evaluation(
            id="ev-struct", project_id=seeded.id, subject_trace_id=subject_trace_id,
            compare_trace_id=kwargs.get("compare_trace_id"), judge_model=judge_model,
            context_mode="output_only", score=9.0, verdict="pass", reasoning="fine",
            dimensions=[{"name": "正确性", "score": 9.0}],
            evidence="全部正确", evidence_step="全链路 · 结论核对", confidence=2,
            created_at=utcnow())

    monkeypatch.setattr(judge_service, "run_judge", fake_run_judge)
    resp = client.post("/api/evaluations", json={
        "subject_trace_id": "tr-a", "judge_models": ["judge-model"]})
    assert resp.status_code == 200
    ev_out = resp.json()["results"][0]["evaluation"]
    assert ev_out["dimensions"] == [{"name": "正确性", "score": 9.0,
                                     "score_a": None, "score_b": None}]
    assert ev_out["evidence"] == "全部正确"
    assert ev_out["evidence_step"] == "全链路 · 结论核对"
    assert ev_out["confidence"] == 2


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


def test_dump_pretty_prints_dict_and_marks_truncation():
    from services.judge_service import MAX_FIELD_CHARS, _dump

    pretty = _dump({"a": 1, "b": [1, 2]})
    assert "\n" in pretty  # 缩进美化，不是压缩单行 JSON
    assert '"a": 1' in pretty

    passthrough = _dump("plain string")
    assert passthrough == "plain string"

    long_text = "x" * (MAX_FIELD_CHARS + 500)
    truncated = _dump(long_text)
    assert truncated.endswith("…(截断)")
    assert len(truncated) == MAX_FIELD_CHARS + len("…(截断)")

    short_text = "short"
    assert _dump(short_text) == short_text  # 未截断时不追加标记


# --- structured output: dimensions / evidence / confidence ---------------

def test_pair_judge_persists_full_structured_output(db_session, seeded):
    payload = {
        "score_a": 7.0, "score_b": 8.0, "verdict": "replaceable", "reasoning": "ok",
        "dimensions": [
            {"name": "正确性", "score_a": 7, "score_b": 8},
            {"name": "意图一致", "score_a": 6, "score_b": 9},
            {"name": "成本效率", "score_a": 8, "score_b": 5},
        ],
        "evidence": "B 的工具入参少传了 currency 字段",
        "evidence_step": "步骤 3 · param_mismatch",
        "confidence": 3,
    }
    ev = judge_service.run_judge(
        db_session, "tr-a", "judge-model", compare_trace_id="tr-b",
        client=judge_http_client(payload))
    assert ev.dimensions == payload["dimensions"]
    assert ev.evidence == payload["evidence"]
    assert ev.evidence_step == payload["evidence_step"]
    assert ev.confidence == 3


def test_single_judge_persists_full_structured_output(db_session, seeded):
    payload = {
        "score": 9.0, "verdict": "pass", "reasoning": "ok",
        "dimensions": [
            {"name": "正确性", "score": 9},
            {"name": "意图一致", "score": 8},
            {"name": "成本效率", "score": 7},
        ],
        "evidence": "输出完整覆盖了任务要求", "evidence_step": "全链路 · 结论核对",
        "confidence": 2,
    }
    ev = judge_service.run_judge(
        db_session, "tr-a", "judge-model", client=judge_http_client(payload))
    assert ev.dimensions == payload["dimensions"]
    assert ev.evidence == payload["evidence"]
    assert ev.evidence_step == payload["evidence_step"]
    assert ev.confidence == 2


def test_judge_returning_only_old_keys_still_succeeds_with_null_new_fields(db_session, seeded):
    # 优雅降级：judge 只返回旧契约字段，评分依然成功，新字段全部为 NULL，
    # 绝不能用假数据（如 0 分）顶替。
    ev = judge_service.run_judge(
        db_session, "tr-a", "judge-model", compare_trace_id="tr-b",
        client=judge_http_client({"score_a": 6.0, "score_b": 6.0,
                                  "verdict": "replaceable", "reasoning": "老格式"}))
    assert ev.score == 6.0 and ev.score_b == 6.0
    assert ev.dimensions is None
    assert ev.evidence is None
    assert ev.evidence_step is None
    assert ev.confidence is None


def test_malformed_dimensions_are_filtered_not_crashed(db_session, seeded):
    payload = {
        "score_a": 5.0, "score_b": 5.0, "verdict": "not_replaceable", "reasoning": "r",
        "dimensions": [
            {"name": "正确性", "score_a": 6, "score_b": 7},   # 有效
            {"name": "不存在的维度", "score_a": 1, "score_b": 1},  # 名字不在 JUDGE_DIMENSIONS
            {"name": "意图一致", "score_a": "not-a-number", "score_b": 5},  # 非数字
            {"name": "成本效率", "score_a": 999, "score_b": -5},  # 需要 clamp 到 0-10
            "not-a-dict",  # 完全畸形
        ],
        "evidence": "x" * 500,  # 超过 200 字，需截断
        "evidence_step": "y" * 300,  # 超过 160 字，需截断
        "confidence": 7,  # 越界
    }
    ev = judge_service.run_judge(
        db_session, "tr-a", "judge-model", compare_trace_id="tr-b",
        client=judge_http_client(payload))
    assert ev.dimensions == [
        {"name": "正确性", "score_a": 6.0, "score_b": 7.0},
        {"name": "成本效率", "score_a": 10.0, "score_b": 0.0},
    ]
    assert len(ev.evidence) == 200
    assert len(ev.evidence_step) == 160
    assert ev.confidence is None  # 7 超出 1-3 范围


def test_all_dimensions_malformed_yields_none(db_session, seeded):
    ev = judge_service.run_judge(
        db_session, "tr-a", "judge-model",
        client=judge_http_client({
            "score": 5.0, "verdict": "pass", "reasoning": "r",
            "dimensions": [{"name": "不存在", "score": 5}]}))
    assert ev.dimensions is None


def test_skeleton_version_bump_invalidates_old_cached_evaluation(db_session, seeded):
    # 模拟骨架升级前落库的评分：fingerprint 只哈希了 rubric，没有拼版本号。
    import hashlib
    old_fingerprint = hashlib.sha256(judge_service.DEFAULT_RUBRIC.encode()).hexdigest()[:16]
    db_session.add(Evaluation(
        project_id=seeded.id, subject_trace_id="tr-a", compare_trace_id="tr-b",
        judge_model="judge-model", context_mode="output_only", score=1.0, score_b=1.0,
        verdict="not_replaceable", reasoning="老骨架的评分",
        prompt_fingerprint=old_fingerprint))
    db_session.commit()

    fresh = judge_service.run_judge(
        db_session, "tr-a", "judge-model", compare_trace_id="tr-b",
        client=judge_http_client({"score_a": 8.0, "score_b": 8.0,
                                  "verdict": "replaceable", "reasoning": "新骨架重新打分"}))
    assert fresh.reasoning == "新骨架重新打分"
    assert fresh.prompt_fingerprint == judge_service.builtin_fingerprint()
    assert fresh.prompt_fingerprint != old_fingerprint

    # 同样的新骨架下再跑一次应该命中刚才的缓存
    def exploding_handler(request):
        raise AssertionError("should hit cache under the new skeleton version")
    cached = judge_service.run_judge(
        db_session, "tr-a", "judge-model", compare_trace_id="tr-b",
        client=httpx.Client(transport=httpx.MockTransport(exploding_handler)))
    assert cached.id == fresh.id


# --- tools_aligned context mode -------------------------------------------

def test_tools_aligned_context_lists_tool_calls_for_both_sides(db_session, seeded):
    from models.entities import Observation
    db_session.add_all([
        Observation(id="ob-a1", trace_id="tr-a", type="tool", name="search",
                   seq=0, tool_input={"q": "foo"}, tool_output={"r": "bar"}),
        Observation(id="ob-b1", trace_id="tr-b", type="tool", name="search",
                   seq=0, tool_input={"q": "foo2"}, tool_output={"r": "baz"}),
    ])
    db_session.commit()
    tr_a = db_session.get(Trace, "tr-a")
    tr_b = db_session.get(Trace, "tr-b")
    ctx = judge_service._tools_aligned_context(tr_a, tr_b)
    assert "【A 的工具调用】" in ctx and "【B 的工具调用】" in ctx
    assert "search" in ctx and "foo" in ctx and "foo2" in ctx


def test_tools_aligned_is_a_distinct_cache_key(db_session, seeded):
    output_only = judge_service.run_judge(
        db_session, "tr-a", "judge-model", compare_trace_id="tr-b",
        context_mode="output_only",
        client=judge_http_client({"score_a": 5.0, "score_b": 5.0,
                                  "verdict": "not_replaceable", "reasoning": "a"}))
    tools_aligned = judge_service.run_judge(
        db_session, "tr-a", "judge-model", compare_trace_id="tr-b",
        context_mode="tools_aligned",
        client=judge_http_client({"score_a": 7.0, "score_b": 7.0,
                                  "verdict": "replaceable", "reasoning": "b"}))
    assert tools_aligned.id != output_only.id
    assert tools_aligned.context_mode == "tools_aligned"

    # 再跑一次 tools_aligned 应该命中刚才那条缓存
    def exploding_handler(request):
        raise AssertionError("should hit cache for repeated tools_aligned run")
    cached = judge_service.run_judge(
        db_session, "tr-a", "judge-model", compare_trace_id="tr-b",
        context_mode="tools_aligned",
        client=httpx.Client(transport=httpx.MockTransport(exploding_handler)))
    assert cached.id == tools_aligned.id


def test_evaluations_hidden_from_non_member(client, db_session):
    # a project the logged-in user is NOT a member of
    other = Project(name="other-grp")
    db_session.add(other)
    db_session.flush()
    db_session.add(Trace(id="other-tr", project_id=other.id, name="a"))
    db_session.commit()

    assert client.post("/api/evaluations", json={
        "subject_trace_id": "other-tr",
        "judge_models": ["judge-model"]}).status_code == 403
    assert client.get(
        "/api/evaluations?subject_trace_id=other-tr").status_code == 403
    resp = client.post("/api/evaluations/batch", json={
        "subject_trace_ids": ["other-tr"], "judge_models": ["judge-model"]})
    assert resp.status_code == 200
    assert resp.json()["results"][0]["status"] == "error"
