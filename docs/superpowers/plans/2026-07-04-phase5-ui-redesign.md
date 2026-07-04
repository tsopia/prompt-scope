# Phase 5: UI 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec（2026-07-04-ui-redesign-design.md）完成双主题设计体系、侧边栏骨架、六页重排与动线改造、项目/API Key 管理、Playwright E2E 全链路验证。

**Architecture:** shadcn/ui 组件源码入仓 + next-themes 双主题；语义 token 全站唯一色彩来源；页面逐个重构（每任务保持全站可 build 可用）；最小后端补充（projects/keys 端点）；E2E 用真实前后端 + Python SDK 灌数。

**Tech Stack:** Next.js 14, Tailwind, shadcn/ui (Radix), next-themes, lucide-react, sonner, @playwright/test

**Spec:** `docs/superpowers/specs/2026-07-04-ui-redesign-design.md`

## Global Constraints

- git 提交信息不含任何 AI 署名
- **组件代码零硬编码色值**——一切颜色走语义 token（`bg-background`/`text-muted-foreground`/`text-success` 等）；review 时 grep `#[0-9a-fA-F]{3,6}` 在 tsx 中应为 0 命中（svg/logo 除外）
- 数字（成本/延迟/token/分数）一律 `font-mono tabular-nums`；成本 4 位有效数字 + tooltip 全精度
- 状态语义全站统一：绿=success/replaceable/pass，琥珀=param_mismatch/running，红=error/failed/unrecorded_call，紫=replay，蓝=live/info
- 每个任务结束：`npm run build && npx vitest run && npm run lint` 全绿（后端任务加 pytest）
- 后端业务逻辑不动（仅 Task 3 新增端点）；桌面优先 ≥1024px
- 允许的新依赖：radix 系（shadcn add 引入）、next-themes、lucide-react、sonner、cva/clsx/tailwind-merge/tailwindcss-animate、@playwright/test(dev)；此外不加

## 设计 token（Task 1 落地，后续任务只消费）

`frontend/app/globals.css` 定义（shadcn 变量约定，HSL 裸值）：

```css
:root {
  --background: 40 20% 98%; --foreground: 222 30% 12%;
  --card: 0 0% 100%; --card-foreground: 222 30% 12%;
  --popover: 0 0% 100%; --popover-foreground: 222 30% 12%;
  --primary: 200 85% 42%; --primary-foreground: 0 0% 100%;
  --secondary: 220 15% 94%; --secondary-foreground: 222 30% 12%;
  --muted: 220 15% 94%; --muted-foreground: 220 10% 42%;
  --accent: 220 15% 92%; --accent-foreground: 222 30% 12%;
  --destructive: 0 72% 48%; --destructive-foreground: 0 0% 100%;
  --border: 220 14% 88%; --input: 220 14% 85%; --ring: 200 85% 42%;
  --radius: 0.5rem;
  --success: 152 55% 36%; --warning: 32 90% 44%;
  --replay: 262 60% 52%; --live: 212 85% 48%;
}
.dark {
  --background: 222 20% 8%; --foreground: 220 14% 90%;
  --card: 222 18% 11%; --card-foreground: 220 14% 90%;
  --popover: 222 18% 10%; --popover-foreground: 220 14% 90%;
  --primary: 199 89% 55%; --primary-foreground: 222 47% 8%;
  --secondary: 222 14% 16%; --secondary-foreground: 220 14% 90%;
  --muted: 222 14% 16%; --muted-foreground: 220 10% 60%;
  --accent: 222 14% 18%; --accent-foreground: 220 14% 90%;
  --destructive: 0 62% 45%; --destructive-foreground: 220 14% 90%;
  --border: 222 14% 18%; --input: 222 14% 20%; --ring: 199 89% 55%;
  --success: 152 60% 42%; --warning: 38 90% 55%;
  --replay: 262 70% 65%; --live: 210 90% 60%;
}
```

