// @ts-nocheck
/**
 * Server funksiyalaridagi ruxsat qatlamini statik tekshiruv.
 *
 * Nima uchun test faylda: UI tugmani yashirishi mumkin, lekin server funksiyani
 * chaqirishni to'xtatmaydi. Shuning uchun har bir yozuv amali (POST) kamida bitta
 * tekshiruvdan o'tishi shart: rol/ruxsat (requirePermission, can, isAdminRole,
 * loadTeam+isAdmin), biznes a'zoligi (requireBusinessId, memberContext), bo'lim
 * ko'rinishi (requireSection, requireModuleAccess) yoki platform tekshiruvi
 * (requireSuperAdmin, assertFeature). Ro'yxatdan tashqaridagi funksiya — xato.
 */
import { expect, test, describe } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LIB_DIR = fileURLToPath(new URL("./", import.meta.url));

/** Yozuv amali bo'lsa ham kirish cheklovi bo'lmaydigan funksiylar. */
const PUBLIC_WRITE_FNS = new Set([
  // Kirish/ro'yxatdan o'tish oqimi — seansi yo'q foydalanuvchi chaqiradi.
  "auth.functions.ts:signUp",
  "auth.functions.ts:signIn",
  "auth.functions.ts:signOut",
  "auth.functions.ts:sendPasswordReset",
  "auth.functions.ts:applyPasswordReset",
  // Auth quvurining o'zi yozadigan xatti-harakat jadvallari (sessiya yo'q).
  "session.functions.ts:recordLogin",
  "session.functions.ts:recordFailedLogin",
  "session.functions.ts:recordRegistration",
  // O'z profiliga bog'langan amallar: biznes emas, foydalanuvchi qatori.
  "telegram-link.functions.ts:getTelegramLinkRequest",
  "notifications.functions.ts:markAnnouncementRead",
  // Ochiq sahifa: tashqi mijozning qabul yozuvi (token + rate limit bilan).
  "public-booking.functions.ts:createPublicBooking",
  // Jamoa ichidagi ish vositasi: har a'zo o'z vazifasini yozadi, biznes chegarasi
  // va bog'langan ID'lar saveTask'ning o'zida tekshiriladi.
  "tasks.functions.ts:setTaskStatus",
  "tasks.functions.ts:deleteTask",
]);

/** Sessiyasiz o'qiy oladigan funksiylar: ochiq sahifa va kirish holati. */
const PUBLIC_READ_FNS = new Set([
  "auth.functions.ts:getAuthSession",
  "public-booking.functions.ts:getPublicBookingPage",
  "public-booking.functions.ts:getPublicSlots",
]);

const AUTHZ_MARKERS = [
  "requirePermission(",
  "requireBusinessId(",
  "requireBusinessAdmin(",
  "requireStaffAdmin(",
  "requirePayrollAdmin(",
  "requireFinanceAccess(",
  "requireSettingsAdmin(",
  "requireBranchAdmin(",
  "requireSuperAdmin(",
  "requireSection(",
  "requireModuleAccess(",
  "memberContext(",
  "isAdminRole(",
  "team.isAdmin",
];

