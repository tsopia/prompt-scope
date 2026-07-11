"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const MIN_LENGTH = 8;

// 账户下拉菜单「修改密码」入口的表单弹框。后端契约：POST /api/auth/change-password
// {current_password, new_password} -> 200 {changed:true}；400 detail 为「当前密码不正确」
// 或「SSO 账户无本地密码」，422 为 min-8 校验失败——两者都以行内 destructive 文案展示。
// 成功后其他会话会被后端注销，只有当前会话存活，故此处只需关闭弹框 + toast 提示，不必登出自己。
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const sameAsCurrentHint = next.length > 0 && current.length > 0 && next === current;
  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const canSubmit = current.length > 0 && next.length >= MIN_LENGTH && next === confirm;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.changePassword({ current_password: current, new_password: next });
      onOpenChange(false);
      toast.success("密码已更新，其他设备已退出登录");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError(String(e));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="change-pw-current" className="text-[12.5px] font-medium text-muted-foreground">
              当前密码
            </label>
            <Input
              id="change-pw-current"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="change-pw-next" className="text-[12.5px] font-medium text-muted-foreground">
              新密码
            </label>
            <Input
              id="change-pw-next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            {tooShort && <p className="text-xs text-destructive">新密码至少 8 位</p>}
            {!tooShort && sameAsCurrentHint && (
              <p className="text-xs text-muted-foreground">新密码与当前密码相同</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="change-pw-confirm" className="text-[12.5px] font-medium text-muted-foreground">
              确认新密码
            </label>
            <Input
              id="change-pw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {mismatch && <p className="text-xs text-destructive">两次输入的新密码不一致</p>}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={!canSubmit || submitting}>
            {submitting ? "提交中…" : "确认修改"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
