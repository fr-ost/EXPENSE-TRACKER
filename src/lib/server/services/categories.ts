import "server-only";
import type { CategoryKind, ExpenseScope, IconKey, PaletteKey } from "@/lib/domain";
import type { CategoryWithUsage } from "@/lib/types";
import type { CategoryInput } from "@/lib/validation";
import { prisma, type Tx } from "../db";
import { conflict, invalid, notFound } from "../errors";
import type { UserId } from "../user-id";
import { categoryRefSelect, toCategoryRef } from "./mappers";

type DefaultCategory = [name: string, defaultScope: ExpenseScope | null, icon: IconKey, color: PaletteKey];

const DEFAULT_EXPENSE_CATEGORIES: DefaultCategory[] = [
  ["Family", "FAMILY", "users", "terracotta"],
  ["Personal", "PERSONAL", "user", "violet"],
  ["Food", "PERSONAL", "utensils", "orange"],
  ["Transport", "PERSONAL", "bus", "blue"],
  ["Housing", "PERSONAL", "house", "brown"],
  ["Bills", "PERSONAL", "receipt", "slate"],
  ["Education", "PERSONAL", "graduation-cap", "teal"],
  ["Medical", "PERSONAL", "heart-pulse", "rose"],
  ["Shopping", "PERSONAL", "shopping-bag", "plum"],
  ["Subscriptions", "PERSONAL", "repeat", "indigo"],
  ["Technology", "PERSONAL", "laptop", "cyan"],
  ["Entertainment", "PERSONAL", "clapperboard", "amber"],
  ["Gifts", "PERSONAL", "gift", "lime"],
  ["Other", "PERSONAL", "circle-dashed", "gray"],
];

const DEFAULT_INCOME_CATEGORIES: DefaultCategory[] = [
  ["Salary", null, "briefcase", "green"],
  ["Business", null, "store", "teal"],
  ["Freelance", null, "pen-tool", "blue"],
  ["Investment", null, "trending-up", "indigo"],
  ["Gifts", null, "gift", "amber"],
  ["Other", null, "circle-dashed", "gray"],
];

/** The categories every new user starts with (all editable in Settings). */
export const DEFAULT_CATEGORIES = (
  [
    ["EXPENSE", DEFAULT_EXPENSE_CATEGORIES],
    ["INCOME", DEFAULT_INCOME_CATEGORIES],
  ] as const
).flatMap(([kind, list]) =>
  list.map(([name, defaultScope, icon, color], index) => ({ kind, name, defaultScope, icon, color, sortOrder: (index + 1) * 10 })),
);

/** Give a new user their starter categories. */
export async function seedDefaultCategories(tx: Tx, userId: UserId): Promise<void> {
  await tx.category.createMany({ data: DEFAULT_CATEGORIES.map((category) => ({ ...category, userId })) });
}

export async function listCategories(userId: UserId): Promise<CategoryWithUsage[]> {
  const rows = await prisma.category.findMany({
    where: { userId },
    select: { ...categoryRefSelect, sortOrder: true, _count: { select: { transactions: true } } },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(({ _count, sortOrder, ...category }) => ({
    ...toCategoryRef(category),
    sortOrder,
    transactionCount: _count.transactions,
  }));
}

/**
 * Load a category for use on a transaction and check it fits. Archived
 * categories are allowed only when the transaction already used them.
 */
export async function requireCategory(tx: Tx, userId: UserId, id: string, kind: CategoryKind, currentId?: string | null) {
  const category = await tx.category.findUnique({ where: { id, userId }, select: categoryRefSelect });
  if (!category) throw invalid("Choose a category.", { categoryId: "This category no longer exists." });
  if (category.kind !== kind) {
    throw invalid("Choose a matching category.", {
      categoryId: kind === "EXPENSE" ? "Choose an expense category." : "Choose an income category.",
    });
  }
  if (category.isArchived && category.id !== currentId) {
    throw invalid("That category is archived.", { categoryId: `${category.name} is archived. Restore it in Settings to use it.` });
  }
  return category;
}

async function assertUniqueName(userId: UserId, input: CategoryInput, exceptId?: string) {
  const clash = await prisma.category.findFirst({
    where: {
      userId,
      kind: input.kind,
      name: { equals: input.name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw invalid("Choose another name.", { name: "A category with this name already exists." });
}

export async function createCategory(userId: UserId, input: CategoryInput) {
  await assertUniqueName(userId, input);
  const last = await prisma.category.aggregate({ where: { userId, kind: input.kind }, _max: { sortOrder: true } });
  return prisma.category.create({
    data: { ...input, userId, sortOrder: (last._max.sortOrder ?? 0) + 10 },
    select: { id: true },
  });
}

export async function updateCategory(userId: UserId, id: string, input: CategoryInput) {
  const existing = await prisma.category.findUnique({
    where: { id, userId },
    select: { kind: true, _count: { select: { transactions: true, recurring: true } } },
  });
  if (!existing) throw notFound("Category");
  if (existing.kind !== input.kind && existing._count.transactions + existing._count.recurring > 0) {
    throw invalid("This category is in use.", { kind: "A category that has transactions can't switch between income and expense." });
  }
  await assertUniqueName(userId, input, id);
  return prisma.category.update({ where: { id, userId }, data: input, select: { id: true } });
}

export async function deleteCategory(userId: UserId, id: string) {
  const usage = await prisma.category.findUnique({
    where: { id, userId },
    select: { _count: { select: { transactions: true, recurring: true } } },
  });
  if (!usage) throw notFound("Category");
  const { transactions, recurring } = usage._count;
  if (transactions + recurring > 0) {
    throw conflict(
      `This category is used by ${transactions + recurring} item${transactions + recurring === 1 ? "" : "s"}. Archive it instead to hide it while keeping history.`,
    );
  }
  await prisma.category.delete({ where: { id, userId } });
}