`tailwind.config` 扩展 colors 按 shadcn 惯例映射全部变量，额外映射 `success/warning/replay/live`（含 `/xx` 透明度支持用 `hsl(var(--x) / <alpha-value>)`），`darkMode: ["class"]`。

---

### Task 1: 底座——shadcn/ui + 双主题

**Files:**
- Modify: `frontend/package.json`, `frontend/tailwind.config.ts|js`, `frontend/app/globals.css`, `frontend/app/layout.tsx`
- Create: `frontend/components.json`, `frontend/lib/utils.ts`(cn), `frontend/components/theme-provider.tsx`, `frontend/components/theme-toggle.tsx`, `frontend/components/ui/*`（shadcn add）

**Interfaces:**
- Produces: 上文全部 token；`cn()`；`<ThemeProvider>`（next-themes，attribute="class"，defaultTheme="dark"，enableSystem）；`<ThemeToggle/>`（亮/暗/系统三态图标组，lucide Sun/Moon/Monitor）；layout 挂 ThemeProvider + sonner `<Toaster richColors/>`；shadcn 组件：button badge card table select input textarea checkbox tabs tooltip dropdown-menu dialog skeleton separator scroll-area sonner

- [ ] Step 1: 安装依赖与初始化——优先 `npx shadcn@latest init -d` 与 `npx shadcn@latest add -y button badge card table select input textarea checkbox tabs tooltip dropdown-menu dialog skeleton separator scroll-area sonner`；CLI 交互卡住则手动装依赖并从 ui.shadcn.com 模式手写组件文件（组件源码固定、无网络内容依赖）；`npm i next-themes lucide-react`
- [ ] Step 2: globals.css 写入上文 token（保留 Tailwind 三指令），tailwind.config 映射；layout.tsx：`<html suppressHydrationWarning>` + ThemeProvider + Toaster；ThemeToggle 组件（三态，选中态高亮，`useTheme`）
- [ ] Step 3: 现有页面暂不改——验证 `npm run build && npx vitest run && npm run lint` 全绿（旧硬编码色仍在，后续任务逐页清除）
- [ ] Step 4: Commit `feat: add shadcn/ui foundation with dual theme tokens`

---

### Task 2: 布局骨架——侧边栏 + 页头

**Files:**
- Create: `frontend/components/layout/AppSidebar.tsx`, `frontend/components/layout/PageHeader.tsx`
- Modify: `frontend/app/layout.tsx`；Delete: `frontend/components/TopBar.tsx`

**Interfaces:**
- Produces: `AppSidebar`——240px（折叠 56px，按钮切换，localStorage `promptscope.sidebarCollapsed`）；结构：Logo → 项目切换器（shadcn Select，复用 useProject）→ 导航（Traces/Compare/Prompts/Settings，lucide 图标 List/GitCompare/FileText/Settings，`usePathname` 选中态 `bg-accent text-primary` 左侧 2px primary 指示条）→ 底部：ThemeToggle + `v0.5.0` 版本字 + 预留账户位（muted 圆形占位 tooltip「登录功能规划中」）
- `PageHeader({crumbs: {label, href?}[], actions?: ReactNode})`——面包屑 + 右侧动作槽；各页后续任务接入
- layout：`flex h-screen`，`<AppSidebar/>` + `<main className="flex-1 overflow-y-auto">`；ProjectProvider 保留

- [ ] Step 1: 实现两组件与 layout 重构（读现有 ProjectContext/TopBar 后动手）；所有颜色走 token
- [ ] Step 2: 全部 6 条路由手动 curl/浏览确认渲染在新骨架内（样式混搭是预期）；build+vitest+lint 全绿
- [ ] Step 3: Commit `feat: add sidebar shell with collapsible nav and page header`

---

### Task 3: 后端项目与 API Key 管理端点

**Files:**
- Create: `backend/schemas/projects.py`, `backend/routers/projects.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_projects_api.py`

