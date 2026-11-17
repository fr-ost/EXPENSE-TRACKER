import type { NextRequest } from "next/server";
import { beginSignInAttempt, checkSignInAttempt, formatRetryAfter, markSignInAttemptSuccessful } from "@/lib/server/auth/rate-limit";
import { tooManyRequests } from "@/lib/server/errors";
import { clientIp, errorResponse, json, readJson } from "@/lib/server/http";
import { completeDeviceLink } from "@/lib/server/services/devices";
import { deviceTokenInput } from "@/lib/validation";

/**
 * The Android app collects its token with the one-time code the signed-in
 * user's browser handed it. There is no session here: the code is the proof.
 * A client that keeps sending bad codes is made to wait, as with sign-in.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    const limit = await checkSignInAttempt(ip);
    if (!limit.allowed) {
      throw tooManyRequests(`Too many tries. Try again in ${formatRetryAfter(limit.retryAfterSeconds)}.`, limit.retryAfterSeconds);
    }
    const input = await readJson(request, deviceTokenInput);
    const attempt = await beginSignInAttempt(ip);
    const { token, account } = await completeDeviceLink(input.code, { name: input.name, appVersion: input.appVersion });
    await markSignInAttemptSuccessful(attempt, ip);
    // The phone shows whose account this is and asks before it reads any message.
    return json({ token, account });
  } catch (error) {
    return errorResponse(error);
  }
}
