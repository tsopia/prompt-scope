export function formatCost(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v === 0) return "$0";
  if (v > 0 && v < 1e-6) return "<$0.000001";
  return `$${Number(v.toPrecision(4))}`;
}

export function formatCostFull(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `$${v.toString()}`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}
