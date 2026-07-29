"use client";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BacktestResult, Holding } from "@/lib/types";

const GREEN = "#1D4ED8";
const SAGE = "#9AA79A";
const BRASS = "#2563EB";
const PALETTE = ["#1D4ED8", "#0891B2", "#7C3AED", "#16A34A", "#64748B", "#DC2626", "#3B82F6", "#0A2540"];

export function EquityCurve({ data }: { data: BacktestResult["equityCurve"] }) {
  const fmt = (t: number) => new Date(t).getFullYear().toString();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="strat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GREEN} stopOpacity={0.28} />
            <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" tickFormatter={fmt} tick={{ fontSize: 11, fill: "#6E7F6A", fontFamily: "var(--font-mono)" }} minTickGap={40} axisLine={{ stroke: "#D8D2C2" }} tickLine={false} />
        <YAxis tickFormatter={(v) => `${v.toFixed(1)}x`} tick={{ fontSize: 11, fill: "#6E7F6A", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} width={34} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid #D8D2C2", fontSize: 12, fontFamily: "var(--font-mono)" }}
          labelFormatter={(t) => new Date(t).toLocaleDateString()}
          formatter={(v: number, n) => [`${v.toFixed(2)}x`, n === "strategy" ? "NIRVANA" : "S&P 500"]}
        />
        <Area type="monotone" dataKey="benchmark" stroke={SAGE} strokeWidth={1.4} strokeDasharray="4 3" fill="none" />
        <Area type="monotone" dataKey="strategy" stroke={GREEN} strokeWidth={2.2} fill="url(#strat)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function AllocationDonut({ holdings }: { holdings: Holding[] }) {
  const data = holdings.map((h) => ({ name: h.symbol, value: Math.round(h.weight * 100) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={62} outerRadius={98} paddingAngle={2} stroke="none">
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid #D8D2C2", fontSize: 12, fontFamily: "var(--font-mono)" }}
          formatter={(v: number, n) => [`${v}%`, n]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ points, color = BRASS }: { points: number[]; color?: string }) {
  const data = points.map((y, x) => ({ x, y }));
  return (
    <ResponsiveContainer width="100%" height={44}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`sp-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="y" stroke={color} strokeWidth={1.6} fill={`url(#sp-${color.slice(1)})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
