# PromptScope 前端重设计 Spec（视觉 + 动线全重构）

**日期:** 2026-07-04
**状态:** 方向已与用户确认（深色观测台默认气质、双主题、侧边栏、shadcn/ui），细节由执行方全权决定
**范围:** 前端全量重构 + 最小后端补充（项目/API Key 管理端点）+ Playwright E2E 全链路测试

---

## 1. 目标与背景

现状六个页面功能完整但视觉为"原型级"（默认 Tailwind、硬编码色值、无层级、无反馈），交互动线有断点。本次重构目标：

1. 建立完整设计体系（双主题语义 token），气质对标 Grafana/Langfuse 的专业观测台
2. 重排全部页面，优化操作连贯性（对比托盘、回放自动进对比、judge 前置等）
3. 补齐"第一次使用"的完整 UI 通路：建项目 → 拿 API Key → SDK 接入引导 → 看到数据
4. Playwright E2E 覆盖从建项目到对比调整的全链路（数据接入环节使用自家 Python SDK）
5. 为未来登录/商业化预留结构（侧边栏账户位、项目切换器可升级为团队切换器）

后端业务逻辑不动；仅新增项目/API Key 管理端点。

---

## 2. 技术选型

- **shadcn/ui**（组件源码入仓，依赖 Radix 原语 + cva/clsx/tailwind-merge/tailwindcss-animate + lucide-react 图标）
- **next-themes**：亮/暗/跟随系统三态，localStorage 记忆，首屏无闪烁（html class 策略）
- E2E：**@playwright/test**（devDependency），chromium 单浏览器
- 现有 vitest 组件测试保留并随组件重写更新

---

## 3. 设计体系

### 3.1 主题 token（shadcn 语义变量，两套值）

- **暗色（默认）**：深蓝灰底（≈ hsl(222 20% 8%)，非纯黑），card 比背景亮半档，border 低对比；primary 用青蓝（cyan-blue，≈ hsl(200 90% 55%)）；图表/状态色降饱和
- **亮色**：暖白底、清晰边框、同语义色的亮色版
- 硬规矩：**组件代码零硬编码色值**，全部走 token；语义状态色全站统一：绿=success/replaceable/pass，琥珀=param_mismatch/running，红=error/failed/unrecorded_call，紫=replay，蓝=live/info

### 3.2 排版

- 数字（成本/延迟/token/分数）一律 `font-mono tabular-nums`
- 成本统一 4 位有效数字 + tooltip 全精度；延迟 `1.2s`/`230ms`；token `5.2k`
- 五级文字层级：页标题 text-xl semibold / 区块 text-sm semibold / 表头 text-xs uppercase muted / 正文 text-sm / 辅助 text-xs muted-foreground

### 3.3 组件

shadcn 引入：button, badge, card, table, select, input, textarea, checkbox, tabs, tooltip, dropdown-menu, dialog, skeleton, separator, sonner(toast), scroll-area。
自定义组件按 token 重写：TraceTree, AlignedTraceView, ScoreBar, DivergenceItem, StatusBadge（统一状态徽章）, MetricText（等宽数字组件）, EmptyState, CodeBlock（带复制按钮，onboarding 用）。
加载态 → skeleton；变更操作反馈 → toast。

---

## 4. 布局骨架

```
┌─────┬──────────────────────────────────────┐
│ 侧  │ 页头：面包屑 + 页级动作（右对齐）        │
│ 边  ├──────────────────────────────────────┤
│ 栏  │ 内容区（流式宽度，max-w 按页面定）       │
│     │                                      │
└─────┴──────────────────────────────────────┘
```

**侧边栏**（240px，可折叠为 56px 纯图标，折叠态记忆）：
- 顶部：Logo「PromptScope」
- 项目切换器（下拉，未来升级为团队/项目二级）
- 导航：Traces（列表图标）/ Compare（对比图标）/ Prompts（文档图标）/ Settings（齿轮）——Replay 不入导航（永远从 trace 上下文进入）
- 底部：主题切换（亮/暗/系统三态图标按钮组）、版本号、预留账户位（未来放头像/登录态）

**Compare 入导航**的语义：无参数访问 /compare 显示"选择两条 trace"的引导 + 最近对比记录（localStorage 存最近 5 组 a/b 对）。

---

## 5. 页面重排与动线

### 5.1 /traces（默认首页）

- 工具行：搜索（防抖 300ms）+ origin 分段控件 + 结果计数
- 表格 shadcn 化：行 hover 高亮、名称列主字重、模型列徽章化、数字列右对齐等宽、origin 用 StatusBadge
- **对比托盘（关键动线改造）**：勾选任意 trace 后，底部浮出固定托盘显示已选项（名称芯片可单个移除），选满 2 个「开始对比」高亮——替代现在"勾了才出现的顶部按钮"
- 空态 = **Onboarding 卡**（三步引导）：① 建项目/看 API Key（跳 Settings）② SDK 接入代码块（真实可跑的 promptscope SDK 片段，带复制按钮，内嵌当前项目名）③ 「我已上报，刷新」按钮

### 5.2 /traces/[id]

