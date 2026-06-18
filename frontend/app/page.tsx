"use client";
import { useState, useEffect } from "react";
import { api, Candidate } from "@/lib/api";
import { ExperimentList } from "@/components/ExperimentList";
import { CompareWorkspace } from "@/components/CompareWorkspace";
import { SyncStatus } from "@/components/SyncStatus";

export default function Page() {
  const [experiments, setExperiments] = useState<Record<string, Candidate[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const loadExperiments = async () => {
    try {
      const data = await api.getExperiments();
      setExperiments(data);
    } catch (e) {
      console.error("Failed to load experiments:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExperiments();
  }, []);

  const toggleCandidate = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const allCandidatesInView = Object.values(experiments).flat();

  const selectedCandidates = Object.values(experiments)
    .flat()
    .filter((c) => selectedIds.includes(c.id));

  return (
    <div className="h-screen flex flex-col bg-[#F9FAFB]">
      {/* Header */}
      <header className="bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-bold text-[#1F2937]">PromptScope</h1>
        <SyncStatus onSyncComplete={loadExperiments} />
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Experiment List */}
        <aside className="w-56 shrink-0 bg-white border-r border-[#E5E7EB] overflow-y-auto">
          <div className="px-3 py-2 border-b border-[#F3F4F6]">
            <p className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider">实验列表</p>
          </div>
          {loading ? (
            <div className="p-4 text-sm text-[#9CA3AF]">加载中...</div>
          ) : (
            <ExperimentList
              experiments={experiments}
              selectedIds={selectedIds}
              onToggle={toggleCandidate}
            />
          )}
        </aside>

        {/* Right: Compare Workspace */}
        <main className="flex-1 overflow-y-auto">
          <CompareWorkspace
            key={selectedIds.join(",")}
            selectedCandidates={selectedCandidates}
            allCandidates={allCandidatesInView}
            selectedIds={selectedIds}
          />
        </main>
      </div>
    </div>
  );
}
