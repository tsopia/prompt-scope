"use client";
import { ObservationNode } from "@/lib/api";
import { formatCost, formatLatency, formatTokens } from "@/lib/format";

function Json({ value }: { value: unknown }) {
  return (
    <pre className="text-xs bg-gray-50 border border-[#E5E7EB] rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{title}</p>
      {children}
    </div>
  );
}

export function ObservationDetail({ node }: { node: ObservationNode }) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4 text-sm">
        <span className="font-semibold">{node.name || node.id.slice(0, 8)}</span>
        <span className="text-xs text-gray-400">{node.type}</span>
        {node.model && <span className="text-xs text-gray-500">{node.model}</span>}
        <span className="ml-auto text-xs text-gray-400 font-mono">
          {formatTokens(node.input_tokens)} / {formatTokens(node.output_tokens)} tokens
          · {formatCost(node.cost)} · {formatLatency(node.latency_ms)}
        </span>
      </div>

      {node.error && (
        <Section title="错误">
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
            {node.error}
          </div>
        </Section>
      )}

      {node.type === "llm" && (
        <>
          {node.model_params && Object.keys(node.model_params).length > 0 && (
            <Section title="模型参数"><Json value={node.model_params} /></Section>
          )}
          {node.messages && (
            <Section title="Messages">
              <div className="space-y-2">
                {node.messages.map((m, i) => (
                  <div key={i} className="border border-[#E5E7EB] rounded p-2">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">
                      {String((m as Record<string, unknown>).role ?? "?")}
                    </p>
                    <p className="text-sm whitespace-pre-wrap break-all">
                      {String((m as Record<string, unknown>).content ?? "")}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {node.tool_calls && node.tool_calls.length > 0 && (
            <Section title="模型发起的工具调用"><Json value={node.tool_calls} /></Section>
          )}
          {node.completion !== null && node.completion !== undefined && (
            <Section title="输出"><Json value={node.completion} /></Section>
          )}
        </>
      )}

      {node.type === "tool" && (
        <>
          <Section title="入参"><Json value={node.tool_input} /></Section>
          {node.tool_output !== null && node.tool_output !== undefined && (
            <Section title="返回结果"><Json value={node.tool_output} /></Section>
          )}
        </>
      )}

      {node.type === "span" && (
        <Section title="基础信息">
          <div className="text-sm text-gray-600 space-y-1">
            <p>开始时间：{node.started_at ? new Date(node.started_at).toLocaleString("zh-CN") : "—"}</p>
            <p>结束时间：{node.ended_at ? new Date(node.ended_at).toLocaleString("zh-CN") : "—"}</p>
            <p>状态：{node.status}</p>
          </div>
        </Section>
      )}
    </div>
  );
}