- 页头：名称 + origin/status 徽章 + 指标条（等宽数字）+ 动作组（回放 ▶ / 加入对比 / 单点回放此步——选中 llm 节点时激活）
- 双栏：左链路树（可整体折叠 span 分组、节点行状态色左边条）/ 右节点详情（messages 气泡化按 role 着色、JSON 块深色语法底、mocked 徽章 + tooltip 显示 recorded_input）
- 若 trace 是 replay 产物：页头显示「源 trace」链接 + divergence 数徽章

### 5.3 /compare

- 布局改为 **主列 + 右侧 Judge 栏**（≥1280px 双列；窄屏 Judge 收为 tab）——judge 不再沉底
- Summary 升级为四张指标卡（成本/延迟/tokens/步数，差值大字 + 方向色）
- 对齐视图：行 hover 联动高亮、⚠ 徽章 tooltip 展示两侧入参 diff、点击行展开双侧节点详情（内联）
- Judge 栏：模型多选 → 运行（每卡 skeleton）→ 结果卡（verdict 大标识、双分数条、成本、重新评分）；无 judge 模型时引导去 Settings

### 5.4 /replay/[id]

- 左：源摘要卡 + 覆盖表单三分组卡（模型 / 参数 / Prompt——库级联 + 编辑降级逻辑不变，交互文案更清晰）
- 右：历史回放时间线（状态点 + divergence 计数徽章）
- **完成动线**：成功 → toast「回放完成」+ **自动跳转** `/compare?a=源&b=结果`；失败 → toast 错误 + 结果卡展开 error 与 partial 链接
- 运行中：按钮 spinner + 表单锁定 + 提示文案（同步执行、约耗时）

### 5.5 /prompts

- 左列表 + 右详情结构保留，样式卡片化
- 版本卡：v 徽章 + 时间 + 内容（收起超过 8 行，可展开）
- **行级 diff**：选中两个版本时，自实现行级 LCS diff（新增绿/删除红行底色）替代裸并排 pre
- 「使用此版本的 traces」折叠列表 + 每行跳转；版本卡加「用此版本回放…」入口（弹出选择该项目 live trace 的对话框 → 跳 /replay 预选版本）

### 5.6 /settings（tabs 化 + 新增项目管理）

- Tab 1 **项目与密钥**（新增）：项目列表（建项目对话框）；选中项目的 API Key 列表（prefix + 创建时间 + 吊销按钮）；「新建 Key」→ 对话框一次性展示明文（复制按钮 + 不再显示警告）
- Tab 2 **模型 Provider**：现有功能样式升级，行内编辑（PUT 端点已存在）
- Tab 3 **定价**：同上
- 危险操作（吊销 key、删 provider）加确认对话框

### 5.7 全局

- 面包屑：Traces / Trace 详情 / 对比 等层级
- 所有 fetch 错误统一 toast + 页面内错误态（不再静默）
- 骨架屏：列表页表格骨架、详情页树骨架

---

## 6. 后端补充（最小）

- `POST /api/projects` `{name}` → 项目（重名 409）
- `GET /api/projects/{id}/keys` → `[{id, prefix, created_at, revoked_at}]`
- `POST /api/projects/{id}/keys` → `{id, prefix, key}`（明文仅此一次）
- `DELETE /api/keys/{key_id}` → 吊销（置 revoked_at，非物理删除）
- 复用 `services/auth.generate_api_key`；无认证（与现有 config 端点一致，登录机制留待下阶段）

---

## 7. E2E 测试（@playwright/test）

**基建**：`frontend/e2e/`；`playwright.config.ts` 启动真实前后端（后端用独立临时 SQLite：`DATABASE_URL=sqlite:///./db/e2e.db`，测试前清理）；chromium。

**核心旅程测试（journey.spec.ts）——用户点名的全链路**：
1. 打开 /settings → 建项目 → 新建 API Key → 捕获明文 key
2. 用 **Python SDK**（子进程调用基于 sdk/promptscope 的 e2e 上报脚本，传入 key）灌入 2 条可对比 trace + 1 条错误 trace
3. /traces 验证列表渲染（名称/徽章/数字）、搜索、origin 筛选
4. 进 trace 详情：链路树节点点击 → 详情切换
5. 勾选 2 条 → 对比托盘 → /compare：对齐视图行数、Summary 差值渲染
6. /settings 配 provider（假 key）+ 定价 → /compare judge 运行 → 断言显示真实错误（不是假数据）
7. /replay 表单提交（假 provider）→ 断言失败态如实展示 + 历史列表出现记录
8. /prompts 建 prompt → 加版本 → 行级 diff 渲染 → 「用此版本回放」动线
9. 主题切换：三态切换 + html class 断言 + 刷新后记忆

**视觉冒烟（theme.spec.ts）**：暗/亮两主题下逐页截图存档（playwright screenshot，供人工回看）。

---

## 8. 实施与验证策略

- 新分支 `phase5-ui-redesign`，SDD 子代理执行，任务粒度：底座（shadcn+主题）→ 布局骨架 → 逐页重构 → 后端 keys 端点 → onboarding → E2E
- 每任务 build+lint+vitest 门禁；收尾跑全量 E2E + 双主题截图
- 完成后合并 master，服务重启供用户直接查看

## 9. 不在范围内

- 登录/鉴权体系（下阶段；本次仅留结构位）
- 移动端适配（桌面优先，≥1024px）
- 图表库引入（Cost vs Quality 散点图等数据可视化后续再议）
- 后端业务逻辑变更
