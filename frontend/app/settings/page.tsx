"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Inbox, KeyRound } from "lucide-react";
import { api, ApiKeyInfo, Pricing, Project, Provider } from "@/lib/api";
import { useProject } from "@/contexts/ProjectContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { CodeBlock } from "@/components/CodeBlock";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN");
}

// ---------- 项目与密钥 ----------

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
      setError(String(e));
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
        <div className="space-y-3">
          <Input
            placeholder="项目名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
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
          <DialogTitle>API Key 已创建</DialogTitle>
          <DialogDescription>
            这是唯一一次能看到完整密钥的机会。
          </DialogDescription>
        </DialogHeader>
        <CodeBlock code={apiKeyValue} />
        <p className="text-sm text-destructive">
          关闭后将无法再次查看，请立即保存。
        </p>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>我已保存，关闭</Button>
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
          <DialogDescription>
            吊销后该 key 将立即失效，且不可恢复。确认继续？
          </DialogDescription>
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

function ProjectsAndKeysTab({
  projects,
  currentProject,
  setCurrentProject,
  refreshProjects,
}: {
  projects: Project[];
  currentProject: Project | null;
  setCurrentProject: (p: Project) => void;
  refreshProjects: () => Promise<void>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);

  const reloadKeys = () => {
    if (!currentProject) {
      setKeys([]);
      return;
    }
    setKeysError(null);
    api
      .getProjectKeys(currentProject.id)
      .then(setKeys)
      .catch((e) => setKeysError(String(e)));
  };

  useEffect(reloadKeys, [currentProject]);

  const handleCreated = async (p: Project) => {
    await refreshProjects();
    setCurrentProject(p);
  };

  const createKey = async () => {
    if (!currentProject) return;
    try {
      const created = await api.createProjectKey(currentProject.id);
      reloadKeys();
      setNewKeyValue(created.key);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const revokeKey = async () => {
    if (!revokeTarget) return;
    try {
      await api.revokeKey(revokeTarget.id);
      toast.success("Key 已吊销");
      reloadKeys();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRevokeTarget(null);
    }
  };

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">项目</h3>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
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
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                currentProject?.id === p.id
                  ? "border-primary bg-accent/50"
                  : "hover:bg-accent/50"
              }`}
            >
              <span className="truncate text-sm font-medium">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0">
        {!currentProject && (
          <EmptyState
            icon={KeyRound}
            title="选择一个项目"
            description="从左侧选择或新建一个项目以管理其 API Key。"
          />
        )}
        {currentProject && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold">
                {currentProject.name} · API Key
              </CardTitle>
              <Button onClick={createKey}>新建 API Key</Button>
            </CardHeader>
            <CardContent>
              {keysError && <p className="text-sm text-destructive">{keysError}</p>}
              {!keysError && keys.length === 0 && (
                <p className="text-sm text-muted-foreground">暂无 API Key</p>
              )}
              {!keysError && keys.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Prefix</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((k) => (
                      <TableRow key={k.id}>
                        <TableCell className="font-mono">{k.prefix}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">
                          {formatDate(k.created_at)}
                        </TableCell>
                        <TableCell>
                          {k.revoked_at ? (
                            <StatusBadge kind="error" label="已吊销" />
                          ) : (
                            <StatusBadge kind="success" label="有效" />
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
                              吊销
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
      {newKeyValue && (
        <NewKeyDialog
          open={!!newKeyValue}
          onOpenChange={(open) => !open && setNewKeyValue(null)}
          apiKeyValue={newKeyValue}
        />
      )}
      <RevokeKeyDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        onConfirm={revokeKey}
      />
    </div>
  );
}

// ---------- 模型 Provider ----------

function ProviderRow({
  provider,
  onSaved,
  onDelete,
}: {
  provider: Provider;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: provider.name,
    base_url: provider.base_url,
    api_key: "",
    provider_type: provider.provider_type,
  });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const startEdit = () => {
    setForm({ name: provider.name, base_url: provider.base_url, api_key: "", provider_type: provider.provider_type });
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateProvider(provider.id, {
        name: form.name,
        base_url: form.base_url,
        api_key: form.api_key || undefined,
        provider_type: form.provider_type,
      });
      toast.success("Provider 已更新");
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
      await api.deleteProvider(provider.id);
      toast.success("Provider 已删除");
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
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </TableCell>
        <TableCell>
          <Input
            value={form.base_url}
            onChange={(e) => setForm({ ...form, base_url: e.target.value })}
          />
        </TableCell>
        <TableCell>
          <Select
            value={form.provider_type}
            onValueChange={(v) => setForm({ ...form, provider_type: v as Provider["provider_type"] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">openai 兼容</SelectItem>
              <SelectItem value="anthropic">anthropic</SelectItem>
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell>
          <Input
            type="password"
            placeholder="留空保持不变"
            value={form.api_key}
            onChange={(e) => setForm({ ...form, api_key: e.target.value })}
          />
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button size="sm" onClick={save} disabled={saving || !form.name || !form.base_url}>
              保存
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{provider.name}</TableCell>
      <TableCell className="text-muted-foreground">{provider.base_url}</TableCell>
      <TableCell>{provider.provider_type}</TableCell>
      <TableCell>{provider.api_key_set ? "已配置" : "未配置"}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={startEdit}>
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            删除
          </Button>
        </div>
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>删除 Provider</DialogTitle>
              <DialogDescription>
                删除「{provider.name}」后，关联的定价将解除绑定。确认继续？
              </DialogDescription>
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

function ProvidersTab({ providers, reload }: { providers: Provider[]; reload: () => void }) {
  const [form, setForm] = useState({ name: "", base_url: "", api_key: "", provider_type: "openai" });
  const [creating, setCreating] = useState(false);

  const addProvider = async () => {
    setCreating(true);
    try {
      await api.createProvider(form);
      setForm({ name: "", base_url: "", api_key: "", provider_type: "openai" });
      toast.success("Provider 已创建");
      reload();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">
          模型 Provider（回放与 Judge 调用凭证）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无 provider</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>Base URL</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>API Key</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((p) => (
                <ProviderRow key={p.id} provider={p} onSaved={reload} onDelete={reload} />
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Input
            className="w-40"
            placeholder="名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            className="w-72"
            placeholder="Base URL（openai 兼容含 /v1；anthropic 填根地址）"
            value={form.base_url}
            onChange={(e) => setForm({ ...form, base_url: e.target.value })}
          />
          <Input
            className="w-40"
            type="password"
            placeholder="API Key"
            value={form.api_key}
            onChange={(e) => setForm({ ...form, api_key: e.target.value })}
          />
          <Select
            value={form.provider_type}
            onValueChange={(v) => setForm({ ...form, provider_type: v })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">openai 兼容</SelectItem>
              <SelectItem value="anthropic">anthropic</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={addProvider} disabled={creating || !form.name || !form.base_url || !form.api_key}>
            添加
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- 定价 ----------

function PricingRow({
  pricing,
  providers,
  onSaved,
  onDelete,
}: {
  pricing: Pricing;
  providers: Provider[];
  onSaved: () => void;
  onDelete: () => void;
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
          <Input
            className="font-mono"
            value={form.input}
            onChange={(e) => setForm({ ...form, input: e.target.value })}
          />
        </TableCell>
        <TableCell>
          <Input
            className="font-mono"
            value={form.output}
            onChange={(e) => setForm({ ...form, output: e.target.value })}
          />
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

  return (
    <TableRow>
      <TableCell className="font-medium">{pricing.model}</TableCell>
      <TableCell className="font-mono">${pricing.input_price_per_1k}</TableCell>
      <TableCell className="font-mono">${pricing.output_price_per_1k}</TableCell>
      <TableCell className="text-muted-foreground">
        {providers.find((p) => p.id === pricing.provider_id)?.name ?? "—"}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={startEdit}>
            编辑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            删除
          </Button>
        </div>
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>删除定价</DialogTitle>
              <DialogDescription>
                删除「{pricing.model}」的定价后将无法计算相关成本。确认继续？
              </DialogDescription>
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
}: {
  pricing: Pricing[];
  providers: Provider[];
  reload: () => void;
}) {
  const [form, setForm] = useState({ model: "", input: "", output: "", provider_id: "" });
  const [creating, setCreating] = useState(false);

  const addPricing = async () => {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">
          模型定价（每 1K tokens 美元；配置 provider 后可作为 Judge 模型）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {pricing.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无定价</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模型</TableHead>
                <TableHead>Input</TableHead>
                <TableHead>Output</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricing.map((r) => (
                <PricingRow key={r.id} pricing={r} providers={providers} onSaved={reload} onDelete={reload} />
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
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

// ---------- 页面 ----------

export default function SettingsPage() {
  const { projects, currentProject, setCurrentProject, refreshProjects } = useProject();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setError(null);
    api.getProviders().then(setProviders).catch((e) => setError(String(e)));
    api.getPricing().then(setPricing).catch((e) => setError(String(e)));
  };

  useEffect(reload, []);

  return (
    <div>
      <PageHeader crumbs={[{ label: "Settings" }]} />

      <main className="mx-auto max-w-6xl p-6">
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        <Tabs defaultValue="projects">
          <TabsList>
            <TabsTrigger value="projects">项目与密钥</TabsTrigger>
            <TabsTrigger value="providers">模型 Provider</TabsTrigger>
            <TabsTrigger value="pricing">定价</TabsTrigger>
          </TabsList>

          <TabsContent value="projects">
            <ProjectsAndKeysTab
              projects={projects}
              currentProject={currentProject}
              setCurrentProject={setCurrentProject}
              refreshProjects={refreshProjects}
            />
          </TabsContent>

          <TabsContent value="providers">
            <ProvidersTab providers={providers} reload={reload} />
          </TabsContent>

          <TabsContent value="pricing">
            <PricingTab pricing={pricing} providers={providers} reload={reload} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
