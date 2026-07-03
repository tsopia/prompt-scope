"use client";
import Link from "next/link";
import { useProject } from "@/contexts/ProjectContext";

export function TopBar() {
  const { projects, currentProject, setCurrentProject } = useProject();

  return (
    <header className="bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-6">
        <Link href="/traces" className="text-lg font-bold text-[#1F2937]">
          PromptScope
        </Link>
        <nav className="flex items-center gap-4 text-sm text-gray-600">
          <Link href="/traces" className="hover:text-[#6366F1]">Traces</Link>
          <Link href="/prompts" className="hover:text-[#6366F1]">Prompts</Link>
          <Link href="/settings" className="hover:text-[#6366F1]">Settings</Link>
        </nav>
      </div>
      <select
        className="text-sm border border-[#E5E7EB] rounded-md px-2 py-1 bg-white"
        value={currentProject?.id ?? ""}
        onChange={(e) => {
          const p = projects.find((x) => x.id === e.target.value);
          if (p) setCurrentProject(p);
        }}
      >
        {projects.length === 0 && <option value="">无项目</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </header>
  );
}
