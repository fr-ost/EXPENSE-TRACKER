import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id (the library default algorithm) with OWASP's recommended
 * parameters: 19 MiB memory, 2 iterations, 1 degree of parallelism.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

// A valid hash of a random value, used to spend the same time verifying when
// there is no user row, so response timing does not reveal setup state.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$udqqYNpZhMc3YfBNclcrpw$TIVOSopUcCiYnHbv6EZuc72uiP7uM0GQW/C1RsdyIRE";

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string | null | undefined, password: string): Promise<boolean> {
  try {
    const ok = await verify(passwordHash ?? DUMMY_HASH, password);
    return ok && !!passwordHash;
  } catch {
    return false;
  }
}

export function isArgon2Hash(value: string): boolean {
  return /^\$argon2(id|i|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(value);
}
