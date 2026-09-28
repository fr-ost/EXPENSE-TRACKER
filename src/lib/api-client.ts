/**
 * Browser-side JSON client for the app's own API. Handles the session
 * responses centrally: 401 → sign-in, 423 → lock screen.
 */

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Let the caller handle 401/423 (login and unlock forms). */
  handleAuth?: boolean;
}

export async function api<T = unknown>(path: string, { method = "POST", body, handleAuth = true }: RequestOptions = {}) {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiClientError("You appear to be offline. Check your connection and try again.", 0, "network");
  }

  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    fieldErrors?: Record<string, string>;
  } & T;

  if (!response.ok) {
    // Full navigations on purpose: they drop every client-side copy of
    // financial data, and replace() keeps the stale page out of history.
    if (handleAuth && (response.status === 401 || response.status === 423)) {
      const here = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
      window.location.replace(`${response.status === 401 ? "/login" : "/lock"}?next=${here}`);
    }
    throw new ApiClientError(
      data.error ?? "Something went wrong. Please try again.",
      response.status,
      data.code,
      data.fieldErrors ?? {},
    );
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
