"use client";

import { Candidate } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { CandidateCard } from "./CandidateCard";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

interface CandidateListProps {
  candidates: Candidate[];
}

export function CandidateList({ candidates }: CandidateListProps) {
  const { sortBy, sortOrder, setSortBy, setSortOrder } = useStore();

  const sortedCandidates = [...candidates].sort((a, b) => {
    let valA: number, valB: number;
    switch (sortBy) {
      case "cost":
        valA = a.cost;
        valB = b.cost;
        break;
      case "score":
        valA = a.score ?? 0;
        valB = b.score ?? 0;
        break;
      case "latency":
        valA = a.latency;
        valB = b.latency;
        break;
      default:
        return 0;
    }
    return sortOrder === "asc" ? valA - valB : valB - valA;
  });

  const toggleSort = (field: "cost" | "score" | "latency") => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const SortIcon = ({ field }: { field: "cost" | "score" | "latency" }) => {
    if (sortBy !== field) return <ArrowUpDown className="w-3 h-3" />;
    return sortOrder === "asc" ? (
      <ArrowUp className="w-3 h-3" />
    ) : (
      <ArrowDown className="w-3 h-3" />
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">
          共 {candidates.length} 个 candidate
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => toggleSort("cost")}>
            成本 <SortIcon field="cost" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => toggleSort("score")}>
            评分 <SortIcon field="score" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => toggleSort("latency")}>
            延迟 <SortIcon field="latency" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sortedCandidates.map((candidate) => (
          <CandidateCard key={candidate.id} candidate={candidate} />
        ))}
      </div>
    </div>
  );
}
