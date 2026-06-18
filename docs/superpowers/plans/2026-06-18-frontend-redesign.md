# PromptScope 前端重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重写前端，实现"实验分组 accordion 左栏 + 真实 Judge 对比右栏"的完整操作流程。

**Architecture:** 单页两栏布局。左栏读 `/api/experiments` 渲染实验 accordion，右栏按选中状态机渲染对比面板，`POST /api/compare` 触发真实 LLM Judge，结果配合 cost-vs-latency 散点图展示。状态全部用 local `useState`，不引入新依赖。

**Tech Stack:** Next.js 14 App Router, TypeScript, TailwindCSS, recharts（已装）, lucide-react（已装）

## Global Constraints

- 所有组件文件放在 `frontend/components/`
- 使用 `cn()` from `@/lib/utils` 做条件 class
- 颜色色板：`["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"]`
- 主色 indigo：`#6366F1` hover `#4F46E5`
- 背景 `#F9FAFB`，边框 `#E5E7EB`，文字主 `#1F2937`，辅 `#6B7280`
- `cost_diff` 定义：`cost_b - cost_a`（正数 = A 更便宜）
- 前端开发服务器：`cd frontend && npm run dev`（端口 3000）
- 后端需在 8000 端口运行（`cd backend && uvicorn main:app --reload --port 8000`）

---

## File Map

| 操作 | 路径 | 说明 |
|------|------|------|
| 删除 | `frontend/components/CandidateList.tsx` | 废弃 |
| 删除 | `frontend/components/CandidateCard.tsx` | 废弃 |
| 删除 | `frontend/components/ComparePanel.tsx` | 废弃 |
| 删除 | `frontend/components/SyncButton.tsx` | 由 SyncStatus 替代 |
| 重写 | `frontend/components/CostChart.tsx` | 当前文件未被使用，完全重写 |
| 新建 | `frontend/components/SyncStatus.tsx` | header 同步状态 + 按钮 |
| 新建 | `frontend/components/CandidateItem.tsx` | 单个 candidate 行 |
| 新建 | `frontend/components/ExperimentList.tsx` | 实验 accordion 左栏 |
| 新建 | `frontend/components/JudgeResult.tsx` | judge 结果展示 |
| 新建 | `frontend/components/CompareWorkspace.tsx` | 右栏状态机容器 |
| 重写 | `frontend/app/page.tsx` | 主页，状态容器 |

---

## Task 1: 清理旧文件

**Files:**
- Delete: `frontend/components/CandidateList.tsx`
- Delete: `frontend/components/CandidateCard.tsx`
- Delete: `frontend/components/ComparePanel.tsx`
- Delete: `frontend/components/SyncButton.tsx`

- [ ] **Step 1: 删除四个废弃组件**

```bash
cd /Users/kj/projects/prompt-scope/promptscope/frontend/components
rm CandidateList.tsx CandidateCard.tsx ComparePanel.tsx SyncButton.tsx
```

- [ ] **Step 2: 验证删除成功**

```bash
ls /Users/kj/projects/prompt-scope/promptscope/frontend/components
```

期望输出只剩：`CostChart.tsx  layout/  ui/`

---

## Task 2: SyncStatus 组件

**Files:**
- Create: `frontend/components/SyncStatus.tsx`

**Interfaces:**
- Produces: `<SyncStatus onSyncComplete={() => void} />`

- [ ] **Step 1: 创建 SyncStatus.tsx**

```typescript
// frontend/components/SyncStatus.tsx
"use client";
import { useEffect, useState } from "react";
import { api, SyncStatus as SyncStatusType } from "@/lib/api";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncStatusProps {
  onSyncComplete: () => void;
}

export function SyncStatus({ onSyncComplete }: SyncStatusProps) {
  const [status, setStatus] = useState<SyncStatusType | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    api.getSyncStatus().then(setStatus).catch(console.error);
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.sync();
      const newStatus = await api.getSyncStatus();
      setStatus(newStatus);
      onSyncComplete();
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  const timeAgo = status?.last_sync ? formatTimeAgo(new Date(status.last_sync)) : "从未";

  return (
    <div className="flex items-center gap-3">
      {status?.status === "mock" && (
        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
          Mock 数据
        </span>
      )}
      <span className="text-xs text-[#6B7280]">
        上次同步: {timeAgo} · {status?.count ?? 0} 条
      </span>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#6B7280] border border-[#E5E7EB] rounded-lg hover:bg-[#F3F4F6] disabled:opacity-50 transition-colors"
      >
        <RotateCcw className={cn("h-3 w-3", syncing && "animate-spin")} />
        {syncing ? "同步中..." : "同步"}
      </button>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
```

