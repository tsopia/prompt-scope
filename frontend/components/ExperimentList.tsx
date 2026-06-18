"use client";
import { useState } from "react";
import { Candidate } from "@/lib/api";
import { CandidateItem } from "./CandidateItem";
import { ChevronDown, ChevronRight } from "lucide-react";

interface ExperimentListProps {
  experiments: Record<string, Candidate[]>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}

export function ExperimentList({ experiments, selectedIds, onToggle }: ExperimentListProps) {
  const entries = Object.entries(experiments);
  const [openId, setOpenId] = useState<string | null>(
    entries.length > 0 ? entries[0][0] : null
  );

  if (entries.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-[#9CA3AF]">暂无实验数据</div>
    );
  }

  return (
    <div className="space-y-0.5 p-2">
      {entries.map(([expId, candidates]) => {
        const isOpen = openId === expId;
        const shortId = expId.length > 12 ? expId.slice(0, 12) + "…" : expId;
        return (
          <div key={expId}>
            <button
              onClick={() => setOpenId(isOpen ? null : expId)}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-[#F3F4F6] transition-colors text-left"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {isOpen
                  ? <ChevronDown className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0" />}
                <span className="text-xs font-medium text-[#374151] truncate" title={expId}>
                  {shortId}
                </span>
              </div>
              <span className="text-xs text-[#9CA3AF] shrink-0 ml-1">{candidates.length}</span>
            </button>
            {isOpen && (
              <div className="ml-1 mt-0.5 space-y-0.5">
                {candidates.map((c, i) => (
                  <CandidateItem
                    key={c.id}
                    candidate={c}
                    index={i}
                    isSelected={selectedIds.includes(c.id)}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
