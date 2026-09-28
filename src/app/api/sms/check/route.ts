import { authed, json, readJson } from "@/lib/server/http";
import { checkSms } from "@/lib/server/services/sms";
import { smsCheckInput } from "@/lib/validation";

const MAX_CHECK_BYTES = 256 * 1024;

/** Which messages were already added, and how similar ones were recorded before. */
export const POST = authed(async ({ request }) => {
  const { items } = await readJson(request, smsCheckInput, MAX_CHECK_BYTES);
  return json({ results: await checkSms(items) });
});
