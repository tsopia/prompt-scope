"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, GitCompare, Star } from "lucide-react";
import { api, TraceDetail, TraceSummary } from "@/lib/api";
import { alignTraces, flattenTree } from "@/lib/align";
import { formatCost, formatLatency, formatRelativeTime } from "@/lib/format";
import { AlignedTraceView } from "@/components/AlignedTraceView";
import { JudgePanel } from "@/components/JudgePanel";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { MetricText } from "@/components/MetricText";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProject } from "@/contexts/ProjectContext";
import { useIsDesktop } from "@/lib/hooks";
import { cn } from "@/lib/utils";

// D1（UI 重设计计划附录）：收藏/最近的对比本次只落 localStorage，不新增后端持久化表
// （saved_comparisons 延后）。两套 key 各自独立读写，互不干扰。
const RECENT_KEY = "promptscope.recentCompares";
const SAVED_KEY = "promptscope.savedCompares";
const RECENT_LIMIT = 8;
const SAVED_LIMIT = 30;

interface RecentCompare {
  a: string;
  b: string;
  aName?: string;
  bName?: string;
  ts: number;
}

interface SavedCompare {
  a: string;
  b: string;
  name: string;
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

function readSavedCompares(): SavedCompare[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedCompare(entry: SavedCompare) {
  try {
    const existing = readSavedCompares().filter((s) => !(s.a === entry.a && s.b === entry.b));
    const next = [entry, ...existing].slice(0, SAVED_LIMIT);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用时静默跳过
  }
}

function pct(a: number | null, b: number | null): string {
  if (a === null || b === null || a === 0) return "—";
  const d = ((b - a) / a) * 100;
  if (d === 0) return "±0%";
  return `${d > 0 ? "↑" : "↓"} ${Math.abs(d).toFixed(0)}%`;
}

function Summary({ a, b }: { a: TraceDetail; b: TraceDetail }) {
  const stepsA = flattenTree(a.observations).length;
  const stepsB = flattenTree(b.observations).length;
  const items = [
    {
      label: "总成本",
      va: formatCost(a.total_cost), vb: formatCost(b.total_cost),
      delta: pct(a.total_cost, b.total_cost),
    },
    {
      label: "总延迟",
      va: formatLatency(a.latency_ms), vb: formatLatency(b.latency_ms),
      delta: pct(a.latency_ms, b.latency_ms),
    },
    {
      label: "Tokens (in)",
      va: String(a.total_input_tokens), vb: String(b.total_input_tokens),
      delta: pct(a.total_input_tokens, b.total_input_tokens),
    },
    {
      label: "步数",
      va: String(stepsA), vb: String(stepsB),
      delta: pct(stepsA, stepsB),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="space-y-2.5 p-4">
            <p className="text-xs text-muted-foreground">{it.label}</p>
            <div className="flex items-center justify-between text-sm">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-primary/15 text-[9px] font-bold text-primary">A</span>
              <MetricText value={it.va} className="text-[15px] font-semibold" />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-replay/15 text-[9px] font-bold text-replay-fg">B</span>
              <MetricText value={it.vb} className="text-[15px] font-semibold" />
            </div>
            <div className="flex items-center justify-between border-t border-border-soft pt-2.5 text-[11px] text-muted-foreground">
              <span>Δ (B−A)</span>
              {/* delta 用中性色（text-muted-foreground），只靠箭头方向传递信息，不做红绿判定 */}
              <MetricText value={it.delta} className="text-xs font-semibold text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TraceHeader({ t, side }: { t: TraceDetail; side: "A" | "B" }) {
  const badgeClass = side === "A" ? "bg-primary/15 text-primary" : "bg-replay/15 text-replay-fg";
  return (
    <div className="flex flex-1 items-center gap-2 px-3 py-2 text-sm">
      <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold", badgeClass)}>
        {side}
      </span>
      <Link href={`/traces/${t.id}`} className="font-semibold hover:text-primary">
        {t.name || t.id.slice(0, 8)}
      </Link>
      <MetricText value={t.id.slice(0, 10)} className="text-xs text-muted-foreground" />
      <StatusBadge kind={t.origin === "replay" ? "replay" : "live"} />
    </div>
  );
}

// ---------- Hub mode ----------

function TracePicker({
  label, badgeClass, traces, value, onChange,
}: {
  label: string;
  badgeClass: string;
  traces: TraceSummary[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = traces.find((t) => t.id === value) ?? null;
  const filtered = traces.filter((t) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return (t.name || "").toLowerCase().includes(needle) || t.id.toLowerCase().includes(needle);
  });

  return (
    <div className="relative min-w-[220px] flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-bg-grid px-3 text-sm"
      >
        <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold", badgeClass)}>
          {label}
        </span>
        <span className={cn("flex-1 truncate text-left", !selected && "text-muted-foreground")}>
          {selected ? (selected.name || selected.id.slice(0, 8)) : `选择链路 ${label}…`}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
          <div className="p-2">
            <Input
              autoFocus
              placeholder="搜索链路名称或 ID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">无匹配</p>
            )}
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { onChange(t.id); setOpen(false); setQ(""); }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent",
                  value === t.id && "bg-accent",
                )}
              >
                <span className="truncate">{t.name || t.id.slice(0, 8)}</span>
                <MetricText value={t.id.slice(0, 8)} className="shrink-0 text-[10px] text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NewComparisonCard() {
  const { currentProject } = useProject();
  const router = useRouter();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);

  useEffect(() => {
    if (!currentProject) return;
    api.getTraces({ projectId: currentProject.id, limit: 200 })
      .then((r) => setTraces(r.items))
      .catch(() => setTraces([]));
  }, [currentProject]);

  const canStart = Boolean(aId && bId && aId !== bId);

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <p className="text-sm font-semibold text-muted-foreground">新建对比</p>
        <div className="flex flex-wrap items-center gap-3">
          <TracePicker label="A" badgeClass="bg-primary/15 text-primary" traces={traces} value={aId} onChange={setAId} />
          <span className="shrink-0 text-xs font-semibold text-muted-foreground">vs</span>
          <TracePicker label="B" badgeClass="bg-replay/15 text-replay-fg" traces={traces} value={bId} onChange={setBId} />
          <Button
            disabled={!canStart}
            onClick={() => canStart && router.push(`/compare?a=${aId}&b=${bId}`)}
            className="shrink-0 gap-1.5"
          >
            <GitCompare className="h-4 w-4" />
            开始对比
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">也可在链路列表勾选 2 条后直接发起，或从回放结果一键进入。</p>
      </CardContent>
    </Card>
  );
}

