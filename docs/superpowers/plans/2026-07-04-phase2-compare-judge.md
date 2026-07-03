# Phase 2: 对比与评分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成对比工作台（双链路对齐 + 差异高亮 + 成本汇总）、多模型 LLM Judge 评分、model provider/定价配置页。

**Architecture:** 后端新增 LLM provider 客户端（httpx，OpenAI 兼容 + Anthropic）、judge 服务（评分缓存于 evaluations 表、失败如实报错不做 mock 兜底）、providers/pricing CRUD。前端新增 /compare（链路 LCS 对齐视图 + judge 面板）与 /settings（provider/定价配置）。链路步骤对齐是纯函数，放前端 `lib/align.ts` 并用 vitest 测试。

**Tech Stack:** 既有栈不变；测试用 httpx.MockTransport（不新增依赖）

**Spec:** `docs/superpowers/specs/2026-07-04-agent-replay-platform-design.md` §4（对比工作台）、§3（evaluations/model_providers）、§7（judge 失败不做 mock 兜底）、§8 Phase 2

## Global Constraints

- git 提交信息不含任何 AI 署名
- Judge 失败（provider 报错/输出无法解析）→ 如实返回错误，绝不返回假结果；多 judge 并行请求中单个失败不影响其他 judge 的结果返回
- Judge 结果缓存：相同 (subject, compare, judge_model, context_mode) 直接返回已有 evaluation，`force=true` 才重跑
- Provider api_key 只写不读：任何 API 响应不得返回明文 api_key（用 `api_key_set: bool` 表示）
- 可选 judge 模型 = `model_pricings` 中配置了 `provider_id` 的行
- 前端不新增 runtime 依赖
- 金额美元；judge 调用本身的成本用 `compute_cost` 按 pricing 计算并存入 evaluation.cost
- schema 演进：新增列通过 `db_migrate.ensure_columns()`（additive ALTER），不重建表

---

### Task 1: 后端地基（pytest 净化 + additive 迁移 + Evaluation.score_b）

**Files:**
- Create: `backend/pytest.ini`, `backend/db_migrate.py`
- Modify: `backend/models/entities.py`（Evaluation 加 score_b）, `backend/main.py`（lifespan 调 ensure_columns）
- Test: `backend/tests/test_migrate.py`

**Interfaces:**
- Produces: `db_migrate.ensure_columns(bind=None)`——对比 ORM 元数据与实际库表，为已存在表补齐缺失列；`Evaluation.score_b: float | None`（pair 评分时 B 侧分数；score 字段承载 A 侧/单侧分数）

- [ ] **Step 1: 写 pytest.ini（过滤第三方弃用告警）**

`backend/pytest.ini`：

```ini
[pytest]
filterwarnings =
    ignore::DeprecationWarning:starlette.*
    ignore:Using `httpx` with `starlette.testclient` is deprecated.*
```

运行 `cd backend && .venv/bin/python -m pytest tests/ -q`，Expected: `21 passed`（无 warning 行）。若 warning 类别名不匹配导致仍有输出，按实际 warning 的 category/message 调整过滤规则直到输出干净。

- [ ] **Step 2: 写失败测试 test_migrate.py**

```python
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from db import Base
from db_migrate import ensure_columns


def test_ensure_columns_adds_missing_column():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    # 手工建一个缺 score_b 列的 evaluations 表（模拟旧库）
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE evaluations (id VARCHAR(32) PRIMARY KEY, "
            "project_id VARCHAR(32), subject_trace_id VARCHAR(64), "
            "compare_trace_id VARCHAR(64), judge_model VARCHAR(128), "
            "context_mode VARCHAR(16), score FLOAT, verdict VARCHAR(32), "
            "reasoning TEXT, cost FLOAT, created_at DATETIME)"))
    ensure_columns(bind=engine)
    cols = {c["name"] for c in inspect(engine).get_columns("evaluations")}
    assert "score_b" in cols


def test_ensure_columns_noop_on_current_schema():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    ensure_columns(bind=engine)  # 不应抛错
    cols = {c["name"] for c in inspect(engine).get_columns("evaluations")}
    assert "score_b" in cols
```

运行确认失败：`.venv/bin/python -m pytest tests/test_migrate.py -v` → FAIL（No module named 'db_migrate' / score_b 不存在）

- [ ] **Step 3: 实现**

`backend/models/entities.py` 的 `Evaluation` 类中，在 `score` 字段之后加：

```python
    score_b: Mapped[float | None] = mapped_column(Float, nullable=True)
```

`backend/db_migrate.py`：

```python
"""Additive schema evolution: create_all 只建缺失表，不加缺失列；此模块补齐。"""
from sqlalchemy import inspect, text

from db import Base, engine


def ensure_columns(bind=None) -> None:
    bind = bind or engine
    insp = inspect(bind)
    with bind.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                col_type = col.type.compile(bind.dialect)
                conn.execute(text(
                    f'ALTER TABLE {table.name} ADD COLUMN {col.name} {col_type}'))
```

`backend/main.py` lifespan 中 `Base.metadata.create_all(bind=engine)` 之后加：

```python
    from db_migrate import ensure_columns
    ensure_columns()
```

- [ ] **Step 4: 全量测试确认通过**

`cd backend && .venv/bin/python -m pytest tests/ -q` → Expected: `23 passed`，输出无 warning

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add additive column migration and evaluation score_b"
```

---

### Task 2: LLM Provider 客户端

**Files:**
- Create: `backend/services/llm_client.py`
- Test: `backend/tests/test_llm_client.py`

**Interfaces:**
- Produces:
  - `llm_client.LLMClientError(message, status_code=None)`（Exception）
  - `llm_client.chat_completion(provider: ModelProvider, model: str, messages: list[dict], model_params: dict | None = None, client: httpx.Client | None = None) -> dict`——返回 `{"content": str, "input_tokens": int | None, "output_tokens": int | None}`；provider_type `openai`（兼容协议 POST {base_url}/chat/completions）或 `anthropic`（POST {base_url}/v1/messages）；HTTP 错误/网络错误 → LLMClientError
  - 约定：调用方只传 user role 消息（judge/回放构造单条 user prompt），规避 anthropic system 参数差异；Phase 3 回放需要 system 时再扩展

- [ ] **Step 1: 写失败测试**

`backend/tests/test_llm_client.py`：

```python
import httpx
import pytest

from models.entities import ModelProvider
from services.llm_client import LLMClientError, chat_completion


def make_client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def openai_provider():
    return ModelProvider(name="oai", base_url="https://api.test.com/v1",
                         api_key="sk-test", provider_type="openai")


def test_openai_compatible_success():
    def handler(request):
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer sk-test"
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "hello"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5}})

    out = chat_completion(openai_provider(), "gpt-4o",
                          [{"role": "user", "content": "hi"}],
                          client=make_client(handler))
    assert out == {"content": "hello", "input_tokens": 10, "output_tokens": 5}


def test_anthropic_success():
    provider = ModelProvider(name="ant", base_url="https://api.anthropic.test",
                             api_key="ak-test", provider_type="anthropic")

    def handler(request):
        assert request.url.path == "/v1/messages"
        assert request.headers["x-api-key"] == "ak-test"
        return httpx.Response(200, json={
            "content": [{"type": "text", "text": "hey"}],
            "usage": {"input_tokens": 8, "output_tokens": 3}})

    out = chat_completion(provider, "claude-x",
                          [{"role": "user", "content": "hi"}],
                          client=make_client(handler))
    assert out == {"content": "hey", "input_tokens": 8, "output_tokens": 3}


def test_model_params_passed_through():
    seen = {}

    def handler(request):
        import json
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "x"}}], "usage": {}})

    chat_completion(openai_provider(), "gpt-4o", [{"role": "user", "content": "hi"}],
                    model_params={"temperature": 0.3}, client=make_client(handler))
    assert seen["temperature"] == 0.3
    assert seen["model"] == "gpt-4o"


