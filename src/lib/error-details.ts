/**
 * The running version in the browser: the deployment ID (Railway's commit,
 * set as `deploymentId` in next.config), which Next.js exposes to client code
 * as NEXT_DEPLOYMENT_ID. Null in development.
 */
export function clientVersion(): string | null {
  if (typeof window === "undefined") return null;
  const id = process.env.NEXT_DEPLOYMENT_ID;
  return id ? String(id).slice(0, 7) : null;
}

/**
 * What went wrong, in one line short enough for an error screen. Server errors
 * carry only a digest in production; their message is hidden on purpose.
 */
export function describeError(error: (Error & { digest?: string }) | null | undefined): string {
  const message = error?.digest ? `Server error ${error.digest}` : error?.message || "Unknown error";
  return message.length > 160 ? `${message.slice(0, 157)}…` : message;
}

/** `describeError` plus the version: enough, in a screenshot, to find the cause. */
export function errorDetails(error: (Error & { digest?: string }) | null | undefined): string {
  const version = clientVersion();
  return version ? `${describeError(error)} · version ${version}` : describeError(error);
}
