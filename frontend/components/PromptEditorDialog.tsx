"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export type PromptEditorMode =
  | {
      kind: "create";
      projectId: string;
      existingNames: string[];
      onCreated: (id: string) => void;
    }
  | {
      kind: "fork";
      promptId: string;
      promptName: string;
      sourceVersion: number;
      sourceContent: string;
      onForked: () => void;
    };

/**
 * Shared large-editor dialog for both "新建 prompt" (create) and "基于此版本新建"
 * (fork a version) — replaces the previous cramped inline textarea in the 288px
 * left column, which made writing long prompts impractical.
 */
export function PromptEditorDialog({
  open,
  onOpenChange,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PromptEditorMode;
}) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const prefill = mode.kind === "fork" ? mode.sourceContent : "";

  useEffect(() => {
    if (!open) return;
    setName("");
    setContent(prefill);
    setError(null);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode.kind, prefill]);

  const trimmedName = name.trim();
  const nameDup =
    mode.kind === "create" &&
    trimmedName !== "" &&
    mode.existingNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase());

  const disabled =
    submitting ||
    content.trim() === "" ||
    (mode.kind === "create" && (trimmedName === "" || nameDup));

  const submit = async () => {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode.kind === "create") {
        const created = await api.createPrompt({
          project_id: mode.projectId,
          name: trimmedName,
          content,
        });
        onOpenChange(false);
        mode.onCreated(created.id);
      } else {
        await api.addPromptVersion(mode.promptId, content);
        onOpenChange(false);
        mode.onForked();
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("已存在同名 prompt");
      } else {
        setError(String(e));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {mode.kind === "create" ? "新建 prompt" : `基于 v${mode.sourceVersion} 新建版本`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3.5">
          {mode.kind === "create" && (
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium text-muted-foreground">名称</label>
              <Input
                autoFocus
                placeholder="prompt 名称（唯一）"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="font-mono"
              />
              {nameDup && <p className="text-[11px] text-fail-fg">已存在同名 prompt</p>}
            </div>
          )}

          {mode.kind === "fork" && (
            <p className="text-xs text-text-3">
              基于{" "}
              <span className="font-mono text-muted-foreground">
                {mode.promptName} v{mode.sourceVersion}
              </span>{" "}
              新建
            </p>
          )}

          <div className="space-y-1.5">
            <label className="text-[12.5px] font-medium text-muted-foreground">内容</label>
            <Textarea
              autoFocus={mode.kind === "fork"}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[380px] max-h-[60vh] resize-y bg-surface-2 font-mono text-[13px] leading-relaxed"
            />
            <p className="text-right font-mono text-[11px] text-text-3">{content.length} 字符</p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={disabled}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