def test_http_error_raises_llm_client_error():
    def handler(request):
        return httpx.Response(429, json={"error": "rate limited"})

    with pytest.raises(LLMClientError) as exc:
        chat_completion(openai_provider(), "gpt-4o",
                        [{"role": "user", "content": "hi"}],
                        client=make_client(handler))
    assert exc.value.status_code == 429


def test_network_error_raises_llm_client_error():
    def handler(request):
        raise httpx.ConnectError("boom")

    with pytest.raises(LLMClientError):
        chat_completion(openai_provider(), "gpt-4o",
                        [{"role": "user", "content": "hi"}],
                        client=make_client(handler))
```

运行确认失败 → FAIL（No module named 'services.llm_client'）

- [ ] **Step 2: 实现 llm_client.py**

```python
import httpx

from models.entities import ModelProvider

ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_TIMEOUT = 120.0
DEFAULT_MAX_TOKENS = 4096


class LLMClientError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _openai_call(client: httpx.Client, provider: ModelProvider, model: str,
                 messages: list, model_params: dict | None) -> dict:
    resp = client.post(
        f"{provider.base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {provider.api_key}"},
        json={"model": model, "messages": messages, **(model_params or {})},
        timeout=DEFAULT_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    usage = data.get("usage") or {}
    return {
        "content": data["choices"][0]["message"]["content"],
        "input_tokens": usage.get("prompt_tokens"),
        "output_tokens": usage.get("completion_tokens"),
    }


def _anthropic_call(client: httpx.Client, provider: ModelProvider, model: str,
                    messages: list, model_params: dict | None) -> dict:
    params = dict(model_params or {})
    max_tokens = params.pop("max_tokens", DEFAULT_MAX_TOKENS)
    resp = client.post(
        f"{provider.base_url.rstrip('/')}/v1/messages",
        headers={"x-api-key": provider.api_key,
                 "anthropic-version": ANTHROPIC_VERSION},
        json={"model": model, "max_tokens": max_tokens,
              "messages": messages, **params},
        timeout=DEFAULT_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    usage = data.get("usage") or {}
    return {
        "content": "".join(b["text"] for b in data["content"]
                           if b.get("type") == "text"),
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
    }


def chat_completion(provider: ModelProvider, model: str, messages: list,
                    model_params: dict | None = None,
                    client: httpx.Client | None = None) -> dict:
    own_client = client is None
    client = client or httpx.Client()
    try:
        if provider.provider_type == "anthropic":
            return _anthropic_call(client, provider, model, messages, model_params)
        return _openai_call(client, provider, model, messages, model_params)
    except httpx.HTTPStatusError as e:
        raise LLMClientError(
            f"provider returned {e.response.status_code}: {e.response.text[:500]}",
            status_code=e.response.status_code) from e
    except httpx.HTTPError as e:
        raise LLMClientError(f"provider request failed: {e}") from e
    finally:
        if own_client:
            client.close()
```

- [ ] **Step 3: 测试确认通过**

`.venv/bin/python -m pytest tests/test_llm_client.py -v` → 5 passed；全量 → 28 passed

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add LLM provider client for openai-compatible and anthropic APIs"
```

---

### Task 3: Providers / Pricing 配置 API

**Files:**
- Create: `backend/schemas/config.py`, `backend/routers/config.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_config_api.py`

**Interfaces:**
- Consumes: `models.entities.ModelProvider/ModelPricing`
- Produces（前端 /settings 消费）:
  - `GET /api/providers` → `[{id, name, base_url, provider_type, api_key_set, created_at}]`（绝不返回明文 key）
  - `POST /api/providers` body `{name, base_url, api_key, provider_type}` → ProviderOut；重名 → 409
  - `PUT /api/providers/{id}` body 同上但 api_key 可选（省略则保留旧值）→ ProviderOut；404
  - `DELETE /api/providers/{id}` → `{"deleted": true}`；被 pricing 引用时把这些 pricing 的 provider_id 置空
  - `GET /api/pricing` → `[{id, model, input_price_per_1k, output_price_per_1k, provider_id}]`
  - `POST /api/pricing` body `{model, input_price_per_1k, output_price_per_1k, provider_id?}` → PricingOut；model 重复 → 409
  - `PUT /api/pricing/{id}` / `DELETE /api/pricing/{id}`
  - `GET /api/judge-models` → `[{model, provider_name}]`（= 配置了 provider_id 的 pricing 行，judge 面板的可选列表）

- [ ] **Step 1: 写失败测试**

`backend/tests/test_config_api.py`：

```python
import pytest
from fastapi.testclient import TestClient

from db import get_db


@pytest.fixture()
def client(db_session):
    from main import app

    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_provider_crud_and_key_masking(client):
    resp = client.post("/api/providers", json={
        "name": "openai", "base_url": "https://api.openai.com/v1",
        "api_key": "sk-secret", "provider_type": "openai"})
    assert resp.status_code == 200
    body = resp.json()
    pid = body["id"]
    assert body["api_key_set"] is True
    assert "sk-secret" not in resp.text

    assert client.post("/api/providers", json={
        "name": "openai", "base_url": "x", "api_key": "y",
        "provider_type": "openai"}).status_code == 409

    resp = client.put(f"/api/providers/{pid}", json={
        "name": "openai-2", "base_url": "https://api.openai.com/v1",
        "provider_type": "openai"})
    assert resp.json()["name"] == "openai-2"
    assert resp.json()["api_key_set"] is True  # key 保留

    assert client.get("/api/providers").json()[0]["name"] == "openai-2"
    assert client.delete(f"/api/providers/{pid}").json() == {"deleted": True}
    assert client.get("/api/providers").json() == []


def test_pricing_crud_and_judge_models(client):
    pid = client.post("/api/providers", json={
        "name": "openai", "base_url": "https://api.openai.com/v1",
        "api_key": "sk-x", "provider_type": "openai"}).json()["id"]

    resp = client.post("/api/pricing", json={
        "model": "gpt-4o", "input_price_per_1k": 0.005,
        "output_price_per_1k": 0.015, "provider_id": pid})
    assert resp.status_code == 200
    price_id = resp.json()["id"]

    assert client.post("/api/pricing", json={
        "model": "gpt-4o", "input_price_per_1k": 1,
        "output_price_per_1k": 1}).status_code == 409

    client.post("/api/pricing", json={
        "model": "no-provider-model", "input_price_per_1k": 0.001,
        "output_price_per_1k": 0.002})

    judge_models = client.get("/api/judge-models").json()
    assert judge_models == [{"model": "gpt-4o", "provider_name": "openai"}]

    resp = client.put(f"/api/pricing/{price_id}", json={
        "model": "gpt-4o", "input_price_per_1k": 0.006,
        "output_price_per_1k": 0.015, "provider_id": pid})
    assert resp.json()["input_price_per_1k"] == 0.006

    client.delete(f"/api/pricing/{price_id}")
    assert client.get("/api/judge-models").json() == []


def test_provider_delete_clears_pricing_reference(client):
    pid = client.post("/api/providers", json={
        "name": "p", "base_url": "u", "api_key": "k",
        "provider_type": "openai"}).json()["id"]
    client.post("/api/pricing", json={
        "model": "m1", "input_price_per_1k": 1, "output_price_per_1k": 1,
        "provider_id": pid})
    client.delete(f"/api/providers/{pid}")
    assert client.get("/api/pricing").json()[0]["provider_id"] is None
```

运行确认失败 → FAIL（404）

- [ ] **Step 2: 实现 schemas/config.py**

```python
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ProviderIn(BaseModel):
    name: str = Field(max_length=128)
    base_url: str = Field(max_length=512)
    api_key: str | None = Field(default=None, max_length=512)
    provider_type: Literal["openai", "anthropic"] = "openai"


class ProviderOut(BaseModel):
    id: str
    name: str
    base_url: str
    provider_type: str
    api_key_set: bool
    created_at: datetime


class PricingIn(BaseModel):
    model: str = Field(max_length=128)
    input_price_per_1k: float = Field(ge=0)
    output_price_per_1k: float = Field(ge=0)
    provider_id: str | None = None


class PricingOut(BaseModel):
    id: str
    model: str
    input_price_per_1k: float
    output_price_per_1k: float
    provider_id: str | None


class JudgeModelOut(BaseModel):
    model: str
    provider_name: str
```

- [ ] **Step 3: 实现 routers/config.py**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ModelPricing, ModelProvider
from schemas.config import JudgeModelOut, PricingIn, PricingOut, ProviderIn, ProviderOut

router = APIRouter(tags=["config"])


def _provider_out(p: ModelProvider) -> ProviderOut:
    return ProviderOut(id=p.id, name=p.name, base_url=p.base_url,
                       provider_type=p.provider_type,
                       api_key_set=bool(p.api_key), created_at=p.created_at)


def _pricing_out(r: ModelPricing) -> PricingOut:
    return PricingOut(id=r.id, model=r.model,
                      input_price_per_1k=r.input_price_per_1k,
                      output_price_per_1k=r.output_price_per_1k,
                      provider_id=r.provider_id)


@router.get("/providers", response_model=list[ProviderOut])
def list_providers(db: Session = Depends(get_db)):
    return [_provider_out(p) for p in
            db.query(ModelProvider).order_by(ModelProvider.created_at).all()]


@router.post("/providers", response_model=ProviderOut)
def create_provider(payload: ProviderIn, db: Session = Depends(get_db)):
    if db.query(ModelProvider).filter(ModelProvider.name == payload.name).first():
        raise HTTPException(status_code=409, detail="provider name already exists")
    p = ModelProvider(name=payload.name, base_url=payload.base_url,
                      api_key=payload.api_key or "",
                      provider_type=payload.provider_type)
    db.add(p)
    db.commit()
    return _provider_out(p)


@router.put("/providers/{provider_id}", response_model=ProviderOut)
def update_provider(provider_id: str, payload: ProviderIn,
                    db: Session = Depends(get_db)):
    p = db.get(ModelProvider, provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail="provider not found")
    p.name = payload.name
    p.base_url = payload.base_url
    p.provider_type = payload.provider_type
    if payload.api_key:
        p.api_key = payload.api_key
    db.commit()
    return _provider_out(p)


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: str, db: Session = Depends(get_db)):
    p = db.get(ModelProvider, provider_id)
    if p is None:
        raise HTTPException(status_code=404, detail="provider not found")
    for pricing in db.query(ModelPricing).filter(
            ModelPricing.provider_id == provider_id).all():
        pricing.provider_id = None
    db.delete(p)
    db.commit()
    return {"deleted": True}


