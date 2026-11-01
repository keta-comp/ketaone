// @ts-nocheck
/**
 * Har bir qabul Telegram'ga borishini statik tekshiradi.
 *
 * Nima uchun test faylda: kartochka yuborish qabul yaratilgan joyning o'zida bo'lishi
 * kerak — aks holda qabulxona sahifasidan yozilgan mijoz haqida xodimlarning xabari
 * bo'lmaydi. Qabul yaratadigan to'rt yo'l bor (CRM, umumiy modul yozuvchisi, ommaviy
 * sahifa, bot), shuning uchun ro'yxatdan tashqaridagi yangi `appointments` insert
 * joyi shu testni buzadi va eslatib turadi.
 */
import { expect, test, describe } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LIB_DIR = fileURLToPath(new URL("./", import.meta.url));
const SRC_DIR = fileURLToPath(new URL("../", import.meta.url));

/** `appointments` jadvaliga qator qo'shadigan fayllar (kartochka yuborishi shart). */
const BOOKING_WRITERS = [
  "appointments.functions.ts",
  "crm-backed.ts",
  "public-booking.functions.ts",
  "telegram-appointments.server.ts",
];

function sourceOf(rel) {
  return readFileSync(`${LIB_DIR}${rel}`, "utf8");
}

function tsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) out.push(...tsFiles(`${full}/`));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function notifies(source) {
  return source.includes("sendAppointmentCardById(") || source.includes("sendBookingCard(");
}

describe("qabul Telegram kartochkasi", () => {
  test("qabul yozuvchilarining hammasi kartochka yuboradi", () => {
    for (const file of BOOKING_WRITERS) {
      const source = sourceOf(file);
      expect(source.includes('from("appointments")') || source.includes('table === "appointments"'),
        `${file} qabul yaratmaydi`).toBe(true);
      expect(notifies(source), `${file} Telegram kartochkasini yubormaydi`).toBe(true);
    }
  });

  test("qabul yaratadigan boshqa fayl paytasa — kartochka qo'shish kerak", () => {
    const offenders = tsFiles(SRC_DIR)
      .filter((path) => !BOOKING_WRITERS.some((file) => path.endsWith(file)))
      .filter((path) => /from\("appointments"\)[\s\S]{0,200}?\.insert\(/.test(readFileSync(path, "utf8")))
      .filter((path) => !notifies(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  test("kartochkada tasdiqlash, bekor qilish va mijoz tugmalari bor", () => {
    const source = sourceOf("telegram-appointments.server.ts");
    for (const action of ["appt:confirm", "appt:cancel", "appt:customer"]) {
      expect(source, `${action} tugmasi yo'q`).toContain(action);
    }
  });

  test("kartochka yuborish qabul yaratishni buzmaydi — xato ushlab, 0 qaytadi", () => {
    const helper = /export async function sendAppointmentCardById\([\s\S]*?\n\}/.exec(
      sourceOf("telegram-appointments.server.ts"),
    )[0];
    expect(helper).toContain("catch");
    expect(helper).toContain("return 0");
  });
});
