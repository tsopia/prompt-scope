"use client";

import { Candidate, CompareResult } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, TrendingDown, Star, DollarSign } from "lucide-react";

interface ComparePanelProps {
  candidateA: Candidate;
  candidateB: Candidate;
  result: CompareResult | null;
}

export function ComparePanel({ candidateA, candidateB, result }: ComparePanelProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Candidate A */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Candidate A</CardTitle>
              <Badge>{candidateA.model}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {candidateA.prompt_id} {candidateA.prompt_version && `v${candidateA.prompt_version}`}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-1">
                <DollarSign className="w-4 h-4 text-muted-foreground" />
                <span>${candidateA.cost.toFixed(4)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Star className="w-4 h-4 text-yellow-500" />
                <span>{result?.score_a.toFixed(1) || "-"}</span>
              </div>
            </div>
            <div className="bg-muted rounded-lg p-4 text-sm whitespace-pre-wrap">
              {candidateA.output}
            </div>
          </CardContent>
        </Card>

        {/* Candidate B */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Candidate B（参考）</CardTitle>
              <Badge variant="secondary">{candidateB.model}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {candidateB.prompt_id} {candidateB.prompt_version && `v${candidateB.prompt_version}`}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-1">
                <DollarSign className="w-4 h-4 text-muted-foreground" />
                <span>${candidateB.cost.toFixed(4)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Star className="w-4 h-4 text-yellow-500" />
                <span>{result?.score_b.toFixed(1) || "-"}</span>
              </div>
            </div>
            <div className="bg-muted rounded-lg p-4 text-sm whitespace-pre-wrap">
              {candidateB.output}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Judge Result */}
      {result && (
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.replaceable ? (
                <>
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span>可替代</span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-red-500" />
                  <span>不可替代</span>
                </>
              )}
              {result.from_cache && (
                <Badge variant="outline" className="ml-2">缓存</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Candidate A 评分</p>
                <p className="text-2xl font-bold">{result.score_a.toFixed(1)}</p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Candidate B 评分</p>
                <p className="text-2xl font-bold">{result.score_b.toFixed(1)}</p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">成本差异</p>
                <div className="flex items-center justify-center gap-1">
                  <TrendingDown className="w-5 h-5 text-green-500" />
                  <p className="text-2xl font-bold text-green-600">
                    {result.cost_diff > 0 ? `+$${result.cost_diff.toFixed(4)}` : `-$${Math.abs(result.cost_diff).toFixed(4)}`}
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-muted rounded-lg p-4">
              <p className="text-sm text-muted-foreground mb-1">评估理由</p>
              <p className="text-sm">{result.reason}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