function SavedCompares({ refreshKey }: { refreshKey: number }) {
  const [saved, setSaved] = useState<SavedCompare[]>([]);
  const [cacheCounts, setCacheCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    setSaved(readSavedCompares());
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    saved.forEach((s) => {
      const key = `${s.a}:${s.b}`;
      api.getEvaluations(s.a, s.b)
        .then((evs) => { if (!cancelled) setCacheCounts((prev) => ({ ...prev, [key]: evs.length })); })
        .catch(() => {
          // 评分缓存计数只是锦上添花的提示；接口失败时静默跳过，不影响收藏列表本体渲染
        });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  if (saved.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">收藏的对比</p>
        <MetricText value={String(saved.length)} className="text-xs text-muted-foreground" />
      </div>
      <Card className="overflow-hidden">
        <div className="divide-y">
          {saved.map((s) => {
            const n = cacheCounts[`${s.a}:${s.b}`] ?? 0;
            return (
              <Link
                key={`${s.a}-${s.b}`}
                href={`/compare?a=${s.a}&b=${s.b}`}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{s.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{s.a.slice(0, 8)} ↔ {s.b.slice(0, 8)}</p>
                </div>
                {n > 0 && <StatusBadge kind="success" label={`评分已缓存 ×${n}`} />}
                <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(new Date(s.ts).toISOString())}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      </Card>
    </section>
  );
}

function RecentCompares({ onSaved }: { onSaved: () => void }) {
  const [recent, setRecent] = useState<RecentCompare[]>([]);
  const [namingEntry, setNamingEntry] = useState<RecentCompare | null>(null);
  const [nameInput, setNameInput] = useState("");

  useEffect(() => {
    setRecent(readRecentCompares());
  }, []);

  if (recent.length === 0) return null;

  const openNaming = (e: React.MouseEvent, entry: RecentCompare) => {
    e.preventDefault();
    e.stopPropagation();
    setNamingEntry(entry);
    setNameInput(`${entry.aName || entry.a.slice(0, 8)} vs ${entry.bName || entry.b.slice(0, 8)}`);
  };

  const confirmSave = () => {
    if (!namingEntry || !nameInput.trim()) return;
    writeSavedCompare({ a: namingEntry.a, b: namingEntry.b, name: nameInput.trim(), ts: Date.now() });
    setNamingEntry(null);
    onSaved();
  };

  return (
    <section className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">最近的对比</p>
      <Card className="overflow-hidden">
        <div className="divide-y">
          {recent.map((r) => (
            <Link
              key={`${r.a}-${r.b}`}
              href={`/compare?a=${r.a}&b=${r.b}`}
              className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/60"
            >
              <span className="truncate">
                {(r.aName || r.a.slice(0, 8))} ↔ {(r.bName || r.b.slice(0, 8))}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatRelativeTime(new Date(r.ts).toISOString())}</span>
              <button
                type="button"
                title="收藏为命名对比"
                onClick={(e) => openNaming(e, r)}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-warning-fg"
              >
                <Star className="h-3.5 w-3.5" />
              </button>
            </Link>
          ))}
        </div>
      </Card>

      <Dialog open={!!namingEntry} onOpenChange={(o) => !o && setNamingEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>收藏为命名对比</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="给这组对比起个名字…"
          />
          <DialogFooter>
            <Button onClick={confirmSave} disabled={!nameInput.trim()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CompareHub() {
  const [savedRefreshKey, setSavedRefreshKey] = useState(0);
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <NewComparisonCard />
      <SavedCompares refreshKey={savedRefreshKey} />
      <RecentCompares onSaved={() => setSavedRefreshKey((k) => k + 1)} />
    </div>
  );
}

// ---------- Diff mode ----------

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

  if (!aId) return <CompareHub />;

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">加载失败：{error}</p>
      </div>
    );
  }
  if (!a) return <div className="p-6"><p className="text-sm text-muted-foreground">加载中…</p></div>;
  if (!bId) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState
          icon={GitCompare}
          title="再选一条 trace 完成对比"
          description="从下方新建对比里选择 B，或返回链路列表勾选两条。"
        />
      </div>
    );
  }
  if (!b) return <div className="p-6"><p className="text-sm text-muted-foreground">加载中…</p></div>;

  const mainColumn = (
    <div className="space-y-4">
      <Summary a={a} b={b} />
      <Card className="overflow-hidden">
        <div className="flex divide-x border-b bg-surface-2">
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
            <TabsTrigger value="judge">多模型评分</TabsTrigger>
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

function useHubSubtitle(): string {
  const params = useSearchParams();
  const isHub = !params.get("a");
  return isHub
    ? "收藏与最近的对比，或新建一组。评分按「链路对 + 裁判 + 上下文」缓存复用。"
    : "逐条对齐两次运行，查看差异并交叉打分。";
}

function ComparePageInner() {
  const subtitle = useHubSubtitle();
  return (
    <div>
      <PageHeader crumbs={[{ label: "对比" }]} subtitle={subtitle} />
      <CompareContent />
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="p-6"><p className="text-sm text-muted-foreground">加载中…</p></div>}>
      <ComparePageInner />
    </Suspense>
  );
}