@router.get("/pricing", response_model=list[PricingOut])
def list_pricing(db: Session = Depends(get_db)):
    return [_pricing_out(r) for r in
            db.query(ModelPricing).order_by(ModelPricing.model).all()]


@router.post("/pricing", response_model=PricingOut)
def create_pricing(payload: PricingIn, db: Session = Depends(get_db)):
    if db.query(ModelPricing).filter(ModelPricing.model == payload.model).first():
        raise HTTPException(status_code=409, detail="model pricing already exists")
    r = ModelPricing(model=payload.model,
                     input_price_per_1k=payload.input_price_per_1k,
                     output_price_per_1k=payload.output_price_per_1k,
                     provider_id=payload.provider_id)
    db.add(r)
    db.commit()
    return _pricing_out(r)


@router.put("/pricing/{pricing_id}", response_model=PricingOut)
def update_pricing(pricing_id: str, payload: PricingIn,
                   db: Session = Depends(get_db)):
    r = db.get(ModelPricing, pricing_id)
    if r is None:
        raise HTTPException(status_code=404, detail="pricing not found")
    r.model = payload.model
    r.input_price_per_1k = payload.input_price_per_1k
    r.output_price_per_1k = payload.output_price_per_1k
    r.provider_id = payload.provider_id
    db.commit()
    return _pricing_out(r)


@router.delete("/pricing/{pricing_id}")
def delete_pricing(pricing_id: str, db: Session = Depends(get_db)):
    r = db.get(ModelPricing, pricing_id)
    if r is None:
        raise HTTPException(status_code=404, detail="pricing not found")
    db.delete(r)
    db.commit()
    return {"deleted": True}


@router.get("/judge-models", response_model=list[JudgeModelOut])
def list_judge_models(db: Session = Depends(get_db)):
    rows = (db.query(ModelPricing, ModelProvider)
            .join(ModelProvider, ModelPricing.provider_id == ModelProvider.id)
            .order_by(ModelPricing.model).all())
    return [JudgeModelOut(model=pricing.model, provider_name=provider.name)
            for pricing, provider in rows]
```

`backend/main.py` 追加挂载：

```python
from routers import config as config_router

app.include_router(config_router.router, prefix="/api")
```

- [ ] **Step 4: 测试确认通过**

`.venv/bin/python -m pytest tests/ -q` → 31 passed

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add provider and pricing config API with judge model listing"
```

---

### Task 4: Judge 服务与 Evaluations API

**Files:**
- Create: `backend/services/judge_service.py`, `backend/schemas/evaluations.py`, `backend/routers/evaluations.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_judge.py`

**Interfaces:**
- Consumes: `llm_client.chat_completion/LLMClientError`, `ingest_service.compute_cost`, `models.entities.Trace/Evaluation/ModelPricing/ModelProvider`
- Produces:
  - `judge_service.run_judge(db, subject_trace_id, judge_model, compare_trace_id=None, context_mode="output_only", force=False, client=None) -> Evaluation`——缓存命中直接返回；provider 未配置 → HTTPException 400；trace 不存在 → 404；LLM 调用失败 → 502；输出解析失败 → 502
  - `POST /api/evaluations` body `{subject_trace_id, compare_trace_id?, judge_models: [str]（≥1）, context_mode?, force?}` → `{"results": [{judge_model, status: "ok"|"error", evaluation?: EvaluationOut, error?: str}]}`——逐个 judge 执行，单个失败不影响其他
  - `GET /api/evaluations?subject_trace_id=&compare_trace_id=` → `[EvaluationOut]`
  - `EvaluationOut = {id, subject_trace_id, compare_trace_id, judge_model, context_mode, score, score_b, verdict, reasoning, cost, created_at}`
  - Judge prompt 输出契约：单 trace `{"score": 0-10, "verdict": "pass"|"fail", "reasoning": str}`；pair `{"score_a", "score_b", "verdict": "replaceable"|"not_replaceable", "reasoning"}`（score_a 存入 score，score_b 存入 score_b）

- [ ] **Step 1: 写失败测试**

`backend/tests/test_judge.py`：

```python
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from db import get_db
from models.entities import Evaluation, ModelPricing, ModelProvider, Project, Trace
import services.judge_service as judge_service


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
    provider = ModelProvider(name="oai", base_url="https://api.test.com/v1",
                             api_key="sk-x", provider_type="openai")
    db_session.add(provider)
    db_session.flush()
    db_session.add(ModelPricing(model="judge-model", input_price_per_1k=0.001,
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
```

注意：`routers/evaluations.py` 必须通过 `judge_service.run_judge(...)` 模块属性调用（而非 `from ... import run_judge`），否则 monkeypatch 不生效——这是实现约束。

运行确认失败 → FAIL（模块不存在）

- [ ] **Step 2: 实现 judge_service.py**

