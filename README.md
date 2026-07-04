# PromptScope

团队内部的 **Agent 调优与回放平台**：自建数据接入，以完整调用链路为核心，围绕 Agent 运行数据支撑对比评分与"重跑回放"，帮助团队在多模型/多 Prompt 方案之间做出低成本、可验证的替代决策。平台分四层能力：**数据接入**（通用 ingestion HTTP API + Python SDK，Agent 直接上报完整 trace）、**链路可视化**（Phase 1，已支持）、**对比 + 评分**（Phase 2，已支持）、**重跑回放**（Phase 3，已支持）、**打磨扩展**（Phase 4，已支持）。

当前仓库已完成 **Phase 1 —— 数据地基**、**Phase 2 —— 对比与评分**、**Phase 3 —— 回放引擎**、**Phase 4 —— 打磨扩展**：Postgres/SQLite 数据模型、ingestion API、Python SDK 与上报示例、trace 列表与详情页（链路可视化）、双链路对齐对比工作台、多模型 LLM Judge、模型 Provider/定价配置页、换模型/改参数/改 Prompt 的重跑回放（mock 工具 + 偏离检测）、多阶段 trace 单点回放、Prompt 版本管理页、批量回放与批量评测端点。

## 架构

```
Agent (用户代码，或 sdk/promptscope Python SDK)
   │  HTTP 上报 (ingestion API, API Key 认证)
   ▼
PromptScope Backend (FastAPI + Postgres)
   ├── Ingestion API      ← 接收 trace/observation
   ├── Query API          ← 前端读取
   ├── Prompt API         ← prompt / 版本管理，trace 引用查询（Phase 4，已支持）
   ├── Config API         ← model_providers / model_pricings（Phase 2，已支持）
   ├── Judge Service      ← 多模型评分（Phase 2，已支持，批量评测 Phase 4）
   └── Replay Engine      ← 调各家模型 API + mock 工具（Phase 3，已支持；单点回放/批量回放 Phase 4）
   ▲
   │
PromptScope Frontend (Next.js)
```

## 技术栈

- **前端**：Next.js 14 + TypeScript + TailwindCSS + shadcn/ui（`components/ui/`）+ next-themes
- **后端**：FastAPI + SQLAlchemy，本地开发默认 SQLite，团队部署用 Postgres
- **部署**：Docker Compose（Postgres 16 + backend + frontend）

## 快速开始

### 本地开发

**1. 启动后端：**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**2. 启动前端：**

```bash
cd frontend
npm install
npm run dev
```

**3. 建项目、拿 API Key**：浏览器打开 `http://localhost:3000`（自动跳转 `/traces`），首次使用无需任何 CLI 操作——打开左侧侧边栏底部进入 **Settings → 项目与密钥** 标签页：「新建项目」建一个项目并自动切换为当前项目，「新建 API Key」弹窗展示完整 key（**仅此一次可见**，关闭前请立即复制保存）。旧的命令行方式仍然保留，适合脚本化/CI 场景：

```bash
cd backend
python -m scripts.create_project demo
# 输出:
# project: demo (<project_id>)
# api key (save it now, shown only once): ps-xxxxxxxx...
```

**4. 跑示例脚本上报一次带工具调用的 Agent 运行：**

```bash
export PROMPTSCOPE_URL=http://localhost:8000
export PROMPTSCOPE_API_KEY=ps-xxxxxxxx...   # 上一步拿到的 key
python examples/report_agent_run.py
```

**5. 回到 `/traces` 页面查看链路**，侧边栏顶部的项目切换器选中对应项目后即可看到新上报的 trace；点进具体 trace 可看分组调用链树（LLM 调用 / 工具调用，角色着色的消息列表 / 每步耗时）。

### Docker 部署

```bash
docker-compose up -d
```

会启动 Postgres 16（映射到宿主机 `5433` 端口，避免与本地已有 Postgres 冲突）、backend（`8000`）、frontend（`3000`）。首次启动后，进入 backend 容器执行 `create_project` 脚本签发 API Key：

```bash
docker-compose exec backend python -m scripts.create_project demo
```

**安全注意**：本平台面向内网部署，除 ingestion 外的接口（查询、配置、评分/回放）均无鉴权，依赖网络边界隔离；评分与回放会实际调用模型 API、消耗模型配额，请勿暴露到公网。

