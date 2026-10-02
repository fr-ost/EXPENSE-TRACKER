import { describe, expect, it } from "vitest";
import { defaultAccountId, newDraft, preferredCurrency } from "@/components/transactions/transaction-draft";
import type { AccountSummary } from "@/lib/types";

function account(id: string, currency: string, type: AccountSummary["type"] = "BANK", isActive = true): AccountSummary {
  return {
    id,
    name: id,
    type,
    currency,
    icon: null,
    color: null,
    isActive,
    sortOrder: 0,
    openingBalance: "0.00",
    openingDate: "2026-01-01",
    balance: "0.00",
    inflow: "0.00",
    outflow: "0.00",
    corrections: "0.00",
    transactionCount: 0,
    lastActivity: null,
    scheduledNet: "0.00",
    lastUpdate: null,
  };
}

const accounts = [account("bank", "BDT"), account("cash", "BDT", "CASH"), account("payoneer", "USD", "OTHER"), account("old", "USD", "OTHER", false)];
const preferences = { baseCurrency: "BDT", incomeCurrency: "USD", expenseCurrency: null };

describe("where a new transaction starts", () => {
  it("knows the currency each type usually comes in", () => {
    expect(preferredCurrency("INCOME", preferences)).toBe("USD");
    expect(preferredCurrency("EXPENSE", preferences)).toBe("BDT");
    expect(preferredCurrency("TRANSFER", preferences)).toBeNull();
    expect(preferredCurrency("INCOME", undefined)).toBeNull();
  });

  it("starts income on a dollar account and spending on taka (cash first)", () => {
    const active = accounts.filter((a) => a.isActive);
    expect(defaultAccountId("INCOME", active, "USD")).toBe("payoneer");
    expect(defaultAccountId("EXPENSE", active, "BDT")).toBe("cash");
    // No account in that currency: fall back to cash, then the first.
    expect(defaultAccountId("INCOME", active, "EUR")).toBe("cash");
    expect(defaultAccountId("TRANSFER", active, null)).toBe("cash");
    expect(defaultAccountId("EXPENSE", [], "BDT")).toBe("");
  });

  it("builds a new draft on the usual account, unless one is given", () => {
    expect(newDraft({ type: "INCOME" }, accounts, "2026-10-02", preferences)).toMatchObject({ accountId: "payoneer", accountChosen: false });
    expect(newDraft({}, accounts, "2026-10-02", preferences)).toMatchObject({ type: "EXPENSE", accountId: "cash", scope: "PERSONAL" });
    expect(newDraft({ type: "INCOME", accountId: "bank" }, accounts, "2026-10-02", preferences)).toMatchObject({ accountId: "bank", accountChosen: true });
  });
});
