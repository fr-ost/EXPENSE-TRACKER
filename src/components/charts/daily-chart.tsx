"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormatMoney } from "@/components/app-data";
import { formatDate } from "@/lib/dates";
import { toChartNumber } from "@/lib/money";
import type { DayPoint } from "@/lib/types";
import { axisProps, gridProps, TooltipCard, useAxisFormatter } from "./chart-parts";

/** Spending per day of a month — one series, so no legend; the heading names it. */
export function DailyChart({ days, height = 220 }: { days: DayPoint[]; height?: number }) {
  const format = useFormatMoney();
  const axis = useAxisFormatter();
  const data = days.map((d) => ({ ...d, value: toChartNumber(d.total), day: Number(d.date.slice(8)) }));
  return (
    <div style={{ height }} className="w-full" role="img" aria-label="Spending per day">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="day" {...axisProps} tickMargin={8} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...axisProps} tickFormatter={axis} width={44} />
          <Tooltip
            cursor={{ fill: "var(--surface-muted)", radius: 4 }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !row) return null;
              return <TooltipCard title={formatDate(row.date, "long")} rows={[{ label: "Spent", value: format(row.total), color: "var(--chart-expense)" }]} />;
            }}
          />
          <Bar dataKey="value" fill="var(--chart-expense)" radius={[3, 3, 0, 0]} maxBarSize={16} animationDuration={500} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
