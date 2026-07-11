"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Inbox, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError, ApiKeyInfo, JudgeModel, Member, Pricing, Project, Provider } from "@/lib/api";
import { useProject } from "@/contexts/ProjectContext";
import { useAuth } from "@/contexts/AuthContext";
import { formatRelativeTime } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { CodeBlock } from "@/components/CodeBlock";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { canManageResource } from "@/lib/resourceAccess";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN");
}

const HEAD_CLASS = "bg-surface-2 text-[11.5px] font-semibold tracking-wide text-text-3";

// ---------- creator-or-owner write gating (provider/pricing) ----------

const MANAGE_TOOLTIP = "仅创建者或 owner 可修改";

function ManageActions({
  allowed,
  onEdit,
  onDelete,
}: {
  allowed: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const buttons = (
    <div className="flex justify-end gap-1">
      <span tabIndex={allowed ? undefined : 0}>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title={allowed ? "编辑" : undefined}
          disabled={!allowed}
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </span>
      <span tabIndex={allowed ? undefined : 0}>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          title={allowed ? "删除" : undefined}
          disabled={!allowed}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </span>
    </div>
  );
  if (allowed) return buttons;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{buttons}</TooltipTrigger>
        <TooltipContent>{MANAGE_TOOLTIP}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------- 项目信息 ----------

const NO_SUMMARY_MODEL = "__none__";

function ProjectInfoCard({
  project,
  refreshProjects,
  isOwner,
}: {
  project: Project;
  refreshProjects: () => Promise<void>;
  isOwner: boolean;
}) {
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [judgeModels, setJudgeModels] = useState<JudgeModel[]>([]);
  const [summaryModel, setSummaryModel] = useState(project.summary_model ?? NO_SUMMARY_MODEL);
  const [savingSummaryModel, setSavingSummaryModel] = useState(false);

  useEffect(() => setName(project.name), [project.id, project.name]);
  useEffect(
    () => setSummaryModel(project.summary_model ?? NO_SUMMARY_MODEL),
    [project.id, project.summary_model],
  );
  useEffect(() => {
    api.getJudgeModels(project.id).then(setJudgeModels).catch(() => setJudgeModels([]));
  }, [project.id]);

  const save = async () => {
    if (!isOwner) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === project.name) {
      setName(project.name);
      return;
    }
    setSaving(true);
    try {
      await api.renameProject(project.id, trimmed);
      toast.success("项目名称已更新");
      await refreshProjects();
    } catch (e) {
      toast.error(String(e));
      setName(project.name);
    } finally {
      setSaving(false);
    }
  };

  const saveSummaryModel = async (value: string) => {
    if (!isOwner) return;
    const prev = summaryModel;
    setSummaryModel(value);
    setSavingSummaryModel(true);
    try {
      await api.updateProject(project.id, {
        name: project.name,
        summary_model: value === NO_SUMMARY_MODEL ? null : value,
      });
      toast.success("摘要模型配置已更新");
      await refreshProjects();
    } catch (e) {
      toast.error(String(e));
      setSummaryModel(prev);
    } finally {
      setSavingSummaryModel(false);
    }
  };

  return (
    <Card>
      <CardHeader className="border-b py-3.5">
        <CardTitle className="text-sm font-semibold text-muted-foreground">项目信息</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-4 p-5">
        <label className="text-[12.5px] font-medium text-muted-foreground">项目名称</label>
        <Input
          value={name}
          disabled={saving || !isOwner}
          aria-label="项目名称"
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="max-w-[320px]"
        />
        <label className="text-[12.5px] font-medium text-muted-foreground">项目 ID</label>
        <div className="flex items-center gap-2.5">
          <code className="rounded-md border border-border-soft bg-bg-grid px-2.5 py-1 font-mono text-[12.5px] text-muted-foreground">
            {project.id}
          </code>
          <span className="text-xs text-text-3">不可修改</span>
        </div>
        <label className="self-start text-[12.5px] font-medium text-muted-foreground">摘要模型</label>
        <div className="space-y-1.5">
          <Select
            value={summaryModel}
            disabled={savingSummaryModel || !isOwner}
            onValueChange={saveSummaryModel}
          >
            <SelectTrigger aria-label="摘要模型" className="max-w-[320px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SUMMARY_MODEL}>关闭（默认）</SelectItem>
              {judgeModels.map((m) => (
                <SelectItem key={m.model} value={m.model}>
                  {m.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="max-w-[420px] text-xs text-text-3">
            配置后，新上报的链路会用该模型自动生成一句话摘要（消耗少量 tokens）；不配置则使用输入内容截断。
          </p>
        </div>
        {!isOwner && (
          <p className="col-span-2 text-xs text-text-3">仅 owner 可修改</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- API 密钥 ----------

function NewKeyNameDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (key: string) => void;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const { currentProject } = useProject();

  useEffect(() => {
    if (!open) setName("");
  }, [open]);

  const submit = async () => {
    if (!currentProject) return;
    setCreating(true);
    try {
      const created = await api.createProjectKey(currentProject.id, name.trim() || undefined);
      onOpenChange(false);
      onCreated(created.key);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建密钥</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="名称（可选，如 生产上报）"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={creating}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewKeyDialog({
  open,
  onOpenChange,
  apiKeyValue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKeyValue: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>密钥已创建</DialogTitle>
          <DialogDescription>这是唯一一次能看到完整密钥的机会。</DialogDescription>
        </DialogHeader>
        <CodeBlock code={apiKeyValue} />
        <p className="text-sm text-warning-foreground">关闭后将无法再次查看，请立即保存。</p>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>我已保存，完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeKeyDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>吊销 API Key</DialogTitle>
          <DialogDescription>吊销后该 key 将立即失效，且不可恢复。确认继续？</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            确认吊销
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApiKeysCard({ project, isOwner }: { project: Project; isOwner: boolean }) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);

  const reload = useCallback(() => {
    setError(null);
    api
      .getProjectKeys(project.id)
      .then((r) => {
        setKeys(r);
        setForbidden(false);
      })
      .catch((e) => {
        // GET /api/projects/{id}/keys is owner-only server-side (assert_owner) — a
        // member always gets a 403 here regardless of what the frontend's isOwner
        // guess believes, so this catch is the authoritative source of truth.
        if (e instanceof ApiError && e.status === 403) {
          setForbidden(true);
        } else {
          setError(String(e));
        }
      });
  }, [project.id]);

  useEffect(() => {
    // Known non-owner: skip the doomed request entirely instead of waiting on a 403.
    if (!isOwner) {
      setForbidden(true);
      return;
    }
    reload();
  }, [isOwner, reload]);

  const revoke = async () => {
    if (!revokeTarget) return;
    try {
      await api.revokeKey(revokeTarget.id);
      toast.success("Key 已吊销");
      reload();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRevokeTarget(null);
    }
  };

  // GET /api/projects/{id}/keys is owner-only server-side, so a member always
  // 403s there — show a friendly empty-state instead of surfacing a raw error.
  if (forbidden) {
    return (
      <Card>
        <CardHeader className="border-b py-3.5">
          <CardTitle className="text-sm font-semibold">API 密钥</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            用于 SDK 上报链路数据。密钥仅在创建时完整显示一次。
          </p>
        </CardHeader>
        <CardContent className="p-5">
          <EmptyState icon={KeyRound} title="仅 owner 可管理 API 密钥" description="密钥管理仅 owner 可见，请联系项目 owner。" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 border-b py-3.5">
        <div>
          <CardTitle className="text-sm font-semibold">API 密钥</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            用于 SDK 上报链路数据。密钥仅在创建时完整显示一次。
          </p>
        </div>
        <Button size="sm" className="shrink-0 gap-1.5" onClick={() => setNameDialogOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          新建密钥
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {error && <p className="p-4 text-sm text-destructive">{error}</p>}
        {!error && keys.length === 0 && <p className="p-4 text-sm text-muted-foreground">暂无 API Key</p>}
        {!error && keys.length > 0 && (
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={HEAD_CLASS}>名称</TableHead>
                <TableHead className={HEAD_CLASS}>密钥前缀</TableHead>
                <TableHead className={HEAD_CLASS}>创建时间</TableHead>
                <TableHead className={HEAD_CLASS}>最近使用</TableHead>
                <TableHead className={cn(HEAD_CLASS, "text-center")}>状态</TableHead>
                <TableHead className={cn(HEAD_CLASS, "text-right")}>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name || "—"}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{k.prefix}</TableCell>
                  <TableCell className="font-mono text-xs text-text-3">{formatDate(k.created_at)}</TableCell>
                  <TableCell className="font-mono text-xs text-text-3">
                    {k.revoked_at ? "—" : formatRelativeTime(k.last_used_at)}
                  </TableCell>
                  <TableCell className="text-center">
                    {k.revoked_at ? (
                      <StatusBadge kind="error" label="已吊销" />
                    ) : (
                      <StatusBadge kind="success" label="启用中" />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!k.revoked_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRevokeTarget(k)}
                      >
                        撤销
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <NewKeyNameDialog open={nameDialogOpen} onOpenChange={setNameDialogOpen} onCreated={setCreatedKey} />
      {createdKey && (
        <NewKeyDialog
          open={!!createdKey}
          onOpenChange={(open) => {
            if (!open) {
              setCreatedKey(null);
              reload();
            }
          }}
          apiKeyValue={createdKey}
        />
      )}
      <RevokeKeyDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        onConfirm={revoke}
      />
    </Card>
  );
}

// ---------- 项目与密钥 tab ----------

function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (p: Project) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await api.createProject({ name });
      onOpenChange(false);
      toast.success("项目已创建");
      onCreated(created);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("项目名称已存在");
      } else {
        setError(String(e));
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            autoFocus
            placeholder="项目名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="font-mono"
          />
          <p className="text-xs text-text-3">创建后你将成为该项目的 owner</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={creating || !name}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectsAndKeysTab({
  projects,
  currentProject,
  setCurrentProject,
  refreshProjects,
  isOwner,
}: {
  projects: Project[];
  currentProject: Project | null;
  setCurrentProject: (p: Project) => void;
  refreshProjects: () => Promise<void>;
  isOwner: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  const handleCreated = async (p: Project) => {
    await refreshProjects();
    setCurrentProject(p);
  };

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6">
      <div className="h-fit space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">项目</h3>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            新建项目
          </Button>
        </div>
        {projects.length === 0 && (
          <EmptyState icon={Inbox} title="暂无项目" description="新建一个项目开始使用。" />
        )}
        <div className="space-y-2">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setCurrentProject(p)}
              className={cn(
                "w-full rounded-lg border p-3 text-left transition-colors",
                currentProject?.id === p.id ? "border-primary bg-accent-subtle" : "hover:bg-surface-hover",
              )}
            >
              <span className="truncate text-sm font-medium">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 space-y-5">
        {!currentProject && (
          <EmptyState icon={KeyRound} title="选择一个项目" description="从左侧选择或新建一个项目以管理其信息与 API Key。" />
        )}
        {currentProject && (
          <>
            <ProjectInfoCard project={currentProject} refreshProjects={refreshProjects} isOwner={isOwner} />
            <ApiKeysCard project={currentProject} isOwner={isOwner} />
          </>
        )}
      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
    </div>
  );
}

// ---------- 模型 Provider ----------

const KIND_OPTIONS: { key: "official" | "aggregator"; title: string; desc: string }[] = [
  { key: "official", title: "官方直连", desc: "厂商官方 API，如 OpenAI、Anthropic。" },
  { key: "aggregator", title: "三方聚合", desc: "聚合网关或自建代理，如 OpenRouter、Groq、vLLM。" },
];

function ProtocolChip({ type }: { type: "openai" | "anthropic" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-border-soft bg-bg-grid px-2 py-0.5 font-mono text-[11.5px] font-semibold",
        type === "openai" ? "text-success-fg" : "text-replay-fg",
      )}
    >
      {type === "openai" ? "OpenAI 兼容" : "Anthropic 兼容"}
    </span>
  );
}

function KindBadge({ kind }: { kind: "official" | "aggregator" | null }) {
  if (kind === "aggregator") return <StatusBadge kind="replay" label="三方聚合" />;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-text-3" />
      官方直连
    </span>
  );
}

interface ProviderFormState {
  kind: "official" | "aggregator";
  provider_type: "openai" | "anthropic";
  name: string;
  base_url: string;
  api_key: string;
  note: string;
}

const EMPTY_PROVIDER_FORM: ProviderFormState = {
  kind: "aggregator",
  provider_type: "openai",
  name: "",
  base_url: "",
  api_key: "",
  note: "",
};

function ProviderDialog({
  open,
  onOpenChange,
  editing,
  projectId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Provider | null;
  projectId: string;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProviderFormState>(EMPTY_PROVIDER_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        kind: editing.kind ?? "official",
        provider_type: editing.provider_type,
        name: editing.name,
        base_url: editing.base_url,
        api_key: "",
        note: editing.note ?? "",
      });
    } else {
      setForm(EMPTY_PROVIDER_FORM);
    }
  }, [open, editing]);

  const submit = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.updateProvider(editing.id, {
          project_id: projectId,
          name: form.name,
          base_url: form.base_url,
          provider_type: form.provider_type,
          kind: form.kind,
          note: form.note || null,
          ...(form.api_key ? { api_key: form.api_key } : {}),
        });
        toast.success("Provider 已更新");
      } else {
        await api.createProvider({
          project_id: projectId,
          name: form.name,
          base_url: form.base_url,
          provider_type: form.provider_type,
          kind: form.kind,
          note: form.note || null,
          api_key: form.api_key,
        });
        toast.success("Provider 已创建");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  const urlPlaceholder = form.provider_type === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `编辑 Provider · ${editing.name}` : "新增 Provider"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-[12.5px] font-semibold text-muted-foreground">供应商种类</label>
            <div className="grid grid-cols-2 gap-2.5">
              {KIND_OPTIONS.map((opt) => {
                const active = form.kind === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        kind: opt.key,
                        provider_type: opt.key === "aggregator" ? "openai" : f.provider_type,
                      }))
                    }
                    className={cn(
                      "flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
                      active ? "border-accent-border bg-accent-subtle" : "border-border hover:bg-surface-hover",
                    )}
                  >
                    <span className="text-[13px] font-semibold">{opt.title}</span>
                    <span className="text-[11.5px] leading-snug text-text-3">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-[12.5px] font-semibold text-muted-foreground">
              接口协议 <span className="font-normal text-text-3">决定按哪种 API 格式请求</span>
            </label>
            <div className="flex gap-0.5 rounded-lg border border-border-soft bg-bg-grid p-0.5">
              {(["openai", "anthropic"] as const).map((pt) => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, provider_type: pt }))}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition-colors",
                    form.provider_type === pt
                      ? "bg-surface-2 font-semibold shadow-[inset_0_0_0_1px_hsl(var(--border))]"
                      : "font-medium text-text-3 hover:text-foreground",
                  )}
                >
                  {pt === "openai" ? "OpenAI 兼容" : "Anthropic 兼容"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-[12.5px] font-semibold text-muted-foreground">名称</label>
            <Input
              placeholder="如 OpenRouter、自建网关"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <label className="mb-2 block text-[12.5px] font-semibold text-muted-foreground">base_url</label>
            <Input
              className="font-mono"
              placeholder={urlPlaceholder}
              value={form.base_url}
              onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
            />
          </div>

          <div>
            <label className="mb-2 block text-[12.5px] font-semibold text-muted-foreground">
              api_key <span className="font-normal text-warning-foreground">只写不回显</span>
            </label>
            <Input
              type="password"
              className="font-mono"
              placeholder={editing ? "留空则不修改现有 key" : "sk-…"}
              value={form.api_key}
              onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
            />
          </div>

          <div>
            <label className="mb-2 block text-[12.5px] font-semibold text-muted-foreground">
              备注 <span className="font-normal text-text-3">可选</span>
            </label>
            <Input
              placeholder="如 聚合 200+ 模型 · openai/model 命名"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving || !form.name || !form.base_url}>
            {editing ? "保存修改" : "添加 Provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProvidersTab({
  providers,
  reload,
  currentProject,
  isOwner,
  userId,
}: {
  providers: Provider[];
  reload: () => void;
  currentProject: Project | null;
  isOwner: boolean;
  userId: string | undefined;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (p: Provider) => {
    setEditing(p);
    setDialogOpen(true);
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteProvider(deleteTarget.id);
      toast.success("Provider 已删除");
      reload();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeleteTarget(null);
    }
  };

  if (!currentProject) return <p className="text-sm text-muted-foreground">请先选择一个项目。</p>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 border-b py-3.5">
        <div>
          <CardTitle className="text-sm font-semibold">模型 Provider</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            官方直连或三方聚合网关（OpenRouter 等）皆可。按接口协议标注 OpenAI / Anthropic 兼容；api_key 只写不回显。
          </p>
        </div>
        <Button size="sm" className="shrink-0 gap-1.5" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" />
          新增 Provider
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {providers.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">暂无 provider</p>
        ) : (
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={HEAD_CLASS}>名称</TableHead>
                <TableHead className={HEAD_CLASS}>种类</TableHead>
                <TableHead className={HEAD_CLASS}>接口协议</TableHead>
                <TableHead className={HEAD_CLASS}>base_url</TableHead>
                <TableHead className={cn(HEAD_CLASS, "text-center")}>api_key</TableHead>
                <TableHead className={cn(HEAD_CLASS, "text-right")}>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-[11px] text-text-3">创建者：{p.created_by_name ?? "—"}</span>
                      {p.note && <span className="text-[11px] text-text-3">{p.note}</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <KindBadge kind={p.kind} />
                  </TableCell>
                  <TableCell>
                    <ProtocolChip type={p.provider_type} />
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate font-mono text-xs text-muted-foreground">
                    {p.base_url}
                  </TableCell>
                  <TableCell className="text-center">
                    {p.api_key_set ? (
                      <StatusBadge kind="success" label="已设置" />
                    ) : (
                      <StatusBadge kind="warning" label="未设置" />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <ManageActions
                      allowed={canManageResource(p.created_by, isOwner, userId)}
                      onEdit={() => openEdit(p)}
                      onDelete={() => setDeleteTarget(p)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        projectId={currentProject.id}
        onSaved={reload}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除 Provider</DialogTitle>
            <DialogDescription>
              删除「{deleteTarget?.name}」后，关联的定价将解除绑定。确认继续？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={remove}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------- 定价 ----------

function PricingRow({
  pricing,
  providers,
  onSaved,
  onDelete,
  isOwner,
  userId,
}: {
  pricing: Pricing;
  providers: Provider[];
  onSaved: () => void;
  onDelete: () => void;
  isOwner: boolean;
  userId: string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    model: pricing.model,
    input: String(pricing.input_price_per_1k),
    output: String(pricing.output_price_per_1k),
    provider_id: pricing.provider_id ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const startEdit = () => {
    setForm({
      model: pricing.model,
      input: String(pricing.input_price_per_1k),
      output: String(pricing.output_price_per_1k),
      provider_id: pricing.provider_id ?? "",
    });
    setEditing(true);
  };

  const save = async () => {
    const inp = parseFloat(form.input);
    const outp = parseFloat(form.output);
    if (!Number.isFinite(inp) || !Number.isFinite(outp)) {
      toast.error("价格必须是数字");
      return;
    }
    setSaving(true);
    try {
      await api.updatePricing(pricing.id, {
        model: form.model,
        input_price_per_1k: inp,
        output_price_per_1k: outp,
        provider_id: form.provider_id || null,
      });
      toast.success("定价已更新");
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deletePricing(pricing.id);
      toast.success("定价已删除");
      onDelete();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeleteOpen(false);
    }
  };

  if (editing) {
    return (
      <TableRow>
        <TableCell>
          <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        </TableCell>
        <TableCell>
          <Select
            value={form.provider_id || "__none__"}
            onValueChange={(v) => setForm({ ...form, provider_id: v === "__none__" ? "" : v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">无 provider</SelectItem>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell className="text-[12px] text-text-3">{pricing.created_by_name ?? "—"}</TableCell>
        <TableCell>
          <Input
            className="text-right font-mono"
            value={form.input}
            onChange={(e) => setForm({ ...form, input: e.target.value })}
          />
        </TableCell>
        <TableCell>
          <Input
            className="text-right font-mono"
            value={form.output}
            onChange={(e) => setForm({ ...form, output: e.target.value })}
          />
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button size="sm" onClick={save} disabled={saving || !form.model}>
              保存
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  const allowed = canManageResource(pricing.created_by, isOwner, userId);

  return (
    <TableRow>
      <TableCell className="font-mono font-medium">{pricing.model}</TableCell>
      <TableCell className="text-muted-foreground">
        {providers.find((p) => p.id === pricing.provider_id)?.name ?? "—"}
      </TableCell>
      <TableCell className="text-[12px] text-text-3">{pricing.created_by_name ?? "—"}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">${pricing.input_price_per_1k}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">${pricing.output_price_per_1k}</TableCell>
      <TableCell className="text-right">
        <ManageActions allowed={allowed} onEdit={startEdit} onDelete={() => setDeleteOpen(true)} />
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>删除定价</DialogTitle>
              <DialogDescription>删除「{pricing.model}」的定价后将无法计算相关成本。确认继续？</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                取消
              </Button>
              <Button variant="destructive" onClick={remove}>
                确认删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
}

function PricingTab({
  pricing,
  providers,
  reload,
  currentProject,
  isOwner,
  userId,
}: {
  pricing: Pricing[];
  providers: Provider[];
  reload: () => void;
  currentProject: Project | null;
  isOwner: boolean;
  userId: string | undefined;
}) {
  const [form, setForm] = useState({ model: "", input: "", output: "", provider_id: "" });
  const [creating, setCreating] = useState(false);

  const addPricing = async () => {
    if (!currentProject) return;
    const inp = parseFloat(form.input);
    const outp = parseFloat(form.output);
    if (!Number.isFinite(inp) || !Number.isFinite(outp)) {
      toast.error("价格必须是数字");
      return;
    }
    setCreating(true);
    try {
      await api.createPricing({
        model: form.model,
        input_price_per_1k: inp,
        output_price_per_1k: outp,
        provider_id: form.provider_id || null,
        project_id: currentProject.id,
      });
      setForm({ model: "", input: "", output: "", provider_id: "" });
      toast.success("定价已创建");
      reload();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  };

  if (!currentProject) return <p className="text-sm text-muted-foreground">请先选择一个项目。</p>;

  return (
    <Card>
      <CardHeader className="border-b py-3.5">
        <CardTitle className="text-sm font-semibold">定价</CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">用于估算链路成本。单位：美元 / 1K token。</p>
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        {pricing.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">暂无定价</p>
        ) : (
          <Table className="min-w-[680px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={HEAD_CLASS}>模型</TableHead>
                <TableHead className={HEAD_CLASS}>关联 Provider</TableHead>
                <TableHead className={HEAD_CLASS}>创建者</TableHead>
                <TableHead className={cn(HEAD_CLASS, "text-right")}>每 1K 输入</TableHead>
                <TableHead className={cn(HEAD_CLASS, "text-right")}>每 1K 输出</TableHead>
                <TableHead className={cn(HEAD_CLASS, "text-right")}>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricing.map((r) => (
                <PricingRow
                  key={r.id}
                  pricing={r}
                  providers={providers}
                  onSaved={reload}
                  onDelete={reload}
                  isOwner={isOwner}
                  userId={userId}
                />
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t p-4">
          <Input
            className="w-40"
            placeholder="模型名（如 gpt-4o）"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
          <Input
            className="w-32 font-mono"
            placeholder="Input $/1K"
            value={form.input}
            onChange={(e) => setForm({ ...form, input: e.target.value })}
          />
          <Input
            className="w-32 font-mono"
            placeholder="Output $/1K"
            value={form.output}
            onChange={(e) => setForm({ ...form, output: e.target.value })}
          />
          <Select
            value={form.provider_id || "__none__"}
            onValueChange={(v) => setForm({ ...form, provider_id: v === "__none__" ? "" : v })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">无 provider</SelectItem>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={addPricing} disabled={creating || !form.model || !form.input || !form.output}>
            添加
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- 成员 ----------

// Gradients built only from existing semantic CSS variables (no hardcoded hex).
const AVATAR_GRADIENTS = [
  "linear-gradient(140deg, hsl(var(--primary)), hsl(var(--replay)))",
  "linear-gradient(140deg, hsl(var(--replay)), hsl(var(--live)))",
  "linear-gradient(140deg, hsl(var(--success)), hsl(var(--live)))",
  "linear-gradient(140deg, hsl(var(--warning)), hsl(var(--destructive)))",
];

function avatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

function MembersTab({
  members,
  setMembers,
  reloadMembers,
  isOwner,
}: {
  members: Member[];
  setMembers: (members: Member[]) => void;
  reloadMembers: () => void;
  isOwner: boolean;
}) {
  const { currentProject } = useProject();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ownerCount = members.filter((m) => m.role === "owner").length;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    setError(null);
    try {
      setMembers(await api.addMember(currentProject.id, email));
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    }
  };

  const remove = async (userId: string) => {
    if (!currentProject) return;
    try {
      await api.removeMember(currentProject.id, userId);
      reloadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除失败");
    }
  };

  if (!currentProject) return <p className="text-sm text-muted-foreground">请先选择一个项目。</p>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 border-b py-3.5">
        <div>
          <CardTitle className="text-sm font-semibold">成员</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">owner 可添加已注册用户或移除成员。</p>
        </div>
        {isOwner && (
          <form onSubmit={add} className="flex shrink-0 gap-2">
            <Input
              placeholder="邀请已注册用户的邮箱"
              value={email}
              type="email"
              required
              onChange={(e) => setEmail(e.target.value)}
              className="w-56"
            />
            <Button type="submit" size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              添加
            </Button>
          </form>
        )}
      </CardHeader>
      {error && <p className="px-5 pt-3 text-sm text-destructive">{error}</p>}
      <CardContent className="overflow-x-auto p-0">
        <Table className="min-w-[560px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD_CLASS}>成员</TableHead>
              <TableHead className={HEAD_CLASS}>邮箱</TableHead>
              <TableHead className={cn(HEAD_CLASS, "text-center")}>角色</TableHead>
              {isOwner && <TableHead className={cn(HEAD_CLASS, "text-right")} />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const isYou = m.user_id === user?.id;
              const isLastOwner = m.role === "owner" && ownerCount <= 1;
              const locked = isYou || isLastOwner;
              return (
                <TableRow key={m.user_id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                        style={{ background: avatarGradient(m.user_id) }}
                      >
                        {(m.display_name || m.email)[0]?.toUpperCase()}
                      </span>
                      <span className="truncate text-[13px] font-medium">
                        {m.display_name}
                        {isYou && <span className="ml-1 font-normal text-text-3">· 你</span>}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{m.email}</TableCell>
                  <TableCell className="text-center">
                    {m.role === "owner" ? (
                      <span className="inline-flex items-center rounded-full bg-accent-subtle px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                        Owner
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        Member
                      </span>
                    )}
                  </TableCell>
                  {isOwner && (
                    <TableCell className="text-right">
                      {!locked && (
                        <button
                          className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                          onClick={() => remove(m.user_id)}
                        >
                          移除
                        </button>
                      )}
                      {locked && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help text-xs text-text-3">—</span>
                            </TooltipTrigger>
                            <TooltipContent>{isYou ? "不能移除自己" : "不能移除最后一个 owner"}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------- 页面 ----------

export default function SettingsPage() {
  const { projects, currentProject, setCurrentProject, refreshProjects } = useProject();
  const { user } = useAuth();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    if (!currentProject) {
      setProviders([]);
      setPricing([]);
      return;
    }
    api.getProviders(currentProject.id).then(setProviders).catch((e) => setError(String(e)));
    api.getPricing(currentProject.id).then(setPricing).catch((e) => setError(String(e)));
  }, [currentProject]);

  useEffect(reload, [reload]);

  // Role lookup lifted here (was previously duplicated inside MembersTab) and shared
  // by every tab that needs to know owner-vs-member: 项目信息 fields, the API 密钥
  // tab, and 成员 itself. A failed/not-yet-loaded lookup defaults isOwner to true —
  // the backend still enforces the real permission on every mutating/owner-only
  // endpoint, so the worst case here is a control that's shown but then 403s.
  const reloadMembers = useCallback(() => {
    if (!currentProject) {
      setMembers([]);
      return;
    }
    api.getMembers(currentProject.id).then(setMembers).catch(() => setMembers([]));
  }, [currentProject]);

  useEffect(reloadMembers, [reloadMembers]);

  const myRole = members.find((m) => m.user_id === user?.id)?.role;
  const isOwner = myRole ? myRole === "owner" : true;

  return (
    <div>
      <PageHeader crumbs={[{ label: "设置" }]} subtitle="项目、API Key、模型 provider、定价与成员。" />

      <main className="mx-auto max-w-6xl p-6">
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        <Tabs defaultValue="projects">
          <TabsList>
            <TabsTrigger value="projects">项目与密钥</TabsTrigger>
            <TabsTrigger value="providers">模型 Provider</TabsTrigger>
            <TabsTrigger value="pricing">定价</TabsTrigger>
            <TabsTrigger value="members">成员</TabsTrigger>
          </TabsList>

          <TabsContent value="projects">
            <ProjectsAndKeysTab
              projects={projects}
              currentProject={currentProject}
              setCurrentProject={setCurrentProject}
              refreshProjects={refreshProjects}
              isOwner={isOwner}
            />
          </TabsContent>

          <TabsContent value="providers">
            <ProvidersTab
              providers={providers}
              reload={reload}
              currentProject={currentProject}
              isOwner={isOwner}
              userId={user?.id}
            />
          </TabsContent>

          <TabsContent value="pricing">
            <PricingTab
              pricing={pricing}
              providers={providers}
              reload={reload}
              currentProject={currentProject}
              isOwner={isOwner}
              userId={user?.id}
            />
          </TabsContent>

          <TabsContent value="members">
            <MembersTab members={members} setMembers={setMembers} reloadMembers={reloadMembers} isOwner={isOwner} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
