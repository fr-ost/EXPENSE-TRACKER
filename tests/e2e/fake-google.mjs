// A local stand-in for Google, for the tests only: sign-in and Drive.
//
// Sign-in: the same OpenID Connect authorization-code flow the app uses with
// Google (authorization endpoint, token endpoint with PKCE, signing keys), so
// the tests exercise the real sign-in code against real signed ID tokens.
//
// Drive: the few calls Hisab makes — refresh tokens, and files in the app's
// hidden folder ("appDataFolder") — kept in memory per Google account. It is
// strict where Google is: a call without the Drive permission, outside the
// app folder, or with a withdrawn token is refused.
//
// Who "signs in" is whoever the browser's `fake_google_user` cookie names:
// base64url JSON { sub, email, name, emailVerified?, deny?, tamper?, withoutDrive? }.
//   deny:         the person presses Cancel on the consent screen.
//   tamper:       "audience" | "nonce" | "issuer" | "expired" | "signature" —
//                 an ID token the app must refuse.
//   withoutDrive: the person unticks the Drive permission on the consent screen.
//
// Tests steer it over HTTP (POST /__test/…): revoke a person's permission,
// make Drive fail in a chosen way, or read what is in a person's folder.
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

const base64url = (value) => Buffer.from(value).toString("base64url");

