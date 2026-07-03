"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, Divergence, JudgeModel, ObservationNode, PromptDetail, PromptSummary, ReplayRun, TraceDetail } from "@/lib/api";
import { formatCost, formatLatency } from "@/lib/format";

function flatten(nodes: ObservationNode[]): ObservationNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function modelSummary(trace: TraceDetail): string {
  const models = Array.from(
    new Set(flatten(trace.observations).filter((o) => o.type === "llm" && o.model).map((o) => o.model as string))
  ).sort();
  return models.join(", ");
}

function findSystemPrompt(trace: TraceDetail): string {
  const llmNode = flatten(trace.observations).find((o) => o.type === "llm");
  if (!llmNode?.messages) return "";
  const sys = llmNode.messages.find((m) => (m as Record<string, unknown>).role === "system");
  if (!sys) return "";
  const content = (sys as Record<string, unknown>).content;
  return typeof content === "string" ? content : "";
}

function statusBadge(status: string) {
  const cls =
    status === "success" ? "bg-green-100 text-green-700"
    : status === "failed" ? "bg-red-100 text-red-700"
    : "bg-gray-100 text-gray-600";
  return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{status}</span>;
}

function divergenceBadge(type: string) {
  const cls =
    type === "param_mismatch" ? "bg-orange-100 text-orange-700"
    : type === "unrecorded_call" ? "bg-red-100 text-red-700"
    : "bg-gray-100 text-gray-600";
  return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{type}</span>;
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="text-xs bg-gray-50 border border-[#E5E7EB] rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function DivergenceItem({ d }: { d: Divergence }) {
  return (
    <div className="border border-[#E5E7EB] rounded p-3 text-sm space-y-2">
      <div className="flex items-center gap-2">
        {divergenceBadge(d.type)}
        {d.tool && <span className="font-semibold">{d.tool}</span>}
        <span className="text-xs text-gray-400">step {d.step}</span>
      </div>
      {d.recorded_input !== undefined && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">录制入参</p>
          <Json value={d.recorded_input} />
        </div>
      )}
      {d.actual_input !== undefined && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">实际入参</p>
          <Json value={d.actual_input} />
        </div>
      )}
      {d.arguments !== undefined && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">调用参数</p>
          <Json value={d.arguments} />
        </div>
      )}
    </div>
  );
}

