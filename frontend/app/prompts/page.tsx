"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Inbox } from "lucide-react";
import { api, PromptDetail, PromptSummary, PromptVersionInfo, VersionTrace } from "@/lib/api";
import { useProject } from "@/contexts/ProjectContext";
import { diffLines } from "@/lib/linediff";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
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

const COLLAPSE_LINES = 8;

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}

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
    <div>
      <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={toggle}>
        {open ? "收起" : "使用此版本的 traces"}
      </Button>
      {open && (
        <div className="mt-2 space-y-1">
          {error && <p className="text-xs text-destructive">{error}</p>}
          {traces === null && !error && <p className="text-xs text-muted-foreground">加载中…</p>}
          {traces !== null && traces.length === 0 && (
            <p className="text-xs text-muted-foreground">暂无引用</p>
          )}
          {traces?.map((t) => (
            <Link
              key={t.id}
              href={`/traces/${t.id}`}
              className="block rounded-md border px-2 py-1 text-xs hover:bg-accent"
            >
              <span className="font-medium">{t.name || t.id.slice(0, 8)}</span>
              <span className="ml-2 text-muted-foreground">{t.origin}</span>
              <span className="ml-2 text-muted-foreground">
                {new Date(t.created_at).toLocaleString("zh-CN")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function VersionCard({
  version,
  promptId,
  projectId,
  checked,
  onToggleCheck,
  onForkSubmit,
}: {
  version: PromptVersionInfo;
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
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Checkbox checked={checked} onCheckedChange={onToggleCheck} />
          <Badge variant="secondary">v{version.version}</Badge>
          <span className="text-xs text-muted-foreground">{formatRelativeTime(version.created_at)}</span>
        </div>
        <div>
          <pre className="whitespace-pre-wrap break-all rounded-md border bg-muted/50 p-3 font-mono text-xs">
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
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={startFork}>
            基于此版本新建
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={() => setReplayOpen(true)}
          >
            用此版本回放…
          </Button>
        </div>
        <VersionTracesSection versionId={version.id} />
      </CardContent>

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

function DiffCard({ oldV, newV }: { oldV: PromptVersionInfo; newV: PromptVersionInfo }) {
  const entries = useMemo(() => diffLines(oldV.content, newV.content), [oldV, newV]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">
          v{oldV.version} → v{newV.version}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-xs">
          {entries.map((e, i) => {
            const prefix = e.type === "add" ? "+" : e.type === "del" ? "-" : " ";
            const cls =
              e.type === "add"
                ? "bg-success/10"
                : e.type === "del"
                  ? "bg-destructive/10"
                  : "text-muted-foreground";
            return (
              <div key={i} className={cls}>
                {prefix} {e.text}
              </div>
            );
          })}
        </pre>
      </CardContent>
    </Card>
  );
}

function CreatePromptDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setContent("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await api.createPrompt({ project_id: projectId, name, content });
      onOpenChange(false);
      onCreated(created.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建 Prompt</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea
            className="h-32 font-mono text-sm"
            placeholder="初始版本内容"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={creating || !name || !content}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PromptsPage() {
  const { currentProject } = useProject();
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [compareVersions, setCompareVersions] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  const reloadPrompts = () => {
    if (!currentProject) return;
    api.getPrompts(currentProject.id).then(setPrompts).catch((e) => setListError(String(e)));
  };

  useEffect(() => {
    setPrompts([]);
    setSelectedId(null);
    setDetail(null);
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

  const compareVersionPair = useMemo(() => {
    if (compareVersions.length !== 2 || !detail) return null;
    const va = detail.versions.find((v) => v.id === compareVersions[0]);
    const vb = detail.versions.find((v) => v.id === compareVersions[1]);
    if (!va || !vb) return null;
    return va.version <= vb.version ? [va, vb] : [vb, va];
  }, [compareVersions, detail]);

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "提示词" }]}
        subtitle="管理 prompt 版本，基于历史版本回放与对比。"
        actions={
          currentProject && (
            <Button onClick={() => setCreateOpen(true)}>新建 Prompt</Button>
          )
        }
      />

      <main className="mx-auto max-w-6xl p-6">
        <div className="grid grid-cols-[280px_1fr] gap-6">
          <div className="space-y-2">
            {listError && (
              <p className="text-sm text-destructive">加载失败：{listError}</p>
            )}
            {!listError && prompts.length === 0 && (
              <EmptyState
                icon={Inbox}
                title="暂无 Prompt"
                description="创建一个 prompt 开始管理版本吧。"
              />
            )}
            {prompts.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  selectedId === p.id ? "border-primary bg-accent/50" : "hover:bg-accent/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{p.name}</span>
                  <Badge variant="secondary" className="shrink-0">
                    v{p.latest_version}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">{p.version_count} 个版本</div>
              </button>
            ))}
          </div>

          <div className="min-w-0">
            {!selectedId && (
              <EmptyState
                icon={FileText}
                title="选择一个 Prompt"
                description="从左侧选择一个 prompt 查看版本历史，或新建一个 prompt。"
              />
            )}
            {selectedId && detailError && (
              <p className="text-sm text-destructive">加载失败：{detailError}</p>
            )}
            {selectedId && !detailError && !detail && (
              <p className="text-sm text-muted-foreground">加载中…</p>
            )}
            {detail && (
              <div className="space-y-4">
                {compareVersionPair && (
                  <DiffCard oldV={compareVersionPair[0]} newV={compareVersionPair[1]} />
                )}
                <h3 className="text-sm font-semibold">{detail.name} 版本历史</h3>
                <div className="space-y-3">
                  {sortedVersions.map((v) => (
                    <VersionCard
                      key={v.id}
                      version={v}
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

      {currentProject && (
        <CreatePromptDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          projectId={currentProject.id}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