```python
import json

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.entities import Evaluation, ModelPricing, ModelProvider, Trace
from services.ingest_service import compute_cost
from services.llm_client import LLMClientError, chat_completion

MAX_FIELD_CHARS = 4000
MAX_STEP_CHARS = 200

PAIR_PROMPT = """你是严格的 LLM 输出质量评审。任务输入与两个候选（A 为基准，B 为候选替代）的输出如下。

【任务输入】
{input}

【A 的输出】(模型: {model_a})
{output_a}

【B 的输出】(模型: {model_b})
{output_b}
{trace_context}
请评估 B 能否替代 A：分别打分（0-10，质量维度：正确性、完整性、指令遵循），并给出结论。
只输出 JSON，不要任何其他文字：
{{"score_a": <number>, "score_b": <number>, "verdict": "replaceable" 或 "not_replaceable", "reasoning": "<中文理由>"}}"""

SINGLE_PROMPT = """你是严格的 LLM 输出质量评审。任务输入与输出如下。

【任务输入】
{input}

【输出】(模型: {model})
{output}
{trace_context}
请打分（0-10）并判断是否合格。只输出 JSON，不要任何其他文字：
{{"score": <number>, "verdict": "pass" 或 "fail", "reasoning": "<中文理由>"}}"""


def _dump(value) -> str:
    text = value if isinstance(value, str) else json.dumps(
        value, ensure_ascii=False, default=str)
    return text[:MAX_FIELD_CHARS]


def _trace_models(trace: Trace) -> str:
    models = sorted({o.model for o in trace.observations
                     if o.type == "llm" and o.model})
    return ", ".join(models) or "unknown"


def _trace_context(trace: Trace, other: Trace | None) -> str:
    lines = ["", "【A 的调用链】" if other is not None else "【调用链】"]
    for ob in trace.observations:
        detail = ""
        if ob.type == "tool":
            detail = (f" 入参={_dump(ob.tool_input)[:MAX_STEP_CHARS]}"
                      f" 结果={_dump(ob.tool_output)[:MAX_STEP_CHARS]}")
        lines.append(f"{ob.seq}. [{ob.type}] {ob.name}{detail}")
    if other is not None:
        lines.append("【B 的调用链】")
        for ob in other.observations:
            detail = ""
            if ob.type == "tool":
                detail = (f" 入参={_dump(ob.tool_input)[:MAX_STEP_CHARS]}"
                          f" 结果={_dump(ob.tool_output)[:MAX_STEP_CHARS]}")
            lines.append(f"{ob.seq}. [{ob.type}] {ob.name}{detail}")
    lines.append("")
    return "\n".join(lines)


def _extract_json(content: str) -> dict:
    start, end = content.find("{"), content.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in judge output")
    return json.loads(content[start:end + 1])


def _resolve_provider(db: Session, judge_model: str) -> ModelProvider:
    pricing = db.query(ModelPricing).filter(
        ModelPricing.model == judge_model).first()
    if pricing is None or pricing.provider_id is None:
        raise HTTPException(status_code=400,
                            detail=f"judge model 未配置 provider: {judge_model}")
    provider = db.get(ModelProvider, pricing.provider_id)
    if provider is None:
        raise HTTPException(status_code=400,
                            detail=f"judge model 的 provider 不存在: {judge_model}")
    return provider


def run_judge(db: Session, subject_trace_id: str, judge_model: str,
              compare_trace_id: str | None = None,
              context_mode: str = "output_only", force: bool = False,
              client=None) -> Evaluation:
    subject = db.get(Trace, subject_trace_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="subject trace not found")
    compare = None
    if compare_trace_id is not None:
        compare = db.get(Trace, compare_trace_id)
        if compare is None:
            raise HTTPException(status_code=404, detail="compare trace not found")

    if not force:
        cached = db.query(Evaluation).filter(
            Evaluation.subject_trace_id == subject_trace_id,
            Evaluation.compare_trace_id == compare_trace_id,
            Evaluation.judge_model == judge_model,
            Evaluation.context_mode == context_mode,
        ).first()
        if cached is not None:
            return cached

    provider = _resolve_provider(db, judge_model)
    trace_context = (_trace_context(subject, compare)
                     if context_mode == "with_trace" else "")
    if compare is not None:
        prompt = PAIR_PROMPT.format(
            input=_dump(subject.input), model_a=_trace_models(subject),
            output_a=_dump(subject.output), model_b=_trace_models(compare),
            output_b=_dump(compare.output), trace_context=trace_context)
    else:
        prompt = SINGLE_PROMPT.format(
            input=_dump(subject.input), model=_trace_models(subject),
            output=_dump(subject.output), trace_context=trace_context)

    try:
        result = chat_completion(provider, judge_model,
                                 [{"role": "user", "content": prompt}],
                                 client=client)
    except LLMClientError as e:
        raise HTTPException(status_code=502,
                            detail=f"judge 调用失败: {e}") from e

    try:
        parsed = _extract_json(result["content"])
        verdict = str(parsed["verdict"])
        if compare is not None:
            score, score_b = float(parsed["score_a"]), float(parsed["score_b"])
        else:
            score, score_b = float(parsed["score"]), None
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
        raise HTTPException(
            status_code=502,
            detail=f"judge 输出无法解析: {result['content'][:300]}") from e

    evaluation = Evaluation(
        project_id=subject.project_id, subject_trace_id=subject_trace_id,
        compare_trace_id=compare_trace_id, judge_model=judge_model,
        context_mode=context_mode, score=score, score_b=score_b,
        verdict=verdict, reasoning=str(parsed.get("reasoning", "")),
        cost=compute_cost(db, judge_model, result["input_tokens"],
                          result["output_tokens"]))
    db.add(evaluation)
    db.commit()
    return evaluation
```

- [ ] **Step 3: 实现 schemas/evaluations.py 与 routers/evaluations.py**

`backend/schemas/evaluations.py`：

```python
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class EvaluateRequest(BaseModel):
    subject_trace_id: str
    compare_trace_id: str | None = None
    judge_models: list[str] = Field(min_length=1)
    context_mode: Literal["output_only", "with_trace"] = "output_only"
    force: bool = False


class EvaluationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    subject_trace_id: str
    compare_trace_id: str | None
    judge_model: str
    context_mode: str
    score: float | None
    score_b: float | None
    verdict: str | None
    reasoning: str | None
    cost: float | None
    created_at: datetime


class JudgeRunResult(BaseModel):
    judge_model: str
    status: Literal["ok", "error"]
    evaluation: EvaluationOut | None = None
    error: str | None = None


class EvaluateResponse(BaseModel):
    results: list[JudgeRunResult]
```

`backend/routers/evaluations.py`（注意：通过模块属性调用 run_judge，保证可 monkeypatch）：

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Evaluation
from schemas.evaluations import (EvaluateRequest, EvaluateResponse,
                                 EvaluationOut, JudgeRunResult)
import services.judge_service as judge_service

router = APIRouter(tags=["evaluations"])


@router.post("/evaluations", response_model=EvaluateResponse)
def evaluate(payload: EvaluateRequest, db: Session = Depends(get_db)):
    results = []
    for judge_model in payload.judge_models:
        try:
            ev = judge_service.run_judge(
                db, payload.subject_trace_id, judge_model,
                compare_trace_id=payload.compare_trace_id,
                context_mode=payload.context_mode, force=payload.force)
            results.append(JudgeRunResult(
                judge_model=judge_model, status="ok",
                evaluation=EvaluationOut.model_validate(ev)))
        except HTTPException as e:
            results.append(JudgeRunResult(
                judge_model=judge_model, status="error", error=str(e.detail)))
    return EvaluateResponse(results=results)


@router.get("/evaluations", response_model=list[EvaluationOut])
def list_evaluations(subject_trace_id: str,
                     compare_trace_id: str | None = None,
                     db: Session = Depends(get_db)):
    q = db.query(Evaluation).filter(
        Evaluation.subject_trace_id == subject_trace_id,
        Evaluation.compare_trace_id == compare_trace_id)
    return q.order_by(Evaluation.created_at.desc()).all()
```

`backend/main.py` 追加挂载：

```python
from routers import evaluations as evaluations_router

app.include_router(evaluations_router.router, prefix="/api")
```

- [ ] **Step 4: 测试确认通过**

`.venv/bin/python -m pytest tests/ -q` → 37 passed，输出干净

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add multi-model LLM judge with cached evaluations API"
```

---

### Task 5: 前端 /settings 配置页

**Files:**
- Modify: `frontend/lib/api.ts`（追加 config 类型与函数）, `frontend/components/TopBar.tsx`（导航加 Settings 链接）
- Create: `frontend/app/settings/page.tsx`

