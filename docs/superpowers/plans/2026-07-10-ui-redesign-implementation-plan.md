# UI 重设计落地计划（claude.ai/design → 代码）

> 依据：设计项目 `b9b56b0f-22d5-405c-aba9-2a97ed234832` 全部 7 页（Traces / TraceDetail / Compare / Replay / Prompts / Settings / Login）+ 现有后端 API 面逐项比对。
> 执行方式：按 Phase 推进；每个 Phase 开工时再按 writing-plans 惯例展开成带 TDD 步骤的任务简报。本文件是总纲 + 差距矩阵。

## 0. 设计系统总结（所有页面共享）

- Token（深/浅双套）：`--bg #0A0D14` / `--surface` / `--surface-2` / `--surface-hover` / `--border` / `--border-soft` / `--text`(3 级) / 品牌青 `--accent #22D3EE`（浅色 `#0E9BB8`）+ `accent-subtle/border`
- 5 状态各为 **fg/dot/bg 三元组**：live 蓝 / replay 紫 / pass 绿 / warn 琥珀 / fail 红；另有 diff-add/del
- 字体：Geist + Geist Mono（**沙箱无网，必须用 `geist` npm 包本地加载**，中文回退 PingFang SC）；数据一律 mono + tabular-nums
- 外壳：可折叠侧边栏（logo→工作区切换器→中文导航 链路/对比/提示词/设置→主题三档→账户[姓名+角色]）；页头=折叠钮+面包屑+标题+副标题+动作区
- 现有映射约束：品牌青→shadcn `--primary`（`--accent` 在 shadcn 语义里是 hover 面），保持 HSL token 结构不动 tailwind 消费方式；新增 token：`surface-2 / bg-grid / border-soft / text-3 / 各状态 fg 变体 / diff-add|del`

## 1. 后端支持度差距矩阵

