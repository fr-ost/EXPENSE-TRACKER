import "server-only";
import { prisma, type Tx } from "../db";
import { asUserId, type UserId } from "../user-id";
import { seedDefaultCategories } from "./categories";

/** A new user, with the starter categories. */
export async function createUser(tx: Tx, data: { displayName: string }): Promise<UserId> {
  const user = await tx.user.create({ data, select: { id: true } });
  const userId = asUserId(user.id);
  await seedDefaultCategories(tx, userId);
  return userId;
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
