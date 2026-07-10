"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, FileText, GitFork, Inbox, Play, Plus } from "lucide-react";
import { api, PromptDetail, PromptSummary, PromptVersionInfo, VersionTrace } from "@/lib/api";
import { useProject } from "@/contexts/ProjectContext";
import { diffLines } from "@/lib/linediff";
import { formatRelativeTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { ReplayWithVersionDialog } from "@/components/ReplayWithVersionDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const COLLAPSE_LINES = 8;

// ---------- 左列表：新建 prompt 内联表单 ----------

function CreatePromptInlineForm({
  existingNames,
  projectId,
  onCreated,
  onCancel,
}: {
  existingNames: string[];
  projectId: string;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const trimmed = name.trim();
  const nameError =
    trimmed !== "" && existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());

  const submit = async () => {
    if (trimmed === "" || nameError || !content.trim()) return;
    setCreating(true);
    setServerError(null);
    try {
      const created = await api.createPrompt({ project_id: projectId, name: trimmed, content });
      onCreated(created.id);
    } catch (e) {
      setServerError(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mt-2.5 space-y-2 rounded-lg border border-border bg-bg-grid p-2.5">
      <Input
        autoFocus
        placeholder="prompt 名称（唯一）"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-9 font-mono text-xs"
      />
      {nameError && <p className="text-[11px] text-fail-fg">已存在同名 prompt</p>}
      <Textarea
        placeholder="初始版本内容"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="h-24 font-mono text-xs"
      />
      {serverError && <p className="text-[11px] text-destructive">{serverError}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-7 flex-1 text-xs"
          disabled={creating || trimmed === "" || nameError || !content.trim()}
          onClick={submit}
        >
          创建
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

// ---------- 右侧：版本 diff 面板 ----------

function DiffPanel({ oldV, newV }: { oldV: PromptVersionInfo; newV: PromptVersionInfo }) {
  const entries = useMemo(() => diffLines(oldV.content, newV.content), [oldV, newV]);
  const adds = entries.filter((e) => e.type === "add").length;
  const dels = entries.filter((e) => e.type === "del").length;

  return (
    <Card className="overflow-hidden border-accent-border" data-testid="diff-panel">
      <div className="flex h-11 items-center justify-between border-b border-border-soft bg-surface-2 px-4">
        <div
          className="flex items-center gap-2 font-mono text-[13px] font-semibold"
          data-testid="diff-version-range"
        >
          <span className="text-fail-fg">v{oldV.version}</span> <span className="text-text-3">→</span>{" "}
          <span className="text-success-fg">v{newV.version}</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11.5px]">
          <span className="text-diff-add-bar">+{adds}</span>
          <span className="text-diff-del-bar">−{dels}</span>
        </div>
      </div>
      <div className="overflow-x-auto py-1.5">
        {entries.map((e, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start",
              e.type === "add" && "border-l-2 border-l-diff-add-bar bg-diff-add-bg/10",
              e.type === "del" && "border-l-2 border-l-diff-del-bar bg-diff-del-bg/10",
              e.type === "same" && "border-l-2 border-l-transparent",
            )}
          >
            <span
              className={cn(
                "w-6 shrink-0 select-none text-center font-mono text-xs",
                e.type === "add" && "text-diff-add-bar",
                e.type === "del" && "text-diff-del-bar",
                e.type === "same" && "text-text-3",
              )}
            >
              {e.type === "add" ? "+" : e.type === "del" ? "−" : ""}
            </span>
            <pre
              className={cn(
                "flex-1 whitespace-pre-wrap break-words pr-4 font-mono text-[12.5px] leading-relaxed",
                e.type === "same" ? "text-text-3" : "text-muted-foreground",
              )}
            >
              {e.text || " "}
            </pre>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- 版本卡：使用此版本的 traces（展开） ----------

function VersionTracesSection({ versionId }: { versionId: string }) {
  const [open, setOpen] = useState(false);
  const [traces, setTraces] = useState<VersionTrace[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && traces === null) {
      api.getVersionTraces(versionId).then(setTraces).catch((e) => setError(String(e)));
    }
  };

  return (
    <div className="border-t border-border-soft">
      <button
        type="button"
        onClick={toggle}
        className="flex h-10 w-full items-center gap-1.5 px-4 text-xs text-muted-foreground hover:bg-surface-hover"
      >
        <span className="font-mono text-text-3">{traces?.length ?? "…"}</span> 条链路使用
        <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="bg-bg-grid">
          {error && <p className="px-4 py-2 text-xs text-destructive">加载失败：{error}</p>}
          {!error && traces === null && (
            <p className="px-4 py-2 text-xs text-muted-foreground">加载中…</p>
          )}
          {!error && traces !== null && traces.length === 0 && (
            <p className="px-4 py-2 text-xs text-muted-foreground">暂无引用</p>
          )}
          {traces?.map((t) => (
            <Link
              key={t.id}
              href={`/traces/${t.id}`}
              className="flex items-center gap-3 border-t border-border-soft px-4 py-2 text-xs hover:bg-surface-hover"
            >
              <StatusBadge kind={t.origin === "replay" ? "replay" : "live"} label={t.origin === "replay" ? "回放" : "实时"} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">
                {t.name || t.id.slice(0, 8)}
              </span>
              <span className="shrink-0 whitespace-nowrap font-mono text-[11.5px] text-text-3">
                {formatRelativeTime(t.created_at)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 版本卡 ----------

function VersionCard({
  version,
  isLatest,
  promptId,
  projectId,
  checked,
  onToggleCheck,
  onForkSubmit,
}: {
  version: PromptVersionInfo;
  isLatest: boolean;
  promptId: string;
  projectId: string;
  checked: boolean;
  onToggleCheck: () => void;
  onForkSubmit: () => void;
}) {
  const [forkOpen, setForkOpen] = useState(false);
  const [content, setContent] = useState(version.content);
  const [forkError, setForkError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);

  const lines = version.content.split("\n");
  const isLong = lines.length > COLLAPSE_LINES;
  const displayContent = expanded || !isLong ? version.content : lines.slice(0, COLLAPSE_LINES).join("\n");

  const startFork = () => {
    setContent(version.content);
    setForkError(null);
    setForkOpen(true);
  };

  const submitFork = async () => {
    setSubmitting(true);
    setForkError(null);
    try {
      await api.addPromptVersion(promptId, content);
      setForkOpen(false);
      onForkSubmit();
    } catch (e) {
      setForkError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card
      className={cn(
        "overflow-hidden transition-colors",
        checked ? "border-accent-border shadow-[0_0_0_1px_hsl(var(--accent-border))]" : "border-border",
      )}
    >
      <div className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
        <Checkbox checked={checked} onCheckedChange={onToggleCheck} aria-label={`选中 v${version.version}`} />
        <span className="font-mono text-sm font-semibold">v{version.version}</span>
        {isLatest && (
          <Badge className="border-transparent bg-success/15 px-2 py-0 text-[10px] font-semibold text-success-fg hover:bg-success/15">
            最新
          </Badge>
        )}
        <div className="flex-1" />
        <span className="whitespace-nowrap font-mono text-[11.5px] text-text-3">
          {formatRelativeTime(version.created_at)}
        </span>
      </div>
      <div className="px-4 py-3">
        <pre className="max-h-[220px] overflow-hidden whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-muted-foreground">
          {displayContent}
          {!expanded && isLong && "\n…"}
        </pre>
        {isLong && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 h-6 px-1.5 text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起" : "展开"}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border-soft px-4 py-2.5">
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={startFork}>
          <GitFork className="h-3.5 w-3.5" />
          基于此版本新建
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-accent-border text-xs text-primary hover:bg-accent-subtle"
          onClick={() => setReplayOpen(true)}
        >
          <Play className="h-3.5 w-3.5" />
          用此版本回放…
        </Button>
      </div>
      <VersionTracesSection versionId={version.id} />

      <Dialog open={forkOpen} onOpenChange={setForkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>基于 v{version.version} 新建版本</DialogTitle>
          </DialogHeader>
          <Textarea
            className="h-40 font-mono text-sm"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          {forkError && <p className="text-sm text-destructive">{forkError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForkOpen(false)}>
              取消
            </Button>
            <Button onClick={submitFork} disabled={submitting || !content}>
              提交新版本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReplayWithVersionDialog
        versionId={version.id}
        projectId={projectId}
        open={replayOpen}
        onOpenChange={setReplayOpen}
      />
    </Card>
  );
}

// ---------- 页面 ----------

export default function PromptsPage() {
  const { currentProject } = useProject();
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [compareVersions, setCompareVersions] = useState<string[]>([]);
  const [creatingNew, setCreatingNew] = useState(false);

  const reloadPrompts = () => {
    if (!currentProject) return;
    api.getPrompts(currentProject.id).then(setPrompts).catch((e) => setListError(String(e)));
  };

  useEffect(() => {
    setPrompts([]);
    setSelectedId(null);
    setDetail(null);
    setCreatingNew(false);
    reloadPrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject]);

  useEffect(() => {
    setCompareVersions([]);
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailError(null);
    api.getPrompt(selectedId).then(setDetail).catch((e) => setDetailError(String(e)));
  }, [selectedId]);

  const reloadDetail = () => {
    if (!selectedId) return;
    api.getPrompt(selectedId).then(setDetail).catch((e) => setDetailError(String(e)));
    reloadPrompts();
  };

  const handleCreated = (id: string) => {
    setCreatingNew(false);
    reloadPrompts();
    setSelectedId(id);
  };

  const toggleCompareVersion = (id: string) =>
    setCompareVersions((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });

  const sortedVersions = useMemo(
    () => (detail ? [...detail.versions].sort((a, b) => b.version - a.version) : []),
    [detail]
  );
  const latestVersionNumber = sortedVersions[0]?.version;

  const compareVersionPair = useMemo(() => {
    if (compareVersions.length !== 2 || !detail) return null;
    const va = detail.versions.find((v) => v.id === compareVersions[0]);
    const vb = detail.versions.find((v) => v.id === compareVersions[1]);
    if (!va || !vb) return null;
    return va.version <= vb.version ? [va, vb] : [vb, va];
  }, [compareVersions, detail]);

  const currentSummary = prompts.find((p) => p.id === selectedId);

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "提示词" }]}
        subtitle="管理 prompt 版本，fork 迭代、回放验证、追溯使用它的链路。"
      />

      <main className="flex min-h-0 flex-1">
        <div className="flex w-[288px] shrink-0 flex-col border-r border-border">
          <div className="border-b border-border-soft p-3.5">
            <Button
              className="w-full gap-1.5"
              onClick={() => setCreatingNew(true)}
              disabled={!currentProject || creatingNew}
            >
              <Plus className="h-4 w-4" />
              新建 prompt
            </Button>
            {creatingNew && currentProject && (
              <CreatePromptInlineForm
                existingNames={prompts.map((p) => p.name)}
                projectId={currentProject.id}
                onCreated={handleCreated}
                onCancel={() => setCreatingNew(false)}
              />
            )}
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
            {listError && <p className="p-2 text-sm text-destructive">加载失败：{listError}</p>}
            {!listError && prompts.length === 0 && !creatingNew && (
              <EmptyState icon={Inbox} title="暂无 Prompt" description="创建一个 prompt 开始管理版本吧。" />
            )}
            {prompts.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors",
                  selectedId === p.id ? "bg-accent-subtle" : "hover:bg-surface-hover",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      "truncate text-[13px] font-semibold",
                      selectedId === p.id ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {p.name}
                  </span>
                  <span className="font-mono text-[11px] text-text-3">
                    {p.version_count} 版本 · {formatRelativeTime(p.created_at)}
                  </span>
                </span>
                <span className="shrink-0 rounded-md border border-border-soft bg-bg-grid px-1.5 py-0.5 font-mono text-[11px] text-text-3">
                  v{p.latest_version}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="max-w-[860px] p-7 pb-16">
            {!selectedId && (
              <EmptyState
                icon={FileText}
                title="选择一个 Prompt"
                description="从左侧选择一个 prompt 查看版本历史，或新建一个 prompt。"
              />
            )}
            {selectedId && detailError && <p className="text-sm text-destructive">加载失败：{detailError}</p>}
            {selectedId && !detailError && !detail && <p className="text-sm text-muted-foreground">加载中…</p>}
            {detail && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <h2 className="truncate font-mono text-lg font-semibold tracking-tight">{detail.name}</h2>
                    <span className="whitespace-nowrap rounded-md border border-border-soft bg-bg-grid px-2 py-0.5 font-mono text-[11.5px] text-text-3">
                      {currentSummary?.version_count ?? detail.versions.length} 个版本
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {compareVersionPair && (
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setCompareVersions([])}>
                        清除对比
                      </Button>
                    )}
                    <span className="text-[11.5px] text-text-3">
                      {compareVersionPair
                        ? ""
                        : compareVersions.length === 1
                          ? "再选 1 个版本对比"
                          : "勾选两个版本对比"}
                    </span>
                  </div>
                </div>

                {compareVersionPair && <DiffPanel oldV={compareVersionPair[0]} newV={compareVersionPair[1]} />}

                <div className="space-y-3.5">
                  {sortedVersions.map((v) => (
                    <VersionCard
                      key={v.id}
                      version={v}
                      isLatest={v.version === latestVersionNumber}
                      promptId={detail.id}
                      projectId={detail.project_id}
                      checked={compareVersions.includes(v.id)}
                      onToggleCheck={() => toggleCompareVersion(v.id)}
                      onForkSubmit={reloadDetail}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