## 前端界面

Phase 5 对前端做了整体视觉与交互重设计：`components/ui/` 引入 shadcn/ui 作为基础组件库，配合 `next-themes` 支持双主题。

### 主题

- 亮色 / 暗色 / 跟随系统三种模式（`components/theme-toggle.tsx`），切换入口在**左侧侧边栏底部**（`components/layout/AppSidebar.tsx`），默认主题为暗色（`app/layout.tsx` 里 `ThemeProvider` 的 `defaultTheme="dark"`）。
- 主题选择持久化在 `localStorage`（`next-themes` 默认行为，键名 `theme`），刷新或重新打开浏览器后保持上次选择；`html` 标签通过 `class` 属性切换（`attribute="class"`），配合 `app/globals.css` 里 `:root` / `.dark` 两套 CSS 变量生效。
- 全站零硬编码色值：所有颜色通过 `app/globals.css` 定义的 Tailwind 语义 token 表达（`success`/`warning`/`destructive`/`replay`/`live` 等状态色见 `components/StatusBadge.tsx`，规则详见 `CLAUDE.md`），因此每个页面都能在两套主题下正确换色，不需要针对组件单独适配。

### 侧边栏导航

左侧固定侧边栏（`components/layout/AppSidebar.tsx`，可折叠为图标态，折叠状态记忆在 `localStorage`）：
- 顶部为项目切换器（下拉框，绑定 `ProjectContext`，切换后全站页面按新的 `currentProject` 重新拉取数据）
- 中部导航：**Traces / Compare / Prompts / Settings** 四个入口，当前路由高亮
- 底部为主题切换器 + 版本号 + 折叠按钮

不再是旧版的顶部 TopBar 布局。

### 页面动线更新

- **`/traces` 列表**：勾选两条 trace 后，底部弹出悬浮的**对比托盘**（`components/CompareTray.tsx`），展示已选 trace 的标签（可单独移除），凑满 2 条后「开始对比」按钮可点击，直接跳转 `/compare?a=<id>&b=<id>`；未配置任何 trace 数据时展示 `OnboardingCard`（三步接入引导：Settings 建 Key → SDK 接入代码示例 → 刷新查看）。
- **`/replay/{id}` 回放成功自动进对比**：点击「运行回放 ▶」后，若本次回放 `status === "success"` 且产出了 `result_trace_id`，页面会自动 `router.push` 跳转到 `/compare?a=<源 trace>&b=<回放结果 trace>`（并有 toast 提示"回放完成，正在打开对比…"），不再需要手动点「与源 trace 对比」；失败或未产生结果 trace 时，结果展示在右侧的历史回放时间线里（含错误信息与 divergence 列表，可展开/收起）。
- **`/prompts` 行级 diff**：勾选两个版本卡片后，页面顶部出现 `v{old} → v{new}` 的差异卡片，使用 `lib/linediff.ts` 做**逐行 diff**（`+`/`-`/空格前缀，新增行绿色高亮、删除行红色高亮），而非旧版的纯文本并排展示；每个版本卡片还支持「用此版本回放…」直接从 prompt 库发起某个版本的回放。
- **`/settings` 三个 tab**：「项目与密钥」「模型 Provider」「定价」（`components/ui/tabs.tsx`）。**「项目与密钥」标签页新增了项目与 API Key 的完整管理 UI**：左侧项目列表 + 「新建项目」弹窗，右侧显示当前项目的 Key 列表（前缀、创建时间、状态）+ 「新建 API Key」（弹窗仅展示一次完整 key，关闭后不可再查看）+ 「吊销」（二次确认弹窗，吊销后立即失效不可恢复）。首次使用起不再必须走 CLI 建项目/建 Key，但 `backend/scripts/create_project.py` 脚本原样保留，适合脚本化场景。

### E2E 测试

```bash
cd frontend
npm run e2e
```

`playwright.config.ts` 会自起一套完全独立的前后端进程，不依赖你本地已经在跑的 `dev`/`uvicorn`：后端用临时 `backend/db/e2e.db`（`journey` 用例组运行前先 `rm -f`，保证每次全新库）跑在 `:8100`，前端跑在 `:3100`（`API_PROXY_HOST` 指向 `:8100`）。共两组用例，`theme` 依赖 `journey` 先跑完：

