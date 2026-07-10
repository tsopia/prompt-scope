"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ObservationNode } from "@/lib/api";
import { formatLatency } from "@/lib/format";
import { cn } from "@/lib/utils";

const TAG_CLASSES: Record<string, string> = {
  llm: "text-primary",
  tool: "text-muted-foreground",
  span: "text-text-3",
};

function TypeTag({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border border-border-soft bg-bg-grid px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide",
        TAG_CLASSES[type] ?? "text-muted-foreground",
      )}
    >
      {type.toUpperCase()}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "error"
      ? "bg-destructive"
      : status === "running"
        ? "bg-live animate-pulse"
        : "bg-success";
  return <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cls)} />;
}

function TreeRow({
  node,
  depth,
  selectedId,
  onSelect,
  collapsed,
  onToggleCollapse,
}: {
  node: ObservationNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: Record<string, boolean>;
  onToggleCollapse: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = collapsed[node.id] !== true;
  const isSelected = selectedId === node.id;
  const isMocked = node.metadata?.mocked === true;
  // Only the llm type has a genuinely distinct sub-label (its model); tool/span
  // observations only carry `name`, so a second line would just repeat the title.
  const sub = node.type === "llm" ? node.model : null;

  return (
    <>
      <div
        onClick={() => onSelect(node.id)}
        className={cn(
          "mb-px flex min-h-[42px] cursor-pointer items-center gap-2 rounded-lg px-2 py-1",
          isSelected ? "bg-primary/10 shadow-[inset_3px_0_0_0_hsl(var(--primary))]" : "hover:bg-accent",
        )}
      >
        <span style={{ width: 6 + depth * 18 }} className="shrink-0" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleCollapse(node.id);
          }}
          aria-label={isExpanded ? "折叠" : "展开"}
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center border-none bg-transparent p-0 text-text-3"
        >
          {hasChildren && (
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-90")}
            />
          )}
        </button>
        <StatusDot status={node.status} />
        <TypeTag type={node.type} />
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-[12.5px] font-medium text-foreground">
            {node.name || node.id.slice(0, 8)}
          </span>
          {sub && <span className="truncate font-mono text-[11px] text-text-3">{sub}</span>}
        </span>
        {isMocked && (
          <span className="shrink-0 rounded-[5px] bg-replay/15 px-1.5 py-px font-mono text-[9.5px] font-semibold text-replay-foreground">
            MOCK
          </span>
        )}
        <span className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-text-3">
          {formatLatency(node.latency_ms)}
        </span>
      </div>
      {hasChildren && isExpanded && node.children.map((c) => (
        <TreeRow
          key={c.id}
          node={c}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
        />
      ))}
    </>
  );
}

export function TraceTree({
  nodes, selectedId, onSelect,
}: {
  nodes: ObservationNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCollapse = (id: string) =>
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  return (
    <div className="p-2">
      {nodes.map((n) => (
        <TreeRow
          key={n.id}
          node={n}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
        />
      ))}
    </div>
  );
}
