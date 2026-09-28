import { createCategory, listCategories } from "@/lib/server/services/categories";
import { authed, json, readJson } from "@/lib/server/http";
import { categoryInput } from "@/lib/validation";

export const GET = authed(async () => json({ categories: await listCategories() }));

export const POST = authed(async ({ request }) => {
  const input = await readJson(request, categoryInput);
  const category = await createCategory(input);
  return json({ id: category.id }, 201);
});
