"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ObservationNode } from "@/lib/api";
import { formatCost, formatLatency } from "@/lib/format";
import { MetricText } from "@/components/MetricText";
import { cn } from "@/lib/utils";

const TYPE_CLASSES: Record<string, string> = {
  llm: "bg-replay/15 text-replay border-replay/30",
  tool: "bg-success/15 text-success border-success/30",
  span: "bg-muted text-muted-foreground border-border",
};

function TreeNode({
  node, depth, selectedId, onSelect,
}: {
  node: ObservationNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  const isSpan = node.type === "span";
  const isError = node.status === "error";

  return (
    <>
      <div
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        className={cn(
          "flex items-center gap-2 py-1.5 pr-2 border-l-2 cursor-pointer text-sm",
          isError ? "border-l-destructive" : "border-l-success",
          selectedId === node.id ? "bg-accent" : "hover:bg-accent/50"
        )}
      >
        {isSpan && hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((c) => !c);
            }}
            aria-label={collapsed ? "展开" : "折叠"}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", !collapsed && "rotate-90")}
            />
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium", TYPE_CLASSES[node.type])}>
          {node.type}
        </span>
        <span className="truncate font-medium">{node.name || node.id.slice(0, 8)}</span>
        {node.model && <span className="text-xs text-muted-foreground">{node.model}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {node.cost !== null && <MetricText value={formatCost(node.cost)} />}
          {node.latency_ms !== null && <MetricText value={formatLatency(node.latency_ms)} />}
        </span>
      </div>
      {hasChildren && !(isSpan && collapsed) && node.children.map((c) => (
        <TreeNode key={c.id} node={c} depth={depth + 1}
                  selectedId={selectedId} onSelect={onSelect} />
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
  return (
    <div className="py-1">
      {nodes.map((n) => (
        <TreeNode key={n.id} node={n} depth={0}
                  selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}
