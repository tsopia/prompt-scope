"use client";

import { useState } from "react";
import { api, Candidate } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Play,
  RotateCcw,
  ChevronDown,
  Thermometer,
  Hash,
  Trash2,
  CheckCircle2,
  XCircle,
  ArrowRightLeft,
  Sparkles,
  TrendingDown,
  BarChart3,
} from "lucide-react";

interface ResultCardProps {
  candidate: Candidate;
  isSelected: boolean;
  onSelect: () => void;
  colorBar: string;
}

function ResultCard({ candidate, isSelected, onSelect, colorBar }: ResultCardProps) {
  const status = (candidate as any).status || "completed";
  const score = candidate.score ?? 0;
  const inputTokens = (candidate as any).input_tokens || 0;
  const outputTokens = (candidate as any).output_tokens || 0;

  return (
    <div
      onClick={onSelect}
      className={cn(
        "relative bg-white rounded-lg border cursor-pointer transition-all overflow-hidden",
        isSelected ? "border-[#6366F1] ring-1 ring-[#6366F1]" : "border-[#E5E7EB] hover:border-[#D1D5DB]"
      )}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: colorBar }} />
      <div className="p-4 pl-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[#1F2937]">{candidate.prompt_id}</span>
            <span className="text-xs text-[#9CA3AF]">·</span>
            <span className="text-sm text-[#6B7280]">{candidate.model}</span>
          </div>
          {status === "completed" ? (
            <span className="status-badge status-completed">已完成</span>
          ) : (
            <span className="status-badge status-pending">未运行</span>
          )}
        </div>

        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-1.5 bg-[#FEF3C7] text-[#92400E] px-2 py-1 rounded-full">
            <Sparkles className="h-3 w-3" />
            <span className="text-xs font-semibold">{score.toFixed(1)}/10</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-3">
          <div>
            <p className="metric-label">Score</p>
            <p className="metric-value">{score.toFixed(1)}</p>
          </div>
          <div>
            <p className="metric-label">成本</p>
            <p className="metric-value">${candidate.cost.toFixed(4)}</p>
          </div>
          <div>
            <p className="metric-label">延迟</p>
            <p className="metric-value">{candidate.latency}s</p>
          </div>
          <div>
            <p className="metric-label">Token</p>
            <p className="metric-value">{inputTokens + outputTokens}</p>
          </div>
        </div>

        <p className="text-xs text-[#6B7280] line-clamp-2">{candidate.output}</p>
      </div>
    </div>
  );
}

interface CompareDetailProps {
  candidateA: Candidate;
  candidateB: Candidate;
}

