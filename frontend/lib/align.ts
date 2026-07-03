import type { ObservationNode } from "./api";

export interface AlignedRow {
  left: ObservationNode | null;
  right: ObservationNode | null;
  status: "matched" | "only_left" | "only_right";
  paramDiff: boolean;
}

export function flattenTree(nodes: ObservationNode[]): ObservationNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

const keyOf = (n: ObservationNode) => `${n.type}:${n.name}`;

function toolParamsDiffer(l: ObservationNode, r: ObservationNode): boolean {
  if (l.type !== "tool") return false;
  return JSON.stringify(l.tool_input ?? null) !== JSON.stringify(r.tool_input ?? null);
}

export function alignTraces(
  aTree: ObservationNode[], bTree: ObservationNode[],
): AlignedRow[] {
  const a = flattenTree(aTree);
  const b = flattenTree(bTree);
  // 经典 LCS 动态规划：dp[i][j] = a[i:], b[j:] 的最长公共（按 key）长度
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = keyOf(a[i]) === keyOf(b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: AlignedRow[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (keyOf(a[i]) === keyOf(b[j])) {
      rows.push({ left: a[i], right: b[j], status: "matched",
                  paramDiff: toolParamsDiffer(a[i], b[j]) });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ left: a[i], right: null, status: "only_left", paramDiff: false });
      i++;
    } else {
      rows.push({ left: null, right: b[j], status: "only_right", paramDiff: false });
      j++;
    }
  }
  for (; i < a.length; i++) rows.push({ left: a[i], right: null, status: "only_left", paramDiff: false });
  for (; j < b.length; j++) rows.push({ left: null, right: b[j], status: "only_right", paramDiff: false });
  return rows;
}
