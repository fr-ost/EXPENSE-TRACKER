import { prisma } from "@/lib/server/db";
import { createAccount } from "@/lib/server/services/accounts";
import { createUser } from "@/lib/server/services/users";
import type { UserId } from "@/lib/server/user-id";
import type { AccountInput } from "@/lib/validation";

/** The user the tests act as: a new one, with the starter categories, after every `resetData()`. */
export let me: UserId;

/** A user with the starter categories. */
export function makeUser(displayName = "Test user"): Promise<UserId> {
  return prisma.$transaction((tx) => createUser(tx, { displayName }));
}

/** Wipe everything, every user included. */
export async function wipeDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE "User", "LoginAttempt" CASCADE');
}

/** Wipe everything and start over as a new user. */
export async function resetData(): Promise<UserId> {
  await wipeDatabase();
  me = await makeUser();
  return me;
}

export async function makeAccount(overrides: Partial<AccountInput> & { name: string }, userId: UserId = me) {
  const account = await createAccount(userId, {
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

export async function categoryId(kind: "EXPENSE" | "INCOME", name: string, userId: UserId = me) {
  const category = await prisma.category.findFirstOrThrow({ where: { userId, kind, name }, select: { id: true } });
  return category.id;
}
