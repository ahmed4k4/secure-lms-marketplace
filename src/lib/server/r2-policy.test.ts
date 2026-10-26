import { describe, expect, it } from "vitest";
import { isAllowedR2ContentType, matchesFileSignature, safeDisplayFileName, safeFileExtension } from "./r2-policy";

describe("R2 upload policy", () => {
  it("allows only the supported video formats for course videos", () => {
    expect(isAllowedR2ContentType("video", "video/mp4")).toBe(true);
    expect(isAllowedR2ContentType("video", "video/webm")).toBe(true);
    expect(isAllowedR2ContentType("video", "video/quicktime")).toBe(true);
    expect(isAllowedR2ContentType("video", "application/octet-stream")).toBe(false);
    expect(isAllowedR2ContentType("video", "video/x-msvideo")).toBe(false);
  });

  it("allows documents and images but rejects executable and HTML content", () => {
    expect(isAllowedR2ContentType("resource", "application/pdf")).toBe(true);
    expect(isAllowedR2ContentType("resource", "image/png")).toBe(true);
    expect(isAllowedR2ContentType("cover", "image/webp")).toBe(true);
    expect(isAllowedR2ContentType("cover", "image/svg+xml")).toBe(false);
    expect(isAllowedR2ContentType("resource", "text/html")).toBe(false);
    expect(isAllowedR2ContentType("resource", "application/x-msdownload")).toBe(false);
  });

  it("checks basic magic bytes before accepting public covers and video uploads", () => {
    expect(matchesFileSignature("cover", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe(true);
    expect(matchesFileSignature("cover", "image/png", new TextEncoder().encode("<script>alert(1)</script>"))).toBe(false);
    expect(matchesFileSignature("video", "video/webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00]))).toBe(true);
    expect(matchesFileSignature("video", "video/mp4", new TextEncoder().encode("not a video"))).toBe(false);
  });

  it("uses a known extension from the MIME type and sanitizes display names", () => {
    expect(safeFileExtension("../../payload.exe", "video/mp4")).toBe("mp4");
    expect(safeDisplayFileName("../notes\r\n.pdf")).toBe(".._notes__.pdf");
    expect(safeDisplayFileName("  ")).toBe("file");
  });
});
