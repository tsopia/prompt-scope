# PromptScope 平台重定位设计：Agent 调优与回放平台

**日期:** 2026-07-04
**状态:** 已与用户确认
**取代:** 2026-06-18-frontend-redesign.md（原"纯分析工具"定位作废）

---

## 1. 背景与重定位

原实现（从 Langfuse 二手同步 candidates、单页对比）偏离了项目初衷。本设计将平台重定位为：

**团队内部的 Agent 调优/降本平台** —— 自建数据接入，以完整调用链路为核心，支持对比、多模型评分与"重跑回放"。

四层能力：

1. **数据接入**：平台提供通用 ingestion HTTP API，agent 像接 Langfuse 一样直接上报完整 trace（含工具调用入参/结果）。SDK 是 API 的多语言薄封装，后置。
2. **链路可视化**：查看 agent 每次运行的完整调用链（LLM 调用、工具调用、中间结果、每步 token/成本/延迟）。
3. **对比 + 评分**：以整条 trace 为单元的 side-by-side 对比；多模型 LLM Judge 打分辅助决策。
4. **重跑回放（核心差异化价值）**：对某次真实运行换模型/改参数/改 prompt 重跑，工具调用不真实执行，用录制的真实结果 mock 回放，并做参数级偏离验证。

### 路线选择

- **选定方案 A**：自定义 ingestion 协议（回放所需字段为一等公民），协议字段设计参考 OTel GenAI 语义约定，保留未来兼容映射的可能。
- 排除方案 B（直接兼容 OTLP：前期成本高、各框架埋点的工具数据完整性不可控）。
- 排除方案 C（继续依附 Langfuse：与用户意愿相悖，二手数据无法保证回放所需字段）。

### 约束

- 团队内部使用：多项目隔离（project + API Key），无需完整多租户用户体系。
- 完整蓝图一次设计（尤其数据模型），分四个阶段落地。
- 技术栈延续：FastAPI + Next.js；数据库 SQLite → **Postgres**。

---

## 2. 整体架构

```
Agent (用户代码)
   │  HTTP 上报 (ingestion API, API Key 认证)
   ▼
PromptScope Backend (FastAPI + Postgres)
   ├── Ingestion API      ← 接收 trace/observation
   ├── Query API          ← 前端读取
   ├── Replay Engine      ← 调各家模型 API + mock 工具
   └── Judge Service      ← 多模型评分
   ▲
   │
PromptScope Frontend (Next.js)
```

### 与现有代码的关系

- 保留：FastAPI + Next.js 技术栈、Docker 部署形态。
- 退役：扁平 `candidates` 数据模型、Langfuse 同步（`langfuse_client.py`、`sync_service.py`）、SQLite、mock_data 兜底、前端全部现有页面（含 7 个 stub 路由与 Sidebar）。
- 可参考迁移：judge_service 的评估概念（升级为多 judge）、对比/JudgeResult 的交互设计。

---

## 3. 数据模型（7 张主表）

- **projects / api_keys** — 项目隔离；API Key 按项目签发，用于 ingestion 认证。
- **traces** — 一次 agent 完整运行：name、input、output、status、耗时、聚合 token/成本、metadata；`origin` 字段区分 `live`（真实上报）/ `replay`（回放产出）。**回放产出物本身就是一条 trace**，链路视图、对比、评分对两者完全通用。
- **observations** — trace 内树形节点（`parent_id` 构成调用链），三种类型：
  - `llm`：**完整消息序列（messages）与工具定义（必填，回放成立的根本）**、模型名、模型参数、模型发起的 tool_calls、输出、token usage、成本、延迟；可引用 prompt_version。
  - `tool`：工具名、**入参与返回结果（必填）**、耗时、错误。
  - `span`：通用分组节点（如 retrieval、planning 阶段）。
- **prompts / prompt_versions** — prompt 版本管理；支撑"同一模型、prompt 前后版本对比"。
- **replay_runs** — 回放记录：源 trace、覆盖配置（模型/参数/prompt 版本）、工具 mock 命中与参数偏离（divergence）明细、产出的新 trace id、状态。
- **evaluations** — Judge 评分：评分对象（单条 trace 或一对 trace）、judge 模型、分数、结论、理由、评分成本；同一对象可被多个 judge 模型评分。预留 `context_mode` 字段（`output_only` / `with_trace`），后期支持"看链路评过程质量"。
- **model_providers** — 回放与 judge 用的模型配置：base_url + api_key（OpenAI 兼容协议为主 + Anthropic 适配）、模型定价表（替代原硬编码 MODEL_PRICING）。

### Token 与成本计算

贯穿每一层：observation 级（每次调用 usage × 定价）→ trace 级聚合 → 对比视图差值/百分比。定价在 model_providers 配置中可随时修改。

---

## 4. 对比工作台：双链路并排对比

对比的基本单元是**整条 trace**（而非最终输出）。

```
┌─────────────── 对比工作台 ───────────────────────────┐
│ Summary: 总成本 ↓63% | 总延迟 ↑0.4s | Judge: A 7.8 vs B 8.5 │
├──────────────────────┬───────────────────────────────┤
│ Trace A (gpt-4o)     │ Trace B (deepseek-chat, 回放)   │
│ ● llm  规划     $.002 │ ● llm  规划      $.0003  ↓85%  │
│ ├ tool search_docs   │ ├ tool search_docs   ✓参数一致  │
│ ├ tool get_price     │ ├ tool get_price     ⚠参数偏离  │
│ ● llm  综合回答 $.004 │ ├ tool get_price     ＋多调一次 │
│                      │ ● llm  综合回答  $.0006        │
│ 最终输出 [展开]        │ 最终输出 [展开]                 │
└──────────────────────┴───────────────────────────────┘
```