- **`e2e/journey.spec.ts`**：串联全链路——从 UI 建项目/建 Key，通过 `execFileSync` 调 `e2e/scripts/ingest_e2e.py`（**真实走 `sdk/promptscope` Python SDK**，而非 mock 数据）上报几条真实 trace，再依次驱动 traces 列表筛选/搜索、trace 详情、对比托盘选择进对比、配置假 provider 后跑 Judge（预期真实报错，不伪造结果）、发起回放（假 provider 必然失败，验证失败态展示）、Prompt 建版本/fork/勾选 diff、主题切换与刷新持久化。
- **`e2e/theme.spec.ts`**：依赖 `journey.spec.ts` 跑完后留下的数据（`e2e-proj` 项目、trace、prompt），对 traces / 详情 / compare / replay / prompts / settings 六个页面分别在浅色和深色主题下各截一张全页截图，产物写入 `frontend/e2e-screenshots/`（如 `traces-light.png`、`compare-dark.png`，共 12 张，`.gitignore` 已排除该目录），用于人工视觉核对两套主题下的页面观感。

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

### Python SDK 快速上手

`sdk/promptscope`（仅依赖 `httpx` 与标准库，未发布到 PyPI，以路径引用或复制文件的方式使用）把上报流程封装为 `trace` context manager + `llm`/`tool` 记录方法，`examples/report_agent_run.py` 即基于该 SDK 实现：

```python
import sys
sys.path.insert(0, "/path/to/promptscope/sdk")

from promptscope import PromptScopeClient

client = PromptScopeClient(base_url="http://localhost:8000", api_key="ps-xxxx")

with client.trace("weather-agent-demo", input={"question": "北京今天天气怎么样？"}) as t:
    llm_id = t.llm("plan", model="gpt-4o",
                   messages=[{"role": "user", "content": "北京今天天气怎么样？"}],
                   tool_definitions=[{"name": "get_weather",
                                      "parameters": {"type": "object",
                                                     "properties": {"city": {"type": "string"}}}}],
                   tool_calls=[{"name": "get_weather", "arguments": {"city": "北京"}}],
                   input_tokens=150, output_tokens=25)
    t.tool("get_weather", tool_input={"city": "北京"},
           tool_output={"weather": "晴", "temperature": 32}, parent=llm_id)
    t.llm("answer", model="gpt-4o",
          messages=[{"role": "user", "content": "北京今天天气怎么样？"}],
          completion="北京今天晴，32°C。", input_tokens=220, output_tokens=35)
    t.set_output({"answer": "北京今天晴，32°C。"})
```

- `with` 代码块正常退出时自动 `flush`（调 `POST /api/ingest`，payload 会走与直接 HTTP 上报完全相同的 `IngestRequest` 校验）；`flush` 幂等，重复调用不会重复上报。
- 代码块内抛出异常时，trace 的 `status` 会被自动标记为 `error`，然后原始异常会被重新抛出——**flush 上报本身失败不会掩盖或替换原始业务异常**：`flush` 若在异常路径下再次失败，只打印到 stderr，不吞掉、也不覆盖正在传播的原始异常。
- 详细字段说明（`trace()` / `TraceContext.llm()` / `.tool()` / `.set_output()` 全部参数）见 `sdk/README.md`。

### 让 trace 可回放的必需字段

回放引擎（见下「重跑回放」一节）严格依赖上报数据的完整性，字段缺失不会报错，但会导致回放不可用或语义残缺：

- **llm 节点必须记录完整 `messages` 与 `tool_definitions`**：`messages` 是回放的初始对话上下文（单点回放时还会被**原样**发给模型，见「单点回放」一节），缺失会导致回放请求语境不完整；`tool_definitions` 缺失会导致回放时模型收不到工具定义，无法产生工具调用，进而使 mock 工具链路完全失效。
- **tool 节点必须挂 `parent`（对应的 llm 观测 id）且记录 `tool_input`/`tool_output`**：回放的 `RecordedTools` 按 `parent_id` 做子树隔离（尤其是单点回放场景），不挂 `parent` 的 tool 观测不会被任何回放消费到；缺失 `tool_input`/`tool_output` 会导致回放时的参数比对（`param_mismatch` 检测）与结果 mock 都失去依据。

