import "server-only";
import { cache } from "react";
import { Prisma } from "@/generated/prisma/client";
import type { ISODate } from "@/lib/dates";
import { convertMoney, fromMinor, isRate, normalizeRate, toMinor, type Rate } from "@/lib/money";
import type { AccountSummary, BalanceTotals, ForeignCurrency } from "@/lib/types";
import { prisma } from "../db";
import { invalid } from "../errors";

/**
 * How amounts become the main currency (`base`): `rates` holds main-currency
 * units for one unit of each currency that can be counted, the main currency
 * itself as "1". Amounts in a currency without a rate are left out of totals.
 *
 * Analytics also accept a plain currency code: just that currency, unconverted.
 */
export interface Conversion {
  base: string;
  rates: Record<string, Rate>;
}

export type CurrencyBasis = Conversion | string;

export function asConversion(fx: CurrencyBasis): Conversion {
  return typeof fx === "string" ? { base: fx, rates: { [fx]: "1" } } : fx;
}

/**
 * The rates as a table for a WITH clause: `fx("currency", "rate")`. Join it
 * on the currency and count `ROUND(amount * fx."rate", 2)`: each amount is
 * converted (and rounded) on its own, so any grouping adds up exactly.
 */
export function ratesTable(fx: CurrencyBasis): Prisma.Sql {
  const rows = Object.entries(asConversion(fx).rates).map(([currency, rate]) => Prisma.sql`(${currency}::text, ${rate}::numeric)`);
  return Prisma.sql`fx("currency", "rate") AS (VALUES ${Prisma.join(rows)})`;
}

export interface Currencies {
  conversion: Conversion;
  /** Every other currency your accounts hold, with how it converts. */
  foreign: ForeignCurrency[];
}

/**
 * The rate of the latest transfer between an account in each other currency
 * and one in the main currency — what you actually got when you converted.
 */
async function latestConversions(base: string): Promise<Map<string, { rate: Rate; date: ISODate }>> {
  const rows = await prisma.$queryRaw<Array<{ currency: string; rate: string; date: string }>>`
    SELECT DISTINCT ON (c."currency") c."currency", ROUND(c."rate", 6)::text AS "rate", to_char(c."date", 'YYYY-MM-DD') AS "date"
    FROM (
      SELECT src."currency"::text AS "currency", t."toAmount" / t."amount" AS "rate", t."date", t."createdAt"
      FROM "Transaction" t
      JOIN "Account" src ON src."id" = t."accountId"
      JOIN "Account" dst ON dst."id" = t."toAccountId"
      WHERE t."type" = 'TRANSFER' AND t."toAmount" IS NOT NULL AND dst."currency" = ${base} AND src."currency" <> ${base}
      UNION ALL
      SELECT dst."currency"::text, t."amount" / t."toAmount", t."date", t."createdAt"
      FROM "Transaction" t
      JOIN "Account" src ON src."id" = t."accountId"
      JOIN "Account" dst ON dst."id" = t."toAccountId"
      WHERE t."type" = 'TRANSFER' AND t."toAmount" IS NOT NULL AND src."currency" = ${base} AND dst."currency" <> ${base}
    ) c
    ORDER BY c."currency", c."date" DESC, c."createdAt" DESC`;
  return new Map(
    rows.filter((row) => isRate(row.rate)).map((row) => [row.currency, { rate: normalizeRate(row.rate), date: row.date }]),
  );
}

/** The other currencies your accounts use, and the rate each converts at. */
export async function loadCurrencies(base: string): Promise<Currencies> {
  const [accounts, manual, conversions] = await Promise.all([
    prisma.account.findMany({ distinct: ["currency"], select: { currency: true }, orderBy: { currency: "asc" } }),
    prisma.exchangeRate.findMany({ where: { base }, select: { currency: true, rate: true } }),
    latestConversions(base),
  ]);
  const manualRates = new Map(manual.map((m) => [m.currency, normalizeRate(m.rate.toFixed(6))]));

  const foreign = accounts
    .map((a) => a.currency)
    .filter((currency) => currency !== base)
    .map((currency): ForeignCurrency => {
      const manualRate = manualRates.get(currency) ?? null;
      const lastConversion = conversions.get(currency) ?? null;
      const rate = manualRate ?? lastConversion?.rate ?? null;
      return { currency, rate, source: manualRate ? "manual" : lastConversion ? "conversion" : null, manualRate, lastConversion };
    });

  const rates: Record<string, Rate> = { [base]: "1" };
  for (const f of foreign) if (f.rate) rates[f.currency] = f.rate;
  return { conversion: { base, rates }, foreign };
}

/** `loadCurrencies`, once per request. */
export const getCurrencies = cache(loadCurrencies);

/** Set your own rate for a currency (null: use the latest conversion again). */
export async function setManualRate(base: string, currency: string, rate: Rate | null) {
  if (currency === base) throw invalid("The main currency doesn't need a rate.", { currency: "Choose another currency." });
  if (rate === null) {
    await prisma.exchangeRate.deleteMany({ where: { base, currency } });
    return;
  }
  await prisma.exchangeRate.upsert({
    where: { base_currency: { base, currency } },
    create: { base, currency, rate },
    update: { rate },
  });
}

/** Balances added up in the main currency, plus each currency's own total. */
export function balanceTotals(accounts: AccountSummary[], fx: Conversion): BalanceTotals {
  const sums = new Map<string, bigint>([[fx.base, 0n]]);
  for (const account of accounts) sums.set(account.currency, (sums.get(account.currency) ?? 0n) + toMinor(account.balance));
  const byCurrency = [...sums.entries()]
    .map(([currency, minor]) => ({ currency, total: fromMinor(minor), rate: fx.rates[currency] ?? null }))
    .sort((a, b) => (a.currency === fx.base ? -1 : b.currency === fx.base ? 1 : a.currency.localeCompare(b.currency)));
  // Each currency's total is converted once, so the parts shown add up to the total.
  const total = byCurrency.reduce((sum, c) => (c.rate ? sum + toMinor(convertMoney(c.total, c.rate)) : sum), 0n);
  return { total: fromMinor(total), byCurrency };
}