1. **双栏链路树**：左右各渲染一条 trace 的完整调用链，每节点显示类型/名称/单步成本/延迟，点击展开详情（消息、工具入参/结果）。
2. **步骤对齐 + 差异高亮**：按顺序和工具名对齐，标注：仅一侧存在（＋/－）、同名工具入参不同（⚠ 参数偏离）、每步成本/延迟差百分比。
3. **顶部 Summary**：总成本差、总延迟差、步骤数差、Judge 分数。
4. **视图统一**："原始 vs 回放"与"两条真实 run"使用同一对比界面；回放的参数偏离验证自然呈现于差异高亮中。
5. **Judge 区**：可多选 judge 模型，结果并列展示；评分结果缓存。

---

## 5. 回放引擎

**输入**：源 trace + 覆盖配置（换模型、改模型参数、换 prompt——三者任意组合）。

**执行流程**：

```
1. 从源 trace 取入口 LLM 节点：
   system prompt（若指定新 prompt 则替换）+ 用户输入 + 工具定义
2. 用新模型/参数发起真实调用（走 model_providers 配置）
3. 模型返回 tool_calls？
   ├─ 是 → 不真正执行工具，从源 trace 的 tool 记录中取录制结果
   │        按 [工具名精确匹配 + 调用次序] 出队
   │        入参结构化 diff：一致 ✓ / 偏离 ⚠（记录 divergence 但继续）
   │        录制结果作为 tool result 回给模型 → 回到 3
   └─ 否 → 产出最终回答，回放结束
4. 全程落成新 trace (origin=replay)，每步实时记 usage 与成本；
   replay_run 记录全部 divergence
```

**已确认的决策**：

- **偏离不中断**：入参与录制不一致时警告并继续（仍返回录制结果）。参数偏离本身就是"能否替代"的重要信号，跑完才能看全貌。
- **录制之外的调用**（调用了源 trace 没有的工具 / 次数超过录制）：向模型返回"工具结果不可用"提示使其继续，同时标记为严重偏离。
- **护栏**：最大迭代步数（防死循环）、单步超时；模型 API 报错时 replay_run 标记 failed，保留已完成的部分链路。

**MVP 范围**：支持**单入口 agent loop**（一个 LLM 循环调工具）。多阶段 pipeline trace（多个独立 LLM 节点串联）在 MVP 支持**单点回放**（重跑指定 LLM 节点，上游输入用录制值）；完整多阶段全链路回放放后续版本。

---

## 6. 前端信息架构

推翻现有单页布局，清除 7 个 stub 路由与 Sidebar，重建为：

```
顶栏: 项目切换 | 设置入口
├── /traces          Trace 列表（默认首页）：时间倒序，
│                    名称/模型/步数/token/成本/延迟/origin，可筛选，勾选两条进对比
├── /traces/[id]     Trace 详情：链路树 + 节点详情展开；「回放 ▶」「加入对比」
├── /compare         对比工作台（见 §4）
├── /replay/[id]     回放配置：源 trace 摘要 + 覆盖配置表单，
│                    运行进度实时显示，完成后一键跳「与源 trace 对比」
├── /prompts         Prompt 库：版本历史、diff 视图、版本被哪些 trace 使用
└── /settings        Provider/模型/定价配置、API Key 管理
```

**核心动线**（≤5 次点击闭环）：trace 详情 → 回放 → 换便宜模型跑完 → 自动进对比 → 双链路 + 成本差 + judge 分 → 得出"能否替代"结论。

---

## 7. 错误处理与测试

- **Ingestion**：API Key 无效 → 401；payload 校验失败 → 422 并给出字段级错误；上报幂等（客户端生成 trace/observation id，重复上报 upsert）。
- **回放**：见 §5 护栏；provider 配置缺失/网络失败给出明确的用户可读错误。
- **Judge**：失败不再返回 mock 结果（原"优雅降级"策略作废），如实报错并允许重试。
- **测试策略**：数据模型与 ingestion API 走单元 + 集成测试（含幂等、认证）；回放引擎以"录制的 fixture trace + mock provider 响应"做确定性测试（工具匹配、偏离判定、护栏各分支）；前端关键动线做组件测试。

---

## 8. 分阶段落地

- **Phase 1 — 数据地基**：Postgres 数据模型、ingestion API（API Key 认证）、Python 上报示例、trace 列表 + 详情页（链路可视化）。退役 Langfuse 同步与旧 candidates 模型。
- **Phase 2 — 对比与评分**：对比工作台（双链路对齐 + 差异高亮 + 成本汇总）、多模型 Judge、model_providers 配置页。
- **Phase 3 — 回放引擎**：单入口 loop 回放 + 工具 mock + divergence 记录、回放配置页、回放结果自动进对比。**核心价值闭环在此打通。**
- **Phase 4 — 打磨扩展**：prompt 版本管理页完善、多阶段 trace 单点回放、Python SDK 封装、批量回放/批量评测。

每个 Phase 结束均为可用状态；Phase 1 完成后真实 agent 即可接入攒数据。

---

## 9. 不在范围内

- 完整多租户用户体系与细粒度权限（仅项目级 API Key 隔离）
- OTLP/OpenTelemetry 协议兼容（仅在字段设计上保持可映射）
- 多阶段 pipeline 的全链路回放（MVP 仅单点回放）
- 真实执行工具的"live 重跑"（仅 mock 回放）
- 移动端适配