## 查询 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/projects` | GET | 项目列表 |
| `/api/traces` | GET | Trace 列表，支持 `project_id` / `origin` / `search` 过滤及 `limit` / `offset` 分页 |
| `/api/traces/{id}` | GET | Trace 详情，含按 `parent_id` 组装的调用链树 |
| `/api/ingest` | POST | 上报 trace + observations（见上） |
| `/api/health` | GET | 健康检查 |

## Prompt 库

Phase 4 新增的 `/prompts` 页支持给 Prompt 建版本历史、双版本对比查看差异、以及查询某个版本被哪些 trace 引用过。

### /prompts 使用动线

1. 左侧列表展示当前项目下的所有 prompt（`GET /api/prompts?project_id=`），每项显示名称与最新版本号（`latest_version`）、版本数（`version_count`）。
2. 「新建 Prompt」表单提交 `POST /api/prompts`（`name` 在同一 `project_id` 下唯一，重复返回 `409`），创建时自动生成版本 1。
3. 选中一个 prompt 后，右侧按版本号倒序展示版本历史（`GET /api/prompts/{id}`），每张版本卡片可「基于此版本新建」——编辑内容后提交 `POST /api/prompts/{id}/versions`，追加下一个版本号（不修改已有版本，版本历史不可变）。
4. 每张版本卡片勾选框最多同时选中 2 个版本，选中两个后页面顶部出现并排的双版本对比（按版本号从小到大排列展示原文，纯文本对照，不做 diff 高亮）。
5. 每张版本卡片下方「使用此版本的 traces」可展开，调用 `GET /api/prompt-versions/{version_id}/traces` 查询引用了该版本的 trace（trace 级 `prompt_version_id` 直接匹配，或该 trace 下任一 observation 的 `prompt_version_id` 匹配），按创建时间倒序最多返回 100 条。

### Prompts API 端点表

**`backend/routers/prompts.py`**（挂载于 `/api`，对照 `backend/schemas/prompts.py`）：

| 端点 | 方法 | 说明 | 请求体字段 | 响应字段 |
|------|------|------|------------|----------|
| `/api/prompts` | GET | Prompt 列表（可选按 `project_id` 过滤，按创建时间倒序） | query: `project_id?` | `PromptSummary[]`：`id, name, version_count, latest_version, created_at` |
| `/api/prompts` | POST | 创建 prompt + 初始版本 1（同 `project_id` 下 `name` 唯一，重复 409） | `project_id, name(≤255), content` | `PromptDetail`：`id, name, project_id, versions: VersionOut[]` |
| `/api/prompts/{id}` | GET | Prompt 详情，含全部版本（不存在返回 404） | — | `PromptDetail` |
| `/api/prompts/{id}/versions` | POST | 追加新版本（不存在返回 404，版本号自动 `max(existing)+1`） | `content` | `VersionOut`：`id, version, content, created_at` |
| `/api/prompt-versions/{version_id}/traces` | GET | 查询引用该版本的 trace（trace 级或 observation 级 `prompt_version_id` 匹配，最多 100 条，按创建时间倒序） | — | `VersionTraceOut[]`：`id, name, origin, total_cost, created_at` |

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
| `/api/evaluations/batch` | POST | 批量评测：对多个 subject trace × 多个 judge 模型跑全量组合评分（笛卡尔积，均不带 `compare_trace_id`，即批量场景仅支持单 trace 评分），单个组合失败不影响其余组合 | `subject_trace_ids(list[str], 1-50), judge_models(list[str], ≥1), context_mode("output_only"\|"with_trace", 默认 output_only), force(bool, 默认 false)` | `{results: [{subject_trace_id, judge_model, status("ok"\|"error"), evaluation?, error?}]}` |

补充说明：
- `force=false`（默认）时，若已有相同 `(subject_trace_id, compare_trace_id, judge_model, context_mode)` 的评分记录，直接复用缓存，不重新调用模型。
- 单 trace 评分（不传 `compare_trace_id`）时响应里 `score` 为该 trace 的打分、`score_b` 为 `null`，`verdict` 取值 `pass`/`fail`；双 trace 对比评分时 `score` 为 A（`subject`）侧打分、`score_b` 为 B（`compare`）侧打分，`verdict` 取值 `replaceable`/`not_replaceable`。
- `cost` 由 judge 调用的输入/输出 token 数结合 `model_pricings` 表计算得出（复用 `services/ingest_service.compute_cost`）。

