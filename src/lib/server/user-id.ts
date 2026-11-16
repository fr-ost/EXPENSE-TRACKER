import "server-only";

/**
 * The id of the user whose data a call may touch. Every service takes one as
 * its first argument and filters by it; the type is branded so an account or
 * transaction id can't be passed in its place by mistake.
 *
 * A UserId comes only from a verified session (`readSession`) or from
 * creating a user — never from request input.
 */
export type UserId = string & { readonly __brand: "UserId" };

export function asUserId(id: string): UserId {
  return id as UserId;
}
