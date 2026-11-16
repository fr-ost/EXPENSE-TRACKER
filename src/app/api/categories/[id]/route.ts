import { deleteCategory, updateCategory } from "@/lib/server/services/categories";
import { authed, json, readJson } from "@/lib/server/http";
import { categoryInput } from "@/lib/validation";

type Params = { id: string };

export const PUT = authed<Params>(async ({ request, params, userId }) => {
  const input = await readJson(request, categoryInput);
  await updateCategory(userId, params.id, input);
  return json({ id: params.id });
});

export const DELETE = authed<Params>(async ({ params, userId }) => {
  await deleteCategory(userId, params.id);
  return json({ ok: true });
});