## 重跑回放

Phase 3 在对比与评分之上增加了「对源 trace 换模型/改参数/改 Prompt 重跑」的能力：工具调用不真实执行，改为按录制结果 mock，并对每一步实际调用与录制记录做偏离（divergence）检测。

### 使用动线

1. 打开一条 `origin=live` 的 trace 详情页（`/traces/{id}`），页头出现「回放 ▶」按钮（只有 live 来源的 trace 才可发起回放，`replay` 来源的 trace 不再允许二次回放），点击进入 `/replay/{id}`。
2. 「覆盖配置」区块可选择覆盖模型（下拉列表复用 `GET /api/judge-models`，即已关联 provider 的定价记录）、覆盖 Temperature（`model_params.temperature`）、编辑 System Prompt（默认回填源 trace 入口 LLM 调用里的 system 消息，编辑后才会作为覆盖值提交）。三项均可留空，留空则沿用源 trace 的对应值。
3. 点击「运行回放 ▶」，前端调用 `POST /api/replays`；请求同步执行完成后才返回（无轮询/无异步任务队列），返回后立即展示本次回放结果卡片。
4. 结果卡片展示状态徽标（`success`/`failed`/`running`）、`error`（若有）、divergence 列表；若回放产出了 `result_trace_id`，提供「与源 trace 对比」（跳转 `/compare?a=<源id>&b=<result_trace_id>`）与「查看回放 trace」（跳转 `/traces/<result_trace_id>`）两个入口。
5. 页面下方「历史回放」区块列出该源 trace 之前所有回放记录（`GET /api/replays?source_trace_id=`），按创建时间倒序。

### 单点回放

多阶段 trace（一条 trace 里有多个 `llm` observation）可以只回放其中一步，而不是从入口重跑整条链路：

1. 在 trace 详情页（`/traces/{id}`）左侧调用链树里选中任意一个 `type=llm` 的节点，右侧详情面板顶部出现「单点回放此步 ▶」，点击跳转 `/replay/{id}?target=<observation_id>`。
2. 回放页检测到 URL 带 `target` 参数后，System Prompt 默认回填**该目标节点**（而非入口节点）消息序列里的 system 消息，页面明确提示"单点回放：{节点名}（step {seq}）"。
3. 提交时请求体带上 `target_observation_id`，其余覆盖字段（模型/参数/Prompt）语义不变。
4. **语义边界**：单点回放只以目标 `llm` observation 为起点重放，不会重放目标节点之前的其他 `llm` 节点；工具调用 mock 仅消费**目标节点子树**下的录制结果——即 `RecordedTools` 只装载 `parent_id == target_observation_id` 的 `tool` observation，不会误用同一条源 trace 里其他分支/其他步骤录制的工具调用结果。不传 `target_observation_id` 时行为不变（仍是整条 trace 从入口 `llm` 节点开始回放，消费全部工具录制）。
5. **上游上下文原样发送**：目标节点录制的完整消息序列（含它自身之前的 assistant/tool 上游上下文）会**原样**发给模型，不做截断——因为 spec 语义是"上游输入用录制值"，这些消息是目标节点执行时的真实上下文，截掉会破坏语义。唯一可被覆盖的是其中的 system 消息（`override_prompt_text`/`override_prompt_version_id`）。整链路回放（不带 `target_observation_id`）则保持原有行为：消息历史截断到入口节点自身的 assistant/tool 前缀之前。
6. 单点回放产出的回放 trace，其 **trace 的** `metadata` 会带上 `target_observation_id`（而非 observation 的 metadata），回放 trace 名称后缀为 `(replay:step-N)`（`N` 为目标节点的 `seq`），与整链路回放的 `(replay)` 后缀区分。

### Mock 机制说明

回放只重新调用 LLM API，**工具调用不会真实执行**：

