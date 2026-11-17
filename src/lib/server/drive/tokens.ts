import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Google's refresh token for a user's Drive folder is kept encrypted
 * (AES-256-GCM). The key is derived from the OAuth client secret — the token
 * is useless without that secret anyway — so a copy of the database alone
 * gives nobody access to anyone's Drive, and no further variable is needed.
 */
const VERSION = "v1";

function keyFrom(clientSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", clientSecret, "hisab", "drive refresh token", 32));
}

export function sealToken(token: string, clientSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(clientSecret), iv);
  const sealed = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), sealed.toString("base64url")].join(":");
}

/** The token, or null when it can't be opened (the client secret changed, or the value was altered). */
export function openToken(sealed: string, clientSecret: string): string | null {
  const [version, iv, tag, data] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(clientSecret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
