import { describe, expect, it } from "vitest";
import { diffLines } from "../linediff";

describe("diffLines", () => {
  it("marks all lines as same when inputs are identical", () => {
    const a = "line1\nline2\nline3";
    const b = "line1\nline2\nline3";
    const result = diffLines(a, b);
    expect(result).toEqual([
      { type: "same", text: "line1" },
      { type: "same", text: "line2" },
      { type: "same", text: "line3" },
    ]);
  });

  it("marks purely appended lines as add", () => {
    const a = "line1\nline2";
    const b = "line1\nline2\nline3\nline4";
    const result = diffLines(a, b);
    expect(result).toEqual([
      { type: "same", text: "line1" },
      { type: "same", text: "line2" },
      { type: "add", text: "line3" },
      { type: "add", text: "line4" },
    ]);
  });

  it("marks purely removed lines as del", () => {
    const a = "line1\nline2\nline3\nline4";
    const b = "line1\nline4";
    const result = diffLines(a, b);
    expect(result).toEqual([
      { type: "same", text: "line1" },
      { type: "del", text: "line2" },
      { type: "del", text: "line3" },
      { type: "same", text: "line4" },
    ]);
  });

  it("keeps order for mixed changes with del before add", () => {
    const a = "keep1\nold\nkeep2";
    const b = "keep1\nnew\nkeep2";
    const result = diffLines(a, b);
    expect(result).toEqual([
      { type: "same", text: "keep1" },
      { type: "del", text: "old" },
      { type: "add", text: "new" },
      { type: "same", text: "keep2" },
    ]);
  });

  it("handles empty strings", () => {
    expect(diffLines("", "")).toEqual([{ type: "same", text: "" }]);
  });
});
