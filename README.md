# PromptScope

团队内部的 **Agent 调优与回放平台**：自建数据接入，以完整调用链路为核心，围绕 Agent 运行数据支撑对比评分与"重跑回放"，帮助团队在多模型/多 Prompt 方案之间做出低成本、可验证的替代决策。平台分四层能力：**数据接入**（通用 ingestion HTTP API，Agent 直接上报完整 trace）、**链路可视化**（Phase 1，已支持）、**对比 + 评分**（Phase 2，已支持）、**重跑回放**（Phase 3 roadmap，核心差异化价值）。

当前仓库已完成 **Phase 1 —— 数据地基** 与 **Phase 2 —— 对比与评分**：Postgres/SQLite 数据模型、ingestion API、Python 上报示例、trace 列表与详情页（链路可视化）、双链路对齐对比工作台、多模型 LLM Judge、模型 Provider/定价配置页。

## 架构

```
Agent (用户代码)
   │  HTTP 上报 (ingestion API, API Key 认证)
   ▼
PromptScope Backend (FastAPI + Postgres)
   ├── Ingestion API      ← 接收 trace/observation
   ├── Query API          ← 前端读取
   ├── Config API         ← model_providers / model_pricings（Phase 2，已支持）
   ├── Judge Service      ← 多模型评分（Phase 2，已支持）
   └── Replay Engine      ← 调各家模型 API + mock 工具（Phase 3）
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

## 对比与评分

Phase 2 在链路可视化之上增加了「两条 trace 对比 + LLM Judge 打分」的完整闭环。

### /compare 使用动线

1. 打开 `/traces` 列表，勾选任意两条 trace（复选框最多同时选中 2 条，超出后自动顶掉最早选中的一条）。
2. 列表上方出现「对比选中项 (2)」按钮，点击跳转到 `/compare?a=<id>&b=<id>`；也可以直接手工拼这个 URL。若只带 `a` 参数，页面会展示一个下拉框，从当前项目的 trace 里选第二条（`b`）。
3. 页面顶部是成本 / 延迟 / 输入 token 的汇总对比（`Summary` 组件，按 `(b-a)/a` 算百分比涨跌，`formatCost`/`formatLatency` 复用查询 API 的字段）。
4. 主体是双链路对齐视图（`AlignedTraceView` + `frontend/lib/align.ts`）：把两条 trace 的 observation 树各自摊平成序列，按 `(type, name)` 组成的 key 做经典 LCS 动态规划对齐，得到逐行的 `{left, right, status, paramDiff}`——`status` 为 `matched`（两边都有，按序对齐）/`only_left`/`only_right`（仅一边有该步骤），`matched` 且都是 `tool` 类型时额外比较 `tool_input` 是否一致标出 `paramDiff`。
5. 视图下方是 `JudgePanel`（评分面板），可勾选一个或多个已配置的 judge 模型跑评分，结果实时展示。

### Judge 配置步骤

1. 打开 `/settings`，在「模型 Provider」区块新增一个 provider：名称、Base URL（如 `https://api.openai.com/v1`）、API Key、类型（`openai` 兼容 或 `anthropic`）。Key 只在创建/更新时写入，列表里只显示是否「已配置」，不回显明文。
2. 在「模型定价」区块新增一条定价记录：模型名（如 `gpt-4o-mini`）、每 1K tokens 的 input/output 单价（美元）、关联到上一步创建的 provider。**只有关联了 provider 的定价记录才会出现在 judge 模型下拉里**（`GET /api/judge-models` 内部用 `model_pricings` INNER JOIN `model_providers`，未关联 provider 的定价不会返回）。
3. 回到 `/compare` 页面，`JudgePanel` 会拉取 `/api/judge-models` 列出可勾选的模型；若列表为空会提示「没有可用的 judge 模型——先到 Settings 配置 provider 并在定价表中关联模型」。勾选后点「运行 Judge」即调用 `POST /api/evaluations`。
4. Judge 调用失败（网络错误、假 key、供应商返回非 2xx、输出无法解析出 JSON 等）不会伪造评分或返回 500，而是在该 judge_model 对应的结果项里如实标记 `status: "error"` 并带上错误详情，不写入数据库；面板会在对应模型下方红色提示这条错误。

### API 端点表

**`backend/routers/config.py`**（挂载于 `/api`，对照 `backend/schemas/config.py`）：

