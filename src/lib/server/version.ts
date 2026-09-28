import "server-only";

/**
 * The commit this deployment was built from (Railway sets
 * RAILWAY_GIT_COMMIT_SHA), so you can tell which version is running.
 */
export function appVersion(): string {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA?.trim();
  return sha ? sha.slice(0, 7) : "development";
}
