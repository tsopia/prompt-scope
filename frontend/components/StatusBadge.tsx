import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusBadgeKind =
  | "success"
  | "error"
  | "running"
  | "warning"
  | "live"
  | "replay"
  | "pass"
  | "fail"
  | "replaceable"
  | "not_replaceable";

// 全局语义色映射：绿=success/pass/replaceable，琥珀=warning/running，红=error/fail/not_replaceable，紫=replay，蓝=live
const KIND_CLASSES: Record<StatusBadgeKind, string> = {
  success: "bg-success/15 text-success border-success/30",
  pass: "bg-success/15 text-success border-success/30",
  replaceable: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  running: "bg-warning/15 text-warning border-warning/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
  fail: "bg-destructive/15 text-destructive border-destructive/30",
  not_replaceable: "bg-destructive/15 text-destructive border-destructive/30",
  replay: "bg-replay/15 text-replay border-replay/30",
  live: "bg-live/15 text-live border-live/30",
};

export function StatusBadge({
  kind,
  label,
  className,
}: {
  kind: StatusBadgeKind;
  label?: string;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(KIND_CLASSES[kind], className)}>
      {label ?? kind}
    </Badge>
  );
}
