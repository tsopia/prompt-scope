"use client";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Candidate } from "@/lib/api";

const COLOR_BARS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"];

interface CostChartProps {
  candidates: Candidate[];
  selectedIds: string[];
}

interface ChartPoint {
  x: number;
  y: number;
  model: string;
  id: string;
  color: string;
  selected: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DotShape(props: any) {
  const { cx, cy, payload } = props;
  const r = payload.selected ? 8 : 5;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={payload.color}
      stroke={payload.selected ? "#1F2937" : "none"}
      strokeWidth={payload.selected ? 2 : 0}
      opacity={0.85}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: ChartPoint = payload[0].payload;
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 text-xs shadow-sm">
      <p className="font-semibold text-[#1F2937] mb-1">{d.model}</p>
      <p className="text-[#6B7280]">成本: ${d.x.toFixed(5)}</p>
      <p className="text-[#6B7280]">延迟: {d.y.toFixed(2)}s</p>
    </div>
  );
}

export function CostChart({ candidates, selectedIds }: CostChartProps) {
  if (candidates.length === 0) return null;

  const data: ChartPoint[] = candidates.map((c, i) => ({
    x: c.cost,
    y: c.latency,
    model: c.model,
    id: c.id,
    color: COLOR_BARS[i % COLOR_BARS.length],
    selected: selectedIds.includes(c.id),
  }));

  return (
    <div>
      <p className="text-xs font-medium text-[#6B7280] mb-3">Cost vs Latency</p>
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
          <XAxis
            dataKey="x"
            type="number"
            name="成本"
            tickFormatter={(v: number) => `$${v.toFixed(3)}`}
            tick={{ fontSize: 10, fill: "#9CA3AF" }}
            label={{
              value: "成本 ($)",
              position: "insideBottomRight",
              offset: -4,
              fontSize: 10,
              fill: "#9CA3AF",
            }}
          />
          <YAxis
            dataKey="y"
            type="number"
            name="延迟"
            tickFormatter={(v: number) => `${v.toFixed(1)}s`}
            tick={{ fontSize: 10, fill: "#9CA3AF" }}
            label={{
              value: "延迟 (s)",
              angle: -90,
              position: "insideLeft",
              offset: 8,
              fontSize: 10,
              fill: "#9CA3AF",
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Scatter data={data} shape={<DotShape />} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
