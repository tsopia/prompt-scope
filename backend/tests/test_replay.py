import json

import httpx
import pytest

from models.entities import (ModelPricing, ModelProvider, Observation, Project,
                             ReplayRun, Trace)
from services.replay_service import MAX_REPLAY_STEPS, execute_replay


@pytest.fixture()
def seeded(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    provider = ModelProvider(project_id=p.id, name="oai",
                             base_url="https://api.test.com/v1",
                             api_key="sk-x", provider_type="openai")
    db_session.add(provider)
    db_session.flush()
    db_session.add(ModelPricing(project_id=p.id, model="cheap-model",
                                input_price_per_1k=0.001,
                                output_price_per_1k=0.002,
                                provider_id=provider.id))
    t = Trace(id="src-1", project_id=p.id, name="weather-run",
              input={"q": "北京天气"}, output={"a": "晴"})
    db_session.add(t)
    db_session.add_all([
        Observation(
            id="ob-llm", trace_id="src-1", type="llm", name="plan", seq=0,
            model="gpt-4o",
            messages=[{"role": "system", "content": "你是天气助手"},
                      {"role": "user", "content": "北京天气"}],
            tool_definitions=[{"type": "function",
                               "function": {"name": "get_weather",
                                            "parameters": {}}}]),
        Observation(id="ob-tool", trace_id="src-1", parent_id="ob-llm",
                    type="tool", name="get_weather", seq=1,
                    tool_input={"city": "北京"},
                    tool_output={"weather": "晴", "temp": 32}),
    ])
    db_session.commit()
    return p


def scripted_client(responses: list[dict]):
    """按调用次序依次返回 responses 中的 JSON。"""
    calls = {"n": 0, "payloads": []}

    def handler(request):
        calls["payloads"].append(json.loads(request.content))
        body = responses[min(calls["n"], len(responses) - 1)]
        calls["n"] += 1
        return httpx.Response(200, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler)), calls


def tool_call_response(name, args_json):
    return {"choices": [{"message": {
        "role": "assistant", "content": None,
        "tool_calls": [{"id": "c1", "type": "function",
                        "function": {"name": name, "arguments": args_json}}]}}],
        "usage": {"prompt_tokens": 50, "completion_tokens": 10}}


def final_response(text):
    return {"choices": [{"message": {"role": "assistant", "content": text}}],
            "usage": {"prompt_tokens": 60, "completion_tokens": 20}}


def make_run(db_session, seeded, **over):
    run = ReplayRun(project_id=seeded.id, source_trace_id="src-1",
                    override_model="cheap-model", status="pending", **over)
    db_session.add(run)
    db_session.commit()
    return run


def test_replay_happy_path_with_matching_tool(db_session, seeded):
    client, calls = scripted_client([
        tool_call_response("get_weather", '{"city": "北京"}'),
        final_response("北京晴 32 度"),
    ])
    run = execute_replay(db_session, make_run(db_session, seeded), client=client)

    assert run.status == "success"
    assert run.divergences == []
    result = db_session.get(Trace, run.result_trace_id)
    assert result.origin == "replay"
    assert result.output == "北京晴 32 度"
    obs = result.observations
    # llm-step-0 + mocked tool + llm-step-1
    assert [o.type for o in obs] == ["llm", "tool", "llm"]
    assert obs[1].meta == {"mocked": True, "recorded_input": {"city": "北京"}}
    assert obs[1].tool_output == {"weather": "晴", "temp": 32}
    # 第二次调用的消息里带了录制的工具结果
    second_payload = calls["payloads"][1]
    assert any("晴" in json.dumps(m, ensure_ascii=False)
               for m in second_payload["messages"])
    # 成本按 pricing 计算并聚合
    assert result.total_cost == pytest.approx(
        (50 + 60) / 1000 * 0.001 + (10 + 20) / 1000 * 0.002)


