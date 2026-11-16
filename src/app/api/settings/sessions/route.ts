import { deleteOtherSessions } from "@/lib/server/auth/session";
import { authed, json } from "@/lib/server/http";

/** Sign out every other device. */
export const DELETE = authed(async ({ session, userId }) => json({ revoked: await deleteOtherSessions(userId, session.id) }));
