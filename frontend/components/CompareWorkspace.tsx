// frontend/components/CompareWorkspace.tsx
"use client";
import { useState } from "react";
import { Candidate, CompareResult, api } from "@/lib/api";
import { JudgeResult } from "./JudgeResult";
import { CostChart } from "./CostChart";
import { Play, MousePointerClick } from "lucide-react";

interface CompareWorkspaceProps {
  selectedCandidates: Candidate[];  // length 0, 1, or 2
  allCandidates: Candidate[];
  selectedIds: string[];
}

export function CompareWorkspace({
  selectedCandidates,
  allCandidates,
  selectedIds,
}: CompareWorkspaceProps) {
  const [judgeResult, setJudgeResult] = useState<CompareResult | null>(null);
  const [judging, setJudging] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);

  const handleJudge = async () => {
    if (selectedCandidates.length !== 2) return;
    setJudging(true);
    setJudgeError(null);
    try {
      const result = await api.compare(selectedCandidates[0].id, selectedCandidates[1].id);
      setJudgeResult(result);
    } catch {
      setJudgeError("Judge 评估失败，请重试");
    } finally {
      setJudging(false);
    }
  };

  // Empty state
  if (selectedCandidates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-8">
        <div className="w-14 h-14 bg-[#F3F4F6] rounded-full flex items-center justify-center mb-4">
          <MousePointerClick className="h-7 w-7 text-[#D1D5DB]" />
        </div>
        <p className="text-sm font-medium text-[#6B7280]">从左侧选择两个 Candidate 开始对比</p>
        <p className="text-xs text-[#9CA3AF] mt-1">点击选中，再点取消选中，最多同时选 2 个</p>
      </div>
    );
  }

  // Partial state (1 selected)
  if (selectedCandidates.length === 1) {
    const c = selectedCandidates[0];
    return (
      <div className="p-6 space-y-4">
        <CandidateCard candidate={c} label="已选择" />
        <p className="text-sm text-[#9CA3AF] text-center">再选择一个 Candidate 进行对比</p>
      </div>
    );
  }

  // 2 selected
  const [a, b] = selectedCandidates;
  return (
    <div className="p-6 space-y-5">
      {/* Side-by-side preview */}
      <div className="grid grid-cols-2 gap-4">
        <CandidateCard candidate={a} label="Candidate A" />
        <CandidateCard candidate={b} label="Candidate B" />
      </div>

      {/* Judge button */}
      {!judgeResult && (
        <button
          onClick={handleJudge}
          disabled={judging}
          className="w-full py-2.5 text-sm font-medium text-white bg-[#6366F1] rounded-lg hover:bg-[#4F46E5] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <Play className="h-4 w-4" />
          {judging ? "评估中..." : "运行 Judge"}
        </button>
      )}

      {judgeError && (
        <p className="text-sm text-red-500 text-center">{judgeError}</p>
      )}

      {/* Judge result */}
      {judgeResult && (
        <>
          <JudgeResult result={judgeResult} candidateA={a} candidateB={b} />
          <button
            onClick={() => { setJudgeResult(null); setJudgeError(null); }}
            className="text-xs text-[#6B7280] hover:text-[#1F2937] underline"
          >
            重新评估
          </button>
        </>
      )}

      {/* Cost chart for current experiment's candidates */}
      {allCandidates.length > 1 && (
        <div className="border-t border-[#E5E7EB] pt-5">
          <CostChart candidates={allCandidates} selectedIds={selectedIds} />
        </div>
      )}
    </div>
  );
}

// Internal helper component
function CandidateCard({ candidate, label }: { candidate: Candidate; label: string }) {
  const totalTokens = (candidate.input_tokens ?? 0) + (candidate.output_tokens ?? 0);
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-4 space-y-3">
      <div>
        <p className="text-xs text-[#6B7280] mb-0.5">{label}</p>
        <p className="text-sm font-semibold text-[#1F2937]">{candidate.model}</p>
        {candidate.prompt_id && (
          <p className="text-xs text-[#9CA3AF]">{candidate.prompt_id}</p>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-xs text-[#9CA3AF]">成本</p>
          <p className="text-sm font-medium text-[#1F2937]">${candidate.cost.toFixed(4)}</p>
        </div>
        <div>
          <p className="text-xs text-[#9CA3AF]">延迟</p>
          <p className="text-sm font-medium text-[#1F2937]">{candidate.latency.toFixed(1)}s</p>
        </div>
        <div>
          <p className="text-xs text-[#9CA3AF]">Tokens</p>
          <p className="text-sm font-medium text-[#1F2937]">{totalTokens}</p>
        </div>
      </div>
      <div>
        <p className="text-xs text-[#9CA3AF] mb-1">输出</p>
        <p className="text-xs text-[#374151] line-clamp-4 leading-relaxed">{candidate.output}</p>
      </div>
    </div>
  );
}