**Interfaces:**
- Consumes: Task 3 的全部 config 端点
- Produces: `lib/api.ts` 追加——类型 `Provider {id,name,base_url,provider_type,api_key_set,created_at}`、`Pricing {id,model,input_price_per_1k,output_price_per_1k,provider_id}`、`JudgeModel {model,provider_name}`；函数 `api.getProviders()`, `api.createProvider(body)`, `api.deleteProvider(id)`, `api.getPricing()`, `api.createPricing(body)`, `api.deletePricing(id)`, `api.getJudgeModels()`；通用 `post/del` helper（非 2xx 时抛出带后端 detail 的 Error）

- [ ] **Step 1: 扩展 lib/api.ts**

在现有 `get<T>` 旁追加（保持现有代码不动）：

```typescript
async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    let detail = `${resp.status}`;
    try {
      const data = await resp.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch { /* keep status */ }
    throw new Error(detail);
  }
  return resp.json();
}

export interface Provider {
  id: string;
  name: string;
  base_url: string;
  provider_type: "openai" | "anthropic";
  api_key_set: boolean;
  created_at: string;
}

export interface Pricing {
  id: string;
  model: string;
  input_price_per_1k: number;
  output_price_per_1k: number;
  provider_id: string | null;
}

export interface JudgeModel {
  model: string;
  provider_name: string;
}
```

并在 `export const api = {...}` 中追加：

```typescript
  getProviders: () => get<Provider[]>("/api/providers"),
  createProvider: (body: { name: string; base_url: string; api_key: string; provider_type: string }) =>
    send<Provider>("POST", "/api/providers", body),
  deleteProvider: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/providers/${id}`),
  getPricing: () => get<Pricing[]>("/api/pricing"),
  createPricing: (body: { model: string; input_price_per_1k: number; output_price_per_1k: number; provider_id?: string | null }) =>
    send<Pricing>("POST", "/api/pricing", body),
  deletePricing: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/pricing/${id}`),
  getJudgeModels: () => get<JudgeModel[]>("/api/judge-models"),
```

- [ ] **Step 2: 实现 /settings 页**

`frontend/app/settings/page.tsx`：

```tsx
"use client";
import { useEffect, useState } from "react";
import { api, Pricing, Provider } from "@/lib/api";

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg border border-[#E5E7EB] p-4 mb-6">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {children}
    </section>
  );
}

const inputCls = "text-sm border border-[#E5E7EB] rounded-md px-2 py-1.5";

export default function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pForm, setPForm] = useState({ name: "", base_url: "", api_key: "", provider_type: "openai" });
  const [prForm, setPrForm] = useState({ model: "", input: "", output: "", provider_id: "" });

  const reload = () => {
    api.getProviders().then(setProviders).catch((e) => setError(String(e)));
    api.getPricing().then(setPricing).catch((e) => setError(String(e)));
  };
  useEffect(reload, []);

  const addProvider = async () => {
    setError(null);
    try {
      await api.createProvider(pForm);
      setPForm({ name: "", base_url: "", api_key: "", provider_type: "openai" });
      reload();
    } catch (e) { setError(String(e)); }
  };

  const addPricing = async () => {
    setError(null);
    try {
      await api.createPricing({
        model: prForm.model,
        input_price_per_1k: parseFloat(prForm.input),
        output_price_per_1k: parseFloat(prForm.output),
        provider_id: prForm.provider_id || null,
      });
      setPrForm({ model: "", input: "", output: "", provider_id: "" });
      reload();
    } catch (e) { setError(String(e)); }
  };

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h2 className="text-base font-semibold mb-4">设置</h2>
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-4">{error}</div>}

      <SectionCard title="模型 Provider（回放与 Judge 调用凭证）">
        <table className="w-full text-sm mb-3">
          <thead><tr className="text-left text-xs text-gray-400 border-b border-[#E5E7EB]">
            <th className="py-1 pr-2">名称</th><th className="py-1 pr-2">Base URL</th>
            <th className="py-1 pr-2">类型</th><th className="py-1 pr-2">API Key</th><th></th>
          </tr></thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id} className="border-b border-[#F3F4F6]">
                <td className="py-2 pr-2 font-medium">{p.name}</td>
                <td className="py-2 pr-2 text-gray-500">{p.base_url}</td>
                <td className="py-2 pr-2">{p.provider_type}</td>
                <td className="py-2 pr-2">{p.api_key_set ? "已配置" : "未配置"}</td>
                <td className="py-2 text-right">
                  <button className="text-xs text-red-500"
                          onClick={() => api.deleteProvider(p.id).then(reload).catch((e) => setError(String(e)))}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {providers.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">暂无 provider</td></tr>}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2 items-center">
          <input className={inputCls} placeholder="名称" value={pForm.name}
                 onChange={(e) => setPForm({ ...pForm, name: e.target.value })} />
          <input className={`${inputCls} w-72`} placeholder="Base URL（如 https://api.openai.com/v1）"
                 value={pForm.base_url}
                 onChange={(e) => setPForm({ ...pForm, base_url: e.target.value })} />
          <input className={inputCls} type="password" placeholder="API Key" value={pForm.api_key}
                 onChange={(e) => setPForm({ ...pForm, api_key: e.target.value })} />
          <select className={inputCls} value={pForm.provider_type}
                  onChange={(e) => setPForm({ ...pForm, provider_type: e.target.value })}>
            <option value="openai">openai 兼容</option>
            <option value="anthropic">anthropic</option>
          </select>
          <button onClick={addProvider}
                  className="text-sm px-3 py-1.5 rounded-md bg-[#6366F1] text-white disabled:opacity-50"
                  disabled={!pForm.name || !pForm.base_url || !pForm.api_key}>
            添加
          </button>
        </div>
      </SectionCard>

      <SectionCard title="模型定价（每 1K tokens 美元；配置 provider 后可作为 Judge 模型）">
        <table className="w-full text-sm mb-3">
          <thead><tr className="text-left text-xs text-gray-400 border-b border-[#E5E7EB]">
            <th className="py-1 pr-2">模型</th><th className="py-1 pr-2">Input</th>
            <th className="py-1 pr-2">Output</th><th className="py-1 pr-2">Provider</th><th></th>
          </tr></thead>
          <tbody>
            {pricing.map((r) => (
              <tr key={r.id} className="border-b border-[#F3F4F6]">
                <td className="py-2 pr-2 font-medium">{r.model}</td>
                <td className="py-2 pr-2 font-mono">${r.input_price_per_1k}</td>
                <td className="py-2 pr-2 font-mono">${r.output_price_per_1k}</td>
                <td className="py-2 pr-2 text-gray-500">
                  {providers.find((p) => p.id === r.provider_id)?.name ?? "—"}
                </td>
                <td className="py-2 text-right">
                  <button className="text-xs text-red-500"
                          onClick={() => api.deletePricing(r.id).then(reload).catch((e) => setError(String(e)))}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {pricing.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">暂无定价</td></tr>}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2 items-center">
          <input className={inputCls} placeholder="模型名（如 gpt-4o）" value={prForm.model}
                 onChange={(e) => setPrForm({ ...prForm, model: e.target.value })} />
          <input className={inputCls} placeholder="Input $/1K" value={prForm.input}
                 onChange={(e) => setPrForm({ ...prForm, input: e.target.value })} />
          <input className={inputCls} placeholder="Output $/1K" value={prForm.output}
                 onChange={(e) => setPrForm({ ...prForm, output: e.target.value })} />
          <select className={inputCls} value={prForm.provider_id}
                  onChange={(e) => setPrForm({ ...prForm, provider_id: e.target.value })}>
            <option value="">无 provider</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={addPricing}
                  className="text-sm px-3 py-1.5 rounded-md bg-[#6366F1] text-white disabled:opacity-50"
                  disabled={!prForm.model || !prForm.input || !prForm.output}>
            添加
          </button>
        </div>
      </SectionCard>
    </main>
  );
}
```

`frontend/components/TopBar.tsx` 的 nav 中 Traces 链接后追加：

```tsx
          <Link href="/settings" className="hover:text-[#6366F1]">Settings</Link>
```

- [ ] **Step 3: 验证构建 + Commit**

