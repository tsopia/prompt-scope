export function formatCost(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `$${v.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0")}`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
