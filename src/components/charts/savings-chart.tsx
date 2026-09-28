"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormatMoney } from "@/components/app-data";
import { formatDate, formatMonth, monthStart } from "@/lib/dates";
import { toChartNumber } from "@/lib/money";
import type { MonthPoint } from "@/lib/types";
import { axisProps, gridProps, Legend, TooltipCard, useAxisFormatter } from "./chart-parts";

const SAVED = "var(--positive)";
const SHORT = "var(--negative)";

/**
 * Net savings per month on a zero baseline: polarity is carried by position
 * (above / below zero) first, colour second.
 */
export function SavingsChart({ months, height = 220 }: { months: MonthPoint[]; height?: number }) {
  const format = useFormatMoney();
  const axis = useAxisFormatter();
  const data = months.map((m) => ({ ...m, value: toChartNumber(m.savings), label: formatDate(monthStart(m.month), "monthShort") }));
  return (
    <div className="flex flex-col gap-3">
      <Legend
        items={[
          { label: "Saved", color: SAVED },
          { label: "Overspent", color: SHORT },
        ]}
      />
      <div style={{ height }} className="w-full" role="img" aria-label="Net savings by month">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} tickMargin={8} />
            <YAxis {...axisProps} tickFormatter={axis} width={44} />
            <ReferenceLine y={0} stroke="var(--border-strong)" />
            <Tooltip
              cursor={{ fill: "var(--surface-muted)", radius: 4 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !row) return null;
                return (
                  <TooltipCard
                    title={formatMonth(row.month)}
                    rows={[
                      { label: "Saved", value: format(row.savings), color: row.value < 0 ? SHORT : SAVED },
                      { label: "Savings rate", value: row.savingsRate === null ? "—" : `${row.savingsRate.toFixed(1)}%`, muted: true },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="value" radius={[4, 4, 4, 4]} maxBarSize={22} animationDuration={500}>
              {data.map((d) => (
                <Cell key={d.month} fill={d.value < 0 ? SHORT : SAVED} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
