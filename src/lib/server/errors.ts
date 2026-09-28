import "server-only";

/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
    /** Sent as a Retry-After header (rate limiting). */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = () => new AppError(401, "unauthorized", "Please sign in to continue.");
export const locked = () => new AppError(423, "locked", "Hisab is locked.");
export const notFound = (what = "Item") => new AppError(404, "not_found", `${what} not found.`);
export const conflict = (message: string) => new AppError(409, "conflict", message);
export const invalid = (message: string, fieldErrors?: Record<string, string>) =>
  new AppError(400, "invalid", message, fieldErrors);
export const tooManyRequests = (message: string, retryAfterSeconds: number) =>
  new AppError(429, "rate_limited", message, undefined, retryAfterSeconds);
