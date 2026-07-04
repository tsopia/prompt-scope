"use client";
import { ObservationNode } from "@/lib/api";
import { formatCost, formatLatency, formatTokens } from "@/lib/format";
import { CodeBlock } from "@/components/CodeBlock";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function jsonText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

const ROLE_CLASSES: Record<string, string> = {
  system: "bg-muted border-border",
  user: "bg-live/10 border-live/20",
  assistant: "bg-success/10 border-success/20",
  tool: "bg-warning/10 border-warning/20",
};

function MessageBubble({ message }: { message: Record<string, unknown> }) {
  const role = String(message.role ?? "?");
  return (
    <div className={cn("rounded border p-2", ROLE_CLASSES[role] ?? "bg-muted border-border")}>
      <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">{role}</p>
      <p className="whitespace-pre-wrap break-all text-sm">{String(message.content ?? "")}</p>
    </div>
  );
}

export function ObservationDetail({ node }: { node: ObservationNode }) {
  const isMocked = node.metadata?.mocked === true;
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-3 text-sm">
        <span className="font-medium">{node.name || node.id.slice(0, 8)}</span>
        <span className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {node.type}
        </span>
        {node.model && <span className="text-xs text-muted-foreground">{node.model}</span>}
        {isMocked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="cursor-default bg-warning/15 text-warning border-warning/30"
              >
                mocked
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <CodeBlock
                code={
                  node.metadata?.recorded_input !== undefined
                    ? jsonText(node.metadata.recorded_input)
                    : "无录制入参"
                }
                language="json"
              />
            </TooltipContent>
          </Tooltip>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">
            {formatTokens(node.input_tokens)} / {formatTokens(node.output_tokens)} tokens
          </span>
          <span className="font-mono tabular-nums">{formatCost(node.cost)}</span>
          <span className="font-mono tabular-nums">{formatLatency(node.latency_ms)}</span>
        </span>
      </div>

      {node.error && (
        <Section title="错误">
          <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {node.error}
          </div>
        </Section>
      )}

      {node.type === "llm" && (
        <>
          {node.model_params && Object.keys(node.model_params).length > 0 && (
            <Section title="模型参数">
              <CodeBlock code={jsonText(node.model_params)} language="json" />
            </Section>
          )}
          {node.messages && (
            <Section title="Messages">
              <div className="space-y-2">
                {node.messages.map((m, i) => (
                  <MessageBubble key={i} message={m as Record<string, unknown>} />
                ))}
              </div>
            </Section>
          )}
          {node.tool_calls && node.tool_calls.length > 0 && (
            <Section title="模型发起的工具调用">
              <CodeBlock code={jsonText(node.tool_calls)} language="json" />
            </Section>
          )}
          {node.completion !== null && node.completion !== undefined && (
            <Section title="输出">
              <CodeBlock code={jsonText(node.completion)} language="json" />
            </Section>
          )}
        </>
      )}

      {node.type === "tool" && (
        <>
          <Section title="入参">
            <CodeBlock code={jsonText(node.tool_input)} language="json" />
          </Section>
          {node.tool_output !== null && node.tool_output !== undefined && (
            <Section title="返回结果">
              <CodeBlock code={jsonText(node.tool_output)} language="json" />
            </Section>
          )}
        </>
      )}

      {node.type === "span" && (
        <Section title="基础信息">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>开始时间：{node.started_at ? new Date(node.started_at).toLocaleString("zh-CN") : "—"}</p>
            <p>结束时间：{node.ended_at ? new Date(node.ended_at).toLocaleString("zh-CN") : "—"}</p>
            <p>状态：{node.status}</p>
          </div>
        </Section>
      )}
    </div>
  );
}
