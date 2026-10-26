import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-errors";
describe("Supabase sign-in errors", () => {
  it("explains invalid credentials and unconfirmed email", () => {
    expect(authErrorMessage({ code: "invalid_credentials", status: 400 }, true)).toContain("غير صحيحة");
    expect(authErrorMessage({ code: "email_not_confirmed", status: 400 }, false)).toContain("Confirm your email");
  });
  it("distinguishes project configuration and network errors", () => {
    expect(authErrorMessage({ message: "Invalid API key", status: 401 }, true)).toContain("إعدادات Supabase");
    expect(authErrorMessage({ name: "AuthRetryableFetchError", message: "fetch failed" }, false)).toContain("Could not reach");
  });
  it("does not require printing provider details to the user", () => {
    expect(authErrorMessage({ code: "some_unknown_code", message: "sensitive internal text" }, true)).not.toContain("sensitive internal text");
  });
});
