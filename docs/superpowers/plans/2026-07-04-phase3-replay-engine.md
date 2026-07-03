# Phase 3: 回放引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 单入口 agent loop 回放：换模型/改参数/改 prompt 重跑真实 trace，工具调用用录制结果 mock，记录参数偏离（divergence），回放产出新 trace（origin=replay）自动接入既有对比/评分工作台。

**Architecture:** `llm_client` 扩展 tools 支持（OpenAI 兼容；anthropic+tools 明确报错，MVP 范围裁剪）。`replay_service` 实现录制队列（按工具名 FIFO）、稳定 JSON 参数比对、divergence 记录、最大步数护栏；回放 trace 通过复用 `ingest_service.ingest()` 落库（成本/延迟自动计算）。同步执行（MVP）。前端 `/replay/[id]` 配置页 → 运行 → 一键进 `/compare`。

**Tech Stack:** 既有栈；测试 httpx.MockTransport 脚本化多轮响应

**Spec:** `docs/superpowers/specs/2026-07-04-agent-replay-platform-design.md` §5（回放引擎——执行流程、偏离不中断、护栏、MVP 范围）、§3（replay_runs）

## Global Constraints

- git 提交信息不含任何 AI 署名
- 偏离不中断：参数不一致 → 记录 divergence 并继续（仍返回录制结果）；录制外调用 → 给模型"工具结果不可用"错误结果并记录严重偏离，继续
- 护栏：`MAX_REPLAY_STEPS = 15`；模型调用失败 → replay_run=failed 但保留已完成的部分链路（partial trace 也落库）
- 回放产出物是 trace（origin=replay），通过 `ingest_service.ingest()` 落库——不得绕过 ingest 直写 ORM
- MVP 仅支持 OpenAI 兼容 provider 的工具回放；anthropic provider 且 trace 含工具定义 → 400 明确报错（无工具的 trace 两种 provider 都可回放）
- 可回放模型 = `model_pricings` 中配置了 provider 的行（与 judge 同一解析逻辑，提取为共享模块）
- 参数比对用稳定序列化：`json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str)`
- 前端不新增 runtime 依赖

---

### Task 1: llm_client 工具调用支持

**Files:**
- Modify: `backend/services/llm_client.py`
- Test: `backend/tests/test_llm_client.py`（追加）

**Interfaces:**
- Produces（向后兼容——现有调用方不传 tools 行为不变）:
  - `chat_completion(provider, model, messages, model_params=None, tools=None, client=None) -> dict`，返回增加两个键：`"tool_calls": list | None`（规范化：`[{"id": str, "name": str, "arguments": dict | str}]`，arguments 尽量 json.loads，失败保留原始字符串）与 `"raw_message": dict | None`（openai 响应的原始 assistant message，回放续写对话用）
  - openai 路径：`tools` 非空时加入请求 payload（值已是 OpenAI tools 格式，由调用方负责包装）
  - anthropic 路径：`tools` 非空 → `raise LLMClientError("anthropic provider 暂不支持工具回放（Phase 4 计划）")`；无 tools 时行为不变，返回中 `tool_calls=None, raw_message=None`

- [ ] **Step 1: 追加失败测试**（现有 6 个 llm_client 测试不动）

`backend/tests/test_llm_client.py` 追加：

