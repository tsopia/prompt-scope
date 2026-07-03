# Phase 1: 数据地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成 PromptScope 的数据核心——全部实体模型、带 API Key 认证的 ingestion API、trace 列表/详情（链路可视化）前端，并退役 Langfuse 旧实现。

**Architecture:** FastAPI + SQLAlchemy 2.0（DATABASE_URL 可切 Postgres/SQLite，测试用 SQLite 内存库，部署用 Postgres）。数据模型一次到位（含 Phase 2-4 所需全部表）。前端 Next.js 14 App Router 重建为多页结构。

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Pydantic v2, pytest, Next.js 14, TailwindCSS, vitest

**Spec:** `docs/superpowers/specs/2026-07-04-agent-replay-platform-design.md`

## Global Constraints

- 数据库通过 `DATABASE_URL` 环境变量配置；默认 `sqlite:///./db/promptscope.db`（本地零配置），docker-compose 提供 Postgres 16
- llm observation 的 `messages` 与 `model` 必填；tool observation 的 `tool_input` 必填、`tool_output` 与 `error` 至少其一（回放数据完整性）
- Ingestion 幂等：trace/observation id 由客户端生成，重复上报 upsert
- 所有新后端代码放在 `backend/` 现有结构内；测试在 `backend/tests/`
- git 提交信息不含任何 AI 署名
- 金额统一美元，Float 存储；token 单价按每 1K tokens 计
- 前端不引入新 UI 库，延续 Tailwind + 现有 `components/ui/*`

---

### Task 1: 退役旧实现 + 依赖更新

**Files:**
- Delete: `backend/services/langfuse_client.py`, `backend/services/sync_service.py`, `backend/services/candidate_service.py`, `backend/services/judge_service.py`, `backend/services/mock_data.py`, `backend/models/database.py`, `backend/models/schemas.py`
- Delete: `frontend/components/CandidateItem.tsx`, `frontend/components/CompareWorkspace.tsx`, `frontend/components/CostChart.tsx`, `frontend/components/ExperimentList.tsx`, `frontend/components/JudgeResult.tsx`, `frontend/components/SyncStatus.tsx`, `frontend/components/layout/Sidebar.tsx`, `frontend/store/useStore.ts`
- Delete: `frontend/app/candidates/`, `frontend/app/compare/`, `frontend/app/evaluation/`, `frontend/app/experiments/`, `frontend/app/models/`, `frontend/app/prompts/`, `frontend/app/settings/` （整个目录）
- Modify: `backend/main.py`, `backend/requirements.txt`, `frontend/app/page.tsx`, `frontend/app/layout.tsx`, `frontend/lib/api.ts`
- Create: `backend/requirements-dev.txt`

**Interfaces:**
- Produces: 可启动的空壳后端（仅 `/api/health`）；可构建的空壳前端（首页占位）；后续任务在此地基上添加

- [ ] **Step 1: 删除退役文件**

```bash
cd /Users/kj/projects/prompt-scope/promptscope
git rm backend/services/langfuse_client.py backend/services/sync_service.py \
  backend/services/candidate_service.py backend/services/judge_service.py \
  backend/services/mock_data.py backend/models/database.py backend/models/schemas.py
git rm frontend/components/CandidateItem.tsx frontend/components/CompareWorkspace.tsx \
  frontend/components/CostChart.tsx frontend/components/ExperimentList.tsx \
  frontend/components/JudgeResult.tsx frontend/components/SyncStatus.tsx \
  frontend/components/layout/Sidebar.tsx frontend/store/useStore.ts
git rm -r frontend/app/candidates frontend/app/compare frontend/app/evaluation \
  frontend/app/experiments frontend/app/models frontend/app/prompts frontend/app/settings
```

- [ ] **Step 2: 重写 backend/main.py 为最小应用**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="PromptScope")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 3: 更新依赖文件**

`backend/requirements.txt`（整体替换）：

```
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
httpx>=0.25.0
python-dotenv>=1.0.0
openai>=1.0.0
pydantic>=2.0.0
sqlalchemy>=2.0.0
psycopg[binary]>=3.1.0
```

`backend/requirements-dev.txt`（新建）：

```
pytest>=8.0.0
```

安装：

```bash
cd backend && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt
```

- [ ] **Step 4: 重写前端空壳**

`frontend/app/layout.tsx`：

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PromptScope",
  description: "Agent 调优与回放平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-[#F9FAFB] text-[#1F2937]">{children}</body>
    </html>
  );
}
```

`frontend/app/page.tsx`：

```tsx
export default function Home() {
  return <main className="p-8 text-sm text-gray-500">PromptScope — rebuilding…</main>;
}
```

`frontend/lib/api.ts`（清空为最小占位，后续任务重建）：

```typescript
export const API_BASE = "";
```

- [ ] **Step 5: 验证后端可启动、前端可构建**

```bash
cd backend && .venv/bin/python -c "import main; print('backend ok')"
cd ../frontend && npm run build
```

Expected: `backend ok`；`npm run build` 成功（可能有未使用依赖警告，无 error）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: retire Langfuse-based implementation and stub routes"
```

---

### Task 2: 数据库层与全部实体模型

**Files:**
- Create: `backend/config.py`, `backend/db.py`, `backend/models/entities.py`
- Modify: `backend/models/__init__.py`, `backend/main.py`
- Test: `backend/tests/__init__.py`, `backend/tests/conftest.py`, `backend/tests/test_models.py`

**Interfaces:**
- Produces:
  - `db.Base`, `db.engine`, `db.SessionLocal`, `db.get_db()`（FastAPI 依赖）
  - `models.entities` 中的 ORM 类：`Project, ApiKey, Trace, Observation, Prompt, PromptVersion, ReplayRun, Evaluation, ModelProvider, ModelPricing`
  - `entities.gen_id() -> str`（32 位 hex uuid）、`entities.utcnow() -> datetime`

- [ ] **Step 1: 写 config.py 与 db.py**

`backend/config.py`：

```python
import os

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./db/promptscope.db")
```

`backend/db.py`：

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import DATABASE_URL

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 2: 写失败测试 test_models.py**

`backend/tests/conftest.py`：

```python
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["DATABASE_URL"] = "sqlite://"  # in-memory，必须在 import config 之前

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, expire_on_commit=False)
    session = TestSession()
    yield session
    session.close()
```

`backend/tests/test_models.py`：

```python
from models.entities import (
    ApiKey, Evaluation, ModelPricing, ModelProvider, Observation,
    Project, Prompt, PromptVersion, ReplayRun, Trace,
)


def test_create_project_with_api_key(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    k = ApiKey(project_id=p.id, key_hash="h" * 64, prefix="ps-abcd")
    db_session.add(k)
    db_session.commit()
    assert p.id and len(p.id) == 32
    assert k.project.name == "demo"


def test_trace_observation_tree(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    t = Trace(id="tr1", project_id=p.id, name="run", origin="live")
    root = Observation(id="ob1", trace_id="tr1", type="llm", name="agent-loop",
                       model="gpt-4o", messages=[{"role": "user", "content": "hi"}], seq=0)
    child = Observation(id="ob2", trace_id="tr1", parent_id="ob1", type="tool",
                        name="search", tool_input={"q": "x"}, tool_output={"r": 1}, seq=1)
    db_session.add_all([t, root, child])
    db_session.commit()
    assert t.observations[0].id == "ob1"
    assert t.observations[1].parent_id == "ob1"
    assert t.observations[0].messages[0]["role"] == "user"


def test_replay_and_evaluation_tables(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    t = Trace(id="tr1", project_id=p.id, name="run")
    db_session.add(t)
    db_session.flush()
    r = ReplayRun(project_id=p.id, source_trace_id="tr1", override_model="deepseek-chat",
                  status="pending", divergences=[])
    e = Evaluation(project_id=p.id, subject_trace_id="tr1", judge_model="gpt-4o",
                   context_mode="output_only", score=8.5, verdict="pass", reasoning="ok")
    db_session.add_all([r, e])
    db_session.commit()
    assert r.id and e.id


def test_prompt_versions_and_pricing(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    pr = Prompt(project_id=p.id, name="qa-bot")
    db_session.add(pr)
    db_session.flush()
    v = PromptVersion(prompt_id=pr.id, version=1, content="You are a bot.")
    provider = ModelProvider(name="openai", base_url="https://api.openai.com/v1",
                             api_key="sk-x", provider_type="openai")
    db_session.add_all([v, provider])
    db_session.flush()
    price = ModelPricing(model="gpt-4o", input_price_per_1k=0.005,
                         output_price_per_1k=0.015, provider_id=provider.id)
    db_session.add(price)
    db_session.commit()
    assert v.prompt.name == "qa-bot"
    assert price.input_price_per_1k == 0.005
```

