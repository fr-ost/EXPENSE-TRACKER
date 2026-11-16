import { updateSettings } from "@/lib/server/services/settings";
import { authed, json, readJson } from "@/lib/server/http";
import { settingsInput } from "@/lib/validation";

export const PUT = authed(async ({ request, userId }) => {
  await updateSettings(userId, await readJson(request, settingsInput));
  return json({ ok: true });
});
