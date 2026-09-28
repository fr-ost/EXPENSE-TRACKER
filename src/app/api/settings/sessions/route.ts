import { deleteOtherSessions } from "@/lib/server/auth/session";
import { authed, json } from "@/lib/server/http";

/** Sign out every other device. */
export const DELETE = authed(async ({ session }) => json({ revoked: await deleteOtherSessions(session.userId, session.id) }));
