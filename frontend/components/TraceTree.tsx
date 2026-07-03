"use client";
import { ObservationNode } from "@/lib/api";
import { formatCost, formatLatency } from "@/lib/format";

const TYPE_STYLES: Record<string, string> = {
  llm: "bg-purple-100 text-purple-700",
  tool: "bg-emerald-100 text-emerald-700",
  span: "bg-gray-100 text-gray-600",
};

function TreeNode({
  node, depth, selectedId, onSelect,
}: {
  node: ObservationNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        className={`flex items-center gap-2 py-1.5 pr-2 rounded cursor-pointer text-sm ${
          selectedId === node.id ? "bg-[#EEF0FF]" : "hover:bg-gray-50"
        } ${node.status === "error" ? "text-red-600" : ""}`}
      >
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_STYLES[node.type]}`}>
          {node.type}
        </span>
        <span className="font-medium truncate">{node.name || node.id.slice(0, 8)}</span>
        {node.model && <span className="text-xs text-gray-400">{node.model}</span>}
        <span className="ml-auto flex items-center gap-2 text-xs text-gray-400 font-mono shrink-0">
          {node.cost !== null && <span>{formatCost(node.cost)}</span>}
          {node.latency_ms !== null && <span>{formatLatency(node.latency_ms)}</span>}
        </span>
      </div>
      {node.children.map((c) => (
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
