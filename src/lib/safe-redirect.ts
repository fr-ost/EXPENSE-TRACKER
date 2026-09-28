/** Only allow same-origin relative paths as post-login destinations (no open redirects). */
export function safeRedirectPath(value: string | string[] | undefined | null, fallback = "/dashboard"): string {
  const path = Array.isArray(value) ? value[0] : value;
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  if (path.startsWith("/login") || path.startsWith("/lock") || path.startsWith("/api/")) return fallback;
  return path;
}