```python
def test_openai_tools_passed_and_tool_calls_normalized():
    seen = {}

    def handler(request):
        import json as _json
        seen.update(_json.loads(request.content))
        return httpx.Response(200, json={
            "choices": [{"message": {
                "role": "assistant", "content": None,
                "tool_calls": [{"id": "call_1", "type": "function",
                                "function": {"name": "get_weather",
                                             "arguments": "{\"city\": \"北京\"}"}}]}}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 10}})

    tools = [{"type": "function", "function": {"name": "get_weather", "parameters": {}}}]
    out = chat_completion(openai_provider(), "gpt-4o",
                          [{"role": "user", "content": "天气"}],
                          tools=tools, client=make_client(handler))
    assert seen["tools"] == tools
    assert out["tool_calls"] == [{"id": "call_1", "name": "get_weather",
                                  "arguments": {"city": "北京"}}]
    assert out["raw_message"]["tool_calls"][0]["id"] == "call_1"
    assert out["content"] is None


def test_openai_unparseable_tool_arguments_kept_raw():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {
                "role": "assistant", "content": None,
                "tool_calls": [{"id": "c1", "type": "function",
                                "function": {"name": "t", "arguments": "not-json"}}]}}],
            "usage": {}})

    out = chat_completion(openai_provider(), "gpt-4o",
                          [{"role": "user", "content": "x"}],
                          tools=[{"type": "function", "function": {"name": "t"}}],
                          client=make_client(handler))
    assert out["tool_calls"][0]["arguments"] == "not-json"


def test_no_tools_response_has_none_tool_calls():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"role": "assistant", "content": "hi"}}],
            "usage": {}})

    out = chat_completion(openai_provider(), "gpt-4o",
                          [{"role": "user", "content": "x"}],
                          client=make_client(handler))
    assert out["tool_calls"] is None
    assert out["content"] == "hi"


def test_anthropic_with_tools_rejected():
    provider = ModelProvider(name="ant2", base_url="https://api.anthropic.test",
                             api_key="ak", provider_type="anthropic")
    with pytest.raises(LLMClientError, match="暂不支持工具回放"):
        chat_completion(provider, "claude-x", [{"role": "user", "content": "x"}],
                        tools=[{"type": "function", "function": {"name": "t"}}],
                        client=make_client(lambda r: httpx.Response(200, json={})))
```

运行确认失败（TypeError: unexpected keyword 'tools' 或断言失败）

- [ ] **Step 2: 实现**

`_openai_call` 改为接受 `tools` 并处理响应：

```python
def _normalize_tool_calls(message: dict) -> list | None:
    raw = message.get("tool_calls")
    if not raw:
        return None
    normalized = []
    for tc in raw:
        fn = tc.get("function") or {}
        args = fn.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except (ValueError, TypeError):
                pass  # 保留原始字符串
        normalized.append({"id": tc.get("id"), "name": fn.get("name"),
                           "arguments": args})
    return normalized


def _openai_call(client, provider, model, messages, model_params, tools):
    payload = {"model": model, "messages": messages, **(model_params or {})}
    if tools:
        payload["tools"] = tools
    resp = client.post(
        f"{provider.base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {provider.api_key}"},
        json=payload, timeout=DEFAULT_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    message = data["choices"][0]["message"]
    usage = data.get("usage") or {}
    return {
        "content": message.get("content"),
        "tool_calls": _normalize_tool_calls(message),
        "raw_message": message,
        "input_tokens": usage.get("prompt_tokens"),
        "output_tokens": usage.get("completion_tokens"),
    }
```

（文件顶部补 `import json`。）`_anthropic_call` 签名同步加 `tools` 参数，开头：

```python
    if tools:
        raise LLMClientError("anthropic provider 暂不支持工具回放（Phase 4 计划）")
```

返回 dict 补 `"tool_calls": None, "raw_message": None`。`chat_completion` 签名加 `tools=None` 并透传两个分支。

- [ ] **Step 3: 全量测试确认通过**

`cd backend && .venv/bin/python -m pytest tests/ -q` → 48 passed 无 warning（44+4；judge 测试断言 `out ==` 精确 dict 的旧用例若因新增键失败，把断言改为逐键断言——brief 内 Task 2 的旧测试 `test_openai_compatible_success`/`test_anthropic_success` 用了 `out == {...}` 精确匹配，需更新为包含新键的完整 dict）

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add tool-calling support to LLM client for replay"
```

---

### Task 2: 共享 provider 解析 + Replay 数据契约

**Files:**
- Create: `backend/services/providers.py`, `backend/schemas/replay.py`
- Modify: `backend/services/judge_service.py`（改用共享解析）
- Test: `backend/tests/test_providers.py`

**Interfaces:**
- Produces:
  - `providers.resolve_provider(db, model: str) -> ModelProvider`——即原 `judge_service._resolve_provider` 逻辑原样迁移（pricing 行含 provider_id → provider；否则 HTTPException 400 detail `f"model 未配置 provider: {model}"`）；`judge_service` 删除私有函数改 import（其 400 detail 文案随之统一为新文案）
  - `schemas/replay.py`：
    - `ReplayRequest(source_trace_id: str, override_model: str | None = None, override_model_params: dict | None = None, override_prompt_text: str | None = None, override_prompt_version_id: str | None = None)`
    - `ReplayRunOut(id, source_trace_id, result_trace_id: str | None, status, override_model: str | None, override_model_params: dict | None, override_prompt_text: str | None, override_prompt_version_id: str | None, divergences: list | None, error: str | None, created_at, finished_at: datetime | None)`（ConfigDict from_attributes）

- [ ] **Step 1: 写失败测试**

`backend/tests/test_providers.py`：

```python
import pytest
from fastapi import HTTPException