**Interfaces:**
- Produces:
  - `POST /api/projects` `{name}` → `{id, name, created_at}`；重名 409
  - `GET /api/projects/{project_id}/keys` → `[{id, prefix, created_at, revoked_at}]`（创建时间倒序）
  - `POST /api/projects/{project_id}/keys` → `{id, prefix, key}`（明文仅此一次）；项目 404
  - `DELETE /api/keys/{key_id}` → `{revoked: true}`（置 revoked_at=utcnow，幂等：已吊销再删仍 200）；404
  - 复用 `services/auth.generate_api_key`；schemas：`ProjectCreate(name: str = Field(max_length=255))`, `ProjectOut2(id,name,created_at)`, `KeyOut(id,prefix,created_at,revoked_at)`, `KeyCreated(id,prefix,key)`

- [ ] Step 1: 失败测试（4 个：创建+重名 409；建 key 返回明文且列表只见 prefix；吊销后 revoked_at 非空且再删幂等 200；对不存在项目建 key 404）——fixtures 仿 test_config_api.py 的 client/db_session 模式
- [ ] Step 2: 实现（router 模式仿 routers/prompts.py）；main.py 挂载
- [ ] Step 3: 全量 pytest → 84 passed 无 warning（80+4）
- [ ] Step 4: Commit `feat: add project and api key management endpoints`

---

### Task 4: 基础展示组件 + 行级 diff 库

**Files:**
- Create: `frontend/components/StatusBadge.tsx`, `frontend/components/MetricText.tsx`, `frontend/components/EmptyState.tsx`, `frontend/components/CodeBlock.tsx`, `frontend/lib/linediff.ts`
- Test: `frontend/lib/__tests__/linediff.test.ts`, `frontend/components/__tests__/StatusBadge.test.tsx`
- Modify: `frontend/lib/format.ts`（formatCost 改 4 位有效数字，导出 formatCostFull 全精度）

**Interfaces:**
- Produces:
  - `StatusBadge({kind}: {kind: "success"|"error"|"running"|"warning"|"live"|"replay"|"pass"|"fail"|"replaceable"|"not_replaceable"})`——映射到统一语义色（Global Constraints 表），shadcn Badge 变体实现
  - `MetricText({value, title?}: {value: string; title?: string})`——`font-mono tabular-nums` + 可选 tooltip
  - `EmptyState({icon, title, description, action?})`
  - `CodeBlock({code, language?})`——muted 底 + 复制按钮（navigator.clipboard + toast）
  - `lib/linediff.ts`: `diffLines(a: string, b: string): {type: "same"|"add"|"del"; text: string}[]`——行级 LCS（复用 align.ts 的 LCS 思路，key=行内容）
  - `formatCost`: 4 位有效数字（`$0.002625`→`$0.002625`? 规则：`Number(v.toPrecision(4))`，小于 1e-6 显示 `<$0.000001`）；`formatCostFull(v)` 原始全精度
- Consumes: Task 1 tokens

- [ ] Step 1: TDD linediff（≥4 用例：全同、纯增、纯删、混合保持顺序）与 StatusBadge（渲染文本与语义 class 断言）
- [ ] Step 2: 实现全部组件；vitest 全绿（原 9 + 新增）
- [ ] Step 3: Commit `feat: add shared display components and line diff`

---

### Task 5: /traces 重构（表格 + 对比托盘 + onboarding）

**Files:**
- Modify: `frontend/app/traces/page.tsx`, `frontend/components/TraceTable.tsx`, `frontend/lib/api.ts`（追加 createProject/getProjectKeys/createProjectKey/revokeKey 四函数与类型——Task 3 契约）
- Create: `frontend/components/CompareTray.tsx`, `frontend/components/OnboardingCard.tsx`

