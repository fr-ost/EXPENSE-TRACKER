"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormatMoney } from "@/components/app-data";
import { formatMonth, type MonthKey } from "@/lib/dates";
import { toChartNumber, type Money } from "@/lib/money";
import type { DayPoint } from "@/lib/types";
import { axisProps, gridProps, Legend, TooltipCard, useAxisFormatter } from "./chart-parts";

const CURRENT = "var(--chart-expense)";
const PREVIOUS = "var(--chart-muted)";

/**
 * Cumulative spending by day of month: this month (emphasised) against last
 * month (gray context). Answers "am I spending faster than usual?".
 */
export function PaceChart({
  current,
  previous,
  month,
  previousMonth,
  height = 220,
}: {
  current: DayPoint[];
  previous: DayPoint[];
  month: MonthKey;
  previousMonth: MonthKey;
  height?: number;
}) {
  const format = useFormatMoney();
  const axis = useAxisFormatter();
  const days = Math.max(current.length, previous.length, 28);
  const data = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    current: current[i] ? toChartNumber(current[i].total) : null,
    previous: previous[i] ? toChartNumber(previous[i].total) : null,
    currentMoney: current[i]?.total as Money | undefined,
    previousMoney: previous[i]?.total as Money | undefined,
  }));

  return (
    <div className="flex flex-col gap-3">
      <Legend
        items={[
          { label: formatMonth(month), color: CURRENT },
          { label: formatMonth(previousMonth), color: PREVIOUS },
        ]}
      />
      <div style={{ height }} className="w-full" role="img" aria-label="Cumulative spending by day of month">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="day" {...axisProps} tickMargin={8} ticks={[1, 8, 15, 22, days]} />
            <YAxis {...axisProps} tickFormatter={axis} width={44} />
            <Tooltip
              cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !row) return null;
                return (
                  <TooltipCard
                    title={`Day ${row.day}`}
                    rows={[
                      ...(row.currentMoney ? [{ label: formatMonth(month, "short"), value: format(row.currentMoney), color: CURRENT }] : []),
                      ...(row.previousMoney ? [{ label: formatMonth(previousMonth, "short"), value: format(row.previousMoney), color: PREVIOUS }] : []),
                    ]}
                  />
                );
              }}
            />
            <Line type="monotone" dataKey="previous" stroke={PREVIOUS} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls={false} animationDuration={500} />
            <Line type="monotone" dataKey="current" stroke={CURRENT} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: CURRENT }} connectNulls={false} animationDuration={600} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
