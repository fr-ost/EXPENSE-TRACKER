import { prisma } from "@/lib/server/db";
import { createAccount } from "@/lib/server/services/accounts";
import type { AccountInput } from "@/lib/validation";

/** Wipe financial data; keeps the default categories from the migration. */
export async function resetData() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Transaction", "ScopeBudget", "ExchangeRate", "RecurringTransaction", "Account", "Session", "LoginAttempt" CASCADE',
  );
  await prisma.category.deleteMany({ where: { name: { startsWith: "Test " } } });
  await prisma.category.updateMany({ data: { isArchived: false } });
}

export async function makeAccount(overrides: Partial<AccountInput> & { name: string }) {
  const account = await createAccount({
    type: "CASH",
    currency: "BDT",
    openingBalance: "0",
    openingDate: "2024-01-01",
    icon: null,
    color: null,
    isActive: true,
    ...overrides,
  });
  return account.id;
}

export async function categoryId(kind: "EXPENSE" | "INCOME", name: string) {
  const category = await prisma.category.findFirstOrThrow({ where: { kind, name }, select: { id: true } });
  return category.id;
}