/** So'zboshimchalik bilan emas: `can(...` chaqiruvi alohida so'z bo'lishi kerak. */
const AUTHZ_PATTERNS = [/\bcan\(/];

function parseServerFns(source) {
  const lines = source.split(/\r?\n/);
  const found = [];
  lines.forEach((line, index) => {
    const match = /^export const (\w+) = createServerFn\(\{ method: "(\w+)" \}\)/.exec(line);
    if (match) found.push({ name: match[1], method: match[2], start: index });
  });
  return found.map((entry, index) => {
    const end = found[index + 1] ? found[index + 1].start : lines.length;
    return { ...entry, body: lines.slice(entry.start, end).join("\n") };
  });
}

function collect() {
  const rows = [];
  for (const file of readdirSync(LIB_DIR)
    .filter((name) => name.endsWith(".functions.ts"))
    .sort()) {
    const source = readFileSync(`${LIB_DIR}${file}`, "utf8");
    for (const fn of parseServerFns(source)) {
      rows.push({
        key: `${file}:${fn.name}`,
        file,
        name: fn.name,
        method: fn.method,
        body: fn.body,
        hasAuthz:
          AUTHZ_MARKERS.some((marker) => fn.body.includes(marker)) ||
          AUTHZ_PATTERNS.some((pattern) => pattern.test(fn.body)),
        middleware: /middleware\(\[requireSupabaseAuth\]\)/.test(fn.body),
      });
    }
  }
  return rows;
}

describe("server funksiya ruxsat qatlami", () => {
  const rows = collect();

  test("har bir yozuv amali rol yoki biznes tekshiruvidan o'tadi", () => {
    const ungated = rows
      .filter((row) => row.method !== "GET" && !row.hasAuthz && !PUBLIC_WRITE_FNS.has(row.key))
      .map((row) => row.key);
    expect(ungated).toEqual([]);
  });

  test("ruyxatdan tashqaridagi funksiylar haqiqatan mavjud va hali ochiq", () => {
    const stale = [...PUBLIC_WRITE_FNS].filter((key) => {
      const row = rows.find((entry) => entry.key === key);
      return !row || row.hasAuthz;
    });
    expect(stale).toEqual([]);
  });

  test("yozuv amallari faqat POST orqali keladi", () => {
    const unusual = rows
      .filter((row) => row.method !== "GET" && row.method !== "POST")
      .map((row) => `${row.key} (${row.method})`);
    expect(unusual).toEqual([]);
  });

  test("ochiq funksiylardan tashqari barchasi requireSupabaseAuth oladi", () => {
    const missingMiddleware = rows
      .filter(
        (row) => !PUBLIC_WRITE_FNS.has(row.key) && !PUBLIC_READ_FNS.has(row.key) && !row.middleware,
      )
      .map((row) => row.key);
    expect(missingMiddleware).toEqual([]);
  });

  test("pul jadvallariga yozuv amali rol tekshiruvini chaqiradi", () => {
    const moneyFiles = [
      "payments.functions.ts",
      "finance.functions.ts",
      "payroll.functions.ts",
      "groups.functions.ts",
    ];
    const offenders = rows
      .filter((row) => moneyFiles.includes(row.file) && row.method !== "GET")
      .filter(
        (row) =>
          /(payments|expenses|payroll_statements|payroll_rules)"\)\.(insert|update|upsert|delete)/.test(
            row.body,
          ) &&
          !/requirePermission\(|requireFinanceAccess\(|requirePayrollAdmin\(|requireSuperAdmin\(/.test(
            row.body,
          ),
      )
      .map((row) => row.key);
    expect(offenders).toEqual([]);
  });

  /**
   * RLS chet biznesning qatorini ko'rsatmaydi, lekin bizning qatorimizga begona
   * FK ID'sini yozishga to'shmaydi — natijada qator bizniki bo'lib, bog'lamasi
   * begona biznesga ketadi. Shuning uchun FK ustunini yozuvchi har bir fayl
   * kamida bitta biznes bo'yicha tekshiruv (.eq("business_id")) qilishi shart.
   */
  const TENANT_FK_COLUMN =
    /\b(customer_id|assigned_member_id|service_id|product_id|employee_id|branch_id|category_id|course_id|group_id|order_id|lead_id|student_id)\s*:/;

  /** Bu fayldagi `service_id` — bazaning ustuni emas, Click to'lov tizimi parametri. */
  const FK_COLUMN_EXEMPT_FILES = new Set(["billing.functions.ts"]);

  test("FK ustunini yozuvchi fayl biznes bo'yicha tekshiruv qiladi", () => {
    const offenders = readdirSync(LIB_DIR)
      .filter((name) => name.endsWith(".functions.ts") && !FK_COLUMN_EXEMPT_FILES.has(name))
      .filter((name) => {
        const source = readFileSync(`${LIB_DIR}${name}`, "utf8");
        const writesRows = /\.(insert|update|upsert)\(/.test(source);
        return writesRows && TENANT_FK_COLUMN.test(source) && !source.includes('.eq("business_id"');
      });
    expect(offenders).toEqual([]);
  });
});
