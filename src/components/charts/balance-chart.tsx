"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormatMoney } from "@/components/app-data";
import { paletteVar } from "@/components/icon";
import { formatDate, type ISODate } from "@/lib/dates";
import { toChartNumber, type Money } from "@/lib/money";
import { axisProps, gridProps, TooltipCard, useAxisFormatter } from "./chart-parts";

/** Running balance as an exact step chart (balances change on days with activity). */
export function BalanceChart({
  points,
  currency,
  color,
}: {
  points: Array<{ date: ISODate; balance: Money }>;
  currency: string;
  color: string | null;
}) {
  const format = useFormatMoney();
  const axis = useAxisFormatter();
  const stroke = paletteVar(color ?? "blue");
  const data = points.map((p) => ({ date: p.date, value: toChartNumber(p.balance), balance: p.balance }));

  return (
    <div className="h-56 w-full" role="img" aria-label="Balance over time">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="date"
            {...axisProps}
            tickFormatter={(d: string) => formatDate(d, "short")}
            minTickGap={40}
            tickMargin={8}
          />
          <YAxis {...axisProps} tickFormatter={axis} width={48} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !row) return null;
              return <TooltipCard title={formatDate(row.date, "medium")} rows={[{ label: "Balance", value: format(row.balance, { currency }) }]} />;
            }}
          />
          <Area
            type="stepAfter"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            fill={stroke}
            fillOpacity={0.1}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: stroke }}
            isAnimationActive
            animationDuration={500}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
