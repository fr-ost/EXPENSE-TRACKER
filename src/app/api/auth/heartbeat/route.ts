import { authed, json } from "@/lib/server/http";

/**
 * Sent periodically while the user is actively using the app, so the
 * server-side inactivity lock matches what the user is actually doing.
 * (The session is touched by `authed`.)
 */
export const POST = authed(async ({ session }) => json({ ok: true, autoLockMinutes: session.autoLockMinutes }));