**Interfaces:**
- Consumes: StatusBadge/MetricText/EmptyState/CodeBlock、shadcn table/input、PageHeader
- Produces:
  - 列表页：PageHeader（crumbs=[Traces]）；工具行=防抖 300ms 搜索（自实现 useDebounce hook 于 `frontend/lib/hooks.ts`）+ origin 分段控件（tabs 或 button group）+ 计数；表格 shadcn 化（hover 行高亮、数字列右对齐 MetricText、origin StatusBadge、模型列 secondary badge）
  - `CompareTray({selected: TraceSummary[], onRemove, onClear})`——固定底部浮层（选中≥1 显示）：名称芯片 ×N 可移除 + 「开始对比」（=2 时可用，Link /compare）+ 清空；main 区预留 padding-bottom 防遮挡
  - `OnboardingCard({projectName, apiKeyHint})`——空态三步卡：①去 Settings 建项目/Key（Link）②SDK 接入 CodeBlock（真实可运行 Python 片段，含 `PromptScopeClient("http://localhost:8000", "<你的 API Key>")` 与 llm/tool/set_output 示例，注明 tool_definitions 为可回放必需）③「刷新」按钮
  - 无 trace 且项目存在 → OnboardingCard；fetch 错误 → toast + 页内错误态

- [ ] Step 1: 实现（先读现页面与 Task 4 组件）；grep 无硬编码色
- [ ] Step 2: build+vitest+lint 全绿；浏览器验证列表/托盘/空态（可临时改 project 无数据验证空态）
- [ ] Step 3: Commit `feat: redesign traces list with compare tray and onboarding`

---

### Task 6: /traces/[id] 重构

**Files:**
- Modify: `frontend/app/traces/[id]/page.tsx`, `frontend/components/TraceTree.tsx`, `frontend/components/ObservationDetail.tsx`

**Interfaces:**
- Produces: PageHeader（crumbs=[Traces, 名称]，actions=回放▶(live)/加入对比/单点回放此步(选中 llm)）；指标条 MetricText 化；replay 产物页头显示源 trace 链接（metadata.source_trace_id）+ divergence 数徽章（GET /api/replays?source_trace_id 反查该 result 对应 run——按 result_trace_id 匹配）；TraceTree：节点行左 2px 状态色边条 + 类型 StatusBadge 小号 + span 分组可折叠（chevron）；ObservationDetail：messages 按 role 着色气泡（system=muted/user=live 淡底/assistant=success 淡底/tool=warning 淡底）、JSON 用 CodeBlock、mocked 徽章 tooltip 展示 recorded_input、error 用 destructive 卡
- Consumes: Task 4 组件、既有 api

- [ ] Step 1: 实现；无硬编码色
- [ ] Step 2: build+vitest（更新 TraceTree 既有 2 测试断言到新结构）+lint；浏览器验证 mock 数据的树/气泡/徽章
- [ ] Step 3: Commit `feat: redesign trace detail with grouped tree and role-colored messages`

---

### Task 7: /compare 重构

**Files:**
- Modify: `frontend/app/compare/page.tsx`, `frontend/components/AlignedTraceView.tsx`, `frontend/components/JudgePanel.tsx`

**Interfaces:**
- Produces: 布局 `xl:grid-cols-[1fr_360px]`（窄屏 Tabs 切"对齐视图/Judge"）；Summary=四指标卡（成本/延迟/tokens/步数：A→B 等宽 + 差值大字方向色，↓成本绿↑红，延迟同理）；AlignedTraceView：行 hover 双侧联动高亮、⚠ tooltip 内双侧入参 CodeBlock、点击行内联展开双侧 ObservationDetail（复用组件，紧凑模式 prop `compact?: boolean`）；JudgePanel 右栏常驻：无 judge 模型 → EmptyState 引导去 Settings；运行中每选中模型 skeleton 卡；结果卡 verdict 大标识 + ScoreBar token 化 + 重新评分；/compare 无参数 → EmptyState + 最近对比记录（localStorage `promptscope.recentCompares` 最近 5 组 {a,b,ts}，进入完整对比时写入，列表可点回）
- Consumes: Task 4/6 组件

