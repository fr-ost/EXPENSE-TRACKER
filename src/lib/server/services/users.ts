import "server-only";
import { isValidTimeZone } from "@/lib/dates";
import type { GoogleProfile } from "../auth/google";
import { prisma, type Tx } from "../db";
import { asUserId, type UserId } from "../user-id";
import { seedDefaultCategories } from "./categories";
import { isUniqueViolation } from "./mappers";

export interface NewUser {
  displayName: string;
  googleSub?: string;
  email?: string | null;
  /** The browser's timezone at sign-up; decides what "today" is. */
  timezone?: string;
}

/** A new user, with the starter categories. */
export async function createUser(tx: Tx, data: NewUser): Promise<UserId> {
  const user = await tx.user.create({ data, select: { id: true } });
  const userId = asUserId(user.id);
  await seedDefaultCategories(tx, userId);
  return userId;
}

/** The address that may take over the ledger recorded before Google sign-in. */
function ownerEmail(): string | null {
  return process.env.OWNER_EMAIL?.trim().toLowerCase() || null;
}

/**
 * The user for a Google account, by Google's permanent id for it — created on
 * the first sign-in. The address is only kept for display.
 *
 * One exception keeps the ledger from before Google sign-in: its owner row
 * has no Google id yet, and is taken over by the first sign-in whose
 * verified address is OWNER_EMAIL.
 */
export async function signInWithGoogle(
  profile: GoogleProfile,
  options: { timezone?: string | null } = {},
): Promise<{ userId: UserId; created: boolean }> {
  const find = () => prisma.user.findUnique({ where: { googleSub: profile.sub }, select: { id: true, email: true } });

  const existing = await find();
  if (existing) {
    if (profile.email && profile.email !== existing.email) {
      await prisma.user.update({ where: { id: existing.id }, data: { email: profile.email }, select: { id: true } });
    }
    return { userId: asUserId(existing.id), created: false };
  }

  const owner = ownerEmail();
  if (owner && profile.emailVerified && profile.email?.toLowerCase() === owner) {
    const unclaimed = await prisma.user.findFirst({ where: { googleSub: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (unclaimed) {
      // Only if still unclaimed: two sign-ins at once can't both take it.
      const claimed = await prisma.user.updateMany({
        where: { id: unclaimed.id, googleSub: null },
        data: { googleSub: profile.sub, email: profile.email },
      });
      if (claimed.count === 1) return { userId: asUserId(unclaimed.id), created: false };
      const winner = await find();
      if (winner) return { userId: asUserId(winner.id), created: false };
    }
  }

  const timezone = options.timezone && isValidTimeZone(options.timezone) ? options.timezone : undefined;
  const displayName = (profile.name ?? profile.email?.split("@")[0] ?? "").slice(0, 60);
  try {
    const userId = await prisma.$transaction((tx) =>
      createUser(tx, { googleSub: profile.sub, email: profile.email, displayName, ...(timezone ? { timezone } : {}) }),
    );
    return { userId, created: true };
  } catch (error) {
    // The same account signing in twice at the same moment: the other request created it.
    if (!isUniqueViolation(error)) throw error;
    const winner = await find();
    if (!winner) throw error;
    return { userId: asUserId(winner.id), created: false };
  }
}

/**
 * Remove everything a user has recorded, leaving the user (and their
 * preferences) in place. Children first: nothing in the database cascades
 * from a user, so this list is the only way their data goes away.
 */
export async function deleteUserData(tx: Tx, userId: UserId): Promise<void> {
  // Writes by this user wait here (their foreign keys lock the user row),
  // so nothing new slips in while the rows below are removed.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  await tx.transaction.deleteMany({ where: { userId } });
  await tx.balanceCheckpoint.deleteMany({ where: { userId } });
  await tx.recurringTransaction.deleteMany({ where: { userId } });
  await tx.scopeBudget.deleteMany({ where: { userId } });
  await tx.exchangeRate.deleteMany({ where: { userId } });
  await tx.category.deleteMany({ where: { userId } });
  await tx.account.deleteMany({ where: { userId } });
}

/** Delete a user and everything they recorded. Their sessions end with them. */
export async function deleteUser(userId: UserId): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await deleteUserData(tx, userId);
    await tx.user.delete({ where: { id: userId } });
  });
}
