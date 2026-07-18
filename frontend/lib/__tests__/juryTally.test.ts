import { describe, expect, it } from "vitest";
import {
  classifyVerdict,
  consensusSentence,
  isTie,
  judgeSpectrumPosition,
  majorityLabel,
  splitPct,
  tallyVerdicts,
} from "../juryTally";
import type { Evaluation } from "../api";

type Ev = Pick<Evaluation, "verdict" | "score" | "score_b">;

const ev = (over: Partial<Ev>): Ev => ({ verdict: null, score: null, score_b: null, ...over });

describe("classifyVerdict", () => {
  it("maps replaceable to B", () => {
    expect(classifyVerdict(ev({ verdict: "replaceable", score: 8, score_b: 9 }))).toBe("B");
  });

  it("maps not_replaceable with a real score gap to A", () => {
    expect(classifyVerdict(ev({ verdict: "not_replaceable", score: 9, score_b: 6 }))).toBe("A");
  });

  it("maps not_replaceable with a near-equal score to TIE", () => {
    expect(classifyVerdict(ev({ verdict: "not_replaceable", score: 8, score_b: 7.8 }))).toBe("TIE");
  });

  it("falls back to TIE for an unknown/missing verdict", () => {
    expect(classifyVerdict(ev({ verdict: null }))).toBe("TIE");
  });
});

describe("isTie", () => {
  it("is false when either score is null", () => {
    expect(isTie(ev({ score: null, score_b: 8 }))).toBe(false);
  });
});

describe("tallyVerdicts / majorityLabel / consensusSentence", () => {
  it("tallies a mixed jury and produces a B-majority sentence", () => {
    const evs: Ev[] = [
      ev({ verdict: "replaceable", score: 8, score_b: 9 }),
      ev({ verdict: "replaceable", score: 8.5, score_b: 8.4 }),
      ev({ verdict: "not_replaceable", score: 8.7, score_b: 7.9 }),
      ev({ verdict: "not_replaceable", score: 8.1, score_b: 8.1 }),
    ];
    const t = tallyVerdicts(evs);
    expect(t).toEqual({ b: 2, a: 1, tie: 1, total: 4 });
    expect(majorityLabel(t)).toBe("B 可替代 A");
    expect(consensusSentence(t)).toBe("4 位裁判中 2 位认为 B 可替代 A");
  });

  it("produces an A-majority sentence when most judges lean A", () => {
    const evs: Ev[] = [
      ev({ verdict: "not_replaceable", score: 9, score_b: 6 }),
      ev({ verdict: "not_replaceable", score: 8, score_b: 5 }),
      ev({ verdict: "replaceable", score: 7, score_b: 8 }),
    ];
    const t = tallyVerdicts(evs);
    expect(majorityLabel(t)).toBe("倾向保留 A");
    expect(consensusSentence(t)).toBe("3 位裁判中 2 位认为应保留 A");
  });

  it("returns the empty-state placeholder for zero judges", () => {
    const t = tallyVerdicts([]);
    expect(majorityLabel(t)).toBe("—");
    expect(consensusSentence(t)).toBe("");
  });
});

describe("judgeSpectrumPosition", () => {
  it("positions a B verdict toward the right", () => {
    expect(judgeSpectrumPosition(ev({ verdict: "replaceable", score: 8, score_b: 8.5 }))).toBeGreaterThan(50);
  });

  it("positions an A verdict toward the left", () => {
    expect(judgeSpectrumPosition(ev({ verdict: "not_replaceable", score: 9, score_b: 6 }))).toBeLessThan(50);
  });

  it("centers a tie", () => {
    expect(judgeSpectrumPosition(ev({ verdict: "not_replaceable", score: 8, score_b: 7.9 }))).toBe(50);
  });
});

describe("splitPct", () => {
  it("splits proportionally between a and b", () => {
    expect(splitPct(6, 2)).toBe(75);
  });

  it("defaults to an even split when both are absent", () => {
    expect(splitPct(null, null)).toBe(50);
  });
});
