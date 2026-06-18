# PromptScope 前端重设计 Spec

**日期:** 2026-06-18  
**范围:** 仅前端重写，后端 API 不变  
**定位:** 纯分析工具——消费 Langfuse 已有数据，对比 LLM candidates，辅助做成本替代决策

---

## 1. 核心问题诊断

当前前端的主要缺陷：
1. 左侧配置面板（prompt 版本、模型、温度）是纯装饰，无任何功能绑定
2. `CompareDetail` 从未调用 `api.compare()`，显示的是假数据推算
3. `CostChart.tsx` 已写但 `page.tsx` 从未渲染
4. `components/` 下的组件全部废弃，`page.tsx` 重新内联了一套
5. Zustand store 存在但 `page.tsx` 用本地 `useState`

---

## 2. 整体布局

两栏布局，左窄右宽，全屏高度。

```
┌──────────────────────────────────────────────────────────┐
│ Header: PromptScope logo | 同步状态 | 手动同步按钮          │
├────────────────┬─────────────────────────────────────────┤
│ 实验列表 (左栏) │ 对比工作区 (右栏)                         │
│ 240px 固定宽   │ flex-1                                   │
│                │                                          │
│ ▼ exp-abc      │ 空状态 / 对比面板                         │
│   ● gpt-4o     │                                          │
│   ○ gpt-mini   │                                          │
│ ▶ exp-def      │                                          │
└────────────────┴─────────────────────────────────────────┘
```

---

## 3. 组件设计

### 3.1 Header

- 左：logo 文字 "PromptScope"
- 右：`SyncStatus`——显示 "上次同步: X 分钟前 · N 条数据"，状态为 `mock` 时加橙色警告徽章
- 右：`SyncButton`——手动触发 `POST /api/sync`，loading 期间禁用并显示旋转图标

### 3.2 ExperimentList（左栏）

- 页面加载时调用 `GET /api/experiments`
- 每个 experiment 是可展开的 accordion 项，标题显示 experiment_id（截断显示）+ candidate 数量
- 展开后列出该 experiment 的所有 `CandidateItem`
- 默认展开第一个 experiment

**CandidateItem**

每行显示：
- 左侧彩色竖条（按 index 取色）
- 模型名称（主要信息）
- `$0.0042` 成本 + `1.2s` 延迟（次要信息）
- 选中状态：蓝色 border + checkmark 图标

选择逻辑：
- 最多选 2 个，第 3 个点击替换最早选的那个
- 选中的 candidate 同步到右栏工作区

### 3.3 CompareWorkspace（右栏）

**状态机：**

```
EMPTY (0 selected)
  → 显示引导文案："从左侧选择两个 Candidate 开始对比"

PARTIAL (1 selected)  
  → 显示已选 candidate 的详情卡，提示"再选一个"

READY (2 selected, judge not run)
  → 显示双栏 candidate 详情 + "运行 Judge ▶" 按钮

JUDGING (API in flight)
  → 按钮变为 loading，内容区显示骨架屏

RESULT (judge complete)
  → JudgeResult 组件 + CostChart
```

**CandidatePreview（双栏对比）**

每栏显示：
- 模型名 + prompt_id（如有）
- 成本 / 延迟 / token 数（三个指标，小字）
- output 文本（最多显示 6 行，超出滚动）
- input 文本折叠（点击展开）

**JudgeResult**

Judge API 返回后显示：
- 顶部一行：✅ 可以替代 / ❌ 不建议替代（大字，绿/红色）
- 评分对比：Score A `8.2` vs Score B `9.0`（数字 + 进度条）
- 成本差：`↓ 80%`（绿色显著标出）+ 绝对值 `节省 $0.016`
- 理由文本（完整展示）
- `(from cache)` 徽章（如果是缓存结果）

**CostChart（Scatter Plot）**

- X 轴：cost（美元）
- Y 轴：latency（秒）——cost 和 latency 对所有 candidates 都有值，保证图表始终可渲染
- 每个点：hover tooltip 显示模型名 + cost + latency
- 当前选中的两个 candidate 高亮（更大的点 + 描边 + 标签）
- 数据范围：当前展开的 experiment 的所有 candidates
- 注：score 仅在 JudgeResult 文本区展示，不作为图表轴

---

## 4. 数据流

```
页面加载
  → GET /api/experiments
  → 左栏渲染实验列表，默认展开第一个
  → GET /api/sync/status（填充 header 同步状态）

用户选择 2 个 candidate
  → 右栏进入 READY 状态

用户点击"运行 Judge"
  → POST /api/compare { candidate_a, candidate_b }
  → 右栏进入 JUDGING 状态
  → 成功 → RESULT 状态，渲染 JudgeResult + CostChart
  → 失败 → 显示 inline 错误提示，按钮恢复可点击

手动同步
  → POST /api/sync
  → 完成后重新 GET /api/experiments 刷新列表
```

---

## 5. 状态管理

**不使用 Zustand**——该页面逻辑完全局限于单个视图，用 React `useState` + prop drilling 即可，无需全局 store。现有 `useStore.ts` 保留但本次不使用。

关键状态（在 `page.tsx` 顶层管理）：

```typescript
experiments: Record<string, Candidate[]>      // 从 API 取
syncStatus: SyncStatus                         // header 用
openExperimentId: string | null               // 当前展开的实验
selectedIds: [string?, string?]               // 最多 2 个
judgeResult: CompareResult | null             // judge 结果
judgeLoading: boolean
judgeError: string | null
```

---

## 6. 文件结构变化

**新增/重写：**
```
frontend/app/page.tsx                  ← 完全重写（主状态容器）
frontend/components/ExperimentList.tsx ← 新建
frontend/components/CandidateItem.tsx  ← 新建
frontend/components/CompareWorkspace.tsx ← 新建
frontend/components/JudgeResult.tsx    ← 新建
frontend/components/CostChart.tsx      ← 重写（现有文件未被使用）
frontend/components/SyncStatus.tsx     ← 新建（替代 SyncButton.tsx）
```

**删除（废弃的旧组件）：**
```
frontend/components/CandidateList.tsx  ← 删除
frontend/components/CandidateCard.tsx  ← 删除
frontend/components/ComparePanel.tsx   ← 删除
frontend/components/SyncButton.tsx     ← 删除（由 SyncStatus 替代）
```

---

## 7. 视觉风格

- 延续当前颜色：`#6366F1`（indigo）主色、`#F9FAFB` 背景、`#E5E7EB` 边框
- 候选颜色条色板：`["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"]`
- 全部使用 Tailwind utility class，不引入新 UI 库（shadcn 组件已有但不强依赖）
- 字体大小层级：标题 `text-base font-semibold`，主要数字 `text-xl font-bold`，辅助信息 `text-xs text-gray-500`

---

## 8. 不在此次范围内

- 后端任何修改
- 新建实验 / 运行新 LLM 调用
- 多实验跨组对比
- 用户认证
- 移动端适配
