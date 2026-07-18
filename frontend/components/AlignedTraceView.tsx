"use client";
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { AlignedRow } from "@/lib/align";
import { ObservationNode } from "@/lib/api";
import { formatCost, formatLatency } from "@/lib/format";
import { MetricText } from "@/components/MetricText";
import { CodeBlock } from "@/components/CodeBlock";
import { ObservationDetail } from "@/components/ObservationDetail";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const TYPE_CLASSES: Record<string, string> = {
  llm: "bg-bg-grid text-primary border-border-soft",
  tool: "bg-bg-grid text-muted-foreground border-border-soft",
  span: "bg-bg-grid text-text-3 border-border-soft",
};

function jsonText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function Cell({ node, missing, missingLabel, warn }: {
  node: ObservationNode | null; missing?: boolean; missingLabel?: string; warn?: boolean;
}) {
  if (!node) {
    return (
      <div className={cn("flex-1 px-3 py-2 text-xs italic text-muted-foreground", missing && "bg-muted/50")}>
        {missingLabel ?? "—"}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-1 min-w-0 items-center gap-2 px-3 py-2 text-sm",
        // 参数偏离行：单元格额外加一条警示色左边框，与行级 bg-warning/5 底色配合，
        // 而不是重新发明一套配色。
        warn && "border-l-2 border-warning/70",
      )}
    >
      <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium", TYPE_CLASSES[node.type])}>
        {node.type}
      </span>
      <span className="truncate font-medium">{node.name || node.id.slice(0, 8)}</span>
      {node.model && <span className="shrink-0 text-xs text-muted-foreground">{node.model}</span>}
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
        <MetricText value={`${node.cost !== null ? formatCost(node.cost) : ""} ${formatLatency(node.latency_ms)}`} />
      </span>
    </div>
  );
}

function MarkChip({ className, dotClassName, children }: {
  className: string; dotClassName?: string; children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold", className)}>
      {dotClassName && <span className={cn("h-1.5 w-1.5 rounded-full", dotClassName)} />}
      {children}
    </span>
  );
}

function MidBadge({ row }: { row: AlignedRow }) {
  if (row.status === "matched" && row.paramDiff) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default">
            <MarkChip className="bg-warning/15 text-warning-fg" dotClassName="bg-warning">参数偏离</MarkChip>
          </span>
        </TooltipTrigger>
        <TooltipContent className="p-2">
          <div className="flex gap-2">
            <div className="w-56">
              <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">A 侧入参</p>
              <CodeBlock code={jsonText(row.left?.tool_input)} language="json" />
            </div>
            <div className="w-56">
              <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">B 侧入参</p>
              <CodeBlock code={jsonText(row.right?.tool_input)} language="json" />
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  if (row.status === "matched") {
    return <MarkChip className="border border-border-soft bg-bg-grid text-text-3">双侧一致</MarkChip>;
  }
  const label = row.status === "only_left" ? "仅 A" : "仅 B";
  return <MarkChip className="bg-primary/15 text-primary" dotClassName="bg-primary">{label}</MarkChip>;
}

function Row({ row }: { row: AlignedRow }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = !!row.left || !!row.right;

  return (
    <div>
      <div
        onClick={() => canExpand && setExpanded((e) => !e)}
        className={cn(
          "flex items-stretch",
          canExpand && "cursor-pointer hover:bg-accent/50",
          row.status === "matched" && row.paramDiff && "bg-warning/5"
        )}
      >
        <div className="flex w-6 shrink-0 items-center justify-center text-muted-foreground">
          {canExpand && (
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
          )}
        </div>
        <Cell node={row.left} missing={row.status === "only_right"} missingLabel="此步仅存在于右侧" warn={row.status === "matched" && row.paramDiff} />
        <div className="flex w-16 shrink-0 items-center justify-center text-xs">
          <MidBadge row={row} />
        </div>
        <Cell node={row.right} missing={row.status === "only_left"} missingLabel="此步仅存在于左侧" warn={row.status === "matched" && row.paramDiff} />
      </div>
      {expanded && (
        <div className="flex items-stretch border-t bg-muted/20">
          <div className="w-6 shrink-0" />
          <div className="flex-1 min-w-0 border-r">
            {row.left ? (
              <ObservationDetail node={row.left} compact />
            ) : (
              <p className="p-3 text-xs italic text-muted-foreground">此步仅存在于右侧</p>
            )}
          </div>
          <div className="w-16 shrink-0" />
          <div className="flex-1 min-w-0">
            {row.right ? (
              <ObservationDetail node={row.right} compact />
            ) : (
              <p className="p-3 text-xs italic text-muted-foreground">此步仅存在于左侧</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AlignedTraceView({ rows }: { rows: AlignedRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">两条 trace 都没有 observation</div>
    );
  }
  return (
    <div className="divide-y">
      {rows.map((row, i) => (
        <Row key={i} row={row} />
      ))}
    </div>
  );
}
