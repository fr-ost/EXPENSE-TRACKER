import { authed, json } from "@/lib/server/http";
import { listDevices } from "@/lib/server/services/devices";

/** The phones that hand their SMS to this account. */
export const GET = authed(async ({ userId }) => json({ devices: await listDevices(userId) }));
