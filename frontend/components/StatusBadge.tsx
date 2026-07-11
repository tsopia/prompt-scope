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

// 全局语义色映射：绿=success/pass/replaceable，琥珀=warning，红=error/fail/not_replaceable，紫=replay，蓝=live/running（脉冲）
const KIND_CLASSES: Record<StatusBadgeKind, { pill: string; dot: string; pulse?: boolean }> = {
  success: { pill: "bg-success/15 text-success-fg", dot: "bg-success" },
  pass: { pill: "bg-success/15 text-success-fg", dot: "bg-success" },
  replaceable: { pill: "bg-success/15 text-success-fg", dot: "bg-success" },
  warning: { pill: "bg-warning/15 text-warning-fg", dot: "bg-warning" },
  error: { pill: "bg-destructive/15 text-fail-fg", dot: "bg-destructive" },
  fail: { pill: "bg-destructive/15 text-fail-fg", dot: "bg-destructive" },
  not_replaceable: { pill: "bg-destructive/15 text-fail-fg", dot: "bg-destructive" },
  replay: { pill: "bg-replay/15 text-replay-fg", dot: "bg-replay" },
  live: { pill: "bg-live/15 text-live-fg", dot: "bg-live" },
  running: { pill: "bg-live/15 text-live-fg", dot: "bg-live", pulse: true },
};

// 供只需要一个状态点（无文字标签）的紧凑场景复用，而不是各处重新定义颜色映射。
export function statusDotClass(kind: StatusBadgeKind): string {
  const { dot, pulse } = KIND_CLASSES[kind];
  return cn(dot, pulse && "animate-pulse");
}

export function StatusBadge({
  kind,
  label,
  className,
}: {
  kind: StatusBadgeKind;
  label?: string;
  className?: string;
}) {
  const { pill, dot, pulse } = KIND_CLASSES[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold leading-4",
        pill,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 flex-none rounded-full", dot, pulse && "animate-pulse")} />
      {label ?? kind}
    </span>
  );
}