- [ ] **Step 3: 运行测试确认失败**

```bash
cd backend && .venv/bin/python -m pytest tests/test_models.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'models.entities'`（或 ImportError）

- [ ] **Step 4: 实现 entities.py**

`backend/models/entities.py`：

```python
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


def gen_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    api_keys: Mapped[list["ApiKey"]] = relationship(back_populates="project")


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    prefix: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped["Project"] = relationship(back_populates="api_keys")


class Trace(Base):
    __tablename__ = "traces"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # 客户端生成
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    origin: Mapped[str] = mapped_column(String(16), default="live")  # live | replay
    status: Mapped[str] = mapped_column(String(16), default="success")  # running | success | error
    input: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    output: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    meta: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    prompt_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("prompt_versions.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    observations: Mapped[list["Observation"]] = relationship(
        back_populates="trace", order_by="Observation.seq",
        cascade="all, delete-orphan")


class Observation(Base):
    __tablename__ = "observations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # 客户端生成
    trace_id: Mapped[str] = mapped_column(ForeignKey("traces.id"), index=True)
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("observations.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(8))  # llm | tool | span
    name: Mapped[str] = mapped_column(String(255), default="")
    seq: Mapped[int] = mapped_column(Integer, default=0)  # trace 内稳定排序
    status: Mapped[str] = mapped_column(String(16), default="success")  # success | error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    meta: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)

    # llm 专属
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    model_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    messages: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tool_definitions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tool_calls: Mapped[list | None] = mapped_column(JSON, nullable=True)
    completion: Mapped[dict | list | str | None] = mapped_column(JSON, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    prompt_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("prompt_versions.id"), nullable=True)

    # tool 专属
    tool_input: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    tool_output: Mapped[dict | list | str | None] = mapped_column(JSON, nullable=True)

    trace: Mapped["Trace"] = relationship(back_populates="observations")


class Prompt(Base):
    __tablename__ = "prompts"
    __table_args__ = (UniqueConstraint("project_id", "name"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    versions: Mapped[list["PromptVersion"]] = relationship(
        back_populates="prompt", order_by="PromptVersion.version")


class PromptVersion(Base):
    __tablename__ = "prompt_versions"
    __table_args__ = (UniqueConstraint("prompt_id", "version"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    prompt_id: Mapped[str] = mapped_column(ForeignKey("prompts.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    variables: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    prompt: Mapped["Prompt"] = relationship(back_populates="versions")


class ReplayRun(Base):
    __tablename__ = "replay_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    source_trace_id: Mapped[str] = mapped_column(ForeignKey("traces.id"), index=True)
    result_trace_id: Mapped[str | None] = mapped_column(ForeignKey("traces.id"), nullable=True)
    target_observation_id: Mapped[str | None] = mapped_column(
        ForeignKey("observations.id"), nullable=True)  # 多阶段单点回放用
    override_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    override_model_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    override_prompt_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("prompt_versions.id"), nullable=True)
    override_prompt_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    # pending | running | success | failed
    divergences: Mapped[list | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    subject_trace_id: Mapped[str] = mapped_column(ForeignKey("traces.id"), index=True)
    compare_trace_id: Mapped[str | None] = mapped_column(ForeignKey("traces.id"), nullable=True)
    judge_model: Mapped[str] = mapped_column(String(128))
    context_mode: Mapped[str] = mapped_column(String(16), default="output_only")
    # output_only | with_trace
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    verdict: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ModelProvider(Base):
    __tablename__ = "model_providers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    base_url: Mapped[str] = mapped_column(String(512))
    api_key: Mapped[str] = mapped_column(String(512))  # 内部平台，明文存储
    provider_type: Mapped[str] = mapped_column(String(16), default="openai")
    # openai | anthropic
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ModelPricing(Base):
    __tablename__ = "model_pricings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=gen_id)
    model: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    input_price_per_1k: Mapped[float] = mapped_column(Float)
    output_price_per_1k: Mapped[float] = mapped_column(Float)
    provider_id: Mapped[str | None] = mapped_column(
        ForeignKey("model_providers.id"), nullable=True)
```

`backend/models/__init__.py`（整体替换）：

```python
from models import entities  # noqa: F401
```

- [ ] **Step 5: 挂到应用启动（main.py 加 lifespan）**

`backend/main.py`（整体替换）：

```python
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import Base, engine
import models.entities  # noqa: F401  确保建表元数据注册


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("db", exist_ok=True)
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="PromptScope", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 6: 运行测试确认通过**

```bash
cd backend && .venv/bin/python -m pytest tests/ -v
```

Expected: 4 passed

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add SQLAlchemy data model for traces, replay, evaluation"
```

---

### Task 3: API Key 认证与项目管理

**Files:**
- Create: `backend/services/auth.py`, `backend/scripts/__init__.py`, `backend/scripts/create_project.py`
- Modify: `backend/services/__init__.py`（若有旧导入则清空）
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: `models.entities.Project/ApiKey`, `db.get_db`
- Produces:
  - `auth.generate_api_key() -> tuple[str, str, str]`（返回 `(明文key, key_hash, prefix)`；明文形如 `ps-<43位urlsafe>`）
  - `auth.hash_key(raw: str) -> str`（sha256 hex）
  - `auth.require_api_key(...) -> Project`（FastAPI 依赖，从 `Authorization: Bearer <key>` 解析；无效/吊销 → 401）
  - `scripts/create_project.py <name>`：创建项目+key，stdout 打印明文 key（仅此一次）

- [ ] **Step 1: 写失败测试**

`backend/tests/test_auth.py`：

```python
import pytest
from fastapi import HTTPException

from models.entities import ApiKey, Project
from services.auth import generate_api_key, hash_key, resolve_api_key


def test_generate_api_key_format():
    raw, key_hash, prefix = generate_api_key()
    assert raw.startswith("ps-")
    assert len(key_hash) == 64
    assert prefix == raw[:7]
    assert hash_key(raw) == key_hash


def test_resolve_api_key(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    raw, key_hash, prefix = generate_api_key()
    db_session.add(ApiKey(project_id=p.id, key_hash=key_hash, prefix=prefix))
    db_session.commit()

    assert resolve_api_key(db_session, raw).id == p.id

    with pytest.raises(HTTPException) as exc:
        resolve_api_key(db_session, "ps-invalid")
    assert exc.value.status_code == 401


def test_revoked_key_rejected(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    raw, key_hash, prefix = generate_api_key()
    from models.entities import utcnow
    db_session.add(ApiKey(project_id=p.id, key_hash=key_hash, prefix=prefix,
                          revoked_at=utcnow()))
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        resolve_api_key(db_session, raw)
    assert exc.value.status_code == 401
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && .venv/bin/python -m pytest tests/test_auth.py -v
```

Expected: FAIL — `No module named 'services.auth'`

- [ ] **Step 3: 实现 auth.py**

`backend/services/auth.py`：

```python
import hashlib
import secrets

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import ApiKey, Project


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    raw = "ps-" + secrets.token_urlsafe(32)
    return raw, hash_key(raw), raw[:7]


def resolve_api_key(db: Session, raw: str) -> Project:
    row = db.query(ApiKey).filter(ApiKey.key_hash == hash_key(raw)).first()
    if row is None or row.revoked_at is not None:
        raise HTTPException(status_code=401, detail="invalid or revoked API key")
    return row.project


def require_api_key(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Project:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing Authorization bearer token")
    return resolve_api_key(db, authorization.removeprefix("Bearer "))
```

