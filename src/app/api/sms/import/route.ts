import { authed, json, readJson } from "@/lib/server/http";
import { importSms } from "@/lib/server/services/sms";
import { getToday } from "@/lib/server/settings";
import { smsImportInput } from "@/lib/validation";

/** Up to 50 messages with their original text; well above the usual body cap. */
const MAX_IMPORT_BYTES = 512 * 1024;

export const POST = authed(async ({ request }) => {
  const input = await readJson(request, smsImportInput, MAX_IMPORT_BYTES);
  return json({ results: await importSms(input, await getToday()) });
});
