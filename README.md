# PromptScope

团队内部的 **Agent 调优与回放平台**：自建数据接入，以完整调用链路为核心，围绕 Agent 运行数据支撑对比评分与"重跑回放"，帮助团队在多模型/多 Prompt 方案之间做出低成本、可验证的替代决策。平台分四层能力：**数据接入**（通用 ingestion HTTP API，Agent 直接上报完整 trace）、**链路可视化**（Phase 1，已支持）、**对比 + 评分**（Phase 2 roadmap）、**重跑回放**（Phase 3 roadmap，核心差异化价值）。

当前仓库处于 **Phase 1 —— 数据地基**：Postgres/SQLite 数据模型、ingestion API、Python 上报示例、trace 列表与详情页（链路可视化）。

## 架构

```
Agent (用户代码)
   │  HTTP 上报 (ingestion API, API Key 认证)
   ▼
PromptScope Backend (FastAPI + Postgres)
   ├── Ingestion API      ← 接收 trace/observation
   ├── Query API          ← 前端读取
   ├── Replay Engine      ← 调各家模型 API + mock 工具（Phase 3）
   └── Judge Service      ← 多模型评分（Phase 2）
   ▲
   │
PromptScope Frontend (Next.js)
```

## 技术栈

- **前端**：Next.js 14 + TypeScript + TailwindCSS
- **后端**：FastAPI + SQLAlchemy，本地开发默认 SQLite，团队部署用 Postgres
- **部署**：Docker Compose（Postgres 16 + backend + frontend）

## 快速开始

### 本地开发

**1. 启动后端并创建项目拿 API Key：**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

另开一个终端，为项目签发 API Key（本地默认使用 SQLite，无需额外配置）：

```bash
cd backend
python -m scripts.create_project demo
# 输出:
# project: demo (<project_id>)
# api key (save it now, shown only once): ps-xxxxxxxx...
```

**2. 启动前端：**

```bash
cd frontend
npm install
npm run dev
```

**3. 跑示例脚本上报一次带工具调用的 Agent 运行：**

```bash
export PROMPTSCOPE_URL=http://localhost:8000
export PROMPTSCOPE_API_KEY=ps-xxxxxxxx...   # 上一步拿到的 key
python examples/report_agent_run.py
```

**4. 浏览器打开** `http://localhost:3000/traces` **查看链路**，点进具体 trace 可看调用链树（LLM 调用 / 工具调用 / 每步耗时）。

### Docker 部署

```bash
docker-compose up -d
```

会启动 Postgres 16（映射到宿主机 `5433` 端口，避免与本地已有 Postgres 冲突）、backend（`8000`）、frontend（`3000`）。首次启动后，进入 backend 容器执行 `create_project` 脚本签发 API Key：

```bash
docker-compose exec backend python -m scripts.create_project demo
```

## Ingestion API

### 认证

`POST /api/ingest` 使用 Bearer Token 认证，Token 即 `create_project` 脚本签发的 API Key：

```
Authorization: Bearer ps-xxxxxxxx...
```

Key 无效或已吊销返回 `401`。

### Payload 结构

请求体为 `{ "trace": {...}, "observations": [...] }`，`trace.id` 与每个 `observations[].id` 由客户端生成，重复上报按 id 幂等 upsert。

**trace 字段：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 客户端生成，≤64 字符 |
| `name` | string | 否 | 默认空字符串 |
| `origin` | `"live"` \| `"replay"` | 否 | 默认 `live` |
| `status` | `"running"` \| `"success"` \| `"error"` | 否 | 默认 `success` |
| `input` / `output` | any | 否 | 整体输入输出 |
| `metadata` | object | 否 | |
| `started_at` / `ended_at` | datetime | 否 | ISO 格式 |
| `prompt_version_id` | string | 否 | |

**observations 字段（数组，每个节点一条）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 客户端生成，≤64 字符 |
| `parent_id` | string | 否 | 构成调用链树 |
| `type` | `"llm"` \| `"tool"` \| `"span"` | 是 | |
| `name` | string | 否 | |
| `seq` | int | 否 | 排序用，默认 0 |
| `status` | `"success"` \| `"error"` | 否 | 默认 `success` |
| `error` | string | 否 | |
| `started_at` / `ended_at` | datetime | 否 | |
| `metadata` | object | 否 | |

`type` 为 `llm` 时额外必填 `messages`（完整消息序列）与 `model`；其余 LLM 相关字段（`model_params`、`tool_definitions`、`tool_calls`、`completion`、`input_tokens`、`output_tokens`、`prompt_version_id`）可选。

`type` 为 `tool` 时额外必填 `tool_input`，以及 `tool_output` 或 `error` 二者至少其一。

不满足以上必填规则返回 `422`。

### 示例

参见 `examples/report_agent_run.py`，模拟一次"规划 → 调用 get_weather 工具 → 综合回答"的 Agent 运行并上报，可直接运行验证联通性。

## 查询 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/projects` | GET | 项目列表 |
| `/api/traces` | GET | Trace 列表，支持 `project_id` / `origin` / `search` 过滤及 `limit` / `offset` 分页 |
| `/api/traces/{id}` | GET | Trace 详情，含按 `parent_id` 组装的调用链树 |
| `/api/ingest` | POST | 上报 trace + observations（见上） |
| `/api/health` | GET | 健康检查 |

## 项目结构

```
promptscope/
├── backend/
│   ├── main.py
│   ├── config.py         # DATABASE_URL 等配置
│   ├── db.py             # SQLAlchemy engine/session
│   ├── models/entities.py
│   ├── schemas/          # ingest.py / query.py
│   ├── services/         # auth / ingest_service / cost 计算
│   ├── routers/          # ingest.py / query.py
│   └── scripts/create_project.py
├── frontend/
│   └── app/traces/       # trace 列表与详情页
├── examples/report_agent_run.py
└── docker-compose.yml
```

## Roadmap

- **Phase 2 — 对比与评分**：双链路对齐 + 差异高亮 + 成本汇总的对比工作台；多模型 LLM Judge；`model_providers` 配置页。
- **Phase 3 — 回放引擎**：对源 trace 换模型/改参数/改 Prompt 重跑，工具调用不真实执行、用录制结果 mock 回放，并做参数级偏离（divergence）验证；回放结果自动进对比。
- **Phase 4 — 打磨扩展**：Prompt 版本管理页完善、多阶段 trace 单点回放、Python SDK 封装、批量回放/批量评测。

## License

MIT