`backend/services/__init__.py`（整体替换为空文件内容）：

```python
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd backend && .venv/bin/python -m pytest tests/test_auth.py -v
```

Expected: 3 passed

- [ ] **Step 5: 写 create_project.py 脚本**

`backend/scripts/__init__.py`：空文件。

`backend/scripts/create_project.py`：

```python
"""创建项目并签发 API Key。用法：python -m scripts.create_project <项目名>"""
import sys

from db import Base, SessionLocal, engine
from models.entities import ApiKey, Project
from services.auth import generate_api_key


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python -m scripts.create_project <name>")
        sys.exit(1)
    name = sys.argv[1]
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.name == name).first()
        if project is None:
            project = Project(name=name)
            db.add(project)
            db.flush()
        raw, key_hash, prefix = generate_api_key()
        db.add(ApiKey(project_id=project.id, key_hash=key_hash, prefix=prefix))
        db.commit()
        print(f"project: {project.name} ({project.id})")
        print(f"api key (save it now, shown only once): {raw}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: 手动验证脚本**

```bash
cd backend && .venv/bin/python -m scripts.create_project demo-project
```

Expected: 打印 project id 和 `ps-` 开头的 key

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add API key auth and project bootstrap script"
```

---

### Task 4: Ingestion API（上报、幂等、校验、成本聚合）

**Files:**
- Create: `backend/schemas/__init__.py`, `backend/schemas/ingest.py`, `backend/services/ingest_service.py`, `backend/routers/__init__.py`, `backend/routers/ingest.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_ingest.py`

**Interfaces:**
- Consumes: `auth.require_api_key`, `models.entities.*`
- Produces:
  - `POST /api/ingest`（Bearer key 认证）Body: `{"trace": TraceIn, "observations": [ObservationIn]}` → `{"trace_id": str, "observation_count": int}`
  - `ingest_service.ingest(db, project_id, payload: IngestRequest) -> Trace`（回放引擎 Phase 3 复用它落回放 trace）
  - `ingest_service.compute_cost(db, model, input_tokens, output_tokens) -> float | None`
  - Pydantic 模型：`TraceIn(id, name, origin='live', status='success', input, output, metadata, started_at, ended_at, prompt_version_id)`；`ObservationIn(id, parent_id, type, name, seq, status, error, started_at, ended_at, metadata, model, model_params, messages, tool_definitions, tool_calls, completion, input_tokens, output_tokens, prompt_version_id, tool_input, tool_output)`；`IngestRequest(trace, observations)`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_ingest.py`：

```python
import pytest
from fastapi.testclient import TestClient

from db import get_db
from models.entities import ApiKey, ModelPricing, Observation, Project, Trace
from services.auth import generate_api_key


@pytest.fixture()
def client(db_session):
    from main import app

    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def api_key(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    raw, key_hash, prefix = generate_api_key()
    db_session.add(ApiKey(project_id=p.id, key_hash=key_hash, prefix=prefix))
    db_session.add(ModelPricing(model="gpt-4o", input_price_per_1k=0.005,
                                output_price_per_1k=0.015))
    db_session.commit()
    return raw, p


PAYLOAD = {
    "trace": {
        "id": "tr-1", "name": "qa-run",
        "input": {"question": "hi"}, "output": {"answer": "hello"},
        "started_at": "2026-07-04T10:00:00Z", "ended_at": "2026-07-04T10:00:03Z",
    },
    "observations": [
        {
            "id": "ob-1", "type": "llm", "name": "agent-loop", "seq": 0,
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "hi"}],
            "tool_definitions": [{"name": "search", "parameters": {}}],
            "tool_calls": [{"name": "search", "arguments": {"q": "hi"}}],
            "completion": "hello",
            "input_tokens": 100, "output_tokens": 50,
        },
        {
            "id": "ob-2", "parent_id": "ob-1", "type": "tool", "name": "search",
            "seq": 1, "tool_input": {"q": "hi"}, "tool_output": {"hits": []},
        },
    ],
}


def test_ingest_requires_auth(client):
    assert client.post("/api/ingest", json=PAYLOAD).status_code == 401


def test_ingest_creates_trace_with_cost(client, db_session, api_key):
    raw, project = api_key
    resp = client.post("/api/ingest", json=PAYLOAD,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"trace_id": "tr-1", "observation_count": 2}

    t = db_session.get(Trace, "tr-1")
    assert t.project_id == project.id
    assert t.latency_ms == 3000
    assert t.total_input_tokens == 100
    # cost = 100/1000*0.005 + 50/1000*0.015
    assert t.total_cost == pytest.approx(0.00125)
    ob = db_session.get(Observation, "ob-1")
    assert ob.cost == pytest.approx(0.00125)


def test_ingest_is_idempotent(client, db_session, api_key):
    raw, _ = api_key
    h = {"Authorization": f"Bearer {raw}"}
    client.post("/api/ingest", json=PAYLOAD, headers=h)
    payload2 = {**PAYLOAD, "trace": {**PAYLOAD["trace"], "output": {"answer": "updated"}}}
    resp = client.post("/api/ingest", json=payload2, headers=h)
    assert resp.status_code == 200
    assert db_session.query(Trace).count() == 1
    assert db_session.query(Observation).count() == 2
    assert db_session.get(Trace, "tr-1").output == {"answer": "updated"}


