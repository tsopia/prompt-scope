# Phase 4: 打磨扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 spec §8 Phase 4 的四项能力（prompt 版本管理、多阶段单点回放、Python SDK、批量回放/评测）+ 前三阶段审查累积的高价值打磨项（回放整体时长护栏、judge 缓存可见性）。

**Architecture:** 全部构建在既有实体与服务之上，无 schema 新表（prompts/prompt_versions/ReplayRun.target_observation_id 均已预留）。SDK 为仓库内单文件客户端（`sdk/promptscope/client.py`），封装 ingestion API。

**Tech Stack:** 既有栈

**Spec:** `docs/superpowers/specs/2026-07-04-agent-replay-platform-design.md` §8 Phase 4、§5 MVP 范围（多阶段单点回放）、§6（/prompts 页）

## Global Constraints

- git 提交信息不含任何 AI 署名
- 无新表；若需加列走 `db_migrate.ensure_columns`（可空或带默认）
- 单点回放语义：重跑指定 llm observation——初始消息取该节点录制的 messages（截断规则同入口回放），工具 mock 只消费**该节点子树**的 tool observations；产出完整 replay trace（只含重跑的那一段链路），divergence 语义不变
- 回放整体护栏：`MAX_REPLAY_WALL_SECONDS = 240`，超限 → status=failed + partial trace 落库（复用现有失败路径），divergence 加 `{"type": "wall_clock_exceeded", "step": n}`
- 批量端点串行执行（内部工具，避免并发打爆 provider），单条失败不中断批次
- SDK 仅依赖 httpx；接口风格与 Langfuse 类似（trace 上下文 + span helpers），一次 flush 上报
- 前端不新增 runtime 依赖

---

### Task 1: Prompt 管理 API

**Files:**
- Create: `backend/schemas/prompts.py`, `backend/routers/prompts.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_prompts_api.py`

**Interfaces:**
- `GET /api/prompts?project_id=` → `[{id, name, version_count, latest_version, created_at}]`
- `POST /api/prompts` `{project_id, name, content}` → 创建 prompt + version 1；同项目重名 → 409
- `GET /api/prompts/{prompt_id}` → `{id, name, project_id, versions: [{id, version, content, created_at}]}`（版本升序）；404
- `POST /api/prompts/{prompt_id}/versions` `{content}` → 新版本（version = max+1）
- `GET /api/prompt-versions/{version_id}/traces` → `[TraceSummary 简化版 {id, name, origin, total_cost, created_at}]`——引用该版本的 traces（`Trace.prompt_version_id` 或其 llm observation 的 `prompt_version_id`，两处 OR，去重、时间倒序、上限 100）

- [ ] **Step 1: 写失败测试**

`backend/tests/test_prompts_api.py`：

```python
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
```

- [ ] **Step 2: 实现**

`backend/schemas/prompts.py`：

```python
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PromptCreate(BaseModel):
    project_id: str
    name: str = Field(max_length=255)
    content: str


class VersionCreate(BaseModel):
    content: str


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    version: int
    content: str
    created_at: datetime


class PromptSummary(BaseModel):
    id: str
    name: str
    version_count: int
    latest_version: int
    created_at: datetime


class PromptDetail(BaseModel):
    id: str
    name: str
    project_id: str
    versions: list[VersionOut]


class VersionTraceOut(BaseModel):
    id: str
    name: str
    origin: str
    total_cost: float | None
    created_at: datetime
```

`backend/routers/prompts.py`：

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Observation, Prompt, PromptVersion, Trace
from schemas.prompts import (PromptCreate, PromptDetail, PromptSummary,
                             VersionCreate, VersionOut, VersionTraceOut)

router = APIRouter(tags=["prompts"])


@router.get("/prompts", response_model=list[PromptSummary])
def list_prompts(project_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Prompt)
    if project_id:
        q = q.filter(Prompt.project_id == project_id)
    out = []
    for p in q.order_by(Prompt.created_at.desc()).all():
        versions = p.versions
        out.append(PromptSummary(
            id=p.id, name=p.name, version_count=len(versions),
            latest_version=versions[-1].version if versions else 0,
            created_at=p.created_at))
    return out


