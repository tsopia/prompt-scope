import { CompareResult, Candidate } from "@/lib/api";
import { CheckCircle2, XCircle, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface JudgeResultProps {
  result: CompareResult;
  candidateA: Candidate;
  candidateB: Candidate;
}

export function JudgeResult({ result, candidateA, candidateB }: JudgeResultProps) {
  // cost_diff = cost_b - cost_a. Positive = A is cheaper than B.
  const aSavesVsB = result.cost_diff > 0;
  const savePct =
    candidateB.cost > 0
      ? ((Math.abs(result.cost_diff) / candidateB.cost) * 100).toFixed(1)
      : "0";

  return (
    <div className="space-y-3">
      {/* Verdict */}
      <div
        className={cn(
          "flex items-center gap-3 p-3 rounded-lg",
          result.replaceable
            ? "bg-emerald-50 border border-emerald-200"
            : "bg-red-50 border border-red-200"
        )}
      >
        {result.replaceable ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
        ) : (
          <XCircle className="h-5 w-5 text-red-500 shrink-0" />
        )}
        <p
          className={cn(
            "text-sm font-semibold",
            result.replaceable ? "text-emerald-800" : "text-red-800"
          )}
        >
          {result.replaceable ? "可以替代" : "不建议替代"}
        </p>
        {result.from_cache && (
          <span className="ml-auto text-xs text-[#9CA3AF] bg-[#F3F4F6] px-2 py-0.5 rounded-full">
            已缓存
          </span>
        )}
      </div>

      {/* Scores */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#F9FAFB] rounded-lg p-3 text-center">
          <p className="text-xs text-[#6B7280] mb-1 truncate" title={candidateA.model}>
            {candidateA.model}
          </p>
          <p className="text-2xl font-bold text-[#1F2937]">{result.score_a.toFixed(1)}</p>
          <p className="text-xs text-[#9CA3AF]">/ 10</p>
        </div>
        <div className="bg-[#F9FAFB] rounded-lg p-3 text-center">
          <p className="text-xs text-[#6B7280] mb-1 truncate" title={candidateB.model}>
            {candidateB.model}
          </p>
          <p className="text-2xl font-bold text-[#1F2937]">{result.score_b.toFixed(1)}</p>
          <p className="text-xs text-[#9CA3AF]">/ 10</p>
        </div>
      </div>

      {/* Cost diff */}
      <div className="bg-[#F9FAFB] rounded-lg p-3 flex items-center gap-3">
        {aSavesVsB ? (
          <TrendingDown className="h-5 w-5 text-emerald-500 shrink-0" />
        ) : (
          <TrendingUp className="h-5 w-5 text-red-500 shrink-0" />
        )}
        <div>
          <p className="text-xs text-[#6B7280]">
            {aSavesVsB ? "替换后节省" : "替换后增加"}
          </p>
          <p
            className={cn(
              "text-sm font-semibold",
              aSavesVsB ? "text-emerald-600" : "text-red-600"
            )}
          >
            {aSavesVsB ? "↓" : "↑"} {savePct}%（${Math.abs(result.cost_diff).toFixed(5)}）
          </p>
        </div>
      </div>

      {/* Reason */}
      <div className="bg-[#F9FAFB] rounded-lg p-3">
        <p className="text-xs text-[#6B7280] mb-1.5">Judge 说明</p>
        <p className="text-sm text-[#374151] leading-relaxed">{result.reason}</p>
      </div>
    </div>
  );
}
