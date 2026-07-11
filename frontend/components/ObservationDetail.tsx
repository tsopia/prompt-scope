"use client";
import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { ObservationNode } from "@/lib/api";
import { formatCost, formatLatency, formatTokens } from "@/lib/format";
import { CodeBlock } from "@/components/CodeBlock";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function jsonText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function toolDefName(def: Record<string, unknown>): string {
  const fn = def.function as Record<string, unknown> | undefined;
  return String(fn?.name ?? def.name ?? "?");
}

function toolDefDescription(def: Record<string, unknown>): string {
  const fn = def.function as Record<string, unknown> | undefined;
  return String(fn?.description ?? def.description ?? "");
}

function toolDefSchema(def: Record<string, unknown>): unknown {
  const fn = def.function as Record<string, unknown> | undefined;
  return fn?.parameters ?? def.parameters ?? def;
}

function countDescendants(node: ObservationNode): number {
  let c = 0;
  const walk = (n: ObservationNode) => {
    n.children.forEach((ch) => {
      c += 1;
      walk(ch);
    });
  };
  walk(node);
  return c;
}

function sumLlmTokens(node: ObservationNode): number {
  let tok = 0;
  const walk = (n: ObservationNode) => {
    if (n.type === "llm") tok += (n.input_tokens ?? 0) + (n.output_tokens ?? 0);
    n.children.forEach(walk);
  };
  walk(node);
  return tok;
}

