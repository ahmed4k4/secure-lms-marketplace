import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth-redirects";

describe("auth callback redirect allowlist", () => {
  it("allows local destinations inside the selected locale", () => {
    expect(safeNextPath("/ar/reset-password", "ar")).toBe("/ar/reset-password");
    expect(safeNextPath("/en/setup-account?flow=invite", "en")).toBe("/en/setup-account?flow=invite");
  });
  it("rejects external, protocol-relative, and cross-locale redirects", () => {
    expect(safeNextPath("https://evil.example", "ar")).toBe("/ar/dashboard");
    expect(safeNextPath("//evil.example/path", "ar")).toBe("/ar/dashboard");
    expect(safeNextPath("/en/admin", "ar")).toBe("/ar/dashboard");
  });
});
