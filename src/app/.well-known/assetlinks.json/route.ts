import { androidAssetLinks } from "@/lib/android";

/**
 * The site vouching for its Android app (see lib/android.ts). Anyone may read
 * it — Android and Chrome do, without a session — and it says nothing that
 * isn't in the app itself.
 */
export function GET() {
  return Response.json(androidAssetLinks(process.env.ANDROID_CERT_SHA256), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
