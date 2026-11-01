// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { jsonObjectOf } from "./pg-rest.server";

describe("jsonObjectOf — jsonb ustuniga satr bilan yozish", () => {
  test("JSON.stringify qilingan konfiguratsiyani obyektga qaytaradi", () => {
    const config = { presetId: "playstation", modules: [] };
    expect(jsonObjectOf(JSON.stringify(config))).toEqual(config);
  });

  test("filtr uchun yozilgan satr ham obyektga aylanadi", () => {
    expect(jsonObjectOf(JSON.stringify({ customer_id: "9c1f" }))).toEqual({ customer_id: "9c1f" });
    expect(jsonObjectOf(JSON.stringify([{ key: "bilyard" }]))).toEqual([{ key: "bilyard" }]);
  });

  test("JSON bo'lmagan matn o'z holicha qoladi (undefined => chaqiruvchi hal qiladi)", () => {
    expect(jsonObjectOf("Salom")).toBeUndefined();
    expect(jsonObjectOf("42")).toBeUndefined();
    expect(jsonObjectOf("null")).toBeUndefined();
  });
});