- 回放开始前，把源 trace 里所有 `type=tool` 的 observation 按工具名分组、组内按原始顺序放入 FIFO 队列（`RecordedTools`，见 `backend/services/replay_service.py`）。
- 每一步 LLM 返回 `tool_calls` 时，按工具名从对应队列里取出（`take`）一条录制记录，直接把该记录的 `tool_output` 作为本次调用结果喂回对话（不执行任何真实副作用、不发起任何外部请求）。
- 如果实际调用参数（`tc["arguments"]`）与取出的录制记录参数（`recorded_input`）不一致，记为 `param_mismatch` 偏离，但**继续执行**、仍使用录制的 `tool_output`（偏离不中断回放）。
- 如果某个工具名对应的队列已空（没有更多录制可消费），记为 `unrecorded_call` 偏离，返回一个错误占位结果（`{"error": "工具结果不可用：录制中不存在该调用"}`）喂回对话，继续执行。

### Divergence 类型表

| type | 触发条件 | 字段 |
|------|----------|------|
| `param_mismatch` | 实际调用参数与该工具下一条录制参数不一致（按稳定 JSON 序列化比较） | `type, tool, step, recorded_input, actual_input` |
| `unrecorded_call` | 该工具名对应的录制队列已耗尽，仍被调用 | `type, tool, step, arguments` |
| `max_steps_exceeded` | 达到 `MAX_REPLAY_STEPS`（15）步仍未产出最终回答（LLM 未返回空 `tool_calls`） | `type, step` |

### Replays API 端点表

**`backend/routers/replay.py`**（挂载于 `/api`，对照 `backend/schemas/replay.py`）：

| 端点 | 方法 | 说明 | 请求体字段 | 响应字段 |
|------|------|------|------------|----------|
| `/api/replays` | POST | 创建并同步执行一次回放（源 trace 不存在返回 404） | `source_trace_id, target_observation_id?, override_model?, override_model_params?, override_prompt_text?, override_prompt_version_id?` | `ReplayRunOut`（见下） |
| `/api/replays/batch` | POST | 批量回放：对多条源 trace 依次执行同一份覆盖配置（整链路回放，不支持批量单点回放），单条失败不影响其余条 | `source_trace_ids(list[str], 1-20), override_model?, override_model_params?, override_prompt_text?, override_prompt_version_id?` | `{results: [{source_trace_id, status("ok"\|"error"), run?, error?}]}` |
| `/api/replays/{id}` | GET | 取单条回放记录（不存在返回 404） | — | `ReplayRunOut` |
| `/api/replays?source_trace_id=` | GET | 按源 trace 列出所有回放记录（按创建时间倒序） | query: `source_trace_id` | `ReplayRunOut[]` |

`ReplayRunOut` 字段：`id, source_trace_id, result_trace_id, status("pending"\|"running"\|"success"\|"failed"), override_model, override_model_params, override_prompt_text, override_prompt_version_id, divergences, error, created_at, finished_at`。

- `target_observation_id` 若填写，触发单点回放（见上「单点回放」一节）：必须是源 trace 里某个 `type=llm` 的 observation id，否则返回 `400`；批量回放端点不支持该字段（`BatchReplayRequest` 未包含）。
- `override_prompt_version_id` 若填写，优先于 `override_prompt_text` 生效（从 `PromptVersion.content` 读取覆盖内容；版本不存在返回 404）。
- `result_trace_id` 只有在回放至少产出一步 observation 并成功落库后才会非空；请求发起阶段（`pending`）或落库前失败时为 `null`。
- `/api/replays` 与 `/api/replays/batch` 内部共享同一个 `_run_one()` 辅助函数（`backend/routers/replay.py`）执行单次回放全部前置校验（源 trace 存在性、`origin == "live"`）与异常兜底（`HTTPException`/意外异常都会把已创建的 `ReplayRun` 标记为 `failed` 并写入真实错误，不会让 run 卡在 `pending`/`running`），避免单点/整链路/批量三条路径出现校验或错误处理不一致。

### 限制说明

