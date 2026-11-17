/**
 * The Android app (android/) is this site inside a shell: the phone's browser
 * shows it full screen, without an address bar, only for an app the site
 * vouches for. The vouching is /.well-known/assetlinks.json, built here: the
 * app's id, and the certificates a genuine copy is signed with.
 */

/** The app's id on the phone and on Google Play. `hisabApplicationId` in android/gradle.properties must say the same. */
export const ANDROID_PACKAGE = "io.github.fr_ost.hisab";

/**
 * SHA-256 fingerprints of the certificates a genuine copy is signed with,
 * known when the code was written: the owner's key (copies installed straight
 * from GitHub). The one Google Play signs with is added on the server, in
 * ANDROID_CERT_SHA256, because it only exists once the app is on Play.
 */
export const ANDROID_CERTIFICATES: readonly string[] = [];

/**
 * The link a page hands the Android app (it opens the app's set-up screen
 * with a one-time code, services/devices.ts). Chrome passes an "intent:" link
 * to the app named in it and to no other; when that app isn't installed it
 * goes to `fallback` instead.
 */
export function androidLinkIntent(code: string, fallback: string): string {
  return `intent://link?code=${encodeURIComponent(code)}#Intent;scheme=hisab;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}

const FINGERPRINT = /^[0-9A-F]{64}$/;

/** "ab:cd…" / "ABCD…" → "AB:CD:…" (32 bytes), or null when it isn't a SHA-256 fingerprint. */
export function normalizeFingerprint(value: string): string | null {
  const hex = value.replace(/[:\s]/g, "").toUpperCase();
  return FINGERPRINT.test(hex) ? hex.match(/../g)!.join(":") : null;
}

/** The fingerprints in a setting like ANDROID_CERT_SHA256: separated by commas or lines; anything else is ignored. */
export function parseFingerprints(setting: string | undefined): string[] {
  return (setting ?? "")
    .split(/[,;\n]/)
    .map((entry) => normalizeFingerprint(entry.trim()))
    .filter((fingerprint): fingerprint is string => fingerprint !== null);
}

export interface AssetLink {
  relation: string[];
  target: { namespace: "android_app"; package_name: string; sha256_cert_fingerprints: string[] };
}

/** What /.well-known/assetlinks.json says: nothing until a certificate is known. */
export function androidAssetLinks(extraFingerprints: string | undefined): AssetLink[] {
  const fingerprints = [...new Set([...parseFingerprints(ANDROID_CERTIFICATES.join(",")), ...parseFingerprints(extraFingerprints)])];
  if (fingerprints.length === 0) return [];
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ];
}
