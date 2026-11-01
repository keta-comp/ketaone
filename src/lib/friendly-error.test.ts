// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { friendlyError, isInternalErrorText } from "./friendly-error";

describe("friendlyError", () => {
  test("yopiq texnik xatolarni foydalanuvchiga ko'rsatmaydi", () => {
    const internal =
      'The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Object';
    expect(isInternalErrorText(internal)).toBe(true);
    expect(friendlyError(new Error(internal), "Saqlash amalga oshmadi")).toBe("Saqlash amalga oshmadi");
  });

  test("Postgres va stack trace xabarlari ham yashiriladi", () => {
    expect(friendlyError(new Error('invalid input syntax for type uuid: "none"'), "Xatolik")).toBe("Xatolik");
    expect(friendlyError(new Error("    at Object.<anonymous> (file:///app/server.js:1:2)"), "Xatolik")).toBe(
      "Xatolik",
    );
  });

  test("izohli, tushunarli xabarlarni o'zini qoldiradi", () => {
    expect(friendlyError(new Error("Bo'lak ketma-ketligi buzildi — qaytadan yuklab ko'ring."), "Xatolik")).toBe(
      "Bo'lak ketma-ketligi buzildi — qaytadan yuklab ko'ring.",
    );
    expect(friendlyError("Fayl hajmi 15 MB dan oshmasin.", "Xatolik")).toBe("Fayl hajmi 15 MB dan oshmasin.");
  });

  test("xabar bo'sh yoki noto'g'ri turda bo'lsa fallback qaytadi", () => {
    expect(friendlyError(undefined, "Xatolik")).toBe("Xatolik");
    expect(friendlyError({}, "Xatolik")).toBe("Xatolik");
  });
});