function ReplayResultCard({ run, sourceId }: { run: ReplayRun; sourceId: string }) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-4 space-y-3">
      <div className="flex items-center gap-2">
        {statusBadge(run.status)}
        <span className="text-xs text-gray-400 font-mono">
          {new Date(run.created_at).toLocaleString("zh-CN")}
        </span>
        <div className="ml-auto flex gap-2">
          {run.result_trace_id && (
            <>
              <Link href={`/compare?a=${sourceId}&b=${run.result_trace_id}`}
                    className="text-xs px-3 py-1 rounded-md border border-[#6366F1] text-[#6366F1] hover:bg-[#EEF0FF]">
                与源 trace 对比
              </Link>
              <Link href={`/traces/${run.result_trace_id}`}
                    className="text-xs px-3 py-1 rounded-md border border-[#E5E7EB] text-gray-600 hover:bg-gray-50">
                查看回放 trace
              </Link>
            </>
          )}
        </div>
      </div>
      {run.error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{run.error}</p>
      )}
      {run.divergences && run.divergences.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Divergences</p>
          {run.divergences.map((d, i) => <DivergenceItem key={i} d={d} />)}
        </div>
      )}
    </div>
  );
}

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [replays, setReplays] = useState<ReplayRun[]>([]);
  const [judgeModels, setJudgeModels] = useState<JudgeModel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("");
  const [prompt, setPrompt] = useState("");
  const [promptEdited, setPromptEdited] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const [libraryPrompts, setLibraryPrompts] = useState<PromptSummary[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [libraryDetail, setLibraryDetail] = useState<PromptDetail | null>(null);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<ReplayRun | null>(null);

  useEffect(() => {
    api.getTrace(id)
      .then((t) => {
        setTrace(t);
        setPrompt(findSystemPrompt(t));
      })
      .catch((e) => setLoadError(String(e)));
    api.getReplays(id).then(setReplays).catch(() => {});
    api.getJudgeModels().then(setJudgeModels).catch(() => setJudgeModels([]));
  }, [id]);

  useEffect(() => {
    if (!trace) return;
    api.getPrompts(trace.project_id).then(setLibraryPrompts).catch(() => setLibraryPrompts([]));
  }, [trace]);

  const summary = useMemo(() => (trace ? modelSummary(trace) : ""), [trace]);

  const selectLibraryPrompt = (promptId: string) => {
    setSelectedPromptId(promptId);
    setLibraryDetail(null);
    setSelectedVersionId(null);
    if (!promptId) return;
    api.getPrompt(promptId).then(setLibraryDetail).catch(() => setLibraryDetail(null));
  };

  const selectLibraryVersion = (versionId: string) => {
    setSelectedVersionId(versionId || null);
    if (!versionId || !libraryDetail) return;
    const v = libraryDetail.versions.find((x) => x.id === versionId);
    if (v) {
      setPrompt(v.content);
      setPromptEdited(false);
    }
  };

  const runReplay = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const useVersion = selectedVersionId && !promptEdited;
      const run = await api.createReplay({
        source_trace_id: id,
        override_model: model || undefined,
        override_model_params: temperature !== "" ? { temperature: parseFloat(temperature) } : undefined,
        override_prompt_version_id: useVersion ? selectedVersionId : undefined,
        override_prompt_text: !useVersion && promptEdited ? prompt : undefined,
      });
      setLastRun(run);
      setReplays(await api.getReplays(id));
    } catch (e) {
      setRunError(String(e));
    } finally {
      setRunning(false);
    }
  };

  if (loadError) return <main className="p-8 text-sm text-red-500">加载失败：{loadError}</main>;
  if (!trace) return <main className="p-8 text-sm text-gray-400">加载中…</main>;

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="mb-4">
        <Link href={`/traces/${trace.id}`} className="text-xs text-[#6366F1]">← 返回 trace</Link>
        <h2 className="text-base font-semibold mt-2">回放配置</h2>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] px-4 py-3 mb-4">
        <div className="flex items-center gap-3 mb-2">
          <span className="font-semibold text-sm">{trace.name || trace.id.slice(0, 8)}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            trace.origin === "replay" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
            {trace.origin}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <div><span className="text-gray-400 mr-2">模型</span><span className="font-mono">{summary || "—"}</span></div>
          <div><span className="text-gray-400 mr-2">总成本</span><span className="font-mono">{formatCost(trace.total_cost)}</span></div>
          <div><span className="text-gray-400 mr-2">总延迟</span><span className="font-mono">{formatLatency(trace.latency_ms)}</span></div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] p-4 mb-4 space-y-4">
        <h3 className="text-sm font-semibold">覆盖配置</h3>
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">模型</label>
          <select className="border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm w-full max-w-md"
                  value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">（沿用源模型）</option>
            {judgeModels.map((m) => (
              <option key={m.model} value={m.model}>{m.model} ({m.provider_name})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Temperature</label>
          <input type="number" step="0.1" className="border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm w-32"
                 value={temperature} onChange={(e) => setTemperature(e.target.value)}
                 placeholder="不覆盖" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">从 Prompt 库选择</label>
          <div className="flex gap-2">
            <select className="border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm flex-1"
                    value={selectedPromptId}
                    onChange={(e) => selectLibraryPrompt(e.target.value)}>
              <option value="">（不使用 Prompt 库）</option>
              {libraryPrompts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select className="border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm flex-1"
                    value={selectedVersionId ?? ""}
                    disabled={!libraryDetail}
                    onChange={(e) => selectLibraryVersion(e.target.value)}>
              <option value="">选择版本</option>
              {libraryDetail?.versions
                .slice()
                .sort((a, b) => b.version - a.version)
                .map((v) => (
                  <option key={v.id} value={v.id}>v{v.version}</option>
                ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">System Prompt</label>
          <textarea className="border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm w-full h-32 font-mono"
                    value={prompt}
                    onChange={(e) => { setPrompt(e.target.value); setPromptEdited(true); }} />
        </div>
        <button onClick={runReplay} disabled={running}
                className="text-sm px-4 py-1.5 rounded-md bg-[#6366F1] text-white disabled:opacity-50">
          {running ? "回放中，工具调用将使用录制结果 mock…" : "运行回放 ▶"}
        </button>
        {runError && <p className="text-sm text-red-600">{runError}</p>}
      </div>

      {lastRun && (
        <section className="mb-6">
          <h3 className="text-sm font-semibold mb-2">本次回放结果</h3>
          <ReplayResultCard run={lastRun} sourceId={trace.id} />
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold mb-2">历史回放</h3>
        {replays.length === 0 ? (
          <p className="text-sm text-gray-400">暂无历史回放记录。</p>
        ) : (
          <div className="space-y-3">
            {replays
              .slice()
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .map((r) => <ReplayResultCard key={r.id} run={r} sourceId={trace.id} />)}
          </div>
        )}
      </section>
    </main>
  );
}