/** Start the stand-in. Resolves once it is listening. */
export function startFakeGoogle({ port, clientId, clientSecret }) {
  const ORIGIN = `http://localhost:${port}`;
  const KID = "fake-google-key-1";
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] };

  /** code → what was asked for, single use. */
  const codes = new Map();
  /** refresh token → { sub, scopes }; access token → the same. */
  const refreshTokens = new Map();
  const accessTokens = new Map();
  /** sub → files in the app folder. */
  const folders = new Map();
  /** upload id → what is being uploaded. */
  const uploads = new Map();
  /** How Drive misbehaves, when a test says so: null | "down" | "disabled" | "full". */
  let trouble = null;
  let clock = 0;

  const folderOf = (sub) => {
    if (!folders.has(sub)) folders.set(sub, []);
    return folders.get(sub);
  };

  function signIdToken(claims, key = privateKey) {
    const head = base64url(JSON.stringify({ alg: "RS256", kid: KID, typ: "JWT" }));
    const body = base64url(JSON.stringify(claims));
    const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key).toString("base64url");
    return `${head}.${body}.${signature}`;
  }

  function identityFrom(request) {
    const cookie = (request.headers.cookie ?? "").split(/;\s*/).find((part) => part.startsWith("fake_google_user="));
    if (!cookie) return null;
    try {
      return JSON.parse(Buffer.from(cookie.slice("fake_google_user=".length), "base64url").toString("utf8"));
    } catch {
      return null;
    }
  }

  function send(response, status, body, headers = {}) {
    const isText = typeof body === "string" || Buffer.isBuffer(body);
    response.writeHead(status, { "Content-Type": isText ? "text/plain" : "application/json", ...headers });
    response.end(isText ? body : JSON.stringify(body));
  }

  async function readBody(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  /** The Google account a Drive call is made for, or an answer saying why not. */
  function driveCaller(request, response) {
    if (trouble === "down") return void send(response, 503, { error: { code: 503, message: "Backend Error" } });
    if (trouble === "disabled") {
      return void send(response, 403, { error: { code: 403, message: "Google Drive API has not been used in project 1 before or it is disabled.", errors: [{ reason: "accessNotConfigured" }] } });
    }
    const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
    const grant = token ? accessTokens.get(token) : null;
    if (!grant) return void send(response, 401, { error: { code: 401, message: "Invalid Credentials" } });
    if (!grant.scopes.includes(DRIVE_SCOPE)) {
      return void send(response, 403, { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED" } });
    }
    return grant.sub;
  }

  const resource = (file) => ({ id: file.id, name: file.name, mimeType: file.mimeType, createdTime: file.createdTime, size: String(file.content.length), appProperties: file.appProperties });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", ORIGIN);
    const { pathname, searchParams: q } = url;

    if (pathname === "/healthz") return send(response, 200, "ok");
    if (pathname === "/oauth2/v3/certs") return send(response, 200, jwks, { "Cache-Control": "public, max-age=3600" });

    // ---- What the tests steer --------------------------------------------
    if (pathname.startsWith("/__test/") && request.method === "POST") {
      const sub = q.get("sub");
      if (pathname === "/__test/revoke") {
        for (const [token, grant] of refreshTokens) if (grant.sub === sub) refreshTokens.delete(token);
        for (const [token, grant] of accessTokens) if (grant.sub === sub) accessTokens.delete(token);
        return send(response, 200, { ok: true });
      }
      if (pathname === "/__test/trouble") {
        trouble = q.get("kind") || null;
        return send(response, 200, { trouble });
      }
      if (pathname === "/__test/files") {
        return send(response, 200, { files: folderOf(sub).map((file) => ({ ...resource(file), base64: file.content.toString("base64") })), grants: [...refreshTokens.values()].filter((g) => g.sub === sub).length });
      }
      if (pathname === "/__test/put-file") {
        // A file as another app version (or a mishap) might have left it.
        const body = JSON.parse((await readBody(request)).toString("utf8"));
        folderOf(sub).push({ id: randomBytes(12).toString("hex"), name: body.name, mimeType: "application/gzip", createdTime: new Date(Date.now() + ++clock).toISOString(), appProperties: body.appProperties ?? {}, content: Buffer.from(body.base64, "base64") });
        return send(response, 200, { ok: true });
      }
      return send(response, 404, "Not found");
    }

    // ---- Sign-in and consent ---------------------------------------------
    if (pathname === "/o/oauth2/v2/auth" && request.method === "GET") {
      const redirectUri = q.get("redirect_uri") ?? "";
      const scopes = (q.get("scope") ?? "").split(" ").filter(Boolean);
      const problems = [
        q.get("client_id") !== clientId && "client_id",
        q.get("response_type") !== "code" && "response_type",
        !scopes.includes("openid") && "scope",
        !q.get("state") && "state",
        !q.get("nonce") && "nonce",
        q.get("code_challenge_method") !== "S256" && "code_challenge_method",
        !q.get("code_challenge") && "code_challenge",
        !/^http:\/\/localhost:\d+\/api\/auth\/google\/callback$/.test(redirectUri) && "redirect_uri",
        // Google gives a lasting token only when asked for offline access with the consent screen shown.
        scopes.includes(DRIVE_SCOPE) && (q.get("access_type") !== "offline" || q.get("prompt") !== "consent") && "offline access",
      ].filter(Boolean);
      if (problems.length) return send(response, 400, `Bad authorization request: ${problems.join(", ")}`);

      const identity = identityFrom(request);
      if (!identity) return send(response, 400, "No test identity: set the fake_google_user cookie first.");

      const back = new URL(redirectUri);
      back.searchParams.set("state", q.get("state"));
      if (identity.deny) {
        back.searchParams.set("error", "access_denied");
      } else {
        const code = randomBytes(24).toString("base64url");
        const granted = scopes.filter((scope) => !(scope === DRIVE_SCOPE && identity.withoutDrive));
        codes.set(code, { identity, nonce: q.get("nonce"), challenge: q.get("code_challenge"), redirectUri, scopes: granted, offline: q.get("access_type") === "offline" });
        back.searchParams.set("code", code);
      }
      return send(response, 302, "", { Location: back.toString() });
    }

    if (pathname === "/token" && request.method === "POST") {
      const form = new URLSearchParams((await readBody(request)).toString("utf8"));
      if (form.get("client_id") !== clientId || form.get("client_secret") !== clientSecret) return send(response, 401, { error: "invalid_client" });

      if (form.get("grant_type") === "refresh_token") {
        const grant = refreshTokens.get(form.get("refresh_token") ?? "");
        if (!grant) return send(response, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        const access = randomBytes(24).toString("base64url");
        accessTokens.set(access, grant);
        return send(response, 200, { access_token: access, token_type: "Bearer", expires_in: 3600, scope: grant.scopes.join(" ") });
      }

      const grant = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const valid =
        grant &&
        form.get("grant_type") === "authorization_code" &&
        form.get("redirect_uri") === grant.redirectUri &&
        createHash("sha256").update(verifier).digest("base64url") === grant.challenge;
      if (!valid) return send(response, 400, { error: "invalid_grant" });

      const { identity } = grant;
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: identity.tamper === "issuer" ? "https://accounts.example.com" : ORIGIN,
        aud: identity.tamper === "audience" ? "someone-else.apps.googleusercontent.com" : clientId,
        sub: identity.sub,
        email: identity.email,
        email_verified: identity.emailVerified ?? true,
        name: identity.name,
        nonce: identity.tamper === "nonce" ? "not-the-nonce" : grant.nonce,
        iat: identity.tamper === "expired" ? now - 7200 : now,
        exp: identity.tamper === "expired" ? now - 3600 : now + 3600,
      };
      const access = randomBytes(24).toString("base64url");
      accessTokens.set(access, { sub: identity.sub, scopes: grant.scopes });
      const answer = {
        access_token: access,
        token_type: "Bearer",
        expires_in: 3600,
        scope: grant.scopes.join(" "),
        id_token: signIdToken(claims, identity.tamper === "signature" ? otherKey : privateKey),
      };
      if (grant.offline) {
        answer.refresh_token = randomBytes(32).toString("base64url");
        refreshTokens.set(answer.refresh_token, { sub: identity.sub, scopes: grant.scopes });
      }
      return send(response, 200, answer);
    }

    if (pathname === "/revoke" && request.method === "POST") {
      const token = new URLSearchParams((await readBody(request)).toString("utf8")).get("token") ?? "";
      const grant = refreshTokens.get(token) ?? accessTokens.get(token);
      if (!grant) return send(response, 400, { error: "invalid_token" });
      // As with Google: revoking any one token withdraws everything this app was granted by that person.
      for (const [other, held] of refreshTokens) if (held.sub === grant.sub) refreshTokens.delete(other);
      for (const [other, held] of accessTokens) if (held.sub === grant.sub) accessTokens.delete(other);
      return send(response, 200, {});
    }

    // ---- Drive: the app's own folder -------------------------------------
    if (pathname === "/upload/drive/v3/files" && q.get("uploadType") === "resumable") {
      // The address of an upload in progress is its own key, as with Google: sending the bytes needs no token.
      const sub = request.method === "PUT" ? uploads.get(q.get("upload_id") ?? "")?.sub : driveCaller(request, response);
      if (!sub) return request.method === "PUT" ? send(response, 404, { error: { code: 404, message: "Upload not found" } }) : undefined;
      if (request.method === "POST") {
        const metadata = JSON.parse((await readBody(request)).toString("utf8") || "{}");
        // With this permission, Drive only takes files into the app's folder.
        if (JSON.stringify(metadata.parents) !== '["appDataFolder"]') {
          return send(response, 403, { error: { code: 403, message: "The user does not have sufficient permissions for this file.", errors: [{ reason: "insufficientFilePermissions" }] } });
        }
        if (trouble === "full") {
          return send(response, 403, { error: { code: 403, message: "The user's Drive storage quota has been exceeded.", errors: [{ reason: "storageQuotaExceeded" }] } });
        }
        const upload = randomBytes(12).toString("hex");
        uploads.set(upload, { sub, metadata, length: Number(request.headers["x-upload-content-length"]), type: request.headers["x-upload-content-type"] });
        return send(response, 200, "", { Location: `${ORIGIN}/upload/drive/v3/files?uploadType=resumable&upload_id=${upload}` });
      }
      if (request.method === "PUT") {
        const upload = uploads.get(q.get("upload_id") ?? "");
        const content = await readBody(request);
        if (!upload || upload.sub !== sub) return send(response, 404, { error: { code: 404, message: "Upload not found" } });
        if (content.length !== upload.length) return send(response, 400, { error: { code: 400, message: "Invalid upload: length mismatch" } });
        uploads.delete(q.get("upload_id"));
        const file = {
          id: randomBytes(12).toString("hex"),
          name: upload.metadata.name,
          mimeType: upload.type,
          // Never two at the same instant: "newest first" stays well defined.
          createdTime: new Date(Date.now() + ++clock).toISOString(),
          appProperties: upload.metadata.appProperties ?? {},
          content,
        };
        folderOf(sub).push(file);
        return send(response, 200, { kind: "drive#file", id: file.id, name: file.name, mimeType: file.mimeType });
      }
    }

    if (pathname === "/drive/v3/files" && request.method === "GET") {
      const sub = driveCaller(request, response);
      if (!sub) return;
      if (q.get("spaces") !== "appDataFolder") {
        return send(response, 403, { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED" } });
      }
      const all = [...folderOf(sub)].sort((a, b) => (a.createdTime < b.createdTime ? 1 : -1));
      const size = Math.min(Number(q.get("pageSize") ?? 100), 100);
      const from = Number(q.get("pageToken") ?? 0);
      const page = all.slice(from, from + size);
      return send(response, 200, { files: page.map(resource), ...(from + size < all.length ? { nextPageToken: String(from + size) } : {}) });
    }

    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(pathname);
    if (one) {
      const sub = driveCaller(request, response);
      if (!sub) return;
      const folder = folderOf(sub);
      const index = folder.findIndex((file) => file.id === decodeURIComponent(one[1]));
      // Another person's file is simply not there.
      if (index < 0) return send(response, 404, { error: { code: 404, message: "File not found." } });
      if (request.method === "GET" && q.get("alt") === "media") {
        return send(response, 200, folder[index].content, { "Content-Type": folder[index].mimeType, "Content-Length": String(folder[index].content.length) });
      }
      if (request.method === "DELETE") {
        folder.splice(index, 1);
        response.writeHead(204);
        return response.end();
      }
    }

    return send(response, 404, "Not found");
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve({ origin: ORIGIN, close: () => new Promise((done) => server.close(done)) }));
  });
}

// Run directly (the e2e suite does): start on the configured port.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { origin } = await startFakeGoogle({
    port: Number(process.env.FAKE_GOOGLE_PORT ?? 3201),
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  });
  console.log(`fake Google listening on ${origin}`);
}
