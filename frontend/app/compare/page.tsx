"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { GitCompare, History } from "lucide-react";
import { api, TraceDetail, TraceSummary } from "@/lib/api";
import { alignTraces, flattenTree } from "@/lib/align";
import { formatCost, formatLatency } from "@/lib/format";
import { AlignedTraceView } from "@/components/AlignedTraceView";
import { JudgePanel } from "@/components/JudgePanel";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricText } from "@/components/MetricText";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProject } from "@/contexts/ProjectContext";
import { useIsDesktop } from "@/lib/hooks";

const RECENT_KEY = "promptscope.recentCompares";
const RECENT_LIMIT = 5;

interface RecentCompare {
  a: string;
  b: string;
  aName?: string;
  bName?: string;
  ts: number;
}

function readRecentCompares(): RecentCompare[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecentCompare(entry: RecentCompare) {
  try {
    const existing = readRecentCompares().filter((r) => !(r.a === entry.a && r.b === entry.b));
    const next = [entry, ...existing].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用时静默跳过
  }
}

function formatRelativeTime(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}

function pct(a: number | null, b: number | null): string {
  if (a === null || b === null || a === 0) return "—";
  const d = ((b - a) / a) * 100;
  if (d === 0) return "±0%";
  return `${d > 0 ? "↑" : "↓"} ${Math.abs(d).toFixed(0)}%`;
}

function deltaClass(delta: string, neutral: boolean): string {
  if (neutral || delta.startsWith("±")) return "text-muted-foreground";
  if (delta.startsWith("↓")) return "text-success";
  if (delta.startsWith("↑")) return "text-destructive";
  return "text-muted-foreground";
}

function Summary({ a, b }: { a: TraceDetail; b: TraceDetail }) {
  const stepsA = flattenTree(a.observations).length;
  const stepsB = flattenTree(b.observations).length;
  const items = [
    {
      label: "总成本",
      value: `${formatCost(a.total_cost)} → ${formatCost(b.total_cost)}`,
      delta: pct(a.total_cost, b.total_cost),
      neutral: false,
    },
    {
      label: "总延迟",
      value: `${formatLatency(a.latency_ms)} → ${formatLatency(b.latency_ms)}`,
      delta: pct(a.latency_ms, b.latency_ms),
      neutral: false,
    },
    {
      label: "Tokens (in)",
      value: `${a.total_input_tokens} → ${b.total_input_tokens}`,
      delta: pct(a.total_input_tokens, b.total_input_tokens),
      neutral: false,
    },
    {
      label: "步数",
      value: `${stepsA} → ${stepsB}`,
      delta: pct(stepsA, stepsB),
      neutral: true,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">{it.label}</p>
            <MetricText value={it.value} className="block text-sm" />
            <p className={`text-2xl font-mono tabular-nums ${deltaClass(it.delta, it.neutral)}`}>
              {it.delta}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PickB({ aId }: { aId: string }) {
  const { currentProject } = useProject();
  const router = useRouter();
  const [candidates, setCandidates] = useState<TraceSummary[]>([]);

  useEffect(() => {
    if (!currentProject) return;
    api.getTraces({ projectId: currentProject.id, limit: 100 })
      .then((r) => setCandidates(r.items.filter((t) => t.id !== aId)))
      .catch(() => {});
  }, [currentProject, aId]);

  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <p className="text-sm text-muted-foreground">选择要与之对比的另一条 trace：</p>
        <select
          className="w-full max-w-xl rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          defaultValue=""
          onChange={(e) => e.target.value && router.push(`/compare?a=${aId}&b=${e.target.value}`)}
        >
          <option value="" disabled>选择 trace…</option>
          {candidates.map((t) => (
            <option key={t.id} value={t.id}>
              {(t.name || t.id.slice(0, 8))} · {t.model_summary || "?"} · {formatCost(t.total_cost)} · {t.origin}
            </option>
          ))}
        </select>
      </CardContent>
    </Card>
  );
}

function TraceHeader({ t, side }: { t: TraceDetail; side: string }) {
  return (
    <div className="flex flex-1 items-center gap-2 px-3 py-2 text-sm">
      <span className="text-xs text-muted-foreground">{side}</span>
      <Link href={`/traces/${t.id}`} className="font-semibold hover:text-primary">
        {t.name || t.id.slice(0, 8)}
      </Link>
      <StatusBadge kind={t.origin === "replay" ? "replay" : "live"} />
    </div>
  );
}

function RecentCompares() {
  const [recent, setRecent] = useState<RecentCompare[]>([]);

  useEffect(() => {
    setRecent(readRecentCompares());
  }, []);

  if (recent.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <History className="h-3.5 w-3.5" /> 最近对比
        </p>
        <div className="divide-y">
          {recent.map((r) => (
            <Link
              key={`${r.a}-${r.b}`}
              href={`/compare?a=${r.a}&b=${r.b}`}
              className="flex items-center justify-between gap-2 py-2 text-sm hover:text-primary"
            >
              <span className="truncate">
                {(r.aName || r.a.slice(0, 8))} ↔ {(r.bName || r.b.slice(0, 8))}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(r.ts)}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CompareContent() {
  const params = useSearchParams();
  const aId = params.get("a");
  const bId = params.get("b");
  const [a, setA] = useState<TraceDetail | null>(null);
  const [b, setB] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    setA(null); setB(null); setError(null);
    if (aId) api.getTrace(aId).then(setA).catch((e) => setError(String(e)));
    if (bId) api.getTrace(bId).then(setB).catch((e) => setError(String(e)));
  }, [aId, bId]);

  useEffect(() => {
    if (a && b) {
      writeRecentCompare({
        a: a.id,
        b: b.id,
        aName: a.name || undefined,
        bName: b.name || undefined,
        ts: Date.now(),
      });
    }
  }, [a, b]);

  const rows = useMemo(() => (a && b ? alignTraces(a.observations, b.observations) : []),
                       [a, b]);

  if (!aId) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <EmptyState
          icon={GitCompare}
          title="选择两条 trace 开始对比"
          description="从 Traces 列表勾选两条 trace 进入对比"
        />
        <RecentCompares />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">加载失败：{error}</p>
      </div>
    );
  }
  if (!a) return <div className="p-6"><p className="text-sm text-muted-foreground">加载中…</p></div>;
  if (!bId) return <div className="mx-auto max-w-3xl p-6"><PickB aId={aId} /></div>;
  if (!b) return <div className="p-6"><p className="text-sm text-muted-foreground">加载中…</p></div>;

  const mainColumn = (
    <div className="space-y-4">
      <Summary a={a} b={b} />
      <Card className="overflow-hidden">
        <div className="flex divide-x border-b">
          <TraceHeader t={a} side="A" />
          <div className="w-16 shrink-0" />
          <TraceHeader t={b} side="B" />
        </div>
        <AlignedTraceView rows={rows} />
      </Card>
    </div>
  );

  const judgeColumn = <JudgePanel subjectId={a.id} compareId={b.id} projectId={a.project_id} />;

  return (
    <div className="p-6">
      {isDesktop ? (
        <div className="grid grid-cols-[1fr_360px] gap-6">
          {mainColumn}
          {judgeColumn}
        </div>
      ) : (
        <Tabs defaultValue="aligned">
          <TabsList>
            <TabsTrigger value="aligned">对齐视图</TabsTrigger>
            <TabsTrigger value="judge">Judge 评分</TabsTrigger>
          </TabsList>
          <TabsContent value="aligned" className="mt-4">
            {mainColumn}
          </TabsContent>
          <TabsContent value="judge" className="mt-4">
            {judgeColumn}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <div>
      <PageHeader crumbs={[{ label: "对比" }]} subtitle="逐条对齐两次运行，查看差异并交叉打分。" />
      <Suspense fallback={<div className="p-6"><p className="text-sm text-muted-foreground">加载中…</p></div>}>
        <CompareContent />
      </Suspense>
    </div>
  );
}
