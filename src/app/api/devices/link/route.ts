import { authed, json } from "@/lib/server/http";
import { startDeviceLink } from "@/lib/server/services/devices";

/** A one-time code for the Android app on this phone to collect its token with. */
export const POST = authed(async ({ userId }) => json(await startDeviceLink(userId)));
