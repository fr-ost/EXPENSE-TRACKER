import { createCategory, listCategories } from "@/lib/server/services/categories";
import { authed, json, readJson } from "@/lib/server/http";
import { categoryInput } from "@/lib/validation";

export const GET = authed(async ({ userId }) => json({ categories: await listCategories(userId) }));

export const POST = authed(async ({ request, userId }) => {
  const input = await readJson(request, categoryInput);
  const category = await createCategory(userId, input);
  return json({ id: category.id }, 201);
});
