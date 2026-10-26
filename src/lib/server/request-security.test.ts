import { describe, expect, it } from "vitest";
import { isSameOriginMutation } from "@/lib/server/request-security";

describe("same-origin mutation guard", () => {
  it("accepts an exact origin match", () => {
    const request = new Request("https://lms.example/api/courses", { method: "POST", headers: { Origin: "https://lms.example" } });
    expect(isSameOriginMutation(request)).toBe(true);
  });
  it("rejects a different origin", () => {
    const request = new Request("https://lms.example/api/courses", { method: "POST", headers: { Origin: "https://attacker.example" } });
    expect(isSameOriginMutation(request)).toBe(false);
  });
  it("rejects missing and malformed origins", () => {
    expect(isSameOriginMutation(new Request("https://lms.example/api/courses", { method: "POST" }))).toBe(false);
    expect(isSameOriginMutation(new Request("https://lms.example/api/courses", { method: "POST", headers: { Origin: "not a URL" } }))).toBe(false);
  });
});