`cd frontend && npm run build && npm run lint` → 通过

```bash
git add -A && git commit -m "feat: add settings page for provider and pricing config"
```

---

### Task 6: 前端链路对齐纯函数 lib/align.ts

**Files:**
- Create: `frontend/lib/align.ts`
- Test: `frontend/lib/__tests__/align.test.ts`

**Interfaces:**
- Consumes: `ObservationNode`（lib/api.ts）
- Produces:
  - `flattenTree(nodes: ObservationNode[]): ObservationNode[]`（先序遍历）
  - `interface AlignedRow { left: ObservationNode | null; right: ObservationNode | null; status: "matched" | "only_left" | "only_right"; paramDiff: boolean }`——paramDiff 仅对 matched 的 tool 节点比较 `tool_input` 深度相等（JSON.stringify），其余为 false
  - `alignTraces(a: ObservationNode[], b: ObservationNode[]): AlignedRow[]`——对两棵树的先序扁平序列按 key=`${type}:${name}` 做 LCS 对齐；未匹配的分别产出 only_left/only_right 行，保持原顺序

- [ ] **Step 1: 写失败测试**

`frontend/lib/__tests__/align.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { alignTraces, flattenTree } from "../align";
import type { ObservationNode } from "../api";

const node = (over: Partial<ObservationNode>): ObservationNode => ({
  id: Math.random().toString(36).slice(2), parent_id: null, type: "span",
  name: "", seq: 0, status: "success", error: null, started_at: null,
  ended_at: null, latency_ms: null, model: null, model_params: null,
  messages: null, tool_definitions: null, tool_calls: null, completion: null,
  input_tokens: null, output_tokens: null, cost: null, tool_input: null,
  tool_output: null, children: [], ...over,
});

describe("flattenTree", () => {
  it("pre-order flattens nested children", () => {
    const tree = [node({ name: "root", children: [node({ name: "child" })] }),
                  node({ name: "sibling" })];
    expect(flattenTree(tree).map((n) => n.name)).toEqual(["root", "child", "sibling"]);
  });
});

describe("alignTraces", () => {
  it("matches identical sequences", () => {
    const a = [node({ type: "llm", name: "plan" }), node({ type: "tool", name: "search" })];
    const b = [node({ type: "llm", name: "plan" }), node({ type: "tool", name: "search" })];
    const rows = alignTraces(a, b);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "matched")).toBe(true);
  });

  it("reports extra step on the right as only_right", () => {
    const a = [node({ type: "llm", name: "plan" })];
    const b = [node({ type: "llm", name: "plan" }), node({ type: "tool", name: "extra" })];
    const rows = alignTraces(a, b);
    expect(rows.map((r) => r.status)).toEqual(["matched", "only_right"]);
    expect(rows[1].left).toBeNull();
  });

  it("reports renamed tool as only_left + only_right", () => {
    const a = [node({ type: "tool", name: "old_tool" })];
    const b = [node({ type: "tool", name: "new_tool" })];
    const statuses = alignTraces(a, b).map((r) => r.status).sort();
    expect(statuses).toEqual(["only_left", "only_right"]);
  });

  it("flags param diff on matched tools", () => {
    const a = [node({ type: "tool", name: "search", tool_input: { q: "x" } })];
    const b = [node({ type: "tool", name: "search", tool_input: { q: "y" } })];
    const rows = alignTraces(a, b);
    expect(rows[0].status).toBe("matched");
    expect(rows[0].paramDiff).toBe(true);
  });

  it("no param diff when tool inputs equal", () => {
    const a = [node({ type: "tool", name: "search", tool_input: { q: "x" } })];
    const b = [node({ type: "tool", name: "search", tool_input: { q: "x" } })];
    expect(alignTraces(a, b)[0].paramDiff).toBe(false);
  });
});
```

运行 `npx vitest run` 确认失败（Cannot find module '../align'）

- [ ] **Step 2: 实现 lib/align.ts**

```typescript
import type { ObservationNode } from "./api";

export interface AlignedRow {
  left: ObservationNode | null;
  right: ObservationNode | null;
  status: "matched" | "only_left" | "only_right";
  paramDiff: boolean;
}

export function flattenTree(nodes: ObservationNode[]): ObservationNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

const keyOf = (n: ObservationNode) => `${n.type}:${n.name}`;

function toolParamsDiffer(l: ObservationNode, r: ObservationNode): boolean {
  if (l.type !== "tool") return false;
  return JSON.stringify(l.tool_input ?? null) !== JSON.stringify(r.tool_input ?? null);
}

export function alignTraces(
  aTree: ObservationNode[], bTree: ObservationNode[],
): AlignedRow[] {
  const a = flattenTree(aTree);
  const b = flattenTree(bTree);
  // 经典 LCS 动态规划：dp[i][j] = a[i:], b[j:] 的最长公共（按 key）长度
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = keyOf(a[i]) === keyOf(b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: AlignedRow[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (keyOf(a[i]) === keyOf(b[j])) {
      rows.push({ left: a[i], right: b[j], status: "matched",
                  paramDiff: toolParamsDiffer(a[i], b[j]) });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ left: a[i], right: null, status: "only_left", paramDiff: false });
      i++;
    } else {
      rows.push({ left: null, right: b[j], status: "only_right", paramDiff: false });
      j++;
    }
  }
  for (; i < a.length; i++) rows.push({ left: a[i], right: null, status: "only_left", paramDiff: false });
  for (; j < b.length; j++) rows.push({ left: null, right: b[j], status: "only_right", paramDiff: false });
  return rows;
}
```

- [ ] **Step 3: 测试确认通过 + Commit**

`npx vitest run` → 8 passed（2 旧 + 6 新）

```bash
git add -A && git commit -m "feat: add LCS-based trace step alignment"
```

---

### Task 7: 前端 /compare 对比工作台 + 入口

**Files:**
- Create: `frontend/app/compare/page.tsx`, `frontend/components/JudgePanel.tsx`, `frontend/components/AlignedTraceView.tsx`
- Modify: `frontend/lib/api.ts`（evaluations 类型与函数）, `frontend/app/traces/page.tsx`（勾选对比）, `frontend/app/traces/[id]/page.tsx`（加入对比按钮）

**Interfaces:**
- Consumes: `alignTraces`, `api.getTrace`, `GET/POST /api/evaluations`, `GET /api/judge-models`
- Produces:
  - `lib/api.ts` 追加：`Evaluation {id, subject_trace_id, compare_trace_id, judge_model, context_mode, score, score_b, verdict, reasoning, cost, created_at}`、`JudgeRunResult {judge_model, status, evaluation, error}`；`api.getEvaluations(subjectId, compareId?)`、`api.evaluate(body)`
  - `/compare?a=<id>&b=<id>` 页面：Summary 条（总成本差%、总延迟差、步数差）+ `AlignedTraceView`（左右双列，行按对齐结果渲染：matched 正常/仅一侧则另一侧灰色占位；tool 参数偏离 ⚠ 徽章；only_left －红/only_right ＋绿）+ `JudgePanel`
  - `JudgePanel`：加载 judge-models 复选 + 已有 evaluations 展示（含 created_at）；运行按钮 POST evaluate；每个 judge 一张结果卡（verdict 大字绿/红、score A vs B 数字与进度条、reasoning 全文、judge 调用成本）；error 状态显示后端 detail 且可重试
  - `/compare?a=<id>`（无 b）：显示 A 的摘要 + 同项目其他 trace 下拉选择 b → 跳转完整对比
  - `/traces` 列表：每行前加 checkbox（最多 2 个，第 3 个替换最早），选中 2 个时浮出「对比选中项」按钮 → `/compare?a=&b=`；`/traces/[id]` 头部加「加入对比」按钮 → `/compare?a=<id>`
  - Next.js 14 约束：使用 `useSearchParams` 的组件必须包在 `<Suspense>` 中（否则 build 报错）——page.tsx 导出包 Suspense 的壳，内容放 `CompareContent` 子组件

- [ ] **Step 1: 扩展 lib/api.ts（evaluations）**

