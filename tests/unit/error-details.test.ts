import { describe, expect, it } from "vitest";
import { clientVersion, describeError, errorDetails } from "@/lib/error-details";

describe("error details", () => {
  it("says what went wrong in one line", () => {
    expect(describeError(new Error('Invalid money value: "5543."'))).toBe('Invalid money value: "5543."');
    expect(describeError(Object.assign(new Error("hidden in production"), { digest: "2207" }))).toBe("Server error 2207");
    expect(describeError(null)).toBe("Unknown error");
    expect(describeError(new Error(""))).toBe("Unknown error");
    const long = describeError(new Error("x".repeat(400)));
    expect(long).toHaveLength(158);
    expect(long.endsWith("…")).toBe(true);
  });

  it("adds the version only in the browser", () => {
    expect(clientVersion()).toBeNull();
    expect(errorDetails(new Error("boom"))).toBe("boom");
  });
});
