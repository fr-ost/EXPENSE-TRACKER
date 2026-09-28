"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormatMoney } from "@/components/app-data";
import { formatMonth, monthStart, formatDate, type MonthKey } from "@/lib/dates";
import { toChartNumber } from "@/lib/money";
import type { MonthPoint } from "@/lib/types";
import { axisProps, gridProps, Legend, TooltipCard, useAxisFormatter } from "./chart-parts";

const INCOME = "var(--chart-income)";
const SPENDING = "var(--chart-expense)";

/**
 * Income vs spending per month: grouped columns on one axis, 2px gap, rounded
 * data-ends. Fills its container's height (min 240px) to balance neighbours.
 */
export function CashflowChart({ months, highlight }: { months: MonthPoint[]; highlight?: MonthKey }) {
  const format = useFormatMoney();
  const axis = useAxisFormatter();
  const data = months.map((m) => ({
    ...m,
    incomeValue: toChartNumber(m.income),
    expenseValue: toChartNumber(m.expenses),
    label: formatDate(monthStart(m.month), "monthShort"),
  }));

  return (
    <div className="flex h-full flex-col gap-3">
      <Legend
        items={[
          { label: "Income", color: INCOME },
          { label: "Spending", color: SPENDING },
        ]}
      />
      <div className="min-h-[240px] w-full flex-1" role="img" aria-label="Income and spending by month">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid {...gridProps} />
            <XAxis
              dataKey="label"
              {...axisProps}
              tickMargin={8}
              interval="preserveStartEnd"
              tick={(props) => {
                const { x, y, payload, index } = props as { x: number; y: number; payload: { value: string }; index: number };
                const isHighlighted = data[index]?.month === highlight;
                return (
                  <text x={x} y={y} dy={10} textAnchor="middle" fontSize={11} fill={isHighlighted ? "var(--text)" : "var(--chart-axis)"} fontWeight={isHighlighted ? 600 : 400}>
                    {payload.value}
                  </text>
                );
              }}
            />
            <YAxis {...axisProps} tickFormatter={axis} width={44} />
            <Tooltip
              cursor={{ fill: "var(--surface-muted)", radius: 6 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !row) return null;
                return (
                  <TooltipCard
                    title={formatMonth(row.month)}
                    rows={[
                      { label: "Income", value: format(row.income), color: INCOME },
                      { label: "Spending", value: format(row.expenses), color: SPENDING },
                      { label: "Saved", value: format(row.savings), muted: true },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="incomeValue" name="Income" fill={INCOME} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={500} />
            <Bar dataKey="expenseValue" name="Spending" fill={SPENDING} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={500} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