| 端点 | 方法 | 说明 | 请求体字段 | 响应字段 |
|------|------|------|------------|----------|
| `/api/providers` | GET | Provider 列表 | — | `id, name, base_url, provider_type, api_key_set(bool), created_at` |
| `/api/providers` | POST | 创建 provider（name 唯一，重复 409） | `name, base_url, api_key?, provider_type("openai"\|"anthropic", 默认 openai)` | 同上 |
| `/api/providers/{id}` | PUT | 更新 provider（`api_key` 为空则保留原值） | 同 POST | 同上 |
| `/api/providers/{id}` | DELETE | 删除 provider（关联的定价记录 `provider_id` 置空，不级联删除） | — | `{deleted: true}` |
| `/api/pricing` | GET | 定价列表（按 model 排序） | — | `id, model, input_price_per_1k, output_price_per_1k, provider_id` |
| `/api/pricing` | POST | 创建定价（model 唯一，重复 409） | `model, input_price_per_1k(≥0), output_price_per_1k(≥0), provider_id?` | 同上 |
| `/api/pricing/{id}` | PUT | 更新定价 | 同 POST | 同上 |
| `/api/pricing/{id}` | DELETE | 删除定价 | — | `{deleted: true}` |
| `/api/judge-models` | GET | 可用 judge 模型（定价与 provider 的内连接，未关联 provider 的定价不出现） | — | `model, provider_name` |

**`backend/routers/evaluations.py`**（对照 `backend/schemas/evaluations.py`）：

| 端点 | 方法 | 说明 | 请求体字段 | 响应字段 |
|------|------|------|------------|----------|
| `/api/evaluations` | POST | 对一或多个 judge 模型跑评分，单个模型失败不影响其余模型 | `subject_trace_id, compare_trace_id?, judge_models(list[str], ≥1), context_mode("output_only"\|"with_trace", 默认 output_only), force(bool, 默认 false)` | `{results: [{judge_model, status("ok"\|"error"), evaluation?, error?}]}` |
| `/api/evaluations` | GET | 按 `subject_trace_id` + `compare_trace_id` 查已跑过的评分记录（按创建时间倒序） | query: `subject_trace_id, compare_trace_id?` | `EvaluationOut[]`：`id, subject_trace_id, compare_trace_id, judge_model, context_mode, score, score_b, verdict, reasoning, cost, created_at` |

补充说明：
- `force=false`（默认）时，若已有相同 `(subject_trace_id, compare_trace_id, judge_model, context_mode)` 的评分记录，直接复用缓存，不重新调用模型。
- 单 trace 评分（不传 `compare_trace_id`）时响应里 `score` 为该 trace 的打分、`score_b` 为 `null`，`verdict` 取值 `pass`/`fail`；双 trace 对比评分时 `score` 为 A（`subject`）侧打分、`score_b` 为 B（`compare`）侧打分，`verdict` 取值 `replaceable`/`not_replaceable`。
- `cost` 由 judge 调用的输入/输出 token 数结合 `model_pricings` 表计算得出（复用 `services/ingest_service.compute_cost`）。

## 项目结构

```
promptscope/
├── backend/
│   ├── main.py
│   ├── config.py         # DATABASE_URL 等配置
│   ├── db.py             # SQLAlchemy engine/session
│   ├── models/entities.py
│   ├── schemas/          # ingest.py / query.py / config.py / evaluations.py
│   ├── services/         # auth / ingest_service / llm_client / judge_service
│   ├── routers/          # ingest.py / query.py / config.py / evaluations.py
│   └── scripts/create_project.py
├── frontend/
│   ├── app/traces/       # trace 列表与详情页
│   ├── app/compare/      # 双链路对齐对比工作台
│   ├── app/settings/     # provider / 定价配置页
│   └── lib/align.ts      # LCS trace 对齐算法
├── examples/report_agent_run.py
└── docker-compose.yml
```

## Roadmap

- **Phase 2 — 对比与评分** ✅：双链路对齐 + 差异高亮 + 成本汇总的对比工作台；多模型 LLM Judge；`model_providers` / `model_pricings` 配置页。
- **Phase 3 — 回放引擎**：对源 trace 换模型/改参数/改 Prompt 重跑，工具调用不真实执行、用录制结果 mock 回放，并做参数级偏离（divergence）验证；回放结果自动进对比。
- **Phase 4 — 打磨扩展**：Prompt 版本管理页完善、多阶段 trace 单点回放、Python SDK 封装、批量回放/批量评测。

## License

MIT
