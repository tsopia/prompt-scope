"use client";

import { Candidate } from "@/lib/api";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface CostChartProps {
  candidates: Candidate[];
}

export function CostChart({ candidates }: CostChartProps) {
  const data = candidates
    .filter((c) => c.score !== undefined && c.score !== null)
    .map((c) => ({
      x: c.cost,
      y: c.score,
      model: c.model,
      prompt: c.prompt_id,
    }));

  const colors = [
    "#8884d8",
    "#82ca9d",
    "#ffc658",
    "#ff7300",
    "#00C49F",
    "#FFBB28",
    "#FF8042",
    "#0088FE",
  ];

  return (
    <div className="w-full h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            name="成本"
            unit="$"
            label={{ value: "Cost ($)", position: "insideBottom", offset: -10 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="评分"
            domain={[0, 10]}
            label={{ value: "Score", angle: -90, position: "insideLeft" }}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg p-3 shadow-lg">
                    <p className="font-medium">{data.model}</p>
                    <p className="text-sm text-muted-foreground">{data.prompt}</p>
                    <p className="text-sm">成本: ${data.x.toFixed(4)}</p>
                    <p className="text-sm">评分: {data.y.toFixed(1)}</p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Scatter name="Candidates" data={data} fill="#8884d8">
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
