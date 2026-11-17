import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANDROID_CERTIFICATES, ANDROID_PACKAGE, androidAssetLinks, androidLinkIntent, normalizeFingerprint, parseFingerprints } from "@/lib/android";

const A = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
const B = "11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF";

describe("the site vouching for the Android app", () => {
  it("names the app the Android build produces", () => {
    const properties = readFileSync(path.join(process.cwd(), "android/gradle.properties"), "utf8");
    expect(properties.match(/^hisabApplicationId=(.+)$/m)?.[1]).toBe(ANDROID_PACKAGE);
  });

  it("hands a link code to this app and no other", () => {
    const intent = androidLinkIntent("c0de_-", "https://hisab.example/settings?phone=missing#sms-phones");
    expect(intent).toBe(
      `intent://link?code=c0de_-#Intent;scheme=hisab;package=${ANDROID_PACKAGE};S.browser_fallback_url=https%3A%2F%2Fhisab.example%2Fsettings%3Fphone%3Dmissing%23sms-phones;end`,
    );
    // The scheme and host are the ones the app's set-up screen answers to.
    const manifest = readFileSync(path.join(process.cwd(), "android/app/src/main/AndroidManifest.xml"), "utf8");
    expect(manifest).toMatch(/<data\s+android:scheme="hisab"\s+android:host="link"\s*\/>/);
    expect(manifest).toMatch(/android:name="\.SmsSetupActivity"/);
  });

  it("reads fingerprints however they were pasted", () => {
    expect(normalizeFingerprint(A)).toBe(A);
    expect(normalizeFingerprint(A.toLowerCase())).toBe(A);
    expect(normalizeFingerprint(A.replaceAll(":", ""))).toBe(A);
    expect(normalizeFingerprint(` ${A} `)).toBe(A);
    // A SHA-1 fingerprint, a truncated one and words are not certificates.
    expect(normalizeFingerprint(A.slice(0, 59))).toBeNull();
    expect(normalizeFingerprint(A.slice(0, -1))).toBeNull();
    expect(normalizeFingerprint("not a fingerprint")).toBeNull();
    expect(normalizeFingerprint("")).toBeNull();

    expect(parseFingerprints(`${A}, ${B.toLowerCase()}`)).toEqual([A, B]);
    expect(parseFingerprints(`${A}\n${B}\n`)).toEqual([A, B]);
    expect(parseFingerprints(`${A},junk,,`)).toEqual([A]);
    expect(parseFingerprints(undefined)).toEqual([]);
    expect(parseFingerprints("")).toEqual([]);
  });

  it("vouches for the app signed with a known certificate, and for nothing else", () => {
    const committed = parseFingerprints(ANDROID_CERTIFICATES.join(","));
    // Every certificate written into the code is a real fingerprint.
    expect(committed).toHaveLength(ANDROID_CERTIFICATES.length);

    const links = androidAssetLinks(`${A},${A.toLowerCase()},${B}`);
    expect(links).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [...new Set([...committed, A, B])] },
      },
    ]);

    // With no certificate known, the site vouches for no app at all.
    const none = androidAssetLinks("junk");
    expect(none).toEqual(committed.length ? [expect.objectContaining({ target: expect.objectContaining({ sha256_cert_fingerprints: committed }) })] : []);
  });
});