def test_replay_param_mismatch_recorded_but_continues(db_session, seeded):
    client, _ = scripted_client([
        tool_call_response("get_weather", '{"city": "上海"}'),
        final_response("done"),
    ])
    run = execute_replay(db_session, make_run(db_session, seeded), client=client)
    assert run.status == "success"
    assert len(run.divergences) == 1
    d = run.divergences[0]
    assert d["type"] == "param_mismatch"
    assert d["step"] == 1
    assert d["recorded_input"] == {"city": "北京"}
    assert d["actual_input"] == {"city": "上海"}
    # 仍返回录制结果
    result = db_session.get(Trace, run.result_trace_id)
    assert result.observations[1].tool_output == {"weather": "晴", "temp": 32}


def test_replay_unrecorded_call_gets_error_result(db_session, seeded):
    client, calls = scripted_client([
        tool_call_response("get_stock", '{"code": "AAPL"}'),
        final_response("done"),
    ])
    run = execute_replay(db_session, make_run(db_session, seeded), client=client)
    assert run.status == "success"
    assert run.divergences[0]["type"] == "unrecorded_call"
    assert run.divergences[0]["step"] == 1
    result = db_session.get(Trace, run.result_trace_id)
    tool_ob = result.observations[1]
    assert tool_ob.status == "error"
    assert "不可用" in json.dumps(tool_ob.tool_output, ensure_ascii=False)


def test_replay_prompt_override_replaces_system(db_session, seeded):
    client, calls = scripted_client([final_response("ok")])
    run = execute_replay(
        db_session,
        make_run(db_session, seeded, override_prompt_text="你是简洁的天气播报员"),
        client=client)
    first_payload = calls["payloads"][0]
    assert first_payload["messages"][0] == {
        "role": "system", "content": "你是简洁的天气播报员"}
    assert run.status == "success"


def test_replay_result_trace_records_prompt_version(db_session, seeded):
    from models.entities import Prompt, PromptVersion

    pr = Prompt(project_id=seeded.id, name="p")
    db_session.add(pr)
    db_session.flush()
    v = PromptVersion(prompt_id=pr.id, version=1, content="新 system")
    db_session.add(v)
    db_session.commit()
    client, calls = scripted_client([final_response("ok")])
    run = execute_replay(
        db_session,
        make_run(db_session, seeded, override_prompt_version_id=v.id),
        client=client)
    assert run.status == "success"
    result = db_session.get(Trace, run.result_trace_id)
    assert result.prompt_version_id == v.id
    assert calls["payloads"][0]["messages"][0]["content"] == "新 system"