def test_llm_observation_requires_messages_and_model(client, api_key):
    raw, _ = api_key
    bad = {"trace": {"id": "tr-2", "name": "x"},
           "observations": [{"id": "ob-x", "type": "llm", "name": "call"}]}
    resp = client.post("/api/ingest", json=bad,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 422
    assert "messages" in resp.text


def test_tool_observation_requires_input_and_result(client, api_key):
    raw, _ = api_key
    bad = {"trace": {"id": "tr-3", "name": "x"},
           "observations": [{"id": "ob-y", "type": "tool", "name": "search"}]}
    resp = client.post("/api/ingest", json=bad,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 422


def test_unknown_model_cost_is_null(client, db_session, api_key):
    raw, _ = api_key
    payload = {
        "trace": {"id": "tr-4", "name": "x"},
        "observations": [{"id": "ob-z", "type": "llm", "name": "call",
                          "model": "unknown-model",
                          "messages": [{"role": "user", "content": "hi"}],
                          "input_tokens": 10, "output_tokens": 10}],
    }
    resp = client.post("/api/ingest", json=payload,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 200
    assert db_session.get(Trace, "tr-4").total_cost is None
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && .venv/bin/python -m pytest tests/test_ingest.py -v
```

Expected: FAIL — 404（路由不存在）或 ImportError

- [ ] **Step 3: 实现 schemas/ingest.py**

`backend/schemas/__init__.py`：空文件。

`backend/schemas/ingest.py`：

```python
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class TraceIn(BaseModel):
    id: str = Field(max_length=64)
    name: str = ""
    origin: Literal["live", "replay"] = "live"
    status: Literal["running", "success", "error"] = "success"
    input: Any = None
    output: Any = None
    metadata: dict | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    prompt_version_id: str | None = None


class ObservationIn(BaseModel):
    id: str = Field(max_length=64)
    parent_id: str | None = None
    type: Literal["llm", "tool", "span"]
    name: str = ""
    seq: int = 0
    status: Literal["success", "error"] = "success"
    error: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    metadata: dict | None = None
    # llm
    model: str | None = None
    model_params: dict | None = None
    messages: list | None = None
    tool_definitions: list | None = None
    tool_calls: list | None = None
    completion: Any = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    prompt_version_id: str | None = None
    # tool
    tool_input: Any = None
    tool_output: Any = None

    @model_validator(mode="after")
    def check_type_required_fields(self) -> "ObservationIn":
        if self.type == "llm":
            if self.messages is None:
                raise ValueError("llm observation requires messages")
            if not self.model:
                raise ValueError("llm observation requires model")
        if self.type == "tool":
            if self.tool_input is None:
                raise ValueError("tool observation requires tool_input")
            if self.tool_output is None and self.error is None:
                raise ValueError("tool observation requires tool_output or error")
        return self


class IngestRequest(BaseModel):
    trace: TraceIn
    observations: list[ObservationIn] = []
```

- [ ] **Step 4: 实现 ingest_service.py**

`backend/services/ingest_service.py`：

```python
from sqlalchemy.orm import Session

from models.entities import ModelPricing, Observation, Trace
from schemas.ingest import IngestRequest, ObservationIn


def compute_cost(db: Session, model: str | None,
                 input_tokens: int | None, output_tokens: int | None) -> float | None:
    if not model or input_tokens is None or output_tokens is None:
        return None
    pricing = db.query(ModelPricing).filter(ModelPricing.model == model).first()
    if pricing is None:
        return None
    return (input_tokens / 1000 * pricing.input_price_per_1k
            + output_tokens / 1000 * pricing.output_price_per_1k)


def _latency_ms(start, end) -> int | None:
    if start is None or end is None:
        return None
    return int((end - start).total_seconds() * 1000)


def _apply_observation(db: Session, trace_id: str, data: ObservationIn) -> None:
    ob = db.get(Observation, data.id)
    if ob is None:
        ob = Observation(id=data.id, trace_id=trace_id)
        db.add(ob)
    ob.trace_id = trace_id
    ob.parent_id = data.parent_id
    ob.type = data.type
    ob.name = data.name
    ob.seq = data.seq
    ob.status = data.status
    ob.error = data.error
    ob.started_at = data.started_at
    ob.ended_at = data.ended_at
    ob.latency_ms = _latency_ms(data.started_at, data.ended_at)
    ob.meta = data.metadata
    ob.model = data.model
    ob.model_params = data.model_params
    ob.messages = data.messages
    ob.tool_definitions = data.tool_definitions
    ob.tool_calls = data.tool_calls
    ob.completion = data.completion
    ob.input_tokens = data.input_tokens
    ob.output_tokens = data.output_tokens
    ob.prompt_version_id = data.prompt_version_id
    ob.tool_input = data.tool_input
    ob.tool_output = data.tool_output
    if data.type == "llm":
        ob.cost = compute_cost(db, data.model, data.input_tokens, data.output_tokens)


def _recompute_aggregates(db: Session, trace: Trace) -> None:
    rows = db.query(Observation).filter(Observation.trace_id == trace.id).all()
    trace.total_input_tokens = sum(o.input_tokens or 0 for o in rows)
    trace.total_output_tokens = sum(o.output_tokens or 0 for o in rows)
    costs = [o.cost for o in rows if o.cost is not None]
    trace.total_cost = sum(costs) if costs else None


def ingest(db: Session, project_id: str, payload: IngestRequest) -> Trace:
    data = payload.trace
    trace = db.get(Trace, data.id)
    if trace is None:
        trace = Trace(id=data.id, project_id=project_id)
        db.add(trace)
    trace.project_id = project_id
    trace.name = data.name
    trace.origin = data.origin
    trace.status = data.status
    trace.input = data.input
    trace.output = data.output
    trace.meta = data.metadata
    trace.started_at = data.started_at
    trace.ended_at = data.ended_at
    trace.latency_ms = _latency_ms(data.started_at, data.ended_at)
    trace.prompt_version_id = data.prompt_version_id

    for ob_data in payload.observations:
        _apply_observation(db, trace.id, ob_data)

    db.flush()
    _recompute_aggregates(db, trace)
    db.commit()
    return trace
```

- [ ] **Step 5: 实现 routers/ingest.py 并挂载**

`backend/routers/__init__.py`：空文件。

`backend/routers/ingest.py`：

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Project
from schemas.ingest import IngestRequest
from services.auth import require_api_key
from services.ingest_service import ingest

router = APIRouter(tags=["ingest"])


@router.post("/ingest")
def ingest_endpoint(
    payload: IngestRequest,
    project: Project = Depends(require_api_key),
    db: Session = Depends(get_db),
):
    trace = ingest(db, project.id, payload)
    return {"trace_id": trace.id, "observation_count": len(payload.observations)}
```

`backend/main.py` 在 CORS 中间件之后追加：

```python
from routers import ingest as ingest_router

app.include_router(ingest_router.router, prefix="/api")
```

- [ ] **Step 6: 运行全部测试确认通过**

```bash
cd backend && .venv/bin/python -m pytest tests/ -v
```

Expected: 全部通过（13 个）

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add ingestion API with idempotent upsert and cost calculation"
```

---

### Task 5: Query API（项目/trace 列表/trace 详情树）

**Files:**
- Create: `backend/schemas/query.py`, `backend/routers/query.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_query.py`

**Interfaces:**
- Consumes: `models.entities.*`, `db.get_db`
- Produces（前端 lib/api.ts 依赖这些响应结构）:
  - `GET /api/projects` → `[{"id", "name"}]`
  - `GET /api/traces?project_id=&origin=&search=&limit=50&offset=0` → `{"items": [TraceSummary], "total": int}`；TraceSummary: `{id, name, origin, status, model_summary, observation_count, total_input_tokens, total_output_tokens, total_cost, latency_ms, started_at, created_at}`（`model_summary` 为该 trace 内去重的 llm 模型名逗号串）
  - `GET /api/traces/{trace_id}` → `{...trace 全字段, "observations": [ObservationNode]}`；ObservationNode 含全部 observation 字段 + `children: [ObservationNode]`（按 seq 排序的树）；404 当 trace 不存在

- [ ] **Step 1: 写失败测试**

`backend/tests/test_query.py`：

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
def seeded(db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
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
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && .venv/bin/python -m pytest tests/test_query.py -v
```

Expected: FAIL — 404（路由不存在）

- [ ] **Step 3: 实现 schemas/query.py**

`backend/schemas/query.py`：

```python
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str


class TraceSummary(BaseModel):
    id: str
    name: str
    origin: str
    status: str
    model_summary: str
    observation_count: int
    total_input_tokens: int
    total_output_tokens: int
    total_cost: float | None
    latency_ms: int | None
    started_at: datetime | None
    created_at: datetime


class TraceListOut(BaseModel):
    items: list[TraceSummary]
    total: int


class ObservationNode(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    parent_id: str | None
    type: str
    name: str
    seq: int
    status: str
    error: str | None
    started_at: datetime | None
    ended_at: datetime | None
    latency_ms: int | None
    model: str | None
    model_params: dict | None
    messages: list | None
    tool_definitions: list | None
    tool_calls: list | None
    completion: Any
    input_tokens: int | None
    output_tokens: int | None
    cost: float | None
    tool_input: Any
    tool_output: Any
    children: list["ObservationNode"] = []


class TraceDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    name: str
    origin: str
    status: str
    input: Any
    output: Any
    started_at: datetime | None
    ended_at: datetime | None
    latency_ms: int | None
    total_input_tokens: int
    total_output_tokens: int
    total_cost: float | None
    created_at: datetime
    observations: list[ObservationNode]
```

- [ ] **Step 4: 实现 routers/query.py 并挂载**

`backend/routers/query.py`：

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Observation, Project, Trace
from schemas.query import ObservationNode, ProjectOut, TraceDetail, TraceListOut, TraceSummary

router = APIRouter(tags=["query"])


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.created_at).all()


@router.get("/traces", response_model=TraceListOut)
def list_traces(
    project_id: str | None = None,
    origin: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(Trace)
    if project_id:
        q = q.filter(Trace.project_id == project_id)
    if origin:
        q = q.filter(Trace.origin == origin)
    if search:
        q = q.filter(Trace.name.ilike(f"%{search}%"))
    total = q.count()
    rows = q.order_by(Trace.created_at.desc()).offset(offset).limit(limit).all()

    items = []
    for t in rows:
        obs = t.observations
        models = sorted({o.model for o in obs if o.type == "llm" and o.model})
        items.append(TraceSummary(
            id=t.id, name=t.name, origin=t.origin, status=t.status,
            model_summary=", ".join(models), observation_count=len(obs),
            total_input_tokens=t.total_input_tokens,
            total_output_tokens=t.total_output_tokens,
            total_cost=t.total_cost, latency_ms=t.latency_ms,
            started_at=t.started_at, created_at=t.created_at,
        ))
    return TraceListOut(items=items, total=total)


def build_tree(observations: list[Observation]) -> list[ObservationNode]:
    nodes = {o.id: ObservationNode.model_validate(o) for o in observations}
    roots: list[ObservationNode] = []
    for o in sorted(observations, key=lambda x: x.seq):
        node = nodes[o.id]
        if o.parent_id and o.parent_id in nodes:
            nodes[o.parent_id].children.append(node)
        else:
            roots.append(node)
    return roots


@router.get("/traces/{trace_id}", response_model=TraceDetail)
def get_trace(trace_id: str, db: Session = Depends(get_db)):
    t = db.get(Trace, trace_id)
    if t is None:
        raise HTTPException(status_code=404, detail="trace not found")
    detail = TraceDetail.model_validate({
        **{c: getattr(t, c) for c in (
            "id", "project_id", "name", "origin", "status", "input", "output",
            "started_at", "ended_at", "latency_ms", "total_input_tokens",
            "total_output_tokens", "total_cost", "created_at")},
        "observations": build_tree(list(t.observations)),
    })
    return detail
```

`backend/main.py` 追加：

```python
from routers import query as query_router

app.include_router(query_router.router, prefix="/api")
```

- [ ] **Step 5: 运行全部测试确认通过**

```bash
cd backend && .venv/bin/python -m pytest tests/ -v
```

Expected: 全部通过（17 个）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add query API for projects, trace list and trace detail tree"
```

---

### Task 6: Python 上报示例 + 端到端集成测试

**Files:**
- Create: `examples/report_agent_run.py`
- Test: `backend/tests/test_e2e_ingest_query.py`

**Interfaces:**
- Consumes: `POST /api/ingest`, `GET /api/traces/{id}`
- Produces: `examples/report_agent_run.py`——团队接入的参考实现（环境变量 `PROMPTSCOPE_URL`、`PROMPTSCOPE_API_KEY`）

- [ ] **Step 1: 写端到端测试（复用 Task 4 的 client/api_key fixture 模式）**

`backend/tests/test_e2e_ingest_query.py`：

```python
import uuid

import pytest
from fastapi.testclient import TestClient

from db import get_db
from models.entities import ApiKey, ModelPricing, Project
from services.auth import generate_api_key


@pytest.fixture()
def client(db_session):
    from main import app

    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_full_agent_run_roundtrip(client, db_session):
    p = Project(name="demo")
    db_session.add(p)
    db_session.flush()
    raw, key_hash, prefix = generate_api_key()
    db_session.add(ApiKey(project_id=p.id, key_hash=key_hash, prefix=prefix))
    db_session.add(ModelPricing(model="gpt-4o", input_price_per_1k=0.005,
                                output_price_per_1k=0.015))
    db_session.commit()

    trace_id = uuid.uuid4().hex
    llm1, tool1, llm2 = (uuid.uuid4().hex for _ in range(3))
    payload = {
        "trace": {"id": trace_id, "name": "weather-agent",
                  "input": {"q": "北京天气"}, "output": {"a": "晴 32°C"},
                  "started_at": "2026-07-04T10:00:00Z",
                  "ended_at": "2026-07-04T10:00:05Z"},
        "observations": [
            {"id": llm1, "type": "llm", "name": "plan", "seq": 0, "model": "gpt-4o",
             "messages": [{"role": "system", "content": "you are a weather agent"},
                          {"role": "user", "content": "北京天气"}],
             "tool_definitions": [{"name": "get_weather",
                                   "parameters": {"city": "string"}}],
             "tool_calls": [{"name": "get_weather", "arguments": {"city": "北京"}}],
             "input_tokens": 120, "output_tokens": 30},
            {"id": tool1, "parent_id": llm1, "type": "tool", "name": "get_weather",
             "seq": 1, "tool_input": {"city": "北京"},
             "tool_output": {"weather": "晴", "temp": 32}},
            {"id": llm2, "type": "llm", "name": "answer", "seq": 2, "model": "gpt-4o",
             "messages": [{"role": "tool", "content": "{\"weather\": \"晴\"}"}],
             "completion": "晴 32°C", "input_tokens": 200, "output_tokens": 40},
        ],
    }
    resp = client.post("/api/ingest", json=payload,
                       headers={"Authorization": f"Bearer {raw}"})
    assert resp.status_code == 200

    detail = client.get(f"/api/traces/{trace_id}").json()
    assert detail["total_input_tokens"] == 320
    assert detail["total_cost"] == pytest.approx(320 / 1000 * 0.005 + 70 / 1000 * 0.015)
    assert len(detail["observations"]) == 2  # llm1(含 child tool) + llm2
    assert detail["observations"][0]["children"][0]["name"] == "get_weather"
```

- [ ] **Step 2: 运行确认通过（API 已就绪，此测试应直接通过）**

```bash
cd backend && .venv/bin/python -m pytest tests/test_e2e_ingest_query.py -v
```

Expected: 1 passed（若失败则修复 API 直至通过）

- [ ] **Step 3: 写上报示例脚本**

`examples/report_agent_run.py`：

```python
"""PromptScope 上报示例：模拟一次带工具调用的 agent 运行并上报。

用法：
  export PROMPTSCOPE_URL=http://localhost:8000
  export PROMPTSCOPE_API_KEY=ps-xxxx
  python examples/report_agent_run.py
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import httpx

BASE_URL = os.environ.get("PROMPTSCOPE_URL", "http://localhost:8000")
API_KEY = os.environ["PROMPTSCOPE_API_KEY"]


def iso(dt: datetime) -> str:
    return dt.isoformat()


def main() -> None:
    t0 = datetime.now(timezone.utc)
    trace_id = uuid.uuid4().hex
    llm_plan, tool_call, llm_answer = (uuid.uuid4().hex for _ in range(3))

    payload = {
        "trace": {
            "id": trace_id,
            "name": "weather-agent-demo",
            "input": {"question": "北京今天天气怎么样？"},
            "output": {"answer": "北京今天晴，32°C。"},
            "started_at": iso(t0),
            "ended_at": iso(t0 + timedelta(seconds=4)),
        },
        "observations": [
            {
                "id": llm_plan, "type": "llm", "name": "plan", "seq": 0,
                "model": "gpt-4o",
                "model_params": {"temperature": 0.2},
                "messages": [
                    {"role": "system", "content": "你是天气助手，可调用工具。"},
                    {"role": "user", "content": "北京今天天气怎么样？"},
                ],
                "tool_definitions": [{
                    "name": "get_weather",
                    "description": "查询城市天气",
                    "parameters": {"type": "object",
                                   "properties": {"city": {"type": "string"}}},
                }],
                "tool_calls": [{"name": "get_weather", "arguments": {"city": "北京"}}],
                "input_tokens": 150, "output_tokens": 25,
                "started_at": iso(t0), "ended_at": iso(t0 + timedelta(seconds=1)),
            },
            {
                "id": tool_call, "parent_id": llm_plan, "type": "tool",
                "name": "get_weather", "seq": 1,
                "tool_input": {"city": "北京"},
                "tool_output": {"weather": "晴", "temperature": 32},
                "started_at": iso(t0 + timedelta(seconds=1)),
                "ended_at": iso(t0 + timedelta(seconds=2)),
            },
            {
                "id": llm_answer, "type": "llm", "name": "answer", "seq": 2,
                "model": "gpt-4o",
                "messages": [
                    {"role": "system", "content": "你是天气助手。"},
                    {"role": "tool", "content": '{"weather": "晴", "temperature": 32}'},
                ],
                "completion": "北京今天晴，32°C。",
                "input_tokens": 220, "output_tokens": 35,
                "started_at": iso(t0 + timedelta(seconds=2)),
                "ended_at": iso(t0 + timedelta(seconds=4)),
            },
        ],
    }

    resp = httpx.post(f"{BASE_URL}/api/ingest", json=payload,
                      headers={"Authorization": f"Bearer {API_KEY}"}, timeout=10)
    resp.raise_for_status()
    print(f"reported trace {trace_id}: {resp.json()}")
    print(f"view it at {BASE_URL.replace('8000', '3000')}/traces/{trace_id}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 手动验证示例（启动服务 + 创建项目 + 上报）**

```bash
cd backend && (.venv/bin/uvicorn main:app --port 8000 &) && sleep 3
KEY=$(.venv/bin/python -m scripts.create_project demo | grep 'api key' | awk '{print $NF}')
cd .. && PROMPTSCOPE_API_KEY=$KEY backend/.venv/bin/python examples/report_agent_run.py
curl -s http://localhost:8000/api/traces | head -c 300
kill %1 2>/dev/null || pkill -f "uvicorn main:app"
```

Expected: `reported trace <id>` 且 curl 返回包含 `weather-agent-demo` 的 JSON

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add ingestion example script and e2e roundtrip test"
```

---

### Task 7: 前端地基（API client、项目上下文、顶栏布局）

**Files:**
- Create: `frontend/lib/format.ts`, `frontend/contexts/ProjectContext.tsx`, `frontend/components/TopBar.tsx`
- Modify: `frontend/lib/api.ts`（重写）, `frontend/app/layout.tsx`, `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `GET /api/projects`（Task 5）
- Produces:
  - `lib/api.ts`：类型 `Project, TraceSummary, TraceListResult, ObservationNode, TraceDetail` + 函数 `api.getProjects(): Promise<Project[]>`, `api.getTraces(params: {projectId?: string; origin?: string; search?: string; limit?: number; offset?: number}): Promise<TraceListResult>`, `api.getTrace(id: string): Promise<TraceDetail>`
  - `lib/format.ts`：`formatCost(v: number | null): string`（`$0.001234`，null → `—`）、`formatLatency(ms: number | null): string`（`1.2s` / `230ms`，null → `—`）、`formatTokens(n: number): string`（`1.2k` 缩写）
  - `contexts/ProjectContext.tsx`：`ProjectProvider`、`useProject(): {projects, currentProject, setCurrentProject}`（选择持久化到 localStorage `promptscope.projectId`）
  - `components/TopBar.tsx`：logo + 项目切换下拉

- [ ] **Step 1: 重写 lib/api.ts**

```typescript
export const API_BASE = "";

export interface Project {
  id: string;
  name: string;
}

export interface TraceSummary {
  id: string;
  name: string;
  origin: "live" | "replay";
  status: string;
  model_summary: string;
  observation_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number | null;
  latency_ms: number | null;
  started_at: string | null;
  created_at: string;
}

export interface TraceListResult {
  items: TraceSummary[];
  total: number;
}

export interface ObservationNode {
  id: string;
  parent_id: string | null;
  type: "llm" | "tool" | "span";
  name: string;
  seq: number;
  status: string;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
  latency_ms: number | null;
  model: string | null;
  model_params: Record<string, unknown> | null;
  messages: Array<Record<string, unknown>> | null;
  tool_definitions: Array<Record<string, unknown>> | null;
  tool_calls: Array<Record<string, unknown>> | null;
  completion: unknown;
  input_tokens: number | null;
  output_tokens: number | null;
  cost: number | null;
  tool_input: unknown;
  tool_output: unknown;
  children: ObservationNode[];
}

export interface TraceDetail {
  id: string;
  project_id: string;
  name: string;
  origin: "live" | "replay";
  status: string;
  input: unknown;
  output: unknown;
  started_at: string | null;
  ended_at: string | null;
  latency_ms: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number | null;
  created_at: string;
  observations: ObservationNode[];
}

async function get<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) throw new Error(`GET ${path} failed: ${resp.status}`);
  return resp.json();
}

export const api = {
  getProjects: () => get<Project[]>("/api/projects"),
  getTraces: (params: {
    projectId?: string;
    origin?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params.projectId) q.set("project_id", params.projectId);
    if (params.origin) q.set("origin", params.origin);
    if (params.search) q.set("search", params.search);
    q.set("limit", String(params.limit ?? 50));
    q.set("offset", String(params.offset ?? 0));
    return get<TraceListResult>(`/api/traces?${q.toString()}`);
  },
  getTrace: (id: string) => get<TraceDetail>(`/api/traces/${id}`),
};
```

- [ ] **Step 2: 写 lib/format.ts**

```typescript
export function formatCost(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `$${v.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0")}`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
```

- [ ] **Step 3: 写 ProjectContext 与 TopBar**

`frontend/contexts/ProjectContext.tsx`：

```tsx
"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { api, Project } from "@/lib/api";

interface ProjectCtx {
  projects: Project[];
  currentProject: Project | null;
  setCurrentProject: (p: Project) => void;
}

const Ctx = createContext<ProjectCtx>({
  projects: [],
  currentProject: null,
  setCurrentProject: () => {},
});

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrent] = useState<Project | null>(null);

  useEffect(() => {
    api.getProjects().then((list) => {
      setProjects(list);
      const savedId = localStorage.getItem("promptscope.projectId");
      setCurrent(list.find((p) => p.id === savedId) ?? list[0] ?? null);
    }).catch(() => setProjects([]));
  }, []);

  const setCurrentProject = (p: Project) => {
    setCurrent(p);
    localStorage.setItem("promptscope.projectId", p.id);
  };

  return (
    <Ctx.Provider value={{ projects, currentProject, setCurrentProject }}>
      {children}
    </Ctx.Provider>
  );
}