### ✅ 后端已完全支持（纯前端工作）
| 设计功能 | 支撑 API |
|---|---|
| 工作区切换、成员角色显示（管理员=owner） | GET /api/projects、/api/auth/me、members |
| Traces 全部列/搜索/来源筛选/计数/多选对比托盘 | GET /api/traces（TraceSummary 字段齐） |
| 详情页指标/调用链树/llm-tool-span 节点详情/MOCK 徽章 | GET /api/traces/{id}（metadata 已暴露） |
| 回放整条/单步回放/成功自动跳对比 | POST /api/replays（target_observation_id） |
| **回放高级参数** top_p/freq/presence/max_tokens/stop | override_model_params 自由 JSON，engine 已合并透传 |
| System prompt「选版本为基准→编辑→dirty 只传文本」 | override_prompt_version_id / override_prompt_text |
| Compare 差异摘要/对齐视图/仅A仅B/参数偏离 | 前端 lib/align.ts |
| 多裁判评分、A/B 分、理由、评分缓存（×N 徽章） | POST/GET /api/evaluations（cache key 已含 judge+ctx） |
| 「重跑」replay trace | = 对 run.source 重发相同 overrides（trace.metadata.replay_run_id → GET /api/replays/{id}）纯接线 |
| Prompts 新建/fork/版本 diff/用此版本回放/使用链路列表 | prompts API + lib/linediff.ts |
| Settings 密钥一次性显示/撤销、定价 CRUD、成员增删+last-owner 锁 | 现有端点 |
| Login 登录/注册/allowRegister 开关 | /api/auth/*、/api/auth/config |

### ⚠️ 需要后端小改（本次纳入）
| # | 设计功能 | 差距 | 改法 |
|---|---|---|---|
| G1 | Traces 列表「偏离」状态徽章 | Trace.status 无 warn；偏离在 ReplayRun.divergences | TraceSummary 增 `divergence_count`（join ReplayRun on result_trace_id）；前端 success+count>0 → 偏离 |
| G2 | 回放历史每条显示成本/用时 | ReplayRunOut 无 result trace 聚合 | ReplayRunOut 增 `result_cost`/`result_latency_ms`（join traces，避免前端 N+1） |
| G3 | 偏离项带「步骤 N」 | divergence dict 是否带 step 未定 | engine append 时补 `step` 字段（无破坏） |
| G4 | Prompts 左列表显示版本数/最新版 | 列表接口是否带 count 待查 | PromptOut 列表加 `version_count`/`latest_version`（小查询） |
| G5 | 项目名称可编辑 | 无 rename 端点 | PUT /api/projects/{id}（owner-gated，name 唯一 409） |
| G6 | 密钥「名称」+「最近使用」列 | ApiKey 无 name/last_used_at | 加 nullable `name`（创建时传）+ `last_used_at`（require_api_key 时 touch）；migration-guard 安全 |
| G7 | Provider「种类」（官方直连/三方聚合）+ 备注 | ModelProvider 只有协议 provider_type | 加 nullable `kind`(official\|aggregator) + `note`；In/Out schema 扩展 |
| G8 | 「运行中」徽章用蓝色脉冲 | StatusBadge 现映射 running→amber | 前端改映射 running→live 蓝（CLAUDE.md 状态色条目同步更新） |

### 🔮 有差距但本次降级/延后（P2 清单）
| # | 设计功能 | 决定 |
|---|---|---|
| D1 | Compare Hub「收藏的对比」（命名收藏） | 本次 localStorage（连同「最近的对比」）；持久化表 saved_comparisons 延后 |
| D2 | 评分上下文 3 口径（完整对话/仅最终输出/工具输出对齐） | 前端先映射现有两种（with_trace/output_only）；`tools_aligned` 新口径延后 |
| D3 | 裁决三值文案（可替代/倾向保留 A/两者相当） | 前端按 verdict+分差映射展示；后端三值 schema 延后 |
| D4 | 成员「调整角色」 | 无 PUT role 端点；本次隐藏，延后 |
| D5 | 版本卡 fork 来源徽章（fork · v7） | PromptVersion 无 forked_from；本次不显示，延后加列 |
| D6 | 登录页 OAuth（Google/GitHub）、忘记密码 | 无 OAuth/重置实现；**默认隐藏**（auth/config 驱动）；对齐既有 AuthProvider SSO seam 延后实装 |
| D7 | 工作区「生产环境」副标签 | 无环境概念；砍掉（显示项目名即可） |
| D8 | 详情页「实时/回放」segmented 切换 | 设计预览用假开关；实际由 trace.origin 决定，落地为徽章 |

## 2. 实施阶段

**起点核对（Phase 0 首任务）**：工作区有未提交改动——`globals.css`+`tailwind.config.ts`（前次被停 agent 的 token 半成品，**须 diff 审查后采纳或重做，不盲信**）、`migrate_provider_project.py`（ensure_columns 修复，已验证，直接提交）。

- **Phase 0 · 设计系统地基**：token 双主题映射（含新增 token 与状态 fg 三元组）→ `geist` 本地字体接入 layout/tailwind → StatusBadge 扩展（G8 + fg 变体）。门槛：build/vitest/lint 全绿 + 浅深双主题人工确认。
- **Phase 1 · 工具链迁移**（独立 commit，随时可做）：前端 bun（bun.lock 生成、删 package-lock、e2e/docker/CLAUDE.md 命令替换、bun run build+vitest+e2e 全绿）；后端 uv（uv venv + requirements 安装、CLAUDE.md/docker 命令、pytest 全绿）。
- **Phase 2 · 外壳 + 登录**：AppSidebar 按设计重构（工作区切换器卡片、图标、账户区姓名+角色、折叠 66px）；PageHeader 面包屑化；Login 左右分屏（右窄表单+左 observatory 氛围动画调用链），OAuth/忘记密码隐藏（D6）。
- **Phase 3 · 链路两页 + G1/G3**：后端 divergence_count/step → Traces 网格表格重构（行内 tid、警示延迟色、托盘文案）→ TraceDetail 双栏（树 42px 行、卡片化节点详情、重跑接线）。
- **Phase 4 · 对比 + 回放 + G2**：Compare Hub（新建对比 picker、最近/收藏 localStorage）+ Diff 视图 + 评分面板（多选裁判、ctx 映射 D2、结果卡 D3）；Replay（高级参数区、prompt 基准选择器、结果卡、历史时间线含 G2）。
- **Phase 5 · 提示词 + 设置 + G4-G7**：Prompts（列表字段 G4、版本卡、diff 面板样式）；Settings（项目信息卡+rename G5、密钥表 G6、Provider 表 G7、成员表）。
- **Phase 6 · 收尾**：e2e 全链路更新（中文导航/新布局选择器）、双主题+无硬编码色审计（`grep hex` 红线）、CLAUDE.md 前端章节更新、demo seed 数据核对。

每个 Phase：后端改动先行（TDD，pytest 全绿）→ 前端页面 → build/vitest/lint 门 → 你在浏览器验收（我看不到渲染，视觉验收以你为准）。

## 3. 附录 · 每页功能清单（提要）

- **Traces**：搜索(名称/tid)、来源 segmented(全部/实时/回放)、11 列网格表、行选中高亮+全选、底部对比托盘(计数/提示/清除/开始对比)、计数标签「N 条 · 共 M」、刷新、接入 SDK。
- **TraceDetail**：面包屑(mono tid)、标题+来源/状态徽章、4 指标行、左树(缩进/折叠/状态点/类型 tag/MOCK/延迟)右详情(llm=模型参数+用量+消息序列+工具定义折叠；tool=input/output 折叠+来自录制；span=聚合)、回放整条/单步回放/重跑。
- **Compare**：Hub(新建对比 A/B picker、收藏的对比[评分缓存×N]、最近的对比[可收藏])；Diff(差异摘要 4 行 A/B/Δ/%、对齐视图 A|标记|B 三列[对齐/参数偏离/仅一侧]、多模型评分[多选裁判、上下文模式、结果卡 verdict+双分+理由+cached])。
- **Replay**：左配置(覆盖模型[标源]、温度滑杆、高级参数折叠[top_p/频率/存在惩罚/max_tokens/stop]、prompt 基准选择+可编辑+已修改/还原)、运行按钮+自动跳转提示；右结果(占位/结果卡[徽章/用时/→结果 trace/错误/偏离列表 code+步骤+描述/查看结果+去对比])+历史时间线(徽章/摘要/偏离数+成本+用时/时间/查看)。
- **Prompts**：左列表(新建[唯一名校验]/版本数/更新时间/latest)；右版本卡(勾选 2 个出 diff 面板[+N −M 行级]、最新徽章、fork 徽章、内容预览、基于此版本新建/用此版本回放/N 条链路使用展开)。
- **Settings**：4 Tab。项目与密钥(项目名可编辑/ID 不可改/密钥表[名称/前缀/创建/最近使用/状态/撤销]/新建密钥)；Provider(表[名称/种类/协议/base_url/api_key 已设]/增删改)；定价(表+增删改)；成员(邮箱添加/角色/移除[锁自己与最后 owner])。
- **Login**：右表单(登录↔注册切换、显示名/邮箱/密码、错误条、loading、OAuth 图标行、忘记密码、条款页脚)；左氛围(轨道环动画、逐步点亮的调用链卡片、状态色图例、「观测每一次 agent 运行」)。