def test_replay_model_error_keeps_partial_trace(db_session, seeded):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(200, json=tool_call_response(
                "get_weather", '{"city": "北京"}'))
        return httpx.Response(500, json={"error": "boom"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    run = execute_replay(db_session, make_run(db_session, seeded), client=client)
    assert run.status == "failed"
    assert run.error and "500" in run.error
    # 部分链路已落库
    result = db_session.get(Trace, run.result_trace_id)
    assert result is not None
    assert result.status == "error"
    assert [o.type for o in result.observations] == ["llm", "tool"]


def test_replay_max_steps_guard(db_session, seeded):
    # 永远返回 tool_call → 触发步数护栏
    client, _ = scripted_client([
        tool_call_response("get_weather", '{"city": "北京"}')])
    run = execute_replay(db_session, make_run(db_session, seeded), client=client)
    assert run.status == "failed"
    assert any(d["type"] == "max_steps_exceeded" for d in run.divergences)
    max_steps_d = next(d for d in run.divergences if d["type"] == "max_steps_exceeded")
    assert max_steps_d["step"] == MAX_REPLAY_STEPS
    result = db_session.get(Trace, run.result_trace_id)
    assert len([o for o in result.observations if o.type == "llm"]) == MAX_REPLAY_STEPS


def test_replay_source_without_llm_fails_cleanly(db_session, seeded):
    from fastapi import HTTPException
    t = Trace(id="src-empty", project_id=seeded.id, name="empty")
    db_session.add(t)
    db_session.commit()
    run = ReplayRun(project_id=seeded.id, source_trace_id="src-empty",
                    override_model="cheap-model", status="pending")
    db_session.add(run)
    db_session.commit()
    with pytest.raises(HTTPException) as exc:
        execute_replay(db_session, run)
    assert exc.value.status_code == 400


def test_replay_result_metadata_records_lineage(db_session, seeded):
    client, calls = scripted_client([final_response("ok")])
    run = execute_replay(
        db_session,
        make_run(db_session, seeded,
                 override_model_params={"thinking": {"type": "enabled"}}),
        client=client)
    assert run.status == "success"
    result = db_session.get(Trace, run.result_trace_id)
    assert result.meta["source_trace_id"] == "src-1"
    assert result.meta["source_trace_name"] == "weather-run"
    assert result.meta["override_model"] == "cheap-model"
    assert result.meta["thinking"] == "enabled"


def test_replay_result_metadata_omits_override_model_and_thinking_when_absent(
        db_session, seeded):
    # run 未设置 override_model、未设置 thinking 参数 -> 两个 key 都不应写入 metadata
    from services.replay_service import _persist_result

    source = db_session.get(Trace, "src-1")
    run = ReplayRun(project_id=seeded.id, source_trace_id="src-1", status="pending")
    db_session.add(run)
    db_session.commit()
    _persist_result(db_session, run, source, "result-empty-override", [],
                    "ok", None)
    db_session.commit()
    result = db_session.get(Trace, "result-empty-override")
    assert result.meta["source_trace_id"] == "src-1"
    assert result.meta["source_trace_name"] == "weather-run"
    assert "override_model" not in result.meta
    assert "thinking" not in result.meta


def test_single_point_replay_uses_target_subtree(db_session, seeded):
    # 给源 trace 加第二个 llm 节点（多阶段）及其子 tool
    db_session.add_all([
        Observation(id="ob-llm2", trace_id="src-1", type="llm", name="answer",
                    seq=2, model="gpt-4o",
                    messages=[{"role": "system", "content": "阶段二"},
                              {"role": "user", "content": "汇总"}],
                    tool_definitions=[{"type": "function",
                                       "function": {"name": "summarize",
                                                    "parameters": {}}}]),
        Observation(id="ob-tool2", trace_id="src-1", parent_id="ob-llm2",
                    type="tool", name="summarize", seq=3,
                    tool_input={"n": 1}, tool_output={"s": "ok"}),
    ])
    db_session.commit()

    client, calls = scripted_client([
        tool_call_response("summarize", '{"n": 1}'),
        final_response("汇总完成"),
    ])
    run = execute_replay(db_session,
                         make_run(db_session, seeded,
                                  target_observation_id="ob-llm2"),
                         client=client)
    assert run.status == "success"
    assert run.divergences == []
    # 初始消息来自目标节点而非入口节点
    assert calls["payloads"][0]["messages"][0]["content"] == "阶段二"
    result = db_session.get(Trace, run.result_trace_id)
    assert result.meta["target_observation_id"] == "ob-llm2"


def test_single_point_replay_does_not_consume_other_subtree_tools(db_session, seeded):
    # 目标节点子树没有录制 get_weather——即使入口节点子树有，也应记 unrecorded_call
    db_session.add(Observation(
        id="ob-llm2", trace_id="src-1", type="llm", name="answer", seq=2,
        model="gpt-4o", messages=[{"role": "user", "content": "x"}],
        tool_definitions=[{"type": "function",
                           "function": {"name": "get_weather",
                                        "parameters": {}}}]))
    db_session.commit()
    client, _ = scripted_client([
        tool_call_response("get_weather", '{"city": "北京"}'),
        final_response("done"),
    ])
    run = execute_replay(db_session,
                         make_run(db_session, seeded,
                                  target_observation_id="ob-llm2"),
                         client=client)
    assert run.divergences[0]["type"] == "unrecorded_call"
    assert run.divergences[0]["step"] == 1


def test_single_point_replay_keeps_upstream_context(db_session, seeded):
    db_session.add(Observation(
        id="ob-llm2", trace_id="src-1", type="llm", name="answer", seq=2,
        model="gpt-4o",
        messages=[{"role": "system", "content": "你是助手"},
                  {"role": "user", "content": "北京天气"},
                  {"role": "tool", "content": "{\"weather\": \"晴\"}"}]))
    db_session.commit()
    client, calls = scripted_client([final_response("晴")])
    run = execute_replay(db_session,
                         make_run(db_session, seeded,
                                  target_observation_id="ob-llm2"),
                         client=client)
    assert run.status == "success"
    sent = calls["payloads"][0]["messages"]
    assert len(sent) == 3  # 上游 tool 消息未被截断
    assert sent[2]["role"] == "tool"


def test_single_point_replay_invalid_target_400(db_session, seeded):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        execute_replay(db_session,
                       make_run(db_session, seeded,
                                target_observation_id="ob-tool"))
    assert exc.value.status_code == 400


def test_wall_clock_guard(db_session, seeded, monkeypatch):
    import services.replay_service as rs
    monkeypatch.setattr(rs, "MAX_REPLAY_WALL_SECONDS", -1)  # 立即超限
    client, _ = scripted_client([final_response("never reached")])
    run = execute_replay(db_session, make_run(db_session, seeded),
                         client=client)
    assert run.status == "failed"
    assert any(d["type"] == "wall_clock_exceeded" for d in run.divergences)
    wall_clock_d = next(d for d in run.divergences if d["type"] == "wall_clock_exceeded")
    assert wall_clock_d["step"] == 1


def test_reasoning_content_persisted_and_passed_back(db_session, seeded):
    """思考模型：reasoning_content 落入 llm observation metadata；
    多轮工具调用时 raw_message（含 reasoning_content）原样回传给 provider。"""
    from models.entities import ReplayRun, Observation
    run = ReplayRun(project_id=seeded.id, source_trace_id="src-1",
                    override_model="cheap-model",
                    override_model_params={"thinking": {"type": "enabled"}})
    db_session.add(run)
    db_session.commit()

    step1 = {"choices": [{"message": {
        "role": "assistant",
        "content": None,
        "reasoning_content": "需要先查天气工具。",
        "tool_calls": [{"id": "c1", "type": "function",
                        "function": {"name": "get_weather",
                                     "arguments": "{\"city\": \"北京\"}"}}],
    }}], "usage": {"prompt_tokens": 10, "completion_tokens": 20}}
    step2 = {"choices": [{"message": {
        "role": "assistant",
        "content": "北京晴，32 度。",
        "reasoning_content": "工具返回晴 32 度，直接总结。",
    }}], "usage": {"prompt_tokens": 30, "completion_tokens": 15}}
    client, calls = scripted_client([step1, step2])

    execute_replay(db_session, run, client=client)

    assert run.status == "success"
    # thinking 参数透传进了每次请求
    assert all(p.get("thinking") == {"type": "enabled"} for p in calls["payloads"])
    # 第二轮请求回传了含 reasoning_content 的 assistant 原始消息（DeepSeek 400 红线）
    second_msgs = calls["payloads"][1]["messages"]
    assistant = [m for m in second_msgs if m.get("role") == "assistant"][-1]
    assert assistant.get("reasoning_content") == "需要先查天气工具。"
    # 两个 llm observation 的 metadata 都带 reasoning_content
    obs = (db_session.query(Observation)
           .filter(Observation.trace_id == run.result_trace_id,
                   Observation.type == "llm")
           .order_by(Observation.seq).all())
    assert [o.meta.get("reasoning_content") for o in obs] == \
        ["需要先查天气工具。", "工具返回晴 32 度，直接总结。"]
