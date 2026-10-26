import { describe, expect, it } from "vitest";
import { classifyDatabaseIssue, databaseIssueMessage } from "./database-errors";
describe("database error classification", () => {
  it("distinguishes missing config, schema, permissions, and network failures", () => {
    expect(classifyDatabaseIssue(new Error("Supabase environment variables are not configured."))).toBe("missing_configuration");
    expect(classifyDatabaseIssue({ code: "PGRST205", message: "table missing from schema cache" })).toBe("schema_missing");
    expect(classifyDatabaseIssue({ code: "42501", message: "permission denied" })).toBe("permission_denied");
    expect(classifyDatabaseIssue(new Error("fetch failed"))).toBe("network");
  });
  it("provides Arabic and English diagnostics", () => {
    expect(databaseIssueMessage("schema_missing", "ar")).toContain("ملفات الترحيل");
    expect(databaseIssueMessage("network", "en")).toContain("Supabase");
  });
});
