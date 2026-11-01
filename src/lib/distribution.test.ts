// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { PLATFORM_DEFAULT_URLS, releaseRow } from "@/lib/distribution.functions";

describe("klub dasturi havolalari", () => {
  test("qatori yo'q Android sahifaga standart APK havolasini chiqaradi", () => {
    expect(releaseRow("android").url).toBe(PLATFORM_DEFAULT_URLS.android);
    expect(releaseRow("android").url).toContain("https://");
  });

  test("Windows, macOS va iOS uchun fayl yo'q — havola bo'sh, soxta tugma chizilmaydi", () => {
    expect(releaseRow("windows").url).toBe("");
    expect(releaseRow("macos").url).toBe("");
    expect(releaseRow("ios").url).toBe("");
  });

  test("admin havolani bo'sh qilib saqlasa standart qaytib kelmaydi", () => {
    const saved = releaseRow("android", {
      url: "",
      version: "",
      instructions: "",
      updated_at: "2026-11-01T10:00:00.000Z",
    });
    expect(saved.url).toBe("");
    expect(saved.updated_at).toBe("2026-11-01T10:00:00.000Z");
  });
});
