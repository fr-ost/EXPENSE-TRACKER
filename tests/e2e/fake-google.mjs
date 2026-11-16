// A local stand-in for Google's sign-in, for the end-to-end tests only.
//
// It speaks the same OpenID Connect authorization-code flow the app uses with
// Google (authorization endpoint, token endpoint with PKCE, signing keys), so
// the tests exercise the real sign-in code against real signed ID tokens.
//
// Who "signs in" is whoever the browser's `fake_google_user` cookie names:
// base64url JSON { sub, email, name, emailVerified?, deny?, tamper? }.
//   deny:   the person presses Cancel on the consent screen.
//   tamper: "audience" | "nonce" | "issuer" | "expired" | "signature" — an ID
//           token the app must refuse.
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_GOOGLE_PORT ?? 3201);
const ORIGIN = `http://localhost:${PORT}`;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

const KID = "fake-google-key-1";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] };

/** code → what was asked for, single use. */
const codes = new Map();

const base64url = (value) => Buffer.from(value).toString("base64url");

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
  const text = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
  response.end(text);
}

async function readForm(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return new URLSearchParams(text);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", ORIGIN);

  if (url.pathname === "/healthz") return send(response, 200, "ok");
  if (url.pathname === "/oauth2/v3/certs") return send(response, 200, jwks, { "Cache-Control": "public, max-age=3600" });

  if (url.pathname === "/o/oauth2/v2/auth" && request.method === "GET") {
    const q = url.searchParams;
    const redirectUri = q.get("redirect_uri") ?? "";
    const problems = [
      q.get("client_id") !== CLIENT_ID && "client_id",
      q.get("response_type") !== "code" && "response_type",
      !(q.get("scope") ?? "").split(" ").includes("openid") && "scope",
      !q.get("state") && "state",
      !q.get("nonce") && "nonce",
      q.get("code_challenge_method") !== "S256" && "code_challenge_method",
      !q.get("code_challenge") && "code_challenge",
      !/^http:\/\/localhost:\d+\/api\/auth\/google\/callback$/.test(redirectUri) && "redirect_uri",
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
      codes.set(code, { identity, nonce: q.get("nonce"), challenge: q.get("code_challenge"), redirectUri });
      back.searchParams.set("code", code);
    }
    return send(response, 302, "", { Location: back.toString() });
  }

  if (url.pathname === "/token" && request.method === "POST") {
    const form = await readForm(request);
    const grant = codes.get(form.get("code") ?? "");
    codes.delete(form.get("code") ?? "");
    const verifier = form.get("code_verifier") ?? "";
    const valid =
      grant &&
      form.get("grant_type") === "authorization_code" &&
      form.get("client_id") === CLIENT_ID &&
      form.get("client_secret") === CLIENT_SECRET &&
      form.get("redirect_uri") === grant.redirectUri &&
      createHash("sha256").update(verifier).digest("base64url") === grant.challenge;
    if (!valid) return send(response, 400, { error: "invalid_grant" });

    const { identity } = grant;
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: identity.tamper === "issuer" ? "https://accounts.example.com" : ORIGIN,
      aud: identity.tamper === "audience" ? "someone-else.apps.googleusercontent.com" : CLIENT_ID,
      sub: identity.sub,
      email: identity.email,
      email_verified: identity.emailVerified ?? true,
      name: identity.name,
      nonce: identity.tamper === "nonce" ? "not-the-nonce" : grant.nonce,
      iat: identity.tamper === "expired" ? now - 7200 : now,
      exp: identity.tamper === "expired" ? now - 3600 : now + 3600,
    };
    const idToken = signIdToken(claims, identity.tamper === "signature" ? otherKey : privateKey);
    return send(response, 200, { access_token: "unused", token_type: "Bearer", expires_in: 3600, id_token: idToken });
  }

  return send(response, 404, "Not found");
});

server.listen(PORT, () => console.log(`fake Google listening on ${ORIGIN}`));
