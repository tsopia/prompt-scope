import { Candidate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const COLOR_BARS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"];

interface CandidateItemProps {
  candidate: Candidate;
  index: number;
  isSelected: boolean;
  onToggle: (id: string) => void;
}

export function CandidateItem({ candidate, index, isSelected, onToggle }: CandidateItemProps) {
  const color = COLOR_BARS[index % COLOR_BARS.length];
  const totalTokens = (candidate.input_tokens ?? 0) + (candidate.output_tokens ?? 0);

  return (
    <div
      onClick={() => onToggle(candidate.id)}
      className={cn(
        "relative flex items-center gap-2.5 px-2.5 py-2 cursor-pointer rounded-lg transition-all",
        isSelected
          ? "bg-indigo-50 border border-indigo-200"
          : "hover:bg-[#F3F4F6] border border-transparent"
      )}
    >
      <div className="w-1 h-7 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1F2937] truncate">{candidate.model}</p>
        <p className="text-xs text-[#9CA3AF]">
          ${candidate.cost.toFixed(4)} · {candidate.latency.toFixed(1)}s · {totalTokens}t
        </p>
      </div>
      {isSelected && <Check className="h-3.5 w-3.5 text-indigo-500 shrink-0" />}
    </div>
  );
}
