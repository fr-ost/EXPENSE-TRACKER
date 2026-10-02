"use client";

import { useEffect, useSyncExternalStore } from "react";
import { clientVersion, describeError } from "@/lib/error-details";

const noSubscription = () => () => {};

/**
 * Last-resort screen when the root layout itself fails. It replaces the whole
 * document, so it carries its own minimal styles (the app's CSS isn't loaded).
 * "Try again" reloads the page: that starts clean and picks up a newer
 * version of the app if one was deployed.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  // Only in the browser: the server render doesn't know it, and must match.
  const version = useSyncExternalStore(noSubscription, clientVersion, () => null);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#ffffff",
          color: "#0e0e12",
          font: '15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        }}
      >
        <title>Something went wrong · Hisab</title>
        <main style={{ maxWidth: 360, textAlign: "center" }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 24px", color: "#4f4f5c" }}>
            Your data is safe. Hisab couldn&rsquo;t load this screen — try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              height: 44,
              padding: "0 20px",
              border: 0,
              borderRadius: 10,
              background: "#0e0e12",
              color: "#ffffff",
              font: "inherit",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {/* Enough, in a screenshot, to find the cause. */}
          <p style={{ margin: "24px 0 0", color: "#8b8b97", font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace", overflowWrap: "anywhere" }}>
            {describeError(error)}
            {version && ` · version ${version}`}
          </p>
        </main>
      </body>
    </html>
  );
}