- [ ] **Step 2: 启动开发服务器，确认无 TypeScript 错误**

先确保后端在运行：
```bash
cd /Users/kj/projects/prompt-scope/promptscope/backend
source .venv/bin/activate && uvicorn main:app --reload --port 8000
```

另开终端：
```bash
cd /Users/kj/projects/prompt-scope/promptscope/frontend
npm run dev
```

期望：编译成功，无 TS 错误（此时 SyncStatus 还没被 page.tsx 引用，不影响页面）

---

## Task 3: CandidateItem + ExperimentList

**Files:**
- Create: `frontend/components/CandidateItem.tsx`
- Create: `frontend/components/ExperimentList.tsx`

**Interfaces:**
- Consumes: `Candidate` from `@/lib/api`
- Produces:
  - `<CandidateItem candidate={Candidate} index={number} isSelected={boolean} onToggle={(id: string) => void} />`
  - `<ExperimentList experiments={Record<string, Candidate[]>} selectedIds={string[]} onToggle={(id: string) => void} />`

- [ ] **Step 1: 创建 CandidateItem.tsx**

```typescript
// frontend/components/CandidateItem.tsx
import { Candidate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const COLOR_BARS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"];

interface CandidateItemProps {
  candidate: Candidate;
  index: number;
  isSelected: boolean;
  onToggle: (id: string) => void;
}

export function CandidateItem({ candidate, index, isSelected, onToggle }: CandidateItemProps) {
  const color = COLOR_BARS[index % COLOR_BARS.length];
  const totalTokens = (candidate.input_tokens ?? 0) + (candidate.output_tokens ?? 0);

  return (
    <div
      onClick={() => onToggle(candidate.id)}
      className={cn(
        "relative flex items-center gap-2.5 px-2.5 py-2 cursor-pointer rounded-lg transition-all",
        isSelected
          ? "bg-indigo-50 border border-indigo-200"
          : "hover:bg-[#F3F4F6] border border-transparent"
      )}
    >
      <div className="w-1 h-7 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1F2937] truncate">{candidate.model}</p>
        <p className="text-xs text-[#9CA3AF]">
          ${candidate.cost.toFixed(4)} · {candidate.latency.toFixed(1)}s · {totalTokens}t
        </p>
      </div>
      {isSelected && <Check className="h-3.5 w-3.5 text-indigo-500 shrink-0" />}
    </div>
  );
}
```

- [ ] **Step 2: 创建 ExperimentList.tsx**

