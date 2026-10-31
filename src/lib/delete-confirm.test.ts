// @ts-nocheck — repo testlari shu usulda: `bun:test` uchun tur ta'rifi yo'q.
import { describe, expect, test } from "bun:test";

import { DELETE_CONFIRM_WORDS, isDeleteConfirmation } from "./delete-confirm";

/** Qaytarib bo'lmaydigan amaldagi yagona to'siq — tasdiq so'zi. U hem UI
 *  tiliga qarab turli so'z bo'ladi, hem klaviaturada tipografik apostrof
 *  yo'q; shuning uchun qabul qilish qatori keng, rad etish esa qattiq. */
describe("o'chirishni tasdiqlovchi so'z", () => {
  test("har bir interfeys tilidagi so'z qabul qilinadi", () => {
    for (const word of DELETE_CONFIRM_WORDS) expect(isDeleteConfirmation(word)).toBe(true);
  });

  test("katta-kichik va qo'shimcha bo'sh joy ahamiyatli emas", () => {
    expect(isDeleteConfirmation("  delete \n")).toBe(true);
    expect(isDeleteConfirmation("удалить")).toBe(true);
  });

  test("oddiy apostrof bilan yozilsa ham o'tadi", () => {
    expect(isDeleteConfirmation("O'CHIRISH")).toBe(true);
    expect(isDeleteConfirmation("Ó'SHIRIW")).toBe(true);
  });

  test("boshqa so'z rad etiladi", () => {
    for (const wrong of ["", "O‘CHIR", "DELETEE", "bloklash", "ha"]) {
      expect(isDeleteConfirmation(wrong)).toBe(false);
    }
  });
});
