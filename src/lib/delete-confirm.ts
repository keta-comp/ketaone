/** Hisobni butunlay o'chirishni tasdiqlovchi so'z.
 *
 *  Panel bu so'zni interfeys tilida ko'rsatadi (uz: O‘CHIRISH, en: DELETE),
 *  server esa hammasini qabul qiladi — ikkala tomon shu jadvaldan foydalanadi,
 *  shuning uchun tarjima bilan tekshiruv bir-biridan ajralib ketmaydi. */
export const DELETE_CONFIRM_WORDS = ["O‘CHIRISH", "DELETE", "УДАЛИТЬ", "Ó‘SHIRIW"];

/** UI kaliti — o'zbekcha manba satr, tarjima jadvali uni boshqa tilga o'giradi. */
export const DELETE_CONFIRM_KEY = "O‘CHIRISH";

/** “O‘CHIRISH”dagi tipografik apostrof klaviaturada yo'q, shuning uchun uni
 *  oddiy ' ga tenglashtiramiz: foydalanuvchi O'CHIRISH deb yozsa ham o'tadi. */
function normalize(value: string) {
  return value.toUpperCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

const ACCEPTED = new Set(DELETE_CONFIRM_WORDS.map(normalize));

export function isDeleteConfirmation(value: string) {
  return ACCEPTED.has(normalize(value));
}