export const useProject = () => useContext(Ctx);
```

`frontend/components/TopBar.tsx`：

```tsx
"use client";
import Link from "next/link";
import { useProject } from "@/contexts/ProjectContext";

export function TopBar() {
  const { projects, currentProject, setCurrentProject } = useProject();

  return (
    <header className="bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-6">
        <Link href="/traces" className="text-lg font-bold text-[#1F2937]">
          PromptScope
        </Link>
        <nav className="flex items-center gap-4 text-sm text-gray-600">
          <Link href="/traces" className="hover:text-[#6366F1]">Traces</Link>
        </nav>
      </div>
      <select
        className="text-sm border border-[#E5E7EB] rounded-md px-2 py-1 bg-white"
        value={currentProject?.id ?? ""}
        onChange={(e) => {
          const p = projects.find((x) => x.id === e.target.value);
          if (p) setCurrentProject(p);
        }}
      >
        {projects.length === 0 && <option value="">无项目</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </header>
  );
}
```

- [ ] **Step 4: 更新 layout.tsx 与首页重定向**

`frontend/app/layout.tsx`：

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = {
  title: "PromptScope",
  description: "Agent 调优与回放平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-[#F9FAFB] text-[#1F2937] h-screen flex flex-col">
        <ProjectProvider>
          <TopBar />
          <div className="flex-1 overflow-y-auto">{children}</div>
        </ProjectProvider>
      </body>
    </html>
  );
}
```

`frontend/app/page.tsx`：

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/traces");
}
```

注意：`/traces` 页面在 Task 8 才创建，本任务结束时首页 404 是预期的。

- [ ] **Step 5: 验证构建**

```bash
cd frontend && npm run build
```

Expected: 构建成功

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add frontend foundation with typed API client and project context"
```

