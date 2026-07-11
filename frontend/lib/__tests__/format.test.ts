import { describe, expect, it, vi } from "vitest";
import { formatCost, formatLatency, formatRelativeTime, formatTokens } from "../format";

describe("formatRelativeTime", () => {
  it("returns em dash for null/undefined", () => {
    expect(formatRelativeTime(null)).toBe("—");
    expect(formatRelativeTime(undefined)).toBe("—");
  });

  it("treats a naive (no-timezone-suffix) ISO string as UTC", () => {
    // now = 2026-07-11T10:00:00Z; backend returns a naive string 2 hours earlier in UTC
    vi.setSystemTime(new Date("2026-07-11T10:00:00.000Z"));
    expect(formatRelativeTime("2026-07-11T08:00:00.000000")).toBe("2 小时前");
    vi.useRealTimers();
  });

  it("still handles ISO strings that already carry a timezone suffix", () => {
    vi.setSystemTime(new Date("2026-07-11T10:00:00.000Z"));
    expect(formatRelativeTime("2026-07-11T08:00:00.000000Z")).toBe("2 小时前");
    expect(formatRelativeTime("2026-07-11T08:00:00.000000+00:00")).toBe("2 小时前");
    vi.useRealTimers();
  });

  it("falls back to minutes/just-now for short diffs", () => {
    vi.setSystemTime(new Date("2026-07-11T10:00:00.000Z"));
    expect(formatRelativeTime("2026-07-11T09:59:30.000000")).toBe("刚刚");
    expect(formatRelativeTime("2026-07-11T09:55:00.000000")).toBe("5 分钟前");
    vi.useRealTimers();
  });
});

describe("formatCost/formatLatency/formatTokens (regression guard)", () => {
  it("formatCost", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(0)).toBe("$0");
  });
  it("formatLatency", () => {
    expect(formatLatency(500)).toBe("500ms");
    expect(formatLatency(1500)).toBe("1.5s");
  });
  it("formatTokens", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1500)).toBe("1.5k");
  });
});
