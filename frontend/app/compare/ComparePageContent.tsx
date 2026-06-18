"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, Candidate, CompareResult } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { ComparePanel } from "@/components/ComparePanel";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";

export function ComparePageContent() {
  const searchParams = useSearchParams();
  const urlA = searchParams.get("a");
  const urlB = searchParams.get("b");

  const { selectedCandidates, compareResult: storeResult, setCompareResult, clearSelection } = useStore();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [localResult, setLocalResult] = useState<CompareResult | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 优先使用 URL 参数，其次使用 store（仅在客户端挂载后生效）
  const candidateIds = mounted && urlA && urlB ? [urlA, urlB] : selectedCandidates;

  useEffect(() => {
    if (candidateIds.length !== 2) return;

    const loadAndCompare = async () => {
      setLoading(true);
      try {
        const all = await api.getCandidates();
        setCandidates(all);

        const result = await api.compare(candidateIds[0], candidateIds[1]);
        setLocalResult(result);
        setCompareResult(result);
      } catch (err) {
        console.error("Compare failed:", err);
      } finally {
        setLoading(false);
      }
    };

    loadAndCompare();
  }, [candidateIds[0], candidateIds[1]]);

  const candidateA = candidates.find((c) => c.id === candidateIds[0]);
  const candidateB = candidates.find((c) => c.id === candidateIds[1]);
  const displayResult = localResult || storeResult;

  if (candidateIds.length !== 2) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">请先选择两个 candidate 进行对比</p>
          <Link href="/candidates">
            <Button>去选 Candidate</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/candidates">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" /> 返回
              </Button>
            </Link>
            <h1 className="text-xl font-bold">对比分析</h1>
          </div>
          <Button variant="outline" size="sm" onClick={clearSelection}>
            重新选择
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin mr-2" />
            正在评估...
          </div>
        ) : (
          candidateA && candidateB && (
            <ComparePanel
              candidateA={candidateA}
              candidateB={candidateB}
              result={displayResult}
            />
          )
        )}
      </main>
    </div>
  );
}