---

### Task 8: Trace 列表页

**Files:**
- Create: `frontend/app/traces/page.tsx`, `frontend/components/TraceTable.tsx`

**Interfaces:**
- Consumes: `api.getTraces`, `useProject`, `lib/format.ts`（Task 7 定义的签名）
- Produces: `/traces` 页面——时间倒序表格、origin 筛选（全部/live/replay）、名称搜索、行点击跳详情

- [ ] **Step 1: 写 TraceTable 组件**

`frontend/components/TraceTable.tsx`：

```tsx
"use client";
import { useRouter } from "next/navigation";
import { TraceSummary } from "@/lib/api";
import { formatCost, formatLatency, formatTokens } from "@/lib/format";

export function TraceTable({ traces }: { traces: TraceSummary[] }) {
  const router = useRouter();

  if (traces.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-gray-400">
        暂无 trace 数据 — 用 examples/report_agent_run.py 上报一条试试
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-400 uppercase tracking-wider border-b border-[#E5E7EB]">
          <th className="px-4 py-2">名称</th>
          <th className="px-4 py-2">来源</th>
          <th className="px-4 py-2">模型</th>
          <th className="px-4 py-2">步数</th>
          <th className="px-4 py-2">Tokens (in/out)</th>
          <th className="px-4 py-2">成本</th>
          <th className="px-4 py-2">延迟</th>
          <th className="px-4 py-2">时间</th>
        </tr>
      </thead>
      <tbody>
        {traces.map((t) => (
          <tr
            key={t.id}
            onClick={() => router.push(`/traces/${t.id}`)}
            className="border-b border-[#F3F4F6] hover:bg-[#F5F6FF] cursor-pointer"
          >
            <td className="px-4 py-3 font-medium">{t.name || t.id.slice(0, 8)}</td>
            <td className="px-4 py-3">
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  t.origin === "replay"
                    ? "bg-purple-100 text-purple-700"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {t.origin}
              </span>
            </td>
            <td className="px-4 py-3 text-gray-600">{t.model_summary || "—"}</td>
            <td className="px-4 py-3">{t.observation_count}</td>
            <td className="px-4 py-3 text-gray-600">
              {formatTokens(t.total_input_tokens)} / {formatTokens(t.total_output_tokens)}
            </td>
            <td className="px-4 py-3 font-mono">{formatCost(t.total_cost)}</td>
            <td className="px-4 py-3">{formatLatency(t.latency_ms)}</td>
            <td className="px-4 py-3 text-gray-400 text-xs">
              {new Date(t.created_at).toLocaleString("zh-CN")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: 写列表页**

`frontend/app/traces/page.tsx`：

```tsx
"use client";
import { useEffect, useState } from "react";
import { api, TraceSummary } from "@/lib/api";
import { useProject } from "@/contexts/ProjectContext";
import { TraceTable } from "@/components/TraceTable";

