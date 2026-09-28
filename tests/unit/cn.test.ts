import { expect, it } from "vitest";
import { cn } from "@/lib/utils";
it("keeps color and custom size", () => {
  expect(cn("text-white text-body")).toBe("text-white text-body");
  expect(cn("text-small text-text-tertiary")).toBe("text-small text-text-tertiary");
  expect(cn("text-body", "text-small")).toBe("text-small");
});
