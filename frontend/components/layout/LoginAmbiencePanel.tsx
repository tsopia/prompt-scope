"use client";

import { useEffect, useState } from "react";
import { StatusBadge, type StatusBadgeKind } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

// Signature left-panel ambience for /login, translated from docs/design/Login.dc.html.
// Purely decorative — no auth logic lives here.

interface ChainStepDef {
  tag: string;
  label: string;
  lat: string;
  latMs: number;
  kind: StatusBadgeKind;
  indent: number;
}

const CHAIN_DEF: ChainStepDef[] = [
  { tag: "LLM", label: "规划：读取购物车", lat: "820ms", latMs: 820, kind: "live", indent: 0 },
  { tag: "TOOL", label: "get_cart", lat: "240ms", latMs: 240, kind: "pass", indent: 14 },
  { tag: "LLM", label: "决定发起支付", lat: "910ms", latMs: 910, kind: "warning", indent: 14 },
  { tag: "TOOL", label: "charge_payment · mock", lat: "1.38s", latMs: 1380, kind: "replay", indent: 14 },
  { tag: "LLM", label: "评分：可替代性判定", lat: "770ms", latMs: 770, kind: "pass", indent: 0 },
];

const LEGEND: { kind: StatusBadgeKind; label: string }[] = [
  { kind: "pass", label: "通过" },
  { kind: "warning", label: "偏离" },
  { kind: "replay", label: "回放" },
  { kind: "live", label: "实时" },
  { kind: "fail", label: "失败" },
];

const DOT_BG: Record<StatusBadgeKind, string> = {
  success: "bg-success",
  pass: "bg-success",
  replaceable: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
  fail: "bg-destructive",
  not_replaceable: "bg-destructive",
  replay: "bg-replay",
  live: "bg-live",
  running: "bg-live",
};

const GLOW_RING: Record<StatusBadgeKind, string> = {
  success: "shadow-[0_0_0_4px_hsl(var(--success)/0.16)]",
  pass: "shadow-[0_0_0_4px_hsl(var(--success)/0.16)]",
  replaceable: "shadow-[0_0_0_4px_hsl(var(--success)/0.16)]",
  warning: "shadow-[0_0_0_4px_hsl(var(--warning)/0.16)]",
  error: "shadow-[0_0_0_4px_hsl(var(--destructive)/0.16)]",
  fail: "shadow-[0_0_0_4px_hsl(var(--destructive)/0.16)]",
  not_replaceable: "shadow-[0_0_0_4px_hsl(var(--destructive)/0.16)]",
  replay: "shadow-[0_0_0_4px_hsl(var(--replay)/0.16)]",
  live: "shadow-[0_0_0_4px_hsl(var(--live)/0.16)]",
  running: "shadow-[0_0_0_4px_hsl(var(--live)/0.16)]",
};

const KIND_LABEL: Record<StatusBadgeKind, string> = {
  success: "通过",
  pass: "通过",
  replaceable: "通过",
  warning: "偏离",
  error: "失败",
  fail: "失败",
  not_replaceable: "失败",
  replay: "回放",
  live: "实时",
  running: "实时",
};