const ORIGINS = [
  { value: "", label: "全部" },
  { value: "live", label: "Live" },
  { value: "replay", label: "回放" },
];

export default function TracesPage() {
  const { currentProject } = useProject();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [origin, setOrigin] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentProject) return;
    setLoading(true);
    setError(null);
    api
      .getTraces({ projectId: currentProject.id, origin: origin || undefined, search: search || undefined })
      .then((r) => {
        setTraces(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [currentProject, origin, search]);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">
          Traces <span className="text-gray-400 font-normal">({total})</span>
        </h2>
        <div className="flex items-center gap-2">
          <input
            className="text-sm border border-[#E5E7EB] rounded-md px-3 py-1.5 w-56"
            placeholder="按名称搜索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex rounded-md border border-[#E5E7EB] overflow-hidden">
            {ORIGINS.map((o) => (
              <button
                key={o.value}
                onClick={() => setOrigin(o.value)}
                className={`text-xs px-3 py-1.5 ${
                  origin === o.value ? "bg-[#6366F1] text-white" : "bg-white text-gray-600"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-x-auto">
        {error ? (
          <div className="p-8 text-sm text-red-500">加载失败：{error}</div>
        ) : loading ? (
          <div className="p-8 text-sm text-gray-400">加载中…</div>
        ) : (
          <TraceTable traces={traces} />
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: 验证构建**

```bash
cd frontend && npm run build
```

Expected: 构建成功，`/traces` 出现在路由列表

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add trace list page with origin filter and search"
```

---

### Task 9: Trace 详情页（链路树可视化）+ vitest

**Files:**
- Create: `frontend/app/traces/[id]/page.tsx`, `frontend/components/TraceTree.tsx`, `frontend/components/ObservationDetail.tsx`, `frontend/vitest.config.ts`, `frontend/components/__tests__/TraceTree.test.tsx`
- Modify: `frontend/package.json`（scripts + devDependencies）

**Interfaces:**
- Consumes: `api.getTrace`, `ObservationNode` 类型, `lib/format.ts`
- Produces:
  - `/traces/[id]` 页面：头部摘要（名称/origin/status/总 token/总成本/总延迟）+ 左侧链路树 + 右侧选中节点详情
  - `TraceTree({nodes, selectedId, onSelect})`：递归渲染树，节点行显示类型徽章（llm 紫/tool 绿/span 灰）、名称、单步成本与延迟
  - `ObservationDetail({node})`：按类型展示——llm：messages 逐条渲染 + completion + model_params + tokens/cost；tool：tool_input/tool_output JSON 块；span：基础信息；error 红色高亮

- [ ] **Step 1: 安装 vitest 并配置**

```bash
cd frontend && npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

`frontend/vitest.config.ts`：

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

`frontend/package.json` 的 scripts 增加：`"test": "vitest run"`

- [ ] **Step 2: 写失败测试**

`frontend/components/__tests__/TraceTree.test.tsx`：

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TraceTree } from "../TraceTree";
import type { ObservationNode } from "@/lib/api";

const node = (over: Partial<ObservationNode>): ObservationNode => ({
  id: "x", parent_id: null, type: "span", name: "", seq: 0, status: "success",
  error: null, started_at: null, ended_at: null, latency_ms: null, model: null,
  model_params: null, messages: null, tool_definitions: null, tool_calls: null,
  completion: null, input_tokens: null, output_tokens: null, cost: null,
  tool_input: null, tool_output: null, children: [], ...over,
});

const tree: ObservationNode[] = [
  node({
    id: "llm-1", type: "llm", name: "plan", model: "gpt-4o", cost: 0.001,
    latency_ms: 900,
    children: [
      node({ id: "tool-1", type: "tool", name: "search", latency_ms: 120 }),
    ],
  }),
];

describe("TraceTree", () => {
  it("renders nested nodes with type badges", () => {
    render(<TraceTree nodes={tree} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText("plan")).toBeDefined();
    expect(screen.getByText("search")).toBeDefined();
    expect(screen.getByText("llm")).toBeDefined();
    expect(screen.getByText("tool")).toBeDefined();
  });

  it("fires onSelect with node id when clicked", () => {
    const onSelect = vi.fn();
    render(<TraceTree nodes={tree} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("search"));
    expect(onSelect).toHaveBeenCalledWith("tool-1");
  });
});
```

- [ ] **Step 3: 运行确认失败**

```bash
cd frontend && npx vitest run
```

Expected: FAIL — Cannot find module '../TraceTree'

- [ ] **Step 4: 实现 TraceTree.tsx**

```tsx
"use client";
import { ObservationNode } from "@/lib/api";
import { formatCost, formatLatency } from "@/lib/format";

const TYPE_STYLES: Record<string, string> = {
  llm: "bg-purple-100 text-purple-700",
  tool: "bg-emerald-100 text-emerald-700",
  span: "bg-gray-100 text-gray-600",
};

function TreeNode({
  node, depth, selectedId, onSelect,
}: {
  node: ObservationNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        className={`flex items-center gap-2 py-1.5 pr-2 rounded cursor-pointer text-sm ${
          selectedId === node.id ? "bg-[#EEF0FF]" : "hover:bg-gray-50"
        } ${node.status === "error" ? "text-red-600" : ""}`}
      >
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_STYLES[node.type]}`}>
          {node.type}
        </span>
        <span className="font-medium truncate">{node.name || node.id.slice(0, 8)}</span>
        {node.model && <span className="text-xs text-gray-400">{node.model}</span>}
        <span className="ml-auto flex items-center gap-2 text-xs text-gray-400 font-mono shrink-0">
          {node.cost !== null && <span>{formatCost(node.cost)}</span>}
          {node.latency_ms !== null && <span>{formatLatency(node.latency_ms)}</span>}
        </span>
      </div>
      {node.children.map((c) => (
        <TreeNode key={c.id} node={c} depth={depth + 1}
                  selectedId={selectedId} onSelect={onSelect} />
      ))}
    </>
  );
}

export function TraceTree({
  nodes, selectedId, onSelect,
}: {
  nodes: ObservationNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="py-1">
      {nodes.map((n) => (
        <TreeNode key={n.id} node={n} depth={0}
                  selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd frontend && npx vitest run
```

Expected: 2 passed

- [ ] **Step 6: 实现 ObservationDetail.tsx**

```tsx
"use client";
import { ObservationNode } from "@/lib/api";
import { formatCost, formatLatency, formatTokens } from "@/lib/format";

function Json({ value }: { value: unknown }) {
  return (
    <pre className="text-xs bg-gray-50 border border-[#E5E7EB] rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{title}</p>
      {children}
    </div>
  );
}

export function ObservationDetail({ node }: { node: ObservationNode }) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4 text-sm">
        <span className="font-semibold">{node.name || node.id.slice(0, 8)}</span>
        <span className="text-xs text-gray-400">{node.type}</span>
        {node.model && <span className="text-xs text-gray-500">{node.model}</span>}
        <span className="ml-auto text-xs text-gray-400 font-mono">
          {formatTokens(node.input_tokens)} / {formatTokens(node.output_tokens)} tokens
          · {formatCost(node.cost)} · {formatLatency(node.latency_ms)}
        </span>
      </div>

      {node.error && (
        <Section title="错误">
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
            {node.error}
          </div>
        </Section>
      )}

      {node.type === "llm" && (
        <>
          {node.model_params && Object.keys(node.model_params).length > 0 && (
            <Section title="模型参数"><Json value={node.model_params} /></Section>
          )}
          {node.messages && (
            <Section title="Messages">
              <div className="space-y-2">
                {node.messages.map((m, i) => (
                  <div key={i} className="border border-[#E5E7EB] rounded p-2">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">
                      {String((m as Record<string, unknown>).role ?? "?")}
                    </p>
                    <p className="text-sm whitespace-pre-wrap break-all">
                      {String((m as Record<string, unknown>).content ?? "")}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {node.tool_calls && node.tool_calls.length > 0 && (
            <Section title="模型发起的工具调用"><Json value={node.tool_calls} /></Section>
          )}
          {node.completion !== null && node.completion !== undefined && (
            <Section title="输出"><Json value={node.completion} /></Section>
          )}
        </>
      )}

      {node.type === "tool" && (
        <>
          <Section title="入参"><Json value={node.tool_input} /></Section>
          {node.tool_output !== null && node.tool_output !== undefined && (
            <Section title="返回结果"><Json value={node.tool_output} /></Section>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 7: 实现详情页**

`frontend/app/traces/[id]/page.tsx`：

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ObservationNode, TraceDetail } from "@/lib/api";
import { formatCost, formatLatency, formatTokens } from "@/lib/format";
import { TraceTree } from "@/components/TraceTree";
import { ObservationDetail } from "@/components/ObservationDetail";

function flatten(nodes: ObservationNode[]): ObservationNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

export default function TraceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    api.getTrace(id)
      .then((t) => {
        setTrace(t);
        setSelectedId(t.observations[0]?.id ?? null);
      })
      .catch((e) => setError(String(e)));
  }, [id]);

  const selected = useMemo(() => {
    if (!trace || !selectedId) return null;
    return flatten(trace.observations).find((n) => n.id === selectedId) ?? null;
  }, [trace, selectedId]);

  if (error) return <main className="p-8 text-sm text-red-500">加载失败：{error}</main>;
  if (!trace) return <main className="p-8 text-sm text-gray-400">加载中…</main>;

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="mb-4">
        <Link href="/traces" className="text-xs text-[#6366F1]">← 返回列表</Link>
        <div className="flex items-center gap-3 mt-2">
          <h2 className="text-base font-semibold">{trace.name || trace.id.slice(0, 8)}</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            trace.origin === "replay" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
          }`}>{trace.origin}</span>
          {trace.status === "error" && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">error</span>
          )}
          <span className="ml-auto text-xs text-gray-500 font-mono">
            {formatTokens(trace.total_input_tokens)} / {formatTokens(trace.total_output_tokens)} tokens
            · {formatCost(trace.total_cost)} · {formatLatency(trace.latency_ms)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(280px,2fr)_3fr] gap-4">
        <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-y-auto max-h-[70vh]">
          <div className="px-3 py-2 border-b border-[#F3F4F6]">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">调用链路</p>
          </div>
          <TraceTree nodes={trace.observations} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-y-auto max-h-[70vh]">
          {selected ? (
            <ObservationDetail node={selected} />
          ) : (
            <div className="p-8 text-sm text-gray-400">点击左侧节点查看详情</div>
          )}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 8: 验证构建 + 测试**

```bash
cd frontend && npm run build && npx vitest run
```

Expected: 构建成功，2 测试通过

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add trace detail page with call-chain tree visualization"
```

---

### Task 10: Docker/Postgres、README、收尾全量验证

**Files:**
- Modify: `docker-compose.yml`, `README.md`, `backend/.env.example`
- Verify: 全部测试 + 前后端启动 + 手动动线

**Interfaces:**
- Consumes: 前面全部任务
- Produces: 可部署的 Phase 1 平台

- [ ] **Step 1: 更新 docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: promptscope
      POSTGRES_PASSWORD: promptscope
      POSTGRES_DB: promptscope
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5433:5432"

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql+psycopg://promptscope:promptscope@postgres:5432/promptscope
    depends_on:
      - postgres

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      API_PROXY_HOST: http://backend:8000
    depends_on:
      - backend

volumes:
  pgdata:
```

- [ ] **Step 2: 更新 backend/.env.example**

```
# 数据库连接；本地开发默认 SQLite，团队部署用 Postgres
# DATABASE_URL=postgresql+psycopg://promptscope:promptscope@localhost:5433/promptscope
```

- [ ] **Step 3: 重写 README.md**

内容要点（用实际命令写全）：项目定位一段话（Agent 调优与回放平台，四层能力）、快速开始（创建项目拿 key → 启动前后端 → 跑 example 上报 → 浏览器看链路）、ingestion API 的 payload 说明（trace/observations 字段表、llm/tool 必填字段）、架构图（spec §2 的 ASCII 图）、Roadmap（Phase 2 对比评分 / Phase 3 回放 / Phase 4 打磨）。

- [ ] **Step 4: 全量验证**

```bash
cd backend && .venv/bin/python -m pytest tests/ -v
cd ../frontend && npm run build && npx vitest run && npm run lint
```

Expected: 后端 18 个测试全过；前端构建、测试、lint 全过

- [ ] **Step 5: 手动动线验证（本地 SQLite 模式）**

```bash
cd backend && (.venv/bin/uvicorn main:app --port 8000 &) && sleep 3
KEY=$(.venv/bin/python -m scripts.create_project demo | grep 'api key' | awk '{print $NF}')
cd .. && PROMPTSCOPE_API_KEY=$KEY backend/.venv/bin/python examples/report_agent_run.py
cd frontend && (npm run dev &) && sleep 8
curl -s http://localhost:3000/traces | grep -o "PromptScope" | head -1
```

Expected: 上报成功；`/traces` 页面 HTML 包含 PromptScope。验证后杀掉两个后台进程。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Postgres docker-compose and rewrite README for platform repositioning"
```

---

## Phase 2-4 说明

本计划仅覆盖 Phase 1（数据地基）。Phase 2（对比与评分）、Phase 3（回放引擎）、Phase 4（打磨扩展）在 Phase 1 完成并验证后各自单独成计划，复用本计划建立的实体模型与接口约定：

- Phase 2 依赖：`Trace/Observation/Evaluation/ModelProvider/ModelPricing` 表、`GET /api/traces/{id}` 的 ObservationNode 树结构
- Phase 3 依赖：`ReplayRun` 表、`ingest_service.ingest()`（落回放 trace）、`compute_cost()`
- Phase 4 依赖：`Prompt/PromptVersion` 表