from models.entities import ModelPricing, ModelProvider
from services.providers import resolve_provider


def test_resolve_provider_success(db_session):
    p = ModelProvider(name="oai", base_url="u", api_key="k", provider_type="openai")
    db_session.add(p)
    db_session.flush()
    db_session.add(ModelPricing(model="m1", input_price_per_1k=1,
                                output_price_per_1k=1, provider_id=p.id))
    db_session.commit()
    assert resolve_provider(db_session, "m1").id == p.id


def test_resolve_provider_unconfigured_400(db_session):
    with pytest.raises(HTTPException) as exc:
        resolve_provider(db_session, "nope")
    assert exc.value.status_code == 400
```

- [ ] **Step 2: 实现**（`providers.py` 迁移原逻辑；`judge_service.py` 顶部 `from services.providers import resolve_provider`，`_resolve_provider(db, judge_model)` 调用点改 `resolve_provider(db, judge_model)`，删除私有函数；`test_judge.py` 里若有断言 400 detail 文案的用例同步核对）；`schemas/replay.py` 按接口定义写全

- [ ] **Step 3: 全量测试确认通过** → 50 passed

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: share provider resolution and add replay schemas"
```

---

### Task 3: 回放引擎核心 replay_service

**Files:**
- Create: `backend/services/replay_service.py`
- Test: `backend/tests/test_replay.py`

