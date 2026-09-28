import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { fieldErrorsOf } from "@/lib/validation";
import { requireApiSession } from "./auth/guard";
import type { SessionState } from "./auth/session";
import { AppError, invalid } from "./errors";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export function json<T>(data: T, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { ...NO_STORE_HEADERS, ...headers } });
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    const headers: Record<string, string> = error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {};
    return json({ error: error.message, code: error.code, fieldErrors: error.fieldErrors }, error.status, headers);
  }
  if (error instanceof ZodError) {
    return json({ error: "Some fields need attention.", code: "invalid", fieldErrors: fieldErrorsOf(error) }, 400);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002":
        return json({ error: "Something with the same name already exists.", code: "conflict" }, 409);
      case "P2003":
        return json({ error: "This item is still used elsewhere.", code: "conflict" }, 409);
      case "P2025":
        return json({ error: "Not found.", code: "not_found" }, 404);
    }
  }
  if (isCheckViolation(error)) {
    // A database invariant rejected the write; application validation should
    // normally catch this first.
    return json({ error: "That combination of values isn't allowed.", code: "invalid" }, 400);
  }
  console.error("[api] unhandled error", error);
  return json({ error: "Something went wrong. Please try again.", code: "internal" }, 500);
}

function isCheckViolation(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : "";
  return /23514|check constraint/i.test(text);
}

/** Parse a JSON body against a schema. Requires a JSON content type. */
export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppError(415, "unsupported_media_type", "Expected a JSON request body.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw invalid("The request body is not valid JSON.");
  }
  return schema.parse(body);
}

interface HandlerArgs<P> {
  request: NextRequest;
  params: P;
  session: SessionState;
}

/**
 * Wrap a Route Handler: enforces an unlocked session (401/423), awaits params
 * and converts thrown errors into consistent JSON responses.
 */
export function authed<P extends Record<string, string> = Record<string, never>>(
  handler: (args: HandlerArgs<P>) => Promise<Response>,
  options: { allowLocked?: boolean } = {},
) {
  return async (request: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const session = await requireApiSession(options);
      const params = await context.params;
      return await handler({ request, params, session });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Best-effort client IP. Prefers the header set by the platform's edge proxy. */
export function clientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // The last hop is appended by the nearest (trusted) proxy; earlier entries
    // are client-controlled.
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1].slice(0, 64);
  }
  return "unknown";
}