function CompareDetail({ candidateA, candidateB }: CompareDetailProps) {
  const scoreA = candidateA.score ?? 0;
  const scoreB = candidateB.score ?? 0;
  const costDiff = candidateB.cost - candidateA.cost;
  const savePercent = candidateB.cost > 0 ? ((costDiff / candidateB.cost) * 100).toFixed(1) : "0";

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-5">
      <h3 className="text-base font-semibold text-[#1F2937] mb-1">对比结果</h3>
      <p className="text-sm text-[#6B7280] mb-4">LLM Judge</p>

      <div className="mb-4 p-3 bg-[#F9FAFB] rounded-lg">
        <p className="text-sm text-[#1F2937] font-medium">
          是否可以用 {candidateA.prompt_id}·{candidateA.model} 替代 {candidateB.prompt_id}·{candidateB.model}?
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="p-4 bg-[#F9FAFB] rounded-lg">
          <p className="text-xs text-[#6B7280] mb-1">输入内容</p>
          <p className="text-sm text-[#1F2937] line-clamp-3">{candidateA.input}</p>
        </div>
        <div className="p-4 bg-[#F9FAFB] rounded-lg">
          <p className="text-xs text-[#6B7280] mb-1">输出内容</p>
          <p className="text-sm text-[#1F2937] line-clamp-3">{candidateA.output}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center p-4 bg-[#F9FAFB] rounded-lg">
          <p className="text-xs text-[#6B7280] mb-1">评分对比</p>
          <div className="flex items-center justify-center gap-2">
            <span className="text-2xl font-bold text-[#1F2937]">{scoreA.toFixed(1)}</span>
            <ArrowRightLeft className="h-4 w-4 text-[#9CA3AF]" />
            <span className="text-2xl font-bold text-[#1F2937]">{scoreB.toFixed(1)}</span>
          </div>
        </div>
        <div className="text-center p-4 bg-[#F9FAFB] rounded-lg">
          <p className="text-xs text-[#6B7280] mb-1">差异分析</p>
          <div className="flex items-center justify-center">
            {scoreA >= scoreB ? (
              <CheckCircle2 className="h-6 w-6 text-[#10B981]" />
            ) : (
              <XCircle className="h-6 w-6 text-[#EF4444]" />
            )}
          </div>
        </div>
        <div className="text-center p-4 bg-[#F9FAFB] rounded-lg">
          <p className="text-xs text-[#6B7280] mb-1">成本对比</p>
          <div className="flex items-center justify-center gap-1">
            <TrendingDown className="h-4 w-4 text-[#10B981]" />
            <span className="text-xl font-bold text-[#10B981]">↓ {savePercent}%</span>
          </div>
        </div>
      </div>

      <div className="p-3 bg-[#D1FAE5] rounded-lg mb-4">
        <p className="text-sm text-[#065F46]">
          ✅ {candidateA.prompt_id}·{candidateA.model} 可以替代 {candidateB.prompt_id}·{candidateB.model}，
          核心信息一致，成本降低 {savePercent}%。
        </p>
      </div>

      <div className="flex gap-3">
        <button className="flex-1 bg-[#10B981] text-white py-2.5 rounded-lg text-sm font-medium hover:bg-[#059669] transition-colors">
          提交替代方案
        </button>
        <button className="px-4 py-2.5 border border-[#E5E7EB] text-[#6B7280] rounded-lg text-sm font-medium hover:bg-[#F3F4F6] transition-colors">
          添加为推荐方案
        </button>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [inputText, setInputText] = useState(
    "请总结以下文章的核心观点：人工智能正在改变软件开发的范式，从代码生成到自动化测试，AI 工具正在提升开发效率。"
  );

  const runExperiment = async () => {
    setLoading(true);
    try {
      const data = await api.getCandidates();
      setCandidates(data);
    } catch (err) {
      console.error("Failed to load:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 2) {
        return [prev[1], id];
      }
      return [...prev, id];
    });
  };

  const selectedCandidates = candidates.filter((c) => selectedIds.includes(c.id));
  const hasCompare = selectedCandidates.length === 2;

  const colorBars = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B"];

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Top Bar */}
      <header className="bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-[#1F2937]">实验工作台</h1>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 text-sm font-medium text-[#6B7280] border border-[#E5E7EB] rounded-lg hover:bg-[#F3F4F6] transition-colors">
            使用指南
          </button>
          <button className="px-4 py-2 text-sm font-medium text-white bg-[#6366F1] rounded-lg hover:bg-[#4F46E5] transition-colors flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            新建实验
          </button>
        </div>
      </header>

      <div className="p-6">
        <div className="flex gap-6">
          {/* Left Config Panel */}
          <div className="w-[360px] shrink-0 space-y-4">
            <div className="bg-white rounded-lg border border-[#E5E7EB] p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-[#1F2937]">输入内容</h2>
                <button className="text-xs text-[#6B7280] hover:text-[#1F2937] flex items-center gap-1">
                  <Trash2 className="h-3 w-3" /> 清空
                </button>
              </div>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="w-full h-32 p-3 text-sm text-[#1F2937] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:border-transparent"
                placeholder="请输入实验内容..."
              />
            </div>

            <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-4">
              <div>
                <label className="text-sm font-medium text-[#1F2937] mb-1.5 block">提示词版本</label>
                <div className="relative">
                  <select className="w-full p-2.5 text-sm text-[#1F2937] bg-white border border-[#E5E7EB] rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-[#6366F1]">
                    <option>prompt1 - 简洁总结</option>
                    <option>prompt2 - 详细分析</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF] pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-[#1F2937] mb-1.5 block">模型</label>
                <div className="relative">
                  <select className="w-full p-2.5 text-sm text-[#1F2937] bg-white border border-[#E5E7EB] rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-[#6366F1]">
                    <option>gpt-4o</option>
                    <option>claude-3-haiku</option>
                    <option>gpt-4o-mini</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF] pointer-events-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-[#1F2937] mb-1.5 flex items-center gap-1">
                    <Thermometer className="h-3.5 w-3.5" /> 温度
                  </label>
                  <input
                    type="number"
                    defaultValue={0.3}
                    step={0.1}
                    className="w-full p-2.5 text-sm text-[#1F2937] bg-white border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-[#1F2937] mb-1.5 flex items-center gap-1">
                    <Hash className="h-3.5 w-3.5" /> 最大 Token
                  </label>
                  <input
                    type="number"
                    defaultValue={2000}
                    className="w-full p-2.5 text-sm text-[#1F2937] bg-white border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={runExperiment}
                disabled={loading}
                className="w-full py-2.5 text-sm font-medium text-white bg-[#6366F1] rounded-lg hover:bg-[#4F46E5] transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                {loading ? "运行中..." : "运行实验"}
              </button>

              <button type="button" className="w-full py-2.5 text-sm font-medium text-[#6366F1] border border-[#6366F1] rounded-lg hover:bg-[#EEF2FF] transition-colors flex items-center justify-center gap-2">
                <RotateCcw className="h-4 w-4" />
                补跑缺失组合
              </button>
            </div>
          </div>

          {/* Right Results Area */}
          <div className="flex-1 space-y-4">
            {candidates.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#1F2937]">实验结果</span>
                    <span className="text-xs text-[#6B7280]">({candidates.length})</span>
                    <span className="text-xs text-[#10B981]">已完成 {candidates.length}/{candidates.length} 个组合</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#6B7280]">全部</span>
                    <ChevronDown className="h-3 w-3 text-[#9CA3AF]" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {candidates.map((c, i) => (
                    <ResultCard
                      key={c.id}
                      candidate={c}
                      isSelected={selectedIds.includes(c.id)}
                      onSelect={() => toggleSelect(c.id)}
                      colorBar={colorBars[i % colorBars.length]}
                    />
                  ))}
                </div>

                {selectedIds.length > 0 && (
                  <div className="flex items-center justify-between bg-white rounded-lg border border-[#E5E7EB] px-4 py-3">
                    <span className="text-sm text-[#1F2937]">
                      已选择 <span className="font-semibold text-[#6366F1]">{selectedIds.length}</span> 个结果进行对比
                    </span>
                    <button
                      onClick={() => setSelectedIds([])}
                      className="text-xs text-[#6B7280] hover:text-[#1F2937] flex items-center gap-1"
                    >
                      <Trash2 className="h-3 w-3" /> 清空选择
                    </button>
                  </div>
                )}

                {hasCompare && (
                  <CompareDetail
                    candidateA={selectedCandidates[0]}
                    candidateB={selectedCandidates[1]}
                  />
                )}
              </>
            )}

            {candidates.length === 0 && !loading && (
              <div className="bg-white rounded-lg border border-[#E5E7EB] p-12 text-center">
                <BarChart3 className="h-12 w-12 text-[#D1D5DB] mx-auto mb-4" />
                <p className="text-sm text-[#6B7280] mb-4">点击"运行实验"开始生成结果</p>
                <button
                  onClick={runExperiment}
                  className="px-6 py-2.5 text-sm font-medium text-white bg-[#6366F1] rounded-lg hover:bg-[#4F46E5] transition-colors"
                >
                  运行实验
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