@router.post("/prompts", response_model=PromptDetail)
def create_prompt(payload: PromptCreate, db: Session = Depends(get_db)):
    exists = db.query(Prompt).filter(
        Prompt.project_id == payload.project_id,
        Prompt.name == payload.name).first()
    if exists:
        raise HTTPException(status_code=409, detail="prompt name already exists")
    p = Prompt(project_id=payload.project_id, name=payload.name)
    db.add(p)
    db.flush()
    db.add(PromptVersion(prompt_id=p.id, version=1, content=payload.content))
    db.commit()
    return _detail(db, p)


def _detail(db: Session, p: Prompt) -> PromptDetail:
    return PromptDetail(
        id=p.id, name=p.name, project_id=p.project_id,
        versions=[VersionOut.model_validate(v) for v in p.versions])


@router.get("/prompts/{prompt_id}", response_model=PromptDetail)
def get_prompt(prompt_id: str, db: Session = Depends(get_db)):
    p = db.get(Prompt, prompt_id)
    if p is None:
        raise HTTPException(status_code=404, detail="prompt not found")
    return _detail(db, p)


@router.post("/prompts/{prompt_id}/versions", response_model=VersionOut)
def add_version(prompt_id: str, payload: VersionCreate,
                db: Session = Depends(get_db)):
    p = db.get(Prompt, prompt_id)
    if p is None:
        raise HTTPException(status_code=404, detail="prompt not found")
    next_version = (p.versions[-1].version + 1) if p.versions else 1
    v = PromptVersion(prompt_id=p.id, version=next_version,
                      content=payload.content)
    db.add(v)
    db.commit()
    return VersionOut.model_validate(v)


@router.get("/prompt-versions/{version_id}/traces",
            response_model=list[VersionTraceOut])
def version_traces(version_id: str, db: Session = Depends(get_db)):
    direct = db.query(Trace).filter(Trace.prompt_version_id == version_id)
    via_obs = (db.query(Trace).join(Observation,
                                    Observation.trace_id == Trace.id)
               .filter(Observation.prompt_version_id == version_id))
    seen: dict[str, Trace] = {}
    for t in direct.all() + via_obs.all():
        seen[t.id] = t
    rows = sorted(seen.values(), key=lambda t: t.created_at, reverse=True)[:100]
    return [VersionTraceOut(id=t.id, name=t.name, origin=t.origin,
                            total_cost=t.total_cost, created_at=t.created_at)
            for t in rows]
