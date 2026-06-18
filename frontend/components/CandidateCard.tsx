"use client";

import { Candidate } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Clock, Star, Check } from "lucide-react";

interface CandidateCardProps {
  candidate: Candidate;
}

export function CandidateCard({ candidate }: CandidateCardProps) {
  const { selectedCandidates, toggleCandidate } = useStore();
  const isSelected = selectedCandidates.includes(candidate.id);

  const outputPreview = candidate.output
    ? candidate.output.slice(0, 120) + (candidate.output.length > 120 ? "..." : "")
    : "无输出";

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${
        isSelected ? "ring-2 ring-primary border-primary" : ""
      }`}
      onClick={() => toggleCandidate(candidate.id)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary">{candidate.prompt_id || "未知 prompt"}</Badge>
              <Badge variant="outline">{candidate.model}</Badge>
              {candidate.prompt_version && (
                <span className="text-xs text-muted-foreground">v{candidate.prompt_version}</span>
              )}
            </div>
          </div>
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
              isSelected
                ? "bg-primary border-primary text-primary-foreground"
                : "border-muted-foreground"
            }`}
          >
            {isSelected && <Check className="w-3 h-3" />}
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{outputPreview}</p>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1 text-muted-foreground">
            <DollarSign className="w-4 h-4" />
            <span>${candidate.cost.toFixed(4)}</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>{candidate.latency.toFixed(1)}s</span>
          </div>
          {candidate.score !== undefined && candidate.score !== null && (
            <div className="flex items-center gap-1 text-yellow-600">
              <Star className="w-4 h-4" />
              <span>{candidate.score.toFixed(1)}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
