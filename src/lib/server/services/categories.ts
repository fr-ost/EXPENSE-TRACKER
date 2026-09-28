import "server-only";
import type { CategoryKind } from "@/lib/domain";
import type { CategoryWithUsage } from "@/lib/types";
import type { CategoryInput } from "@/lib/validation";
import { prisma, type Tx } from "../db";
import { conflict, invalid, notFound } from "../errors";
import { categoryRefSelect, toCategoryRef } from "./mappers";

export async function listCategories(): Promise<CategoryWithUsage[]> {
  const rows = await prisma.category.findMany({
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
export async function requireCategory(tx: Tx, id: string, kind: CategoryKind, currentId?: string | null) {
  const category = await tx.category.findUnique({ where: { id }, select: categoryRefSelect });
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

async function assertUniqueName(input: CategoryInput, exceptId?: string) {
  const clash = await prisma.category.findFirst({
    where: {
      kind: input.kind,
      name: { equals: input.name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw invalid("Choose another name.", { name: "A category with this name already exists." });
}

export async function createCategory(input: CategoryInput) {
  await assertUniqueName(input);
  const last = await prisma.category.aggregate({ where: { kind: input.kind }, _max: { sortOrder: true } });
  return prisma.category.create({
    data: { ...input, sortOrder: (last._max.sortOrder ?? 0) + 10 },
    select: { id: true },
  });
}

export async function updateCategory(id: string, input: CategoryInput) {
  const existing = await prisma.category.findUnique({
    where: { id },
    select: { kind: true, _count: { select: { transactions: true, recurring: true } } },
  });
  if (!existing) throw notFound("Category");
  if (existing.kind !== input.kind && existing._count.transactions + existing._count.recurring > 0) {
    throw invalid("This category is in use.", { kind: "A category that has transactions can't switch between income and expense." });
  }
  await assertUniqueName(input, id);
  return prisma.category.update({ where: { id }, data: input, select: { id: true } });
}

export async function deleteCategory(id: string) {
  const usage = await prisma.category.findUnique({
    where: { id },
    select: { _count: { select: { transactions: true, recurring: true } } },
  });
  if (!usage) throw notFound("Category");
  const { transactions, recurring } = usage._count;
  if (transactions + recurring > 0) {
    throw conflict(
      `This category is used by ${transactions + recurring} item${transactions + recurring === 1 ? "" : "s"}. Archive it instead to hide it while keeping history.`,
    );
  }
  await prisma.category.delete({ where: { id } });
}
