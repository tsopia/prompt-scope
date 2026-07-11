"use client";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api, ApiError, JudgeTemplate } from "@/lib/api";
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
import { cn } from "@/lib/utils";

export type JudgeTemplateEditorMode =
  | {
      kind: "create";
      projectId: string;
      existingNames: string[];
      onSaved: () => void;
    }
  | {
      kind: "edit";
      template: JudgeTemplate;
      existingNames: string[];
      onSaved: () => void;
    };

const MAX_CONTENT_LENGTH = 8000;

/**
 * 用户不写、也不该写这部分——任务输入/输出与 JSON 输出格式由后端评审 prompt 固定
 * 拼接（见 backend/services/judge_service.py PAIR_PROMPT/SINGLE_PROMPT）。这里的展示
 * 是静态简述，不是真实拼接结果，只是让用户理解自己写的 rubric 会被塞进什么上下文。
 */
function InjectedPreview() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border-soft bg-bg-grid">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground"
      >
        系统将自动注入
        <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-border-soft px-3 py-3 text-[11.5px] leading-relaxed text-text-3">
          <div>
            <p className="mb-1 font-semibold text-muted-foreground">任务输入 / 输出</p>
            <pre className="whitespace-pre-wrap rounded bg-surface-2 p-2 font-mono">
              {"[任务输入]\n<subject 的原始输入>\n\n[待评审输出 A]\n<subject 的输出>\n\n[对比输出 B]（仅对比评分时注入）\n<compare 的输出>"}
            </pre>
          </div>
          <div>
            <p className="mb-1 font-semibold text-muted-foreground">JSON 输出格式（结尾固定追加）</p>
            <pre className="whitespace-pre-wrap rounded bg-surface-2 p-2 font-mono">
              {'{ "score": <0-10>, "verdict": "...", "reasoning": "..." }'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 新建/编辑评分模板的大编辑器弹窗，沿用 PromptEditorDialog 的模式（max-w-3xl +
 * mono Textarea）。多了一段只读的「系统将自动注入」折叠区，让用户清楚自己写的
 * rubric 之外，评审 prompt 还会拼接什么——避免用户重复描述任务输入/输出或 JSON 格式。
 */
export function JudgeTemplateEditorDialog({
  open,
  onOpenChange,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: JudgeTemplateEditorMode;
}) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const editingId = mode.kind === "edit" ? mode.template.id : null;

  useEffect(() => {
    if (!open) return;
    setName(mode.kind === "edit" ? mode.template.name : "");
    setContent(mode.kind === "edit" ? mode.template.content : "");
    setError(null);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode.kind, editingId]);

  const trimmedName = name.trim();
  const originalName = mode.kind === "edit" ? mode.template.name : null;
  const nameDup =
    trimmedName !== "" &&
    trimmedName.toLowerCase() !== originalName?.toLowerCase() &&
    mode.existingNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase());

  const overLength = content.length > MAX_CONTENT_LENGTH;
  const disabled = submitting || trimmedName === "" || content.trim() === "" || nameDup || overLength;

  const submit = async () => {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode.kind === "create") {
        await api.createJudgeTemplate({ project_id: mode.projectId, name: trimmedName, content });
      } else {
        await api.updateJudgeTemplate(mode.template.id, { name: trimmedName, content });
      }
      onOpenChange(false);
      mode.onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("已存在同名模板");
      } else if (e instanceof ApiError && e.status === 403) {
        setError("仅创建者或项目 owner 可修改");
      } else {
        setError(String(e));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode.kind === "create" ? "新建评分模板" : `编辑模板 · ${mode.template.name}`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <label className="text-[12.5px] font-medium text-muted-foreground">名称</label>
            <Input
              autoFocus
              placeholder="模板名称（同项目内唯一）"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="font-mono"
            />
            {nameDup && <p className="text-[11px] text-fail-fg">已存在同名模板</p>}
          </div>

          <div className="space-y-1.5">
            <label className="text-[12.5px] font-medium text-muted-foreground">内容</label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="描述评审身份与标准，如：你是一名严格的代码评审专家……"
              className="min-h-[320px] max-h-[60vh] resize-y bg-surface-2 font-mono text-[13px] leading-relaxed"
            />
            <p className={cn("text-right font-mono text-[11px]", overLength ? "text-fail-fg" : "text-text-3")}>
              {content.length} / {MAX_CONTENT_LENGTH} 字符
            </p>
          </div>

          <InjectedPreview />

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={disabled}>
            {mode.kind === "create" ? "创建" : "保存修改"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
