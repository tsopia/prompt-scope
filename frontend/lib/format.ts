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

// 后端（尤其 SQLite 落盘时）返回的是不带时区后缀的朴素 UTC ISO 字符串
// （如 "2026-07-11T08:23:45.123456"）——`new Date(...)` 会把它当作*本地*时区
// 解析，在非 UTC 时区下相对时间会整体偏移。已带 Z / ±HH:MM 后缀的字符串保持不变。
function toUtcIso(iso: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(toUtcIso(iso)).getTime()) / 1000));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}