function formatElapsed(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function LoginAmbiencePanel() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s >= CHAIN_DEF.length + 1 ? 0 : s + 1));
    }, 950);
    return () => clearInterval(id);
  }, []);

  const totalMs = CHAIN_DEF.reduce((a, c) => a + c.latMs, 0);
  const doneMs = CHAIN_DEF.slice(0, Math.min(step + 1, CHAIN_DEF.length)).reduce((a, c) => a + c.latMs, 0);
  const finished = step > CHAIN_DEF.length;
  const runElapsed = finished ? `${formatElapsed(totalMs)} · 完成` : formatElapsed(doneMs);

  return (
    <div
      className="relative order-1 flex min-w-0 flex-1 items-center justify-center overflow-hidden p-12"
      style={{
        background:
          "radial-gradient(120% 90% at 22% 12%, hsl(var(--primary) / 0.09) 0%, transparent 55%)",
      }}
    >
      {/* faint grid, masked to a soft radial vignette */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--border-soft)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border-soft)) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
          maskImage: "radial-gradient(80% 70% at 60% 40%, black 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(80% 70% at 60% 40%, black 30%, transparent 100%)",
        }}
      />

      {/* observatory orbital rings */}
      <svg
        viewBox="0 0 600 600"
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[min(120%,860px)] w-[min(120%,860px)] -translate-x-1/2 -translate-y-1/2 text-primary opacity-50"
        fill="none"
      >
        <circle cx="300" cy="300" r="120" stroke="currentColor" strokeWidth="1" opacity="0.16" />
        <circle cx="300" cy="300" r="200" stroke="currentColor" strokeWidth="1" opacity="0.11" />
        <circle cx="300" cy="300" r="280" stroke="hsl(var(--border))" strokeWidth="1" opacity="0.5" />
        <g
          style={{ transformOrigin: "300px 300px" }}
          className="animate-[ps-orbit_32s_linear_infinite]"
        >
          <circle cx="420" cy="300" r="3" className="fill-replay" opacity="0.7" />
        </g>
        <g
          style={{ transformOrigin: "300px 300px", animationDirection: "reverse" }}
          className="animate-[ps-orbit_52s_linear_infinite]"
        >
          <circle cx="300" cy="100" r="2.5" className="fill-live" opacity="0.7" />
        </g>
        <g
          style={{ transformOrigin: "300px 300px" }}
          className="animate-[ps-orbit_44s_linear_infinite]"
        >
          <circle cx="500" cy="300" r="2.5" className="fill-success" opacity="0.6" />
        </g>
      </svg>

      {/* faint stars */}
      <span className="absolute left-[14%] top-[16%] h-0.5 w-0.5 rounded-full bg-text-3 opacity-50" aria-hidden />
      <span className="absolute left-[22%] top-[72%] h-0.5 w-0.5 rounded-full bg-text-3 opacity-40" aria-hidden />
      <span className="absolute left-[84%] top-[30%] h-0.5 w-0.5 rounded-full bg-text-3 opacity-45" aria-hidden />
      <span className="absolute left-[74%] top-[84%] h-0.5 w-0.5 rounded-full bg-text-3 opacity-40" aria-hidden />

      <div className="relative w-full max-w-[440px]">
        <div className="mb-[22px] inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-live [animation:ps-flow_1.6s_ease-in-out_infinite]" />
          <span className="font-mono text-[11.5px] tracking-wide text-muted-foreground">观测每一次 agent 运行</span>
        </div>

        <h2 className="m-0 text-[26px] font-bold leading-tight tracking-tight text-foreground">
          看清调用链
          <br />
          录制、回放、对比调优
        </h2>
        <p className="mb-[30px] mt-0 max-w-[400px] text-[13.5px] leading-relaxed text-muted-foreground">
          从 LLM 调用到工具执行，逐步可视化；换模型 / prompt 重跑，用录制结果 mock，多模型交叉评分。
        </p>

        {/* animated call chain card */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card/80 shadow-lg backdrop-blur-md">
          <div className="flex h-9 items-center gap-2 border-b border-border-soft px-3.5">
            <span className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-destructive opacity-60" />
              <span className="h-2 w-2 rounded-full bg-warning opacity-60" />
              <span className="h-2 w-2 rounded-full bg-success opacity-60" />
            </span>
            <span className="ml-1.5 font-mono text-[11px] text-text-3">tr_9f2ac10b · 结账助手</span>
            <div className="flex-1" />
            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-text-3">
              <span className="h-[5px] w-[5px] rounded-full bg-live [animation:ps-blip_1.1s_ease-in-out_infinite]" />
              {runElapsed}
            </span>
          </div>
          <div className="p-2 pb-4 pt-3.5">
            {CHAIN_DEF.map((c, i) => {
              const lit = i < step;
              const isActive = i === step;
              const dim = i > step;
              return (
                <div
                  key={c.label}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded-lg px-3 py-[7px] transition-[opacity,background-color] duration-300",
                    dim && "opacity-50",
                    isActive && "bg-primary/[0.08]"
                  )}
                >
                  <span style={{ width: c.indent }} className="shrink-0" />
                  <span
                    className={cn(
                      "h-[9px] w-[9px] shrink-0 rounded-full transition-colors duration-300",
                      lit || isActive ? DOT_BG[c.kind] : "bg-border",
                      isActive && GLOW_RING[c.kind]
                    )}
                  />
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-[5px] border border-border-soft bg-bg-grid px-1.5 py-px font-mono text-[9.5px] font-semibold tracking-wide",
                      lit || isActive ? "text-primary" : "text-text-3"
                    )}
                  >
                    {c.tag}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono text-[12.5px] transition-colors duration-300",
                      lit || isActive ? "text-foreground" : "text-text-3"
                    )}
                  >
                    {c.label}
                  </span>
                  {isActive && <span className="shrink-0 font-mono text-[10px] text-primary">运行中</span>}
                  {lit && (
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-3">{c.lat}</span>
                  )}
                  {lit && <StatusBadge kind={c.kind} label={KIND_LABEL[c.kind]} />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3.5">
          {LEGEND.map((l) => (
            <span key={l.kind} className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <span className={cn("h-[7px] w-[7px] rounded-full", DOT_BG[l.kind])} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