```typescript
export interface Evaluation {
  id: string;
  subject_trace_id: string;
  compare_trace_id: string | null;
  judge_model: string;
  context_mode: string;
  score: number | null;
  score_b: number | null;
  verdict: string | null;
  reasoning: string | null;
  cost: number | null;
  created_at: string;
}

export interface JudgeRunResult {
  judge_model: string;
  status: "ok" | "error";
  evaluation: Evaluation | null;
  error: string | null;
}
```

`api` 对象追加：

```typescript
  getEvaluations: (subjectId: string, compareId?: string) => {
    const q = new URLSearchParams({ subject_trace_id: subjectId });
    if (compareId) q.set("compare_trace_id", compareId);
    return get<Evaluation[]>(`/api/evaluations?${q.toString()}`);
  },
  evaluate: (body: { subject_trace_id: string; compare_trace_id?: string; judge_models: string[]; force?: boolean }) =>
    send<{ results: JudgeRunResult[] }>("POST", "/api/evaluations", body),
```

- [ ] **Step 2: 实现 AlignedTraceView.tsx**

```tsx
"use client";
import { AlignedRow } from "@/lib/align";
import { ObservationNode } from "@/lib/api";
import { formatCost, formatLatency } from "@/lib/format";

const TYPE_STYLES: Record<string, string> = {
  llm: "bg-purple-100 text-purple-700",
  tool: "bg-emerald-100 text-emerald-700",
  span: "bg-gray-100 text-gray-600",
};

function Cell({ node, missing, missingLabel }: {
  node: ObservationNode | null; missing?: boolean; missingLabel?: string;
}) {
  if (!node) {
    return (
      <div className={`flex-1 px-3 py-2 text-xs italic ${
        missing ? "text-gray-300 bg-gray-50" : "text-gray-300"}`}>
        {missingLabel ?? "—"}
      </div>
    );
  }
  return (
    <div className="flex-1 px-3 py-2 flex items-center gap-2 text-sm min-w-0">
      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${TYPE_STYLES[node.type]}`}>
        {node.type}
      </span>
      <span className="font-medium truncate">{node.name || node.id.slice(0, 8)}</span>
      {node.model && <span className="text-xs text-gray-400 shrink-0">{node.model}</span>}
      <span className="ml-auto text-xs text-gray-400 font-mono shrink-0">
        {node.cost !== null ? formatCost(node.cost) : ""} {formatLatency(node.latency_ms)}
      </span>
    </div>
  );
}

export function AlignedTraceView({ rows }: { rows: AlignedRow[] }) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] divide-y divide-[#F3F4F6]">
      {rows.map((row, i) => (
        <div key={i} className={`flex items-stretch ${
          row.status === "only_left" ? "bg-red-50/50" :
          row.status === "only_right" ? "bg-green-50/50" : ""}`}>
          <Cell node={row.left} missing={row.status === "only_right"}
                missingLabel="－ 此步仅存在于右侧" />
          <div className="w-16 shrink-0 flex items-center justify-center text-xs">
            {row.status === "matched" && row.paramDiff && (
              <span className="text-amber-600" title="工具入参与另一侧不一致">⚠ 参数</span>
            )}
            {row.status === "matched" && !row.paramDiff && (
              <span className="text-gray-300">=</span>
            )}
            {row.status === "only_left" && <span className="text-red-400">－</span>}
            {row.status === "only_right" && <span className="text-green-500">＋</span>}
          </div>
          <Cell node={row.right} missing={row.status === "only_left"}
                missingLabel="－ 此步仅存在于左侧" />
        </div>
      ))}
      {rows.length === 0 && (
        <div className="p-6 text-sm text-gray-400 text-center">两条 trace 都没有 observation</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 实现 JudgePanel.tsx**

```tsx
"use client";
import { useEffect, useState } from "react";
import { api, Evaluation, JudgeModel, JudgeRunResult } from "@/lib/api";
import { formatCost } from "@/lib/format";

function ScoreBar({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-16 text-gray-500">{label}</span>
      <span className="font-bold text-lg w-10">{score ?? "—"}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
        <div className="h-full bg-[#6366F1]" style={{ width: `${((score ?? 0) / 10) * 100}%` }} />
      </div>
    </div>
  );
}

function EvalCard({ ev }: { ev: Evaluation }) {
  const positive = ev.verdict === "replaceable" || ev.verdict === "pass";
  return (
    <div className="border border-[#E5E7EB] rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold">{ev.judge_model}</span>
        <span className={`text-sm font-bold ${positive ? "text-green-600" : "text-red-600"}`}>
          {positive ? "✅" : "❌"} {ev.verdict}
        </span>
        <span className="ml-auto text-xs text-gray-400">
          {formatCost(ev.cost)} · {new Date(ev.created_at).toLocaleString("zh-CN")}
        </span>
      </div>
      <div className="space-y-1 mb-2">
        <ScoreBar label="A" score={ev.score} />
        {ev.score_b !== null && <ScoreBar label="B" score={ev.score_b} />}
      </div>
      {ev.reasoning && <p className="text-sm text-gray-600 whitespace-pre-wrap">{ev.reasoning}</p>}
    </div>
  );
}

export function JudgePanel({ subjectId, compareId }: { subjectId: string; compareId: string }) {
  const [judgeModels, setJudgeModels] = useState<JudgeModel[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api.getJudgeModels().then(setJudgeModels).catch(() => setJudgeModels([]));
    api.getEvaluations(subjectId, compareId).then(setEvaluations).catch(() => {});
  }, [subjectId, compareId]);

  const toggle = (m: string) =>
    setSelected((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);

  const run = async () => {
    setRunning(true);
    setErrors({});
    try {
      const { results } = await api.evaluate({
        subject_trace_id: subjectId, compare_trace_id: compareId, judge_models: selected,
      });
      const errs: Record<string, string> = {};
      results.forEach((r: JudgeRunResult) => {
        if (r.status === "error" && r.error) errs[r.judge_model] = r.error;
      });
      setErrors(errs);
      setEvaluations(await api.getEvaluations(subjectId, compareId));
    } catch (e) {
      setErrors({ _global: String(e) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold mb-3">LLM Judge 评分</h3>
      {judgeModels.length === 0 ? (
        <p className="text-sm text-gray-400">
          没有可用的 judge 模型——先到 Settings 配置 provider 并在定价表中关联模型。
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {judgeModels.map((m) => (
            <label key={m.model} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={selected.includes(m.model)}
                     onChange={() => toggle(m.model)} />
              {m.model} <span className="text-xs text-gray-400">({m.provider_name})</span>
            </label>
          ))}
          <button onClick={run} disabled={selected.length === 0 || running}
                  className="text-sm px-4 py-1.5 rounded-md bg-[#6366F1] text-white disabled:opacity-50">
            {running ? "评分中…" : "运行 Judge ▶"}
          </button>
        </div>
      )}
      {errors._global && <p className="text-sm text-red-600 mb-2">{errors._global}</p>}
      {Object.entries(errors).filter(([k]) => k !== "_global").map(([model, err]) => (
        <p key={model} className="text-sm text-red-600 mb-2">{model}: {err}</p>
      ))}
      <div className="grid gap-3 md:grid-cols-2">
        {evaluations.map((ev) => <EvalCard key={ev.id} ev={ev} />)}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 实现 /compare 页**

`frontend/app/compare/page.tsx`：

```tsx
"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, TraceDetail, TraceSummary } from "@/lib/api";
import { alignTraces } from "@/lib/align";
import { formatCost, formatLatency } from "@/lib/format";
import { AlignedTraceView } from "@/components/AlignedTraceView";
import { JudgePanel } from "@/components/JudgePanel";
import { useProject } from "@/contexts/ProjectContext";

function pct(a: number | null, b: number | null): string {
  if (a === null || b === null || a === 0) return "—";
  const d = ((b - a) / a) * 100;
  return `${d > 0 ? "↑" : "↓"} ${Math.abs(d).toFixed(0)}%`;
}

function Summary({ a, b }: { a: TraceDetail; b: TraceDetail }) {
  const items = [
    { label: "总成本", value: `${formatCost(a.total_cost)} → ${formatCost(b.total_cost)}`,
      delta: pct(a.total_cost, b.total_cost) },
    { label: "总延迟", value: `${formatLatency(a.latency_ms)} → ${formatLatency(b.latency_ms)}`,
      delta: pct(a.latency_ms, b.latency_ms) },
    { label: "Tokens (in)", value: `${a.total_input_tokens} → ${b.total_input_tokens}`,
      delta: pct(a.total_input_tokens, b.total_input_tokens) },
  ];
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] px-4 py-3 mb-4 flex flex-wrap gap-x-8 gap-y-2">
      {items.map((it) => (
        <div key={it.label} className="text-sm">
          <span className="text-gray-400 mr-2">{it.label}</span>
          <span className="font-mono">{it.value}</span>
          <span className={`ml-2 font-semibold ${
            it.delta.startsWith("↓") ? "text-green-600" :
            it.delta.startsWith("↑") ? "text-red-600" : "text-gray-400"}`}>
            {it.delta}
          </span>
        </div>
      ))}
    </div>
  );
}

function PickB({ aId }: { aId: string }) {
  const { currentProject } = useProject();
  const router = useRouter();
  const [candidates, setCandidates] = useState<TraceSummary[]>([]);

  useEffect(() => {
    if (!currentProject) return;
    api.getTraces({ projectId: currentProject.id, limit: 100 })
      .then((r) => setCandidates(r.items.filter((t) => t.id !== aId)))
      .catch(() => {});
  }, [currentProject, aId]);

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 text-sm">
      <p className="mb-3 text-gray-600">选择要与之对比的另一条 trace：</p>
      <select className="border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm w-full max-w-xl"
              defaultValue=""
              onChange={(e) => e.target.value && router.push(`/compare?a=${aId}&b=${e.target.value}`)}>
        <option value="" disabled>选择 trace…</option>
        {candidates.map((t) => (
          <option key={t.id} value={t.id}>
            {(t.name || t.id.slice(0, 8))} · {t.model_summary || "?"} · {formatCost(t.total_cost)} · {t.origin}
          </option>
        ))}
      </select>
    </div>
  );
}

