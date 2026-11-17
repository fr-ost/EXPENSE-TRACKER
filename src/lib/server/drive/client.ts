import "server-only";
import { googleEndpoints, type GoogleConfig } from "../auth/google";

/**
 * Google Drive, as far as Hisab uses it: files in the app's own hidden folder
 * ("appDataFolder") of one person's Drive. Every call names that folder, and
 * the permission asked for (DRIVE_SCOPE) reaches nothing else.
 */

/**
 * Why a Drive call didn't work:
 *   reconnect   — Google has withdrawn the permission (revoked, expired, or
 *                 the Drive permission was never ticked): the person must
 *                 connect again.
 *   unavailable — Drive couldn't be reached or is busy; trying later may work.
 *   failed      — Drive refused; `message` says why in words fit to show.
 */
export class DriveError extends Error {
  constructor(
    public readonly kind: "reconnect" | "unavailable" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

export interface DriveFile {
  id: string;
  name: string;
  /** When it was put in Drive (ISO). */
  createdTime: string;
  /** Bytes. */
  size: number;
  /** Our own notes on the file (what the backup holds). */
  properties: Record<string, string>;
}

const QUICK_MS = 30_000;
const TRANSFER_MS = 120_000;

async function call(url: string, init: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = QUICK_MS, ...request } = init;
  try {
    return await fetch(url, { ...request, signal: AbortSignal.timeout(timeout), cache: "no-store" });
  } catch {
    throw new DriveError("unavailable", "Google Drive couldn't be reached. Try again in a moment.");
  }
}

/** Turn a refused Drive call into the reason. */
async function refused(response: Response, doing: string): Promise<DriveError> {
  const text = await response.text().catch(() => "");
  if (response.status === 401) return new DriveError("reconnect", "Google Drive needs to be connected again.");
  if (response.status === 404) return new DriveError("failed", "That backup is no longer in your Google Drive.");
  if (response.status === 403 && /accessNotConfigured|has not been used|is disabled|SERVICE_DISABLED/i.test(text)) {
    return new DriveError("failed", "Google Drive isn't switched on for this app yet (the Google Drive API must be enabled in the Google Cloud project).");
  }
  if (response.status === 403 && /insufficient|scope|PERMISSION_DENIED/i.test(text)) {
    return new DriveError("reconnect", "Google Drive needs to be connected again.");
  }
  if (response.status === 403 && /storageQuotaExceeded|quota/i.test(text) && !/rateLimit/i.test(text)) {
    return new DriveError("failed", "Your Google Drive is full.");
  }
  if (response.status === 429 || response.status >= 500 || /rateLimit/i.test(text)) {
    return new DriveError("unavailable", "Google Drive is busy. Try again in a moment.");
  }
  console.warn(`[drive] ${doing} refused: ${response.status} ${text.slice(0, 300)}`);
  return new DriveError("failed", "Google Drive refused the request.");
}

/** A short-lived access token from the stored permission. */
export async function accessToken(config: GoogleConfig, refreshToken: string): Promise<string> {
  const response = await call(googleEndpoints().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: unknown; error?: unknown } | null;
  if (response.ok && typeof body?.access_token === "string") return body.access_token;
  // "invalid_grant": revoked by the person, expired, or unused for too long.
  if (response.status === 400 || response.status === 401) return Promise.reject(new DriveError("reconnect", "Google Drive needs to be connected again."));
  throw new DriveError("unavailable", "Google couldn't be reached. Try again in a moment.");
}

const authorized = (token: string) => ({ Authorization: `Bearer ${token}` });

interface FileResource {
  id?: string;
  name?: string;
  createdTime?: string;
  size?: string | number;
  appProperties?: Record<string, string>;
}

const toFile = (file: FileResource): DriveFile => ({
  id: String(file.id ?? ""),
  name: String(file.name ?? ""),
  createdTime: String(file.createdTime ?? ""),
  size: Number(file.size ?? 0),
  properties: file.appProperties ?? {},
});

/** The files in Hisab's folder, newest first. */
export async function listFiles(token: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  for (let pageToken: string | undefined; ; ) {
    const url = new URL(`${googleEndpoints().drive}/files`);
    url.search = new URLSearchParams({
      spaces: "appDataFolder",
      orderBy: "createdTime desc",
      pageSize: "100",
      fields: "nextPageToken,files(id,name,createdTime,size,appProperties)",
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const response = await call(url.toString(), { headers: authorized(token) });
    if (!response.ok) throw await refused(response, "listing backups");
    const body = (await response.json()) as { files?: FileResource[]; nextPageToken?: string };
    files.push(...(body.files ?? []).map(toFile).filter((file) => file.id));
    pageToken = body.nextPageToken;
    // Far more than Hisab ever keeps: stop rather than page for ever.
    if (!pageToken || files.length >= 500) return files;
  }
}

/**
 * Put a file in Hisab's folder (a resumable upload sent in one piece, which
 * has no size limit worth mentioning). Returns the new file's id.
 */
export async function uploadFile(
  token: string,
  file: { name: string; mimeType: string; contents: Buffer; properties: Record<string, string> },
): Promise<string> {
  const start = await call(`${googleEndpoints().driveUpload}/files?uploadType=resumable`, {
    method: "POST",
    headers: {
      ...authorized(token),
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": file.mimeType,
      "X-Upload-Content-Length": String(file.contents.length),
    },
    body: JSON.stringify({ name: file.name, parents: ["appDataFolder"], mimeType: file.mimeType, appProperties: file.properties }),
  });
  const session = start.headers.get("location");
  if (!start.ok || !session) throw await refused(start, "starting an upload");

  const sent = await call(session, {
    method: "PUT",
    headers: { ...authorized(token), "Content-Type": file.mimeType, "Content-Length": String(file.contents.length) },
    body: new Uint8Array(file.contents),
    timeout: TRANSFER_MS,
  });
  if (!sent.ok) throw await refused(sent, "uploading a backup");
  const created = (await sent.json().catch(() => null)) as FileResource | null;
  if (!created?.id) throw new DriveError("failed", "Google Drive didn't confirm the upload.");
  return created.id;
}

/** A file's contents. `maxBytes` guards against being handed something enormous. */
export async function downloadFile(token: string, id: string, maxBytes: number): Promise<Buffer> {
  const response = await call(`${googleEndpoints().drive}/files/${encodeURIComponent(id)}?alt=media`, {
    headers: authorized(token),
    timeout: TRANSFER_MS,
  });
  if (!response.ok) throw await refused(response, "downloading a backup");
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) throw new DriveError("failed", "That file is too large to be a Hisab backup.");
  const contents = Buffer.from(await response.arrayBuffer());
  if (contents.length > maxBytes) throw new DriveError("failed", "That file is too large to be a Hisab backup.");
  return contents;
}

export async function deleteFile(token: string, id: string): Promise<void> {
  const response = await call(`${googleEndpoints().drive}/files/${encodeURIComponent(id)}`, { method: "DELETE", headers: authorized(token) });
  // Already gone is as good as deleted.
  if (!response.ok && response.status !== 404) throw await refused(response, "deleting a backup");
}

/** Hand the permission back to Google. Best effort: a token Google no longer knows is already gone. */
export async function revokeToken(refreshToken: string): Promise<void> {
  await call(googleEndpoints().revoke, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => undefined);
}
