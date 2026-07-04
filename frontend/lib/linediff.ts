export interface LineDiffEntry {
  type: "same" | "add" | "del";
  text: string;
}

// 行级 LCS：与 lib/align.ts 的 DP+回溯模式一致，key 为整行字符串全等。
export function diffLines(a: string, b: string): LineDiffEntry[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const dp: number[][] = Array.from({ length: aLines.length + 1 }, () =>
    new Array(bLines.length + 1).fill(0));
  for (let i = aLines.length - 1; i >= 0; i--) {
    for (let j = bLines.length - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: LineDiffEntry[] = [];
  let i = 0, j = 0;
  while (i < aLines.length && j < bLines.length) {
    if (aLines[i] === bLines[j]) {
      result.push({ type: "same", text: aLines[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "del", text: aLines[i] });
      i++;
    } else {
      result.push({ type: "add", text: bLines[j] });
      j++;
    }
  }
  for (; i < aLines.length; i++) result.push({ type: "del", text: aLines[i] });
  for (; j < bLines.length; j++) result.push({ type: "add", text: bLines[j] });
  return result;
}