**Interfaces:**
- Consumes: `llm_client.chat_completion`（含 tools）、`providers.resolve_provider`、`ingest_service.ingest`、`schemas.ingest.TraceIn/ObservationIn/IngestRequest`、`models.entities.*`
- Produces:
  - `replay_service.MAX_REPLAY_STEPS = 15`
  - `replay_service.stable_json(obj) -> str`
  - `replay_service.execute_replay(db, replay_run: ReplayRun, client=None) -> ReplayRun`——执行整个回放循环并落库；不 raise 业务失败（失败态写入 replay_run.status/error），仅编程错误才异常
  - divergence 记录格式：`{"type": "param_mismatch", "tool", "step", "recorded_input", "actual_input"}` / `{"type": "unrecorded_call", "tool", "step", "arguments"}` / `{"type": "max_steps_exceeded", "step"}`
  - 回放 trace：`origin="replay"`，name `f"{源名或id前8} (replay)"`，`metadata={"replay_run_id", "source_trace_id"}`；llm observation name `llm-step-{n}`；mock tool observation `metadata={"mocked": True, "recorded_input": ...}`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_replay.py`：

```python
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
    provider = ModelProvider(name="oai", base_url="https://api.test.com/v1",
                             api_key="sk-x", provider_type="openai")
    db_session.add(provider)
    db_session.flush()
    db_session.add(ModelPricing(model="cheap-model", input_price_per_1k=0.001,
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
```

运行确认失败（模块不存在）

- [ ] **Step 2: 实现 replay_service.py**

```python
import json
from collections import defaultdict, deque

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.entities import PromptVersion, ReplayRun, Trace, gen_id, utcnow
from schemas.ingest import IngestRequest, ObservationIn, TraceIn
from services.ingest_service import ingest
from services.llm_client import LLMClientError, chat_completion
from services.providers import resolve_provider

MAX_REPLAY_STEPS = 15


def stable_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str)


class RecordedTools:
    """源 trace 的工具调用录制，按工具名 FIFO 消费。"""

    def __init__(self, tool_observations):
        self.queues = defaultdict(deque)
        for ob in tool_observations:
            self.queues[ob.name].append(ob)

    def take(self, name):
        q = self.queues.get(name)
        return q.popleft() if q else None


def _find_entry_llm(trace: Trace):
    for ob in trace.observations:
        if ob.type == "llm":
            return ob
    raise HTTPException(status_code=400,
                        detail="源 trace 没有 llm observation，无法回放")


def _initial_messages(entry, override_prompt: str | None) -> list[dict]:
    msgs = [dict(m) for m in (entry.messages or [])]
    cut = len(msgs)
    for i, m in enumerate(msgs):
        if m.get("role") in ("assistant", "tool"):
            cut = i
            break
    msgs = msgs[:cut]
    if override_prompt is not None:
        for m in msgs:
            if m.get("role") == "system":
                m["content"] = override_prompt
                break
        else:
            msgs.insert(0, {"role": "system", "content": override_prompt})
    return msgs


def _normalize_tools(tool_definitions) -> list | None:
    if not tool_definitions:
        return None
    tools = []
    for d in tool_definitions:
        tools.append(d if d.get("type") == "function"
                     else {"type": "function", "function": d})
    return tools


def _resolve_prompt_override(db: Session, run: ReplayRun) -> str | None:
    if run.override_prompt_version_id:
        version = db.get(PromptVersion, run.override_prompt_version_id)
        if version is None:
            raise HTTPException(status_code=404,
                                detail="prompt version not found")
        return version.content
    return run.override_prompt_text


def _persist_result(db, run, source, result_trace_id, observations,
                    final_content, started_at) -> None:
    """先落 trace 再把 result_trace_id 写回 run——顺序不能反：
    ReplayRun.result_trace_id 有 FK，trace 不存在时提前 commit 会在 Postgres 上外键违约。"""
    trace_in = TraceIn(
        id=result_trace_id,
        name=f"{source.name or source.id[:8]} (replay)",
        origin="replay",
        status="success" if final_content is not None else "error",
        input=source.input,
        output=final_content,
        metadata={"replay_run_id": run.id, "source_trace_id": source.id},
        started_at=started_at,
        ended_at=utcnow(),
    )
    ingest(db, source.project_id,
           IngestRequest(trace=trace_in, observations=observations))
    run.result_trace_id = result_trace_id


def execute_replay(db: Session, run: ReplayRun, client=None) -> ReplayRun:
    source = db.get(Trace, run.source_trace_id)
    if source is None:
        raise HTTPException(status_code=404, detail="source trace not found")
    entry = _find_entry_llm(source)

    model = run.override_model or entry.model
    if not model:
        raise HTTPException(status_code=400, detail="无法确定回放模型")
    provider = resolve_provider(db, model)

    messages = _initial_messages(entry, _resolve_prompt_override(db, run))
    model_params = {**(entry.model_params or {}),
                    **(run.override_model_params or {})}
    tools = _normalize_tools(entry.tool_definitions)
    if tools and provider.provider_type == "anthropic":
        raise HTTPException(status_code=400,
                            detail="anthropic provider 暂不支持工具回放")

    recorded = RecordedTools([o for o in source.observations
                              if o.type == "tool"])
    divergences: list[dict] = []
    observations: list[ObservationIn] = []
    result_trace_id = gen_id()  # 先本地持有，trace 落库后才写回 run（FK 约束）
    run.status = "running"
    db.commit()

    started_at = utcnow()
    seq = 0
    final_content = None
    try:
        for step in range(MAX_REPLAY_STEPS):
            t0 = utcnow()
            result = chat_completion(provider, model, messages,
                                     model_params=model_params or None,
                                     tools=tools, client=client)
            llm_ob = ObservationIn(
                id=gen_id(), type="llm", name=f"llm-step-{step}", seq=seq,
                model=model, model_params=model_params or None,
                messages=[dict(m) for m in messages],
                tool_definitions=entry.tool_definitions,
                tool_calls=result["tool_calls"],
                completion=result["content"],
                input_tokens=result["input_tokens"],
                output_tokens=result["output_tokens"],
                started_at=t0, ended_at=utcnow(),
            )
            observations.append(llm_ob)
            seq += 1

            if not result["tool_calls"]:
                final_content = result["content"]
                break

            messages.append(result["raw_message"])
            for tc in result["tool_calls"]:
                rec = recorded.take(tc["name"])
                if rec is None:
                    divergences.append({
                        "type": "unrecorded_call", "tool": tc["name"],
                        "step": step, "arguments": tc["arguments"]})
                    tool_output = {"error": "工具结果不可用：录制中不存在该调用"}
                    status, error_txt, rec_input = "error", "unrecorded tool call", None
                else:
                    rec_input = rec.tool_input
                    if stable_json(tc["arguments"]) != stable_json(rec.tool_input):
                        divergences.append({
                            "type": "param_mismatch", "tool": tc["name"],
                            "step": step, "recorded_input": rec.tool_input,
                            "actual_input": tc["arguments"]})
                    tool_output = rec.tool_output
                    status, error_txt = "success", None
                observations.append(ObservationIn(
                    id=gen_id(), parent_id=llm_ob.id, type="tool",
                    name=tc["name"], seq=seq, status=status, error=error_txt,
                    tool_input=tc["arguments"] if tc["arguments"] is not None else {},
                    tool_output=tool_output,
                    metadata={"mocked": True, "recorded_input": rec_input},
                ))
                seq += 1
                messages.append({
                    "role": "tool", "tool_call_id": tc.get("id") or "",
                    "content": json.dumps(tool_output, ensure_ascii=False,
                                          default=str)})
        else:
            divergences.append({"type": "max_steps_exceeded",
                                "step": MAX_REPLAY_STEPS})

        _persist_result(db, run, source, result_trace_id, observations,
                        final_content, started_at)
        run.divergences = divergences
        if final_content is not None:
            run.status = "success"
        else:
            run.status = "failed"
            run.error = f"达到最大步数（{MAX_REPLAY_STEPS}）仍未产出最终回答"
    except LLMClientError as e:
        if observations:
            _persist_result(db, run, source, result_trace_id, observations,
                            None, started_at)
        run.divergences = divergences
        run.status = "failed"
        run.error = str(e)

    run.finished_at = utcnow()
    db.commit()
    return run
```

- [ ] **Step 3: 全量测试确认通过** → 57 passed 无 warning

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add replay engine with recorded tool mocking and divergence tracking"
```

---

### Task 4: Replay API 路由

**Files:**
- Create: `backend/routers/replay.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_replay_api.py`

**Interfaces:**
- Consumes: `replay_service.execute_replay`（通过模块属性调用以便 monkeypatch）、`schemas.replay.*`
- Produces:
  - `POST /api/replays` body=ReplayRequest → 同步执行，返回 ReplayRunOut；source 不存在 → 404（执行前校验）
  - `GET /api/replays/{replay_id}` → ReplayRunOut；404
  - `GET /api/replays?source_trace_id=` → `[ReplayRunOut]`（created_at 倒序）

- [ ] **Step 1: 写失败测试**

`backend/tests/test_replay_api.py`：

```python
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
```

- [ ] **Step 2: 实现 routers/replay.py**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ReplayRun, Trace
from schemas.replay import ReplayRequest, ReplayRunOut
import services.replay_service as replay_service

router = APIRouter(tags=["replay"])


@router.post("/replays", response_model=ReplayRunOut)
def create_replay(payload: ReplayRequest, db: Session = Depends(get_db)):
    source = db.get(Trace, payload.source_trace_id)
    if source is None:
        raise HTTPException(status_code=404, detail="source trace not found")
    run = ReplayRun(
        project_id=source.project_id,
        source_trace_id=payload.source_trace_id,
        override_model=payload.override_model,
        override_model_params=payload.override_model_params,
        override_prompt_text=payload.override_prompt_text,
        override_prompt_version_id=payload.override_prompt_version_id,
        status="pending",
    )
    db.add(run)
    db.commit()
    return replay_service.execute_replay(db, run)


@router.get("/replays/{replay_id}", response_model=ReplayRunOut)
def get_replay(replay_id: str, db: Session = Depends(get_db)):
    run = db.get(ReplayRun, replay_id)
    if run is None:
        raise HTTPException(status_code=404, detail="replay run not found")
    return run


@router.get("/replays", response_model=list[ReplayRunOut])
def list_replays(source_trace_id: str, db: Session = Depends(get_db)):
    return (db.query(ReplayRun)
            .filter(ReplayRun.source_trace_id == source_trace_id)
            .order_by(ReplayRun.created_at.desc()).all())
```

`main.py` 挂载 `replay_router`。注意 FastAPI 路由顺序：`/replays/{replay_id}` 与 `/replays`（query 版）不冲突。

- [ ] **Step 3: 全量测试确认通过** → 60 passed

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add replay API endpoints"
```

---

### Task 5: 前端回放页与入口

**Files:**
- Create: `frontend/app/replay/[id]/page.tsx`
- Modify: `frontend/lib/api.ts`, `frontend/app/traces/[id]/page.tsx`

**Interfaces:**
- Consumes: `POST /api/replays`、`GET /api/replays?source_trace_id=`、`api.getTrace`、`api.getJudgeModels`（作为可执行模型列表）
- Produces:
  - `lib/api.ts` 追加：`ReplayRun {id, source_trace_id, result_trace_id, status, override_model, override_model_params, override_prompt_text, override_prompt_version_id, divergences, error, created_at, finished_at}`、`Divergence {type, tool?, step, recorded_input?, actual_input?, arguments?}`；`api.createReplay(body)`、`api.getReplays(sourceTraceId)`
  - `/replay/[id]`：源 trace 摘要卡（名称/模型/成本/延迟）+ 覆盖表单（模型下拉=getJudgeModels、temperature 数字输入、system prompt textarea 预填源 entry llm 的 system 消息内容）+「运行回放 ▶」（同步请求，运行中禁用+spinner 文案"回放中，工具调用将使用录制结果 mock…"）→ 完成后结果区：状态徽章、divergence 列表（类型徽章 param_mismatch 橙 / unrecorded_call 红 + 工具名 + 步号 + 录制/实际入参 JSON）、按钮「与源 trace 对比」→ `/compare?a={sourceId}&b={result_trace_id}`、「查看回放 trace」→ `/traces/{result_trace_id}`；失败时显示 error + 若有 partial result_trace_id 也给查看入口；页面底部列出该源的历史回放（getReplays）
  - `/traces/[id]` 头部「加入对比」旁添加「回放 ▶」按钮 → `/replay/{trace.id}`（仅 origin=live 时显示，replay 的 trace 不再回放）
  - system prompt 预填逻辑：`trace.observations` 先序找第一个 type=llm 节点，取其 messages 中第一条 role=system 的 content（字符串化），找不到留空

- [ ] **Step 1: lib/api.ts 追加类型与函数**（照上述接口写；`createReplay` 用已有 `send` helper POST）

- [ ] **Step 2: 实现 /replay/[id] 页**（"use client"；`useParams` 取 id；useEffect 加载 `api.getTrace(id)` 与 `api.getReplays(id)`；表单 state：model/temperature/prompt；提交 `api.createReplay({source_trace_id: id, override_model: model || undefined, override_model_params: temperature !== "" ? {temperature: parseFloat(temperature)} : undefined, override_prompt_text: promptEdited ? prompt : undefined})`——注意仅当用户改动过 prompt 才发送 override（用 `promptEdited` state 标记 onChange），避免把预填原文当覆盖；错误 inline 展示；成功后刷新历史列表）

- [ ] **Step 3: /traces/[id] 加回放按钮**（`trace.origin === "live"` 条件渲染，Link 样式同「加入对比」）

- [ ] **Step 4: 验证** `npm run build && npx vitest run && npm run lint` 全过（路由含 /replay/[id]）

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add replay configuration page with divergence display"
```

---

### Task 6: 收尾（文档 + 全量验证 + 冒烟）

**Files:**
- Modify: `README.md`（Roadmap Phase 3 ✅；新增"重跑回放"章节：动线、mock 机制说明、divergence 类型表、replays API 端点表、anthropic 工具回放限制）、`CLAUDE.md`（Architecture 补 replay_service/providers/routers/replay 与 /replay 页面；Key Design Decisions 补：回放偏离不中断、录制外调用给错误结果继续、MAX_REPLAY_STEPS=15、partial trace 保留、回放走 ingest() 落库、anthropic 工具回放 MVP 不支持）
- Verify: 全量 + 冒烟

- [ ] **Step 1: 文档更新**（字段与端点对照真实代码）

- [ ] **Step 2: 全量验证**：backend 60 passed 无 warning；frontend build + vitest 9 passed + lint

- [ ] **Step 3: 冒烟**（后端 8010 + SQLite）：create_project → 跑 example 上报 → 建假 provider + pricing（model 名任意，如 `fake-model`）→ `POST /api/replays {source_trace_id, override_model: "fake-model"}` → 确认 200、`status=="failed"`、`error` 含 provider 调用失败信息、`GET /api/replays?source_trace_id=` 能列出该 run → 杀进程。（假 key 调不通模型——验证的是失败路径如实报错与 run 持久化；成功路径已由 MockTransport 测试覆盖）

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: update README and CLAUDE.md for replay engine"
```

---

## Phase 4 依赖（本计划产出）

- `replay_service` 单点回放扩展点（`ReplayRun.target_observation_id` 已在 schema）
- divergence 数据 → /compare 对齐视图的偏离标注可在 Phase 4 融合展示
