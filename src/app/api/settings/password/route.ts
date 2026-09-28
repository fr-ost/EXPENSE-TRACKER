import { changePassword } from "@/lib/server/services/settings";
import { authed, clientIp, json, readJson } from "@/lib/server/http";
import { changePasswordInput } from "@/lib/validation";

export const POST = authed(async ({ request, session }) => {
  const input = await readJson(request, changePasswordInput);
  const result = await changePassword({
    ip: clientIp(request),
    sessionId: session.id,
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
  });
  return json(result);
});
