import type { Evaluation } from "./api";

// D3（沿用既有约定，见 components/JudgePanel.tsx 历史注释）：后端 Evaluation.verdict
// 只有 replaceable/not_replaceable 两态原始判决；「两者相当」是前端按分差在 not_replaceable
// 内部再切一刀的展示态，不是后端概念。TIE_THRESHOLD 与切分逻辑集中在这里，供 JudgePanel
// 的徽章渲染和合议统计共用，避免两处判定标准漂移。
export const TIE_THRESHOLD = 0.3;

export function isTie(ev: Pick<Evaluation, "score" | "score_b">): boolean {
  return ev.score !== null && ev.score_b !== null && Math.abs(ev.score - ev.score_b) <= TIE_THRESHOLD;
}

export type VerdictCategory = "B" | "A" | "TIE";

export function classifyVerdict(ev: Pick<Evaluation, "verdict" | "score" | "score_b">): VerdictCategory {
  if (ev.verdict === "replaceable") return "B";
  if (ev.verdict === "not_replaceable") return isTie(ev) ? "TIE" : "A";
  return "TIE";
}

export interface VerdictTally {
  b: number;
  a: number;
  tie: number;
  total: number;
}

// 客观聚合真实裁判的 verdict 计数——不是额外裁判，只是对已有结果的统计展示（合议汇总）。
export function tallyVerdicts(evs: Pick<Evaluation, "verdict" | "score" | "score_b">[]): VerdictTally {
  let b = 0, a = 0, tie = 0;
  evs.forEach((ev) => {
    const c = classifyVerdict(ev);
    if (c === "B") b++;
    else if (c === "A") a++;
    else tie++;
  });
  return { b, a, tie, total: evs.length };
}

// 三类计数打平时按 B > A > 两者相当 的固定优先级选择一个确定性结果——合议只是客观聚合
// 展示，打平顺序无语义偏向，只是需要可复现的规则。
export function majorityLabel(t: VerdictTally): string {
  if (t.total === 0) return "—";
  if (t.b >= t.a && t.b >= t.tie) return "B 可替代 A";
  if (t.a >= t.b && t.a >= t.tie) return "倾向保留 A";
  return "两者相当";
}

export function consensusSentence(t: VerdictTally): string {
  if (t.total === 0) return "";
  if (t.b >= t.a && t.b >= t.tie) return `${t.total} 位裁判中 ${t.b} 位认为 B 可替代 A`;
  if (t.a >= t.b && t.a >= t.tie) return `${t.total} 位裁判中 ${t.a} 位认为应保留 A`;
  return `${t.total} 位裁判中 ${t.tie} 位认为两者相当`;
}

// 频谱条上的位置（0-100，越靠右越偏向「B 可替代」）：verdict 分类决定基准位置，
// 分差在分类内小幅微调，避免同类判决的圆点完全重叠。
export function judgeSpectrumPosition(ev: Pick<Evaluation, "verdict" | "score" | "score_b">): number {
  const category = classifyVerdict(ev);
  if (category === "TIE") return 50;
  const base = category === "B" ? 80 : 20;
  if (ev.score !== null && ev.score_b !== null) {
    const delta = Math.max(-10, Math.min(10, ev.score_b - ev.score));
    return Math.max(4, Math.min(96, base + delta * 1.2));
  }
  return base;
}

// A/B 分数拆分为左右占比（0-100，左侧 = A 占比），供 duel bar / 维度分数条复用。
export function splitPct(a: number | null, b: number | null): number {
  const total = (a ?? 0) + (b ?? 0);
  return total > 0 ? ((a ?? 0) / total) * 100 : 50;
}
