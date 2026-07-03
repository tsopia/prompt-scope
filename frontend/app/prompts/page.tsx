"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, PromptDetail, PromptSummary, PromptVersionInfo, VersionTrace } from "@/lib/api";
import { useProject } from "@/contexts/ProjectContext";

function VersionTracesSection({ versionId }: { versionId: string }) {
  const [open, setOpen] = useState(false);
  const [traces, setTraces] = useState<VersionTrace[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && traces === null) {
      api.getVersionTraces(versionId).then(setTraces).catch((e) => setError(String(e)));
    }
  };

  return (
    <div>
      <button onClick={toggle} className="text-xs text-[#6366F1]">
        {open ? "收起" : "使用此版本的 traces"}
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {error && <p className="text-xs text-red-500">{error}</p>}
          {traces === null && !error && <p className="text-xs text-gray-400">加载中…</p>}
          {traces !== null && traces.length === 0 && (
            <p className="text-xs text-gray-400">暂无引用</p>
          )}
          {traces?.map((t) => (
            <Link
              key={t.id}
              href={`/traces/${t.id}`}
              className="block text-xs px-2 py-1 rounded border border-[#E5E7EB] hover:bg-gray-50"
            >
              <span className="font-medium">{t.name || t.id.slice(0, 8)}</span>
              <span className="text-gray-400 ml-2">{t.origin}</span>
              <span className="text-gray-400 ml-2">{new Date(t.created_at).toLocaleString("zh-CN")}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function VersionCard({
  version,
  promptId,
  checked,
  onToggleCheck,
  onForkSubmit,
}: {
  version: PromptVersionInfo;
  promptId: string;
  checked: boolean;
  onToggleCheck: () => void;
  onForkSubmit: () => void;
}) {
  const [forking, setForking] = useState(false);
  const [content, setContent] = useState(version.content);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const startFork = () => {
    setContent(version.content);
    setError(null);
    setForking(true);
  };

  const submitFork = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.addPromptVersion(promptId, content);
      setForking(false);
      onForkSubmit();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-4 space-y-2">
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={onToggleCheck} />
        <span className="font-semibold text-sm">v{version.version}</span>
        <span className="text-xs text-gray-400 font-mono">
          {new Date(version.created_at).toLocaleString("zh-CN")}
        </span>
      </div>
      <pre className="text-xs bg-gray-50 border border-[#E5E7EB] rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
        {version.content}
      </pre>
      <div className="flex items-center gap-3">
        <button onClick={startFork} className="text-xs text-[#6366F1]">
          基于此版本新建
        </button>
      </div>
      {forking && (
        <div className="space-y-2 border-t border-[#E5E7EB] pt-2">
          <textarea
            className="w-full h-32 text-xs font-mono border border-[#E5E7EB] rounded p-2"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={submitFork}
              disabled={submitting || !content}
              className="text-xs px-3 py-1.5 rounded-md bg-[#6366F1] text-white disabled:opacity-50"
            >
              提交新版本
            </button>
            <button
              onClick={() => setForking(false)}
              className="text-xs px-3 py-1.5 rounded-md border border-[#E5E7EB] text-gray-600"
            >
              取消
            </button>
          </div>
        </div>
      )}
      <VersionTracesSection versionId={version.id} />
    </div>
  );
}

export default function PromptsPage() {
  const { currentProject } = useProject();
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [compareVersions, setCompareVersions] = useState<string[]>([]);

  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reloadPrompts = () => {
    if (!currentProject) return;
    api.getPrompts(currentProject.id).then(setPrompts).catch((e) => setListError(String(e)));
  };

  useEffect(() => {
    setPrompts([]);
    setSelectedId(null);
    setDetail(null);
    reloadPrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject]);

  useEffect(() => {
    setCompareVersions([]);
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailError(null);
    api.getPrompt(selectedId).then(setDetail).catch((e) => setDetailError(String(e)));
  }, [selectedId]);

  const reloadDetail = () => {
    if (!selectedId) return;
    api.getPrompt(selectedId).then(setDetail).catch((e) => setDetailError(String(e)));
    reloadPrompts();
  };

  const createPrompt = async () => {
    if (!currentProject) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.createPrompt({
        project_id: currentProject.id,
        name: newName,
        content: newContent,
      });
      setNewName("");
      setNewContent("");
      reloadPrompts();
      setSelectedId(created.id);
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const toggleCompareVersion = (id: string) =>
    setCompareVersions((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });

  const sortedVersions = useMemo(
    () => (detail ? [...detail.versions].sort((a, b) => b.version - a.version) : []),
    [detail]
  );

  const compareVersionPair = useMemo(() => {
    if (compareVersions.length !== 2 || !detail) return null;
    const va = detail.versions.find((v) => v.id === compareVersions[0]);
    const vb = detail.versions.find((v) => v.id === compareVersions[1]);
    if (!va || !vb) return null;
    return va.version <= vb.version ? [va, vb] : [vb, va];
  }, [compareVersions, detail]);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h2 className="text-base font-semibold mb-4">Prompts</h2>
      <div className="flex gap-6">
        <div className="w-64 shrink-0 space-y-4">
          <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
            {listError && <div className="p-3 text-xs text-red-500">加载失败：{listError}</div>}
            {!listError && prompts.length === 0 && (
              <div className="p-4 text-sm text-gray-400">暂无 prompt，创建一个开始管理版本吧。</div>
            )}
            {prompts.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`w-full text-left px-3 py-2 border-b border-[#F3F4F6] last:border-b-0 ${
                  selectedId === p.id ? "bg-[#EEF0FF]" : "hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{p.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">
                    v{p.latest_version}
                  </span>
                </div>
                <div className="text-xs text-gray-400">{p.version_count} 个版本</div>
              </button>
            ))}
          </div>

          <div className="bg-white rounded-lg border border-[#E5E7EB] p-3 space-y-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">新建 Prompt</h3>
            <input
              className="w-full text-sm border border-[#E5E7EB] rounded-md px-2 py-1.5"
              placeholder="名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <textarea
              className="w-full h-24 text-sm border border-[#E5E7EB] rounded-md px-2 py-1.5 font-mono"
              placeholder="初始版本内容"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
            />
            {createError && <p className="text-xs text-red-500">{createError}</p>}
            <button
              onClick={createPrompt}
              disabled={creating || !currentProject || !newName || !newContent}
              className="text-sm px-3 py-1.5 rounded-md bg-[#6366F1] text-white disabled:opacity-50"
            >
              创建
            </button>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {!selectedId && (
            <div className="bg-white rounded-lg border border-[#E5E7EB] p-8 text-sm text-gray-400 text-center">
              从左侧选择一个 prompt 查看版本历史，或新建一个 prompt。
            </div>
          )}
          {selectedId && detailError && (
            <div className="p-4 text-sm text-red-500">加载失败：{detailError}</div>
          )}
          {selectedId && !detailError && !detail && (
            <div className="p-4 text-sm text-gray-400">加载中…</div>
          )}
          {detail && (
            <div className="space-y-4">
              {compareVersionPair && (
                <section className="bg-white rounded-lg border border-[#E5E7EB] p-4">
                  <h3 className="text-sm font-semibold mb-2">
                    v{compareVersionPair[0].version} vs v{compareVersionPair[1].version}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <pre className="text-xs bg-gray-50 border border-[#E5E7EB] rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {compareVersionPair[0].content}
                    </pre>
                    <pre className="text-xs bg-gray-50 border border-[#E5E7EB] rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {compareVersionPair[1].content}
                    </pre>
                  </div>
                </section>
              )}
              <h3 className="text-sm font-semibold">{detail.name} 版本历史</h3>
              <div className="space-y-3">
                {sortedVersions.map((v) => (
                  <VersionCard
                    key={v.id}
                    version={v}
                    promptId={detail.id}
                    checked={compareVersions.includes(v.id)}
                    onToggleCheck={() => toggleCompareVersion(v.id)}
                    onForkSubmit={reloadDetail}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