/** Card with a bordered header + body, matching the design's `cardStyle`/`cardHeadStyle`. */
function DetailCard({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex h-10 items-center gap-2 border-b border-border-soft px-4 text-xs font-semibold tracking-wide text-muted-foreground">
        {title}
        {extra}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/** Collapsible variant of DetailCard — header itself is the toggle button. */
function CollapsibleCard({
  title,
  count,
  defaultOpen,
  headDot,
  headExtra,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen: boolean;
  headDot?: string;
  headExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-full items-center justify-between border-none bg-transparent px-4 font-mono text-xs font-semibold tracking-wide text-muted-foreground"
      >
        <span className="flex items-center gap-2">
          {headDot && <span className={cn("h-1.5 w-1.5 rounded-full", headDot)} />}
          {title}
          {count !== undefined && <span className="font-mono font-normal text-text-3">{count}</span>}
        </span>
        <span className="flex items-center gap-2.5">
          {headExtra}
          <ChevronRight className={cn("h-3.5 w-3.5 text-text-3 transition-transform", open && "rotate-90")} />
        </span>
      </button>
      {open && <div className="px-4 pb-4 pt-0.5">{children}</div>}
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
  const content = message.content;
  return (
    <div className="flex gap-3">
      <span className="w-[68px] shrink-0 pt-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-text-3">
        {role}
      </span>
      <div className="min-w-0 flex-1">
        {content != null && content !== "" && (
          <p className={cn("whitespace-pre-wrap break-words text-sm text-foreground")}>{String(content)}</p>
        )}
      </div>
    </div>
  );
}

function ToolCallBlock({ calls }: { calls: Array<Record<string, unknown>> }) {
  return (
    <div className="flex gap-3">
      <span className="w-[68px] shrink-0 pt-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-text-3">
        assistant
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {calls.map((c, i) => {
          const fn = (c.function ?? c) as Record<string, unknown>;
          const args = typeof fn.arguments === "string" ? fn.arguments : jsonText(fn.arguments ?? {});
          return (
            <pre
              key={i}
              className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border-soft bg-bg-grid p-2.5 font-mono text-xs text-muted-foreground"
            >
              {String(fn.name ?? "?")}({args})
            </pre>
          );
        })}
      </div>
    </div>
  );
}

function LlmDetail({ node }: { node: ObservationNode }) {
  const params = Object.entries(node.model_params ?? {});
  const toolDefs = (node.tool_definitions ?? []) as Record<string, unknown>[];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <DetailCard title="模型与参数">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-border-soft bg-bg-grid px-2.5 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="font-mono text-[13px] font-semibold">{node.model ?? "—"}</span>
          </div>
          {params.length > 0 ? (
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              {params.map(([k, v]) => (
                <Fragment key={k}>
                  <span className="text-xs text-text-3">{k}</span>
                  <span className="text-right font-mono text-xs tabular-nums text-foreground">
                    {jsonText(v)}
                  </span>
                </Fragment>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">未记录调用参数</p>
          )}
        </DetailCard>
        <DetailCard title="用量">
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <div className="mb-1 text-[11px] text-text-3">输入 token</div>
              <div className="font-mono text-lg font-semibold tabular-nums">{formatTokens(node.input_tokens)}</div>
            </div>
            <div>
              <div className="mb-1 text-[11px] text-text-3">输出 token</div>
              <div className="font-mono text-lg font-semibold tabular-nums">{formatTokens(node.output_tokens)}</div>
            </div>
            <div>
              <div className="mb-1 text-[11px] text-text-3">成本</div>
              <div className="font-mono text-lg font-semibold tabular-nums">{formatCost(node.cost)}</div>
            </div>
            <div>
              <div className="mb-1 text-[11px] text-text-3">延迟</div>
              <div className="font-mono text-lg font-semibold tabular-nums">{formatLatency(node.latency_ms)}</div>
            </div>
          </div>
        </DetailCard>
      </div>

      <DetailCard title="消息序列" extra={<span className="font-mono font-normal text-text-3">{node.messages?.length ?? 0}</span>}>
        <div className="flex flex-col gap-3">
          {(node.messages ?? []).map((m, i) => (
            <MessageBubble key={i} message={m as Record<string, unknown>} />
          ))}
          {node.tool_calls && node.tool_calls.length > 0 && (
            <ToolCallBlock calls={node.tool_calls as Record<string, unknown>[]} />
          )}
          {(!node.messages || node.messages.length === 0) && (!node.tool_calls || node.tool_calls.length === 0) && (
            <p className="text-sm text-muted-foreground">无消息记录</p>
          )}
        </div>
      </DetailCard>

      <CollapsibleCard title="工具定义" count={toolDefs.length} defaultOpen={false}>
        {toolDefs.length === 0 ? (
          <p className="text-xs text-muted-foreground">该次调用未携带工具定义</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {toolDefs.map((td, i) => (
              <div key={i} className="rounded-lg border border-border-soft p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-mono text-[13px] font-semibold text-primary">{toolDefName(td)}</span>
                  {toolDefDescription(td) && (
                    <span className="text-xs text-muted-foreground">{toolDefDescription(td)}</span>
                  )}
                </div>
                <pre className="overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed text-muted-foreground">
                  {jsonText(toolDefSchema(td))}
                </pre>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>
    </div>
  );
}

function ToolDetail({ node }: { node: ObservationNode }) {
  const isMocked = node.metadata?.mocked === true;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3">
        <span className="text-[11px] text-text-3">工具</span>
        <span className="font-mono text-sm font-semibold text-primary">{node.name}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-text-3">延迟</span>
        <span className="font-mono text-sm font-semibold tabular-nums">{formatLatency(node.latency_ms)}</span>
      </div>

      {node.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {node.error}
        </div>
      )}

      <CollapsibleCard title="input" defaultOpen headDot="bg-live">
        <pre className="overflow-x-auto whitespace-pre rounded-lg border border-border-soft bg-bg-grid p-3.5 font-mono text-[12.5px] leading-relaxed text-muted-foreground">
          {jsonText(node.tool_input)}
        </pre>
      </CollapsibleCard>

      <CollapsibleCard
        title="output"
        defaultOpen
        headDot="bg-success"
        headExtra={isMocked ? (
          <span className="rounded-[5px] bg-replay/15 px-1.5 py-px font-mono text-[10px] font-semibold text-replay-foreground">
            来自录制
          </span>
        ) : undefined}
      >
        <pre className="overflow-x-auto whitespace-pre rounded-lg border border-border-soft bg-bg-grid p-3.5 font-mono text-[12.5px] leading-relaxed text-muted-foreground">
          {node.tool_output !== null && node.tool_output !== undefined ? jsonText(node.tool_output) : "—"}
        </pre>
      </CollapsibleCard>
    </div>
  );
}

function SpanDetail({ node }: { node: ObservationNode }) {
  return (
    <DetailCard title="区块概要">
      <div className="grid grid-cols-3 gap-3.5">
        <div>
          <div className="mb-1 text-[11px] text-text-3">子节点</div>
          <div className="font-mono text-lg font-semibold tabular-nums">{countDescendants(node)}</div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-text-3">耗时</div>
          <div className="font-mono text-lg font-semibold tabular-nums">{formatLatency(node.latency_ms)}</div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-text-3">token 合计</div>
          <div className="font-mono text-lg font-semibold tabular-nums">{formatTokens(sumLlmTokens(node))}</div>
        </div>
      </div>
    </DetailCard>
  );
}

const MESSAGE_PREVIEW_COUNT = 2;

function CompactObservationDetail({ node }: { node: ObservationNode }) {
  const isMocked = node.metadata?.mocked === true;
  const messages = node.messages;
  const visibleMessages = messages?.slice(0, MESSAGE_PREVIEW_COUNT);
  const hiddenCount = messages ? messages.length - MESSAGE_PREVIEW_COUNT : 0;

  return (
    <div className="p-2">
      <div className="mb-2 flex items-center gap-3 text-sm">
        <span className="font-medium">{node.name || node.id.slice(0, 8)}</span>
        <span className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {node.type}
        </span>
        {node.model && <span className="text-xs text-muted-foreground">{node.model}</span>}
        {isMocked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="cursor-default border-warning/30 bg-warning/15 text-warning">
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
        <div className="mb-3 rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {node.error}
        </div>
      )}

      {node.type === "llm" && (
        <>
          {node.model_params && Object.keys(node.model_params).length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">模型参数</p>
              <CodeBlock code={jsonText(node.model_params)} language="json" />
            </div>
          )}
          {visibleMessages && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Messages</p>
              <div className="space-y-2">
                {visibleMessages.map((m, i) => (
                  <MessageBubble key={i} message={m as Record<string, unknown>} />
                ))}
              </div>
              {hiddenCount > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">…共 {messages!.length} 条</p>
              )}
            </div>
          )}
          {node.tool_calls && node.tool_calls.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">模型发起的工具调用</p>
              <CodeBlock code={jsonText(node.tool_calls)} language="json" />
            </div>
          )}
          {node.completion !== null && node.completion !== undefined && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">输出</p>
              <CodeBlock code={jsonText(node.completion)} language="json" />
            </div>
          )}
        </>
      )}

      {node.type === "tool" && (
        <>
          <div className="mb-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">入参</p>
            <CodeBlock code={jsonText(node.tool_input)} language="json" />
          </div>
          {node.tool_output !== null && node.tool_output !== undefined && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">返回结果</p>
              <CodeBlock code={jsonText(node.tool_output)} language="json" />
            </div>
          )}
        </>
      )}

      {node.type === "span" && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">基础信息</p>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>开始时间：{node.started_at ? new Date(node.started_at).toLocaleString("zh-CN") : "—"}</p>
            <p>结束时间：{node.ended_at ? new Date(node.ended_at).toLocaleString("zh-CN") : "—"}</p>
            <p>状态：{node.status}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function ObservationDetail({
  node,
  compact = false,
}: {
  node: ObservationNode;
  compact?: boolean;
}) {
  if (compact) return <CompactObservationDetail node={node} />;

  if (node.type === "llm") return <LlmDetail node={node} />;
  if (node.type === "tool") return <ToolDetail node={node} />;
  return <SpanDetail node={node} />;
}