```typescript
// frontend/components/ExperimentList.tsx
"use client";
import { useState } from "react";
import { Candidate } from "@/lib/api";
import { CandidateItem } from "./CandidateItem";
import { ChevronDown, ChevronRight } from "lucide-react";

interface ExperimentListProps {
  experiments: Record<string, Candidate[]>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}

export function ExperimentList({ experiments, selectedIds, onToggle }: ExperimentListProps) {
  const entries = Object.entries(experiments);
  const [openId, setOpenId] = useState<string | null>(
    entries.length > 0 ? entries[0][0] : null
  );

  if (entries.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-[#9CA3AF]">暂无实验数据</div>
    );
  }

  return (
    <div className="space-y-0.5 p-2">
      {entries.map(([expId, candidates]) => {
        const isOpen = openId === expId;
        const shortId = expId.length > 12 ? expId.slice(0, 12) + "…" : expId;
        return (
          <div key={expId}>
            <button
              onClick={() => setOpenId(isOpen ? null : expId)}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-[#F3F4F6] transition-colors text-left"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {isOpen
                  ? <ChevronDown className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0" />}
                <span className="text-xs font-medium text-[#374151] truncate" title={expId}>
                  {shortId}
                </span>
              </div>
              <span className="text-xs text-[#9CA3AF] shrink-0 ml-1">{candidates.length}</span>
            </button>
            {isOpen && (
              <div className="ml-1 mt-0.5 space-y-0.5">
                {candidates.map((c, i) => (
                  <CandidateItem
                    key={c.id}
                    candidate={c}
                    index={i}
                    isSelected={selectedIds.includes(c.id)}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: 验证编译**

```bash
# 在 frontend/ 目录下，确认 npm run dev 无 TS 报错
# 如果 dev server 已经在运行，保存文件后观察终端输出
```

期望：无 TypeScript 编译错误

---

## Task 4: JudgeResult + CostChart

**Files:**
- Create: `frontend/components/JudgeResult.tsx`
- Modify: `frontend/components/CostChart.tsx` （完全重写）

**Interfaces:**
- Consumes:
  - `CompareResult` from `@/lib/api`
  - `Candidate` from `@/lib/api`
- Produces:
  - `<JudgeResult result={CompareResult} candidateA={Candidate} candidateB={Candidate} />`
  - `<CostChart candidates={Candidate[]} selectedIds={string[]} />`

- [ ] **Step 1: 创建 JudgeResult.tsx**

```typescript
// frontend/components/JudgeResult.tsx
import { CompareResult, Candidate } from "@/lib/api";
import { CheckCircle2, XCircle, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface JudgeResultProps {
  result: CompareResult;
  candidateA: Candidate;
  candidateB: Candidate;
}

export function JudgeResult({ result, candidateA, candidateB }: JudgeResultProps) {
  // cost_diff = cost_b - cost_a. Positive = A is cheaper than B.
  const aSavesVsB = result.cost_diff > 0;
  const savePct =
    candidateB.cost > 0
      ? ((Math.abs(result.cost_diff) / candidateB.cost) * 100).toFixed(1)
      : "0";

  return (
    <div className="space-y-3">
      {/* Verdict */}
      <div
        className={cn(
          "flex items-center gap-3 p-3 rounded-lg",
          result.replaceable
            ? "bg-emerald-50 border border-emerald-200"
            : "bg-red-50 border border-red-200"
        )}
      >
        {result.replaceable ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
        ) : (
          <XCircle className="h-5 w-5 text-red-500 shrink-0" />
        )}
        <p
          className={cn(
            "text-sm font-semibold",
            result.replaceable ? "text-emerald-800" : "text-red-800"
          )}
        >
          {result.replaceable ? "可以替代" : "不建议替代"}
        </p>
        {result.from_cache && (
          <span className="ml-auto text-xs text-[#9CA3AF] bg-[#F3F4F6] px-2 py-0.5 rounded-full">
            已缓存
          </span>
        )}
      </div>

      {/* Scores */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#F9FAFB] rounded-lg p-3 text-center">
          <p className="text-xs text-[#6B7280] mb-1 truncate" title={candidateA.model}>
            {candidateA.model}
          </p>
          <p className="text-2xl font-bold text-[#1F2937]">{result.score_a.toFixed(1)}</p>
          <p className="text-xs text-[#9CA3AF]">/ 10</p>
        </div>
        <div className="bg-[#F9FAFB] rounded-lg p-3 text-center">
          <p className="text-xs text-[#6B7280] mb-1 truncate" title={candidateB.model}>
            {candidateB.model}
          </p>
          <p className="text-2xl font-bold text-[#1F2937]">{result.score_b.toFixed(1)}</p>
          <p className="text-xs text-[#9CA3AF]">/ 10</p>
        </div>
      </div>

      {/* Cost diff */}
      <div className="bg-[#F9FAFB] rounded-lg p-3 flex items-center gap-3">
        {aSavesVsB ? (
          <TrendingDown className="h-5 w-5 text-emerald-500 shrink-0" />
        ) : (
          <TrendingUp className="h-5 w-5 text-red-500 shrink-0" />
        )}
        <div>
          <p className="text-xs text-[#6B7280]">
            {aSavesVsB ? "替换后节省" : "替换后增加"}
          </p>
          <p
            className={cn(
              "text-sm font-semibold",
              aSavesVsB ? "text-emerald-600" : "text-red-600"
            )}
          >
            {aSavesVsB ? "↓" : "↑"} {savePct}%（${Math.abs(result.cost_diff).toFixed(5)}）
          </p>
        </div>
      </div>

      {/* Reason */}
      <div className="bg-[#F9FAFB] rounded-lg p-3">
        <p className="text-xs text-[#6B7280] mb-1.5">Judge 说明</p>
        <p className="text-sm text-[#374151] leading-relaxed">{result.reason}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 重写 CostChart.tsx**

```typescript
// frontend/components/CostChart.tsx
"use client";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Candidate } from "@/lib/api";

const COLOR_BARS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"];

interface CostChartProps {
  candidates: Candidate[];
  selectedIds: string[];
}

interface ChartPoint {
  x: number;
  y: number;
  model: string;
  id: string;
  color: string;
  selected: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DotShape(props: any) {
  const { cx, cy, payload } = props;
  const r = payload.selected ? 8 : 5;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={payload.color}
      stroke={payload.selected ? "#1F2937" : "none"}
      strokeWidth={payload.selected ? 2 : 0}
      opacity={0.85}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: ChartPoint = payload[0].payload;
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 text-xs shadow-sm">
      <p className="font-semibold text-[#1F2937] mb-1">{d.model}</p>
      <p className="text-[#6B7280]">成本: ${d.x.toFixed(5)}</p>
      <p className="text-[#6B7280]">延迟: {d.y.toFixed(2)}s</p>
    </div>
  );
}

export function CostChart({ candidates, selectedIds }: CostChartProps) {
  if (candidates.length === 0) return null;

  const data: ChartPoint[] = candidates.map((c, i) => ({
    x: c.cost,
    y: c.latency,
    model: c.model,
    id: c.id,
    color: COLOR_BARS[i % COLOR_BARS.length],
    selected: selectedIds.includes(c.id),
  }));

  return (
    <div>
      <p className="text-xs font-medium text-[#6B7280] mb-3">Cost vs Latency</p>
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
          <XAxis
            dataKey="x"
            type="number"
            name="成本"
            tickFormatter={(v: number) => `$${v.toFixed(3)}`}
            tick={{ fontSize: 10, fill: "#9CA3AF" }}
            label={{
              value: "成本 ($)",
              position: "insideBottomRight",
              offset: -4,
              fontSize: 10,
              fill: "#9CA3AF",
            }}
          />
          <YAxis
            dataKey="y"
            type="number"
            name="延迟"
            tickFormatter={(v: number) => `${v.toFixed(1)}s`}
            tick={{ fontSize: 10, fill: "#9CA3AF" }}
            label={{
              value: "延迟 (s)",
              angle: -90,
              position: "insideLeft",
              offset: 8,
              fontSize: 10,
              fill: "#9CA3AF",
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Scatter data={data} shape={<DotShape />} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: 验证编译**

保存后确认 `npm run dev` 无 TS 错误。

---

## Task 5: CompareWorkspace

**Files:**
- Create: `frontend/components/CompareWorkspace.tsx`

**Interfaces:**
- Consumes:
  - `<JudgeResult result={CompareResult} candidateA={Candidate} candidateB={Candidate} />`
  - `<CostChart candidates={Candidate[]} selectedIds={string[]} />`
  - `api.compare(idA: string, idB: string): Promise<CompareResult>`
- Produces: `<CompareWorkspace selectedCandidates={Candidate[]} allCandidates={Candidate[]} selectedIds={string[]} />`

注意：`page.tsx` 需给此组件传 `key={selectedIds.join(",")}` 以在选择变化时重置内部状态。

- [ ] **Step 1: 创建 CompareWorkspace.tsx**

```typescript
// frontend/components/CompareWorkspace.tsx
"use client";
import { useState } from "react";
import { Candidate, CompareResult, api } from "@/lib/api";
import { JudgeResult } from "./JudgeResult";
import { CostChart } from "./CostChart";
import { Play, MousePointerClick } from "lucide-react";

interface CompareWorkspaceProps {
  selectedCandidates: Candidate[];  // length 0, 1, or 2
  allCandidates: Candidate[];
  selectedIds: string[];
}

export function CompareWorkspace({
  selectedCandidates,
  allCandidates,
  selectedIds,
}: CompareWorkspaceProps) {
  const [judgeResult, setJudgeResult] = useState<CompareResult | null>(null);
  const [judging, setJudging] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);

  const handleJudge = async () => {
    if (selectedCandidates.length !== 2) return;
    setJudging(true);
    setJudgeError(null);
    try {
      const result = await api.compare(selectedCandidates[0].id, selectedCandidates[1].id);
      setJudgeResult(result);
    } catch {
      setJudgeError("Judge 评估失败，请重试");
    } finally {
      setJudging(false);
    }
  };

  // Empty state
  if (selectedCandidates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-8">
        <div className="w-14 h-14 bg-[#F3F4F6] rounded-full flex items-center justify-center mb-4">
          <MousePointerClick className="h-7 w-7 text-[#D1D5DB]" />
        </div>
        <p className="text-sm font-medium text-[#6B7280]">从左侧选择两个 Candidate 开始对比</p>
        <p className="text-xs text-[#9CA3AF] mt-1">点击选中，再点取消选中，最多同时选 2 个</p>
      </div>
    );
  }

  // Partial state (1 selected)
  if (selectedCandidates.length === 1) {
    const c = selectedCandidates[0];
    return (
      <div className="p-6 space-y-4">
        <CandidateCard candidate={c} label="已选择" />
        <p className="text-sm text-[#9CA3AF] text-center">再选择一个 Candidate 进行对比</p>
      </div>
    );
  }

  // 2 selected
  const [a, b] = selectedCandidates;
  return (
    <div className="p-6 space-y-5">
      {/* Side-by-side preview */}
      <div className="grid grid-cols-2 gap-4">
        <CandidateCard candidate={a} label="Candidate A" />
        <CandidateCard candidate={b} label="Candidate B" />
      </div>

      {/* Judge button */}
      {!judgeResult && (
        <button
          onClick={handleJudge}
          disabled={judging}
          className="w-full py-2.5 text-sm font-medium text-white bg-[#6366F1] rounded-lg hover:bg-[#4F46E5] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <Play className="h-4 w-4" />
          {judging ? "评估中..." : "运行 Judge"}
        </button>
      )}

      {judgeError && (
        <p className="text-sm text-red-500 text-center">{judgeError}</p>
      )}

      {/* Judge result */}
      {judgeResult && (
        <>
          <JudgeResult result={judgeResult} candidateA={a} candidateB={b} />
          <button
            onClick={() => { setJudgeResult(null); setJudgeError(null); }}
            className="text-xs text-[#6B7280] hover:text-[#1F2937] underline"
          >
            重新评估
          </button>
        </>
      )}

      {/* Cost chart for current experiment's candidates */}
      {allCandidates.length > 1 && (
        <div className="border-t border-[#E5E7EB] pt-5">
          <CostChart candidates={allCandidates} selectedIds={selectedIds} />
        </div>
      )}
    </div>
  );
}

// Internal helper component
function CandidateCard({ candidate, label }: { candidate: Candidate; label: string }) {
  const totalTokens = (candidate.input_tokens ?? 0) + (candidate.output_tokens ?? 0);
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-4 space-y-3">
      <div>
        <p className="text-xs text-[#6B7280] mb-0.5">{label}</p>
        <p className="text-sm font-semibold text-[#1F2937]">{candidate.model}</p>
        {candidate.prompt_id && (
          <p className="text-xs text-[#9CA3AF]">{candidate.prompt_id}</p>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-xs text-[#9CA3AF]">成本</p>
          <p className="text-sm font-medium text-[#1F2937]">${candidate.cost.toFixed(4)}</p>
        </div>
        <div>
          <p className="text-xs text-[#9CA3AF]">延迟</p>
          <p className="text-sm font-medium text-[#1F2937]">{candidate.latency.toFixed(1)}s</p>
        </div>
        <div>
          <p className="text-xs text-[#9CA3AF]">Tokens</p>
          <p className="text-sm font-medium text-[#1F2937]">{totalTokens}</p>
        </div>
      </div>
      <div>
        <p className="text-xs text-[#9CA3AF] mb-1">输出</p>
        <p className="text-xs text-[#374151] line-clamp-4 leading-relaxed">{candidate.output}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证编译**

保存后确认 `npm run dev` 无 TS 错误。

---

## Task 6: page.tsx 重写 + 集成验证

**Files:**
- Modify: `frontend/app/page.tsx`（完全重写）

**Interfaces:**
- Consumes: 所有上方任务产出的组件

- [ ] **Step 1: 重写 page.tsx**

```typescript
// frontend/app/page.tsx
"use client";
import { useState, useEffect } from "react";
import { api, Candidate } from "@/lib/api";
import { ExperimentList } from "@/components/ExperimentList";
import { CompareWorkspace } from "@/components/CompareWorkspace";
import { SyncStatus } from "@/components/SyncStatus";

export default function Page() {
  const [experiments, setExperiments] = useState<Record<string, Candidate[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openExperimentId, setOpenExperimentId] = useState<string | null>(null);

  const loadExperiments = async () => {
    try {
      const data = await api.getExperiments();
      setExperiments(data);
      // 默认展开第一个实验
      const firstId = Object.keys(data)[0] ?? null;
      setOpenExperimentId((prev) => prev ?? firstId);
    } catch (e) {
      console.error("Failed to load experiments:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExperiments();
  }, []);

  const toggleCandidate = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  // 右栏显示当前展开实验的所有 candidates，用于 CostChart
  const allCandidatesInView = openExperimentId
    ? (experiments[openExperimentId] ?? [])
    : Object.values(experiments).flat();

  const selectedCandidates = Object.values(experiments)
    .flat()
    .filter((c) => selectedIds.includes(c.id));

  return (
    <div className="h-screen flex flex-col bg-[#F9FAFB]">
      {/* Header */}
      <header className="bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-bold text-[#1F2937]">PromptScope</h1>
        <SyncStatus onSyncComplete={loadExperiments} />
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Experiment List */}
        <aside className="w-56 shrink-0 bg-white border-r border-[#E5E7EB] overflow-y-auto">
          <div className="px-3 py-2 border-b border-[#F3F4F6]">
            <p className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider">实验列表</p>
          </div>
          {loading ? (
            <div className="p-4 text-sm text-[#9CA3AF]">加载中...</div>
          ) : (
            <ExperimentList
              experiments={experiments}
              selectedIds={selectedIds}
              onToggle={toggleCandidate}
            />
          )}
        </aside>

        {/* Right: Compare Workspace */}
        <main className="flex-1 overflow-y-auto">
          <CompareWorkspace
            key={selectedIds.join(",")}
            selectedCandidates={selectedCandidates}
            allCandidates={allCandidatesInView}
            selectedIds={selectedIds}
          />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 端对端功能验证**

确保后端在 8000 端口运行，然后访问 http://localhost:3000

**验证清单：**

1. **页面加载**：左栏显示实验列表，默认展开第一个实验；Header 显示同步状态和条数
2. **展开/收起**：点击实验名称可展开/收起 candidate 列表
3. **选择 1 个**：右栏显示单个 candidate 卡片 + "再选一个"提示
4. **选择 2 个**：右栏出现双栏预览 + "运行 Judge" 按钮
5. **运行 Judge**：按钮变为"评估中..."，完成后显示 JudgeResult（可替代性 + 评分 + 成本差 + 说明）
6. **CostChart**：Judge 结果下方出现散点图，选中的两个点有描边高亮
7. **Mock 数据**：如果后端 Langfuse 未配置，Header 显示橙色"Mock 数据"徽章
8. **手动同步**：点击"同步"按钮，旋转动画，完成后更新同步时间
9. **选择第 3 个**：最早选中的被替换，只保持 2 个选中
10. **重新评估**：点击"重新评估"链接，Judge 结果清空，重新显示"运行 Judge"按钮

- [ ] **Step 3: 检查 TypeScript 类型**

```bash
cd /Users/kj/projects/prompt-scope/promptscope/frontend
npx tsc --noEmit
```

期望：无错误或仅有无关的已有类型警告

---

## 自检：Spec 覆盖确认

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 删除假配置面板 | Task 1（删除旧组件）+ Task 6（新 page.tsx 无配置面板） |
| 实验分组 accordion 左栏 | Task 3 ExperimentList |
| 同步状态 Header | Task 2 SyncStatus |
| 右栏状态机（empty/partial/ready/judging/result） | Task 5 CompareWorkspace |
| 双栏 candidate 预览（model/cost/latency/token/output） | Task 5 CandidateCard（内联 helper） |
| 真实 Judge API 调用 | Task 5 handleJudge → api.compare() |
| JudgeResult（可替代性/评分/成本差/理由/缓存徽章） | Task 4 JudgeResult |
| CostChart cost vs latency 散点图 | Task 4 CostChart |
| 选中点高亮 | Task 4 CostChart DotShape |
| key 重置 CompareWorkspace 状态 | Task 6 page.tsx key prop |