```

`main.py` 挂载 prompts router。

- [ ] **Step 3: 全量测试确认通过** → 65 passed 无 warning

- [ ] **Step 4: Commit** `feat: add prompt management API with version trace lookup`

---

### Task 2: 前端 /prompts 页

**Files:**
- Create: `frontend/app/prompts/page.tsx`
- Modify: `frontend/lib/api.ts`, `frontend/components/TopBar.tsx`（nav 加 Prompts）, `frontend/app/replay/[id]/page.tsx`（prompt 覆盖支持从 prompt 库选版本）

**Interfaces (contract-driven，参照既有页面模式):**
- `lib/api.ts` 追加：`PromptSummary/PromptDetail/PromptVersion/VersionTrace` 类型（与 Task 1 响应一一对应）+ `api.getPrompts(projectId)`, `api.createPrompt(body)`, `api.getPrompt(id)`, `api.addPromptVersion(id, content)`, `api.getVersionTraces(versionId)`
- `/prompts` 页：左列 prompt 列表（名称 + vN 徽章 + 新建表单：名称+内容）；选中后右侧版本历史（每版本卡：v 号、时间、内容 pre 块、「新建版本」textarea 预填当前最新内容、「使用此版本的 traces」展开列表——点击跳 trace 详情）；相邻版本 diff 视图简化实现：选中两个版本时并排两个 pre 块（不引 diff 库）
- `/replay/[id]` 表单的 prompt 区域增加「从 Prompt 库选择」下拉（`api.getPrompts` + `api.getPrompt` 级联：选 prompt → 选版本 → 填充 textarea 并记录 version_id；用户再编辑则退回 override_prompt_text 语义）——发送时：选了版本且未再编辑 → `override_prompt_version_id`；编辑过 → `override_prompt_text`
- TopBar nav：Traces / Prompts / Settings

- [ ] **Step 1: 实现（先读 settings/compare 页对齐模式）**
- [ ] **Step 2: 验证** `npm run build && npx vitest run && npm run lint` 全过（路由含 /prompts）
- [ ] **Step 3: Commit** `feat: add prompt library page with version history`

---

### Task 3: 多阶段单点回放 + 整体时长护栏

**Files:**
- Modify: `backend/services/replay_service.py`, `backend/schemas/replay.py`, `backend/routers/replay.py`
- Test: `backend/tests/test_replay.py`（追加）

**Interfaces:**
- `ReplayRequest` 加 `target_observation_id: str | None = None`；router 透传到 ReplayRun（列已存在）
- `execute_replay`：`run.target_observation_id` 非空时——目标必须是源 trace 的 llm observation（否则 400）；入口 = 该节点；recorded tools 只取 `parent_id == target.id` 的 tool observations；回放 trace 的 metadata 加 `"target_observation_id"`；trace name 后缀 `(replay:step-{seq})`
- 时长护栏：`MAX_REPLAY_WALL_SECONDS = 240`；每轮循环开始检查 `(utcnow() - started_at).total_seconds()`，超限 → divergence `{"type": "wall_clock_exceeded", "step": n}` + 跳出循环走"未产出最终回答"失败路径（partial 落库）
- 前端（本任务只动后端；前端入口在 Task 4 一并做）

- [ ] **Step 1: 追加失败测试**

```python
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
```

（`test_single_point_replay_invalid_target_400` 里 `"ob-tool"` 是 seeded fixture 已有的 tool observation id。）

- [ ] **Step 2: 实现**（要点：`entry = 目标节点 or _find_entry_llm(source)`；目标校验 `db.get(Observation, ...)`、属于 source、type=="llm"；`RecordedTools` 构造入参在单点模式下过滤 `parent_id == entry.id`；循环开头 `if (utcnow() - started_at).total_seconds() > MAX_REPLAY_WALL_SECONDS: divergences.append(...); break`——break 后 final_content 为 None 自然走失败路径，但注意与 for/else 的 max_steps 分支区分：wall-clock break 不应再追加 max_steps divergence（break 跳过 else ✓）；trace name/metadata 调整）

- [ ] **Step 3: 全量测试确认通过** → 69 passed
- [ ] **Step 4: Commit** `feat: add single-point replay and wall-clock guard`

---

### Task 4: 前端单点回放入口 + judge 缓存可见性

**Files:**
- Modify: `frontend/app/replay/[id]/page.tsx`, `frontend/app/traces/[id]/page.tsx`, `frontend/components/JudgePanel.tsx`, `frontend/lib/api.ts`

**Interfaces (contract-driven):**
- `api.createReplay` body 加 `target_observation_id?: string`
- `/traces/[id]`：链路树选中 llm 节点且 trace.origin==="live" 时，节点详情区顶部显示「单点回放此步 ▶」→ `/replay/{traceId}?target={observationId}`
- `/replay/[id]`：读取 `?target=` searchParams（页面需包 Suspense——现在要用 useSearchParams 了）；有 target 时摘要卡显示"单点回放：{节点名}"，prompt 预填从目标节点取，提交带 target_observation_id
- `JudgePanel`：结果卡右上角时间旁加「重新评分」小按钮（`api.evaluate` 带 `force: true` + 仅该 judge_model）→ 完成后刷新；说明文案「相同组合默认返回缓存结果」

- [ ] **Step 1: 实现（读现有代码对齐；注意 useSearchParams + Suspense）**
- [ ] **Step 2: 验证** build/vitest/lint 全过
- [ ] **Step 3: Commit** `feat: add single-point replay entry and judge re-run control`

---

### Task 5: Python SDK

**Files:**
- Create: `sdk/promptscope/__init__.py`, `sdk/promptscope/client.py`, `sdk/README.md`
- Modify: `examples/report_agent_run.py`（改用 SDK 重写，行为不变）
- Test: `backend/tests/test_sdk.py`

**Interfaces:**
- `PromptScopeClient(base_url, api_key)`：
  - `trace(name, input=None, metadata=None)` → `TraceContext`（context manager；`__exit__` 时自动 flush 上报，异常时 status=error）
  - `TraceContext.llm(name, model, messages, *, model_params=None, tool_definitions=None, tool_calls=None, completion=None, input_tokens=None, output_tokens=None, parent=None)` → span id；自动 seq 递增、started/ended 时间戳（调用时刻）
  - `TraceContext.tool(name, tool_input, tool_output=None, error=None, parent=None)` → span id
  - `TraceContext.set_output(output)`
  - 也提供显式 `client.flush(trace_context)`（context manager 外用）
  - 传输：httpx POST `{base_url}/api/ingest`，Bearer key；非 2xx raise `PromptScopeError`（含响应 detail）
- 测试用 `httpx.MockTransport` 注入（`PromptScopeClient(..., transport=...)` 参数）断言 payload 结构合法（用后端 `schemas.ingest.IngestRequest.model_validate` 直接校验 SDK 产物——SDK payload 必须过后端校验）

- [ ] **Step 1: 写失败测试**

`backend/tests/test_sdk.py`：

```python
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sdk"))

