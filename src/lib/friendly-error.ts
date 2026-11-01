/**
 * Ekranga chiqadigan xato matnini tanlaydi.
 *
 * Serverda o'zbek tilida ataylab yozilgan xabarlar (masalan «Logotip hajmi
 * 2 MB dan kichik bo'lsin.») foydalanuvchiga foydali. Node, Postgres va zod
 * ichidan chiqqan xabarlar esa — «The "string" argument must be of type
 * string...», «relation ... does not exist» — faqat chalg'itadi: ularni
 * yashiramiz, tafsilot server logida va error_events jadvalida qoladi.
 */
const INTERNAL_PATTERNS: RegExp[] = [
  /must be of type/i,
  /must be a [a-z]/i,
  /argument must be/i,
  /is not a function/i,
  /is not defined/i,
  /is not an object/i,
  /cannot read propert/i,
  /cannot convert/i,
  /cannot access /i,
  /cannot use .*before/i,
  /unexpected token/i,
  /unexpected end/i,
  /unexpected character/i,
  /invalid input syntax/i,
  /invalid [a-z_ ]*uuid/i,
  /does not exist/i,
  /syntax error/i,
  /duplicate key/i,
  /violates .*constraint/i,
  /permission denied/i,
  /row-level security/i,
  /json object requested/i,
  /failed to fetch/i,
  /networkerror/i,
  /load failed/i,
  /err_[a-z_]+/i,
  /typeerror|referenceerror|rangeerror|syntaxerror/i,
  /^\s*at\s|\n\s+at\s/,
  /zoderror|validation failed/i,
  /\[pg\]/i,
  /serialized error/i,
  /httperror/i,
  /operation was aborted/i,
  /timed? ?out/i,
  /econn|epipehang|socket hang up/i,
  /could not connect/i,
  /connection terminated/i,
  /current business_id/i,
  /["{}]/,
];

export function isInternalErrorText(message: string): boolean {
  return INTERNAL_PATTERNS.some((pattern) => pattern.test(message));
}

/** `error` odamlar tushunadigan xabarmi — shuni qaytaradi, bo'lmasa `fallback`. */
export function friendlyError(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw.trim();
  if (!message || isInternalErrorText(message)) {
    if (message) console.warn("[xato] foydalanuvchiga ko'rsatilmadi:", message);
    return fallback;
  }
  return message;
}