- **anthropic provider 暂不支持工具回放**：若源 trace 的入口 LLM 调用带 `tool_definitions`，且回放实际使用的 provider（覆盖模型或源模型对应的 provider）`provider_type == "anthropic"`，直接返回 `400`，不发起任何调用（MVP 范围内的已知限制，非 anthropic 工具调用格式尚未适配）。
- **`MAX_REPLAY_STEPS = 15`**：LLM ↔ mock 工具往返上限，超过后记 `max_steps_exceeded` 偏离并将 run 标记为 `failed`（但已产出的 observation 仍会落库，见下）。
- **`MAX_REPLAY_WALL_SECONDS = 240`**：单次回放循环的墙钟时间护栏（`backend/services/replay_service.py`），每一步开始前检查累计耗时是否已超过 240 秒，超过则记 `wall_clock_exceeded` 偏离、跳出循环并将 run 标记为 `failed`（`error` 写明"超过最大回放时长"），已产出的 observation 仍会落库——用于兜底 `MAX_REPLAY_STEPS` 未触发但单步调用耗时异常长（如模型 API 挂起）的场景，避免一次同步请求无限期占用后端 worker。
- **同步执行**：`POST /api/replays` 在请求内完成整个回放循环再返回，没有后台任务/轮询机制；耗时等于本次回放里所有 LLM 调用的真实耗时总和，受上面的墙钟护栏约束。
- 录制之外的调用不会中断回放，只如实记录偏离；provider 调用本身失败（网络错误、鉴权失败等）会中断循环，run 标记为 `failed` 并写入真实错误信息到 `error`，之前已产生的 observation（partial trace）仍会落库保留。
- **同步执行**：回放请求超过约 5 分钟可能被前端代理断开（后端会继续执行完成，结果仍会出现在历史回放列表中；可稍后刷新查看）。
- **形态限制**：MVP 仅支持"单轮输入 + 单入口 agent loop"形态的 trace；多轮对话或多阶段 pipeline trace 若需要只重跑其中一步，使用上面的单点回放（`target_observation_id`）。

## 项目结构

```
promptscope/
├── backend/
│   ├── main.py
│   ├── config.py         # DATABASE_URL 等配置
│   ├── db.py             # SQLAlchemy engine/session
│   ├── models/entities.py
│   ├── schemas/          # ingest.py / query.py / config.py / evaluations.py / replay.py / prompts.py
│   ├── services/         # auth / ingest_service / llm_client / judge_service / providers / replay_service
│   ├── routers/          # ingest.py / query.py / config.py / evaluations.py / replay.py / prompts.py / projects.py
│   └── scripts/create_project.py
├── frontend/
│   ├── app/traces/       # trace 列表与详情页（对比托盘、"单点回放此步"入口）
│   ├── app/compare/      # 双链路对齐对比工作台
│   ├── app/replay/[id]/  # 回放配置与结果页（支持整链路回放、单点回放、成功后自动跳对比）
│   ├── app/prompts/      # Prompt 版本管理页（含行级 diff）
│   ├── app/settings/     # 项目与密钥 / provider / 定价三个 tab
│   ├── components/ui/    # shadcn/ui 基础组件
│   ├── components/layout/AppSidebar.tsx  # 侧边栏导航 + 主题切换
│   ├── lib/align.ts      # LCS trace 对齐算法
│   ├── lib/linediff.ts   # LCS 行级 diff（prompt 版本对比）
│   └── e2e/              # Playwright 端到端测试（journey + theme 截图）
├── sdk/promptscope/       # Python SDK：trace context manager + llm/tool 上报
├── examples/report_agent_run.py   # 基于 SDK 的上报示例
└── docker-compose.yml
```

## Roadmap

- **Phase 2 — 对比与评分** ✅：双链路对齐 + 差异高亮 + 成本汇总的对比工作台；多模型 LLM Judge；`model_providers` / `model_pricings` 配置页。
- **Phase 3 — 回放引擎** ✅：对源 trace 换模型/改参数/改 Prompt 重跑，工具调用不真实执行、用录制结果 mock 回放，并做参数级偏离（divergence）验证；回放结果自动可与源 trace 对比。
- **Phase 4 — 打磨扩展** ✅：Prompt 版本管理页（版本历史、双版本对比、trace 引用查询）；多阶段 trace 单点回放（`target_observation_id`，只重放目标节点及其子树录制）；Python SDK 封装（`sdk/promptscope`，trace context manager + llm/tool + 自动 flush）；批量回放（`POST /api/replays/batch`，1-20 条）与批量评测（`POST /api/evaluations/batch`，1-50 trace × judge 组合）；回放墙钟护栏（`MAX_REPLAY_WALL_SECONDS=240`）。

**Phase 1-4 已全部完成。**

## License

MIT