from promptscope.client import PromptScopeClient, PromptScopeError  # noqa: E402

from schemas.ingest import IngestRequest  # noqa: E402


def capture_transport(captured: list, status=200):
    def handler(request):
        captured.append(json.loads(request.content))
        if status >= 400:
            return httpx.Response(status, json={"detail": "boom"})
        return httpx.Response(status, json={"trace_id": "x",
                                            "observation_count": 0})
    return httpx.MockTransport(handler)


def test_sdk_payload_passes_backend_validation():
    captured = []
    client = PromptScopeClient("http://x", "ps-key",
                               transport=capture_transport(captured))
    with client.trace("run", input={"q": "hi"}) as t:
        llm_id = t.llm("plan", model="gpt-4o",
                       messages=[{"role": "user", "content": "hi"}],
                       tool_calls=[{"name": "search", "arguments": {}}],
                       input_tokens=10, output_tokens=5)
        t.tool("search", tool_input={"q": "hi"}, tool_output={"r": 1},
               parent=llm_id)
        t.llm("answer", model="gpt-4o",
              messages=[{"role": "user", "content": "hi"}],
              completion="hello", input_tokens=20, output_tokens=8)
        t.set_output({"answer": "hello"})

    assert len(captured) == 1
    payload = IngestRequest.model_validate(captured[0])  # 必须过后端校验
    assert payload.trace.name == "run"
    assert payload.trace.output == {"answer": "hello"}
    assert [o.seq for o in payload.observations] == [0, 1, 2]
    assert payload.observations[1].parent_id == payload.observations[0].id
    assert request_has_bearer(captured)  # 见下——改为在 handler 里断言 header


def test_sdk_marks_error_on_exception():
    captured = []
    client = PromptScopeClient("http://x", "ps-key",
                               transport=capture_transport(captured))
    with pytest.raises(ValueError):
        with client.trace("run") as t:
            t.tool("s", tool_input={}, tool_output={})
            raise ValueError("agent crashed")
    assert captured[0]["trace"]["status"] == "error"