function TraceHeader({ t, side }: { t: TraceDetail; side: string }) {
  return (
    <div className="flex-1 px-3 py-2 text-sm">
      <span className="text-xs text-gray-400 mr-2">{side}</span>
      <Link href={`/traces/${t.id}`} className="font-semibold hover:text-[#6366F1]">
        {t.name || t.id.slice(0, 8)}
      </Link>
      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
        t.origin === "replay" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
        {t.origin}
      </span>
    </div>
  );
}

function CompareContent() {
  const params = useSearchParams();
  const aId = params.get("a");
  const bId = params.get("b");
  const [a, setA] = useState<TraceDetail | null>(null);
  const [b, setB] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setA(null); setB(null); setError(null);
    if (aId) api.getTrace(aId).then(setA).catch((e) => setError(String(e)));
    if (bId) api.getTrace(bId).then(setB).catch((e) => setError(String(e)));
  }, [aId, bId]);

  const rows = useMemo(() => (a && b ? alignTraces(a.observations, b.observations) : []),
                       [a, b]);

  if (!aId) {
    return <p className="text-sm text-gray-400">缺少参数——从 Traces 列表勾选两条 trace 进入对比。</p>;
  }
  if (error) return <p className="text-sm text-red-500">加载失败：{error}</p>;
  if (!a) return <p className="text-sm text-gray-400">加载中…</p>;
  if (!bId) return <PickB aId={aId} />;
  if (!b) return <p className="text-sm text-gray-400">加载中…</p>;

  return (
    <>
      <Summary a={a} b={b} />
      <div className="bg-white rounded-t-lg border border-b-0 border-[#E5E7EB] flex divide-x divide-[#F3F4F6]">
        <TraceHeader t={a} side="A" />
        <div className="w-16 shrink-0" />
        <TraceHeader t={b} side="B" />
      </div>
      <AlignedTraceView rows={rows} />
      <JudgePanel subjectId={a.id} compareId={b.id} />
    </>
  );
}

export default function ComparePage() {
  return (
    <main className="max-w-6xl mx-auto p-6">
      <h2 className="text-base font-semibold mb-4">对比工作台</h2>
      <Suspense fallback={<p className="text-sm text-gray-400">加载中…</p>}>
        <CompareContent />
      </Suspense>
    </main>
  );
}
```

- [ ] **Step 5: 列表勾选 + 详情入口**

`frontend/app/traces/page.tsx`：加状态 `const [compareIds, setCompareIds] = useState<string[]>([]);` 与切换函数（最多 2 个，满员替换最早的）：

```tsx
  const toggleCompare = (id: string) =>
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
```

传给 `<TraceTable traces={traces} compareIds={compareIds} onToggleCompare={toggleCompare} />`；在标题行右侧按钮组之前加（选中 2 个才显示）：

```tsx
          {compareIds.length === 2 && (
            <Link href={`/compare?a=${compareIds[0]}&b=${compareIds[1]}`}
                  className="text-sm px-3 py-1.5 rounded-md bg-[#6366F1] text-white">
              对比选中项 (2)
            </Link>
          )}
```

（记得 `import Link from "next/link";`）

`frontend/components/TraceTable.tsx`：props 扩为 `{ traces, compareIds, onToggleCompare }: { traces: TraceSummary[]; compareIds: string[]; onToggleCompare: (id: string) => void }`；表头最前加 `<th className="px-2 py-2"></th>`；每行最前加：

```tsx
            <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={compareIds.includes(t.id)}
                     onChange={() => onToggleCompare(t.id)} />
            </td>
```

`frontend/app/traces/[id]/page.tsx`：头部 `<span className="ml-auto ...">` 指标之前加：

```tsx
          <Link href={`/compare?a=${trace.id}`}
                className="text-xs px-3 py-1 rounded-md border border-[#6366F1] text-[#6366F1] hover:bg-[#EEF0FF]">
            加入对比
          </Link>
```

（该文件已 import Link；把指标 span 的 `ml-auto` 保留即可，按钮放其前面。）

- [ ] **Step 6: 验证 + Commit**

`cd frontend && npm run build && npx vitest run && npm run lint` → 全过（build 路由列表含 /compare、/settings）

```bash
git add -A && git commit -m "feat: add compare workspace with aligned trace view and judge panel"
```

---

### Task 8: 收尾（文档 + 全量验证）

**Files:**
- Modify: `README.md`（Roadmap 更新：Phase 2 标记完成；新增"对比与评分"章节：/compare 动线、judge 配置步骤、evaluations API 表）、`CLAUDE.md`（Architecture 增补 llm_client/judge_service/config+evaluations 路由与 /compare /settings 页面；Key Design Decisions 增补 judge 缓存键与 score/score_b 语义）
- Verify: 全量

**Interfaces:** 无新接口，文档与验证

- [ ] **Step 1: 更新 README.md 与 CLAUDE.md**（内容按上述 Files 描述写全，命令与字段名须对照真实代码核验）

- [ ] **Step 2: 全量验证**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q     # 37 passed，无 warning
cd ../frontend && npm run build && npx vitest run && npm run lint   # 8 vitest passed
```

- [ ] **Step 3: 手动冒烟（SQLite 本地）**

启动后端（端口 8010）→ create_project + 上报两条 example trace（跑两次 report_agent_run.py）→ curl 创建 provider（假 key）+ pricing → `POST /api/evaluations`（judge 会真调假 provider 而失败——确认返回 `{"results":[{"status":"error",...}]}` 而非 500，即"失败如实报错"链路正确）→ 杀进程。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: update README and CLAUDE.md for compare and judge"
```

---

## Phase 3 依赖（本计划产出、回放引擎将复用）

- `llm_client.chat_completion`（回放调模型）
- `judge_service` 的 provider 解析模式
- `/compare` 视图（回放结果 trace 直接进对比）
- `db_migrate.ensure_columns`（Phase 3 若需加列）