- [ ] Step 1: 实现；无硬编码色
- [ ] Step 2: build+vitest+lint；浏览器验证 mock 双 weather 对比 + judge 卡 + 主题切换下配色
- [ ] Step 3: Commit `feat: redesign compare workspace with metric cards and side judge panel`

---

### Task 8: /replay/[id] 重构 + 完成动线

**Files:**
- Modify: `frontend/app/replay/[id]/page.tsx`

**Interfaces:**
- Produces: 左（源摘要卡 + 三分组表单卡：模型/参数/Prompt——库级联与编辑降级逻辑不变）右（历史时间线：竖线 + 状态点 StatusBadge + divergence 计数徽章 + 展开详情）；单点模式蓝条提示（目标节点名 + step）；**成功 → toast.success("回放完成，正在打开对比…") + `router.push('/compare?a=源&b=结果')`**；失败 → toast.error + 结果卡展开 error 与 partial trace 链接；运行中按钮 spinner + 表单 disabled + 说明文案
- Consumes: Task 4 组件、既有 createReplay/getReplays

- [ ] Step 1: 实现（保住三分支 override 优先级与 target 逻辑——回归重点）
- [ ] Step 2: build+vitest+lint；浏览器验证假 provider 失败动线 toast
- [ ] Step 3: Commit `feat: redesign replay page with timeline and auto-compare on success`

---

### Task 9: /prompts 重构

**Files:**
- Modify: `frontend/app/prompts/page.tsx`
- Create: `frontend/components/ReplayWithVersionDialog.tsx`

**Interfaces:**
- Produces: 左列表卡片化（选中态 accent）+ 新建表单 dialog 化；版本卡：v StatusBadge 风徽章 + 内容超 8 行折叠展开；双版本勾选 → 顶部 diff 卡用 `diffLines`（add 行 `bg-success/10`、del 行 `bg-destructive/10`、行首 +/- 等宽）；「使用此版本的 traces」折叠列表保留；版本卡新增「用此版本回放…」→ `ReplayWithVersionDialog({versionId, projectId})`：dialog 内列该项目 live traces（getTraces origin=live）单选 → 跳 `/replay/{traceId}?promptVersion={versionId}`；/replay 页读取 `?promptVersion=` 预选库版本（Task 8 已重构的页面加 searchParams 支持——本任务补该 query 处理）
- Consumes: diffLines、Task 4 组件

- [ ] Step 1: 实现
- [ ] Step 2: build+vitest+lint；浏览器验证 diff 与回放动线
- [ ] Step 3: Commit `feat: redesign prompts page with line diff and replay-with-version flow`

---

### Task 10: /settings 重构（tabs + 项目/密钥管理）

**Files:**
- Modify: `frontend/app/settings/page.tsx`, `frontend/contexts/ProjectContext.tsx`（暴露 `refreshProjects()`）

**Interfaces:**
- Produces: shadcn Tabs 三页——
  - **项目与密钥**：项目列表（当前项目高亮）+「新建项目」dialog（成功后 refreshProjects + 切换到新项目 + toast）；选中项目的 Key 表（prefix mono/创建时间/状态[有效|已吊销]/吊销按钮→确认 dialog）；「新建 Key」→ 成功 dialog 一次性展示明文（CodeBlock 复制 + destructive 提示"关闭后不再显示"）
  - **模型 Provider**：现功能样式升级 + 行内编辑（编辑按钮 → 行变输入态 → 保存调 PUT `/api/providers/{id}`，api.ts 补 `updateProvider`；api_key 留空=不改）；删除加确认 dialog
  - **定价**：同 Provider 模式（补 `updatePricing`）
- Consumes: Task 3 端点、Task 4/5 的 api.ts 函数

- [ ] Step 1: 实现（api.ts 补 updateProvider/updatePricing）
- [ ] Step 2: build+vitest+lint；浏览器全流程点一遍（建项目→建 key→复制→吊销）
- [ ] Step 3: Commit `feat: redesign settings with tabs and project key management`

---

