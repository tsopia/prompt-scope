"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, TraceSummary } from "@/lib/api";
import { useProject } from "@/contexts/ProjectContext";
import { TraceTable } from "@/components/TraceTable";

const ORIGINS = [
  { value: "", label: "全部" },
  { value: "live", label: "Live" },
  { value: "replay", label: "回放" },
];

export default function TracesPage() {
  const { currentProject } = useProject();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [origin, setOrigin] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const toggleCompare = (id: string) =>
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });

  useEffect(() => {
    if (!currentProject) return;
    setLoading(true);
    setError(null);
    api
      .getTraces({ projectId: currentProject.id, origin: origin || undefined, search: search || undefined })
      .then((r) => {
        setTraces(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [currentProject, origin, search]);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">
          Traces <span className="text-gray-400 font-normal">({total})</span>
        </h2>
        <div className="flex items-center gap-2">
          <input
            className="text-sm border border-[#E5E7EB] rounded-md px-3 py-1.5 w-56"
            placeholder="按名称搜索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {compareIds.length === 2 && (
            <Link href={`/compare?a=${compareIds[0]}&b=${compareIds[1]}`}
                  className="text-sm px-3 py-1.5 rounded-md bg-[#6366F1] text-white">
              对比选中项 (2)
            </Link>
          )}
          <div className="flex rounded-md border border-[#E5E7EB] overflow-hidden">
            {ORIGINS.map((o) => (
              <button
                key={o.value}
                onClick={() => setOrigin(o.value)}
                className={`text-xs px-3 py-1.5 ${
                  origin === o.value ? "bg-[#6366F1] text-white" : "bg-white text-gray-600"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-x-auto">
        {error ? (
          <div className="p-8 text-sm text-red-500">加载失败：{error}</div>
        ) : loading ? (
          <div className="p-8 text-sm text-gray-400">加载中…</div>
        ) : (
          <TraceTable traces={traces} compareIds={compareIds} onToggleCompare={toggleCompare} />
        )}
      </div>
    </main>
  );
}