def test_sdk_raises_on_http_error():
    client = PromptScopeClient("http://x", "ps-key",
                               transport=capture_transport([], status=401))
    with pytest.raises(PromptScopeError, match="boom"):
        with client.trace("run"):
            pass
```

（`request_has_bearer` 这行按实现调整：在 handler 里直接 `assert request.headers["authorization"] == "Bearer ps-key"` 更简单——写测试时落实为 handler 内断言，删除该占位行。）

- [ ] **Step 2: 实现 SDK**（单文件 `client.py`：uuid id、seq 计数、ISO 时间戳、trace context manager、flush 幂等（只发一次）、`transport=None` 参数透传 httpx.Client；`sdk/README.md` 写用法示例；`examples/report_agent_run.py` 用 SDK 重写——同样的 weather 数据，行为与原脚本一致）

- [ ] **Step 3: 全量测试确认通过** → 72 passed
- [ ] **Step 4: Commit** `feat: add Python SDK with trace context manager`

---

### Task 6: 批量回放与批量评测

**Files:**
- Modify: `backend/routers/replay.py`, `backend/routers/evaluations.py`, `backend/schemas/replay.py`, `backend/schemas/evaluations.py`
- Test: `backend/tests/test_batch.py`

**Interfaces:**
- `POST /api/replays/batch` `{source_trace_ids: [str]（1-20）, override_model?, override_model_params?, override_prompt_text?, override_prompt_version_id?}` → `{"results": [{source_trace_id, status: "ok"|"error", run?: ReplayRunOut, error?}]}`——逐条串行，单条失败（HTTPException/意外异常）转 error 条目不中断；每条各自建 ReplayRun（复用单条端点的防护逻辑——提取共享函数 `_run_one_replay(db, payload_like) -> ReplayRun`）
- `POST /api/evaluations/batch` `{subject_trace_ids: [str]（1-50）, judge_models: [str], context_mode?, force?}` → `{"results": [{subject_trace_id, judge_model, status, evaluation?, error?}]}`——每 trace × 每 judge 单评（compare_trace_id=None），串行，失败不中断
- 批量端点各限一次最多条数（超限 422 由 Field 约束给出）

- [ ] **Step 1: 写失败测试**（monkeypatch `replay_service.execute_replay` 与 `judge_service.run_judge`——一个成功一个抛 HTTPException，断言 results 混合状态、行数、不中断；再断言超限 422）
- [ ] **Step 2: 实现**（评测复用现有循环模式；回放把单条端点的 create+guard+execute 逻辑提取为共享函数，两个端点共用——避免防护逻辑分叉）
- [ ] **Step 3: 全量测试确认通过** → 76 passed（新增 4 个：批量回放混合、批量评测混合、两个超限）
- [ ] **Step 4: Commit** `feat: add batch replay and batch evaluation endpoints`

---

### Task 7: 收尾（文档 + 全量验证 + 冒烟 + 终审）

**Files:**
- Modify: `README.md`（Roadmap Phase 4 ✅；Prompt 库章节、单点回放说明、SDK 快速上手（从 sdk/README.md 摘要）、批量端点表）、`CLAUDE.md`（Architecture 补 prompts 路由、sdk/、批量端点；Key Design Decisions 补单点回放子树语义、wall-clock 护栏、SDK payload 必须过 IngestRequest 校验）

- [ ] **Step 1: 文档更新**（对照真实代码）
- [ ] **Step 2: 全量验证**：backend 76 passed 无 warning；frontend build + vitest 9 + lint
- [ ] **Step 3: 冒烟**：后端 8010 → create_project → 用 **SDK 重写后的 example** 上报（验证 SDK 真实链路）→ `POST /api/prompts` 建 prompt → `GET /api/prompts` 列表 → 批量评测（假 provider，断言 results 全 error 且 200）→ 杀进程
- [ ] **Step 4: Commit** `docs: update README and CLAUDE.md for phase 4 capabilities`

之后：整分支终审（fable）→ 修复 → 合并 master。
