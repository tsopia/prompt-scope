"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError, type Project } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// Shared by the settings 项目与密钥 tab's former inline create flow (now removed —
// project switching/creation lives in the sidebar workspace switcher and the
// first-run onboarding screen), components/layout/AppSidebar.tsx, and
// components/FirstRunScreen.tsx.
export function CreateProjectDialog({
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