### Task 11: Playwright E2E 全链路

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/journey.spec.ts`, `frontend/e2e/theme.spec.ts`, `frontend/e2e/scripts/ingest_e2e.py`
- Modify: `frontend/package.json`（devDep @playwright/test + scripts `"e2e": "playwright test"`）, `frontend/.gitignore 或根 .gitignore`（playwright-report/, test-results/, e2e-screenshots/）

**Interfaces:**
- config：`webServer` 数组——backend：`bash -c "cd ../backend && rm -f db/e2e.db && DATABASE_URL=sqlite:///./db/e2e.db .venv/bin/uvicorn main:app --port 8100"`（port 8100, reuseExistingServer:false）；frontend：`bash -c "API_PROXY_HOST=http://localhost:8100 npm run dev -- --port 3100"`（port 3100）——注意 next.config rewrites 读环境变量在 dev 模式是启动时求值，可行；baseURL http://localhost:3100；workers:1（串行，共享后端状态）
- `ingest_e2e.py`：`sys.path` 注入 `../../sdk`，用 `PromptScopeClient(os.environ["PS_URL"], os.environ["PS_KEY"])` 上报 3 条 trace（两条同名可对比含 tool_definitions/messages 完整、一条 status=error），trace 名带 `e2e-` 前缀
- `journey.spec.ts` 单 test 串行走 spec §7 的 9 步：建项目`e2e-proj`→建 key（dialog 中抓明文）→`child_process.execFileSync('python3', ['e2e/scripts/ingest_e2e.py'], {env: {...process.env, PS_URL:'http://localhost:8100', PS_KEY: key}})`→列表断言/搜索/筛选→详情树点击→托盘对比→Summary/对齐行断言→settings 建假 provider+定价→judge 运行断言 error 文案出现（非假数据）→replay 提交断言失败态+历史出现→prompts 建版本 diff 断言→theme 三态切换 + `html.dark` class 断言 + reload 记忆
- `theme.spec.ts`：两主题 × 6 页截图到 `e2e-screenshots/`（`fullPage:true`，文件名 `{page}-{theme}.png`）——journey 已灌数后运行（依赖顺序：配 `dependencies` 或同文件顺序执行；简单起见 theme.spec 自己也跑一遍最小灌数或复用 journey 的库——用 playwright project dependencies：journey 为 setup project）
- python3 路径：优先 `backend/.venv/bin/python`（绝对路径由 config 注入 env）

- [ ] Step 1: 安装 `npm i -D @playwright/test && npx playwright install chromium`；写 config+ingest 脚本
- [ ] Step 2: journey.spec 逐步写逐步跑（`npx playwright test e2e/journey.spec.ts --headed=false`）直到全绿；期间发现的前端 bug 修在对应页面文件（记录在报告）
- [ ] Step 3: theme.spec 截图 12 张生成
- [ ] Step 4: build+vitest+lint+pytest 全绿 + `npm run e2e` 全绿
- [ ] Step 5: Commit `test: add playwright e2e journey and theme screenshots`

---

### Task 12: 收尾（文档 + 全量验证）

**Files:**
- Modify: `README.md`（前端章节：双主题、侧边栏、页面动线更新；E2E 运行说明 `npm run e2e`；/settings 建项目建 key 的 UI 流程替代 CLI 说明——CLI 保留）、`CLAUDE.md`（Frontend 架构更新：shadcn/ui、theme、组件清单、e2e；Key Design Decisions：零硬编码色值规矩、状态语义表）

- [ ] Step 1: 文档更新（对照真实代码）
- [ ] Step 2: 全量验证：backend 84 pytest 无 warning；frontend build+vitest+lint+e2e 全绿；grep 硬编码色值确认 tsx 0 命中
- [ ] Step 3: Commit `docs: update README and CLAUDE.md for UI redesign`

之后：整分支终审（fable，附 12 张主题截图供视觉判断）→ 修复 → 合并 master → 重启服务供用户查看。
