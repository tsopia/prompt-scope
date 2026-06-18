"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, Candidate } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";

export function CandidatesPageContent() {
  const searchParams = useSearchParams();
  const experimentId = searchParams.get("experiment");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedCandidates, clearSelection } = useStore();

  useEffect(() => {
    loadCandidates();
  }, [experimentId]);

  const loadCandidates = async () => {
    try {
      const all = await api.getCandidates();
      if (experimentId) {
        setCandidates(all.filter((c) => c.experiment_id === experimentId));
      } else {
        setCandidates(all);
      }
    } catch (err) {
      console.error("Failed to load candidates:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" /> 返回
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Candidates</h1>
          </div>
          <div className="flex items-center gap-2">
            {selectedCandidates.length > 0 && (
              <Button variant="outline" size="sm" onClick={clearSelection}>
                清除选择 ({selectedCandidates.length})
              </Button>
            )}
            {selectedCandidates.length === 2 && (
              <Link href="/compare">
                <Button size="sm">
                  开始对比 <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            )}
            <div className="text-sm text-gray-400">Component removed</div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {loading ? (
          <div className="text-center py-12">加载中...</div>
        ) : (
          <div className="text-sm text-gray-400">Component removed</div>
        )}
      </main>
    </div>
  );
}
