/**
 * Session cookie name, shared by the proxy and the server session module.
 * `__Host-` prefix in production: HTTPS only, Path=/, no Domain — pinned to
 * this exact origin.
 */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-hisab_session" : "hisab_session";
