// @ts-nocheck — repo testlari shu usulda: `bun:test` uchun tur ta'rifi yo'q.
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

/** Super-admin darvozasi qog'oz ustida emas, bazoda tekshirilishini shu
 *  testlar ushlab turadi: platform_admins'da tenant roliga yozish siyosati
 *  bo'lmasligi, keyin esa ruxsatning faqat administrator skriptidan berilishi. */

const script = readFileSync("scripts/super-admin.mjs", "utf8");
const schema = readFileSync("neon/0001_neon_schema.sql", "utf8");
const functions = readFileSync("src/lib/super-admin.functions.ts", "utf8");
const server = readFileSync("src/lib/super-admin.server.ts", "utf8");
const auth = readFileSync("src/lib/auth.server.ts", "utf8");

describe("super-admin darvozasi", () => {
  test("platform_admins'da app_user faqat o'qiydi (o'zini tayinlay olmaydi)", () => {
    const policies = schema
      .split(";")
      .filter((statement) => statement.includes("public.platform_admins") && /CREATE POLICY/.test(statement));
    expect(policies.length).toBeGreaterThan(0);
    for (const statement of policies) expect(statement).toMatch(/FOR SELECT TO app_user/);
    expect(schema).toMatch(/GRANT SELECT ON public\.platform_admins TO app_user/);
    expect(schema).toMatch(/GRANT ALL ON public\.platform_admins TO app_service/);
  });

  test("skript yozishlarni --apply bilan himoya qiladi", () => {
    expect(script).toContain("insert into public.platform_admins");
    expect(script).toContain("delete from public.platform_admins");
    // Grant va revoke — faqat --apply; purge — --apply + --confirm=<email>.
    expect(script.match(/else if \(!apply\) \{/g) ?? []).toHaveLength(2);
    expect(script).toContain("if (!apply || confirmEmail !== purgeEmail)");
    expect(script).toContain('delete from neon_auth."user" where id =');
  });

  test("tekshiruv RLS ostidagi is_super_admin() orqali qilinadi", () => {
    expect(script).toContain("set local role app_user");
    expect(script).toContain("public.is_super_admin()");
  });

  test("flag nomi Node'ning own flagi bilan to'qnashmaydi", () => {
    expect(script).toContain('"--envfile="');
    expect(script).not.toContain('"--env-file="');
  });

  test("baza manzili xatolikdan ham chop etilmaydi", () => {
    expect(script).toMatch(/const scrub = \(message\) => String\(message\)\.split\(url\)/);
    expect(script).toMatch(/console\.error\(`xato: \$\{scrub/);
    expect(script).not.toMatch(/console\.log\([^)]*\burl\b/);
  });

  test("har bir server funksiyasi handler ichida tekshiradi", () => {
    const handlers = functions
      .split(/(?=export const )/)
      .filter((part) => /^export const \w+ = createServerFn/.test(part));
    expect(handlers.length).toBeGreaterThan(20);
    // amISuperAdmin — tekshiruvning o'zi, u natijani boolean qaytaradi.
    const ungated = handlers
      .filter((part) => !part.includes("requireSuperAdmin("))
      .map((part) => part.match(/^export const (\w+)/)?.[1]);
    expect(ungated).toEqual(["amISuperAdmin"]);
  });
});

describe("Bloklash haqiqiy to'siq", () => {
  test("neon_auth.user.banned + seanslar o'chiriladi", () => {
    const ban = server.slice(server.indexOf("export async function applyAccountBan"));
    expect(ban.slice(0, 900)).toMatch(/update neon_auth\."user"/);
    expect(ban).toContain("banned = ${banned}");
    expect(ban).toContain('"banReason"');
    expect(ban).toContain('delete from neon_auth.session where "userId"');
    // Bloklanmagan holatda seans o'chirilmaydi — faqat belgi tozalanadi.
    expect(ban).toMatch(/const cleared = banned/);
  });

  test("bloklov profili yangilashdan oldin qilinadi", () => {
    const handler = functions.slice(functions.indexOf("export const setUserStatus"));
    const banAt = handler.indexOf("applyAccountBan(");
    const updateAt = handler.indexOf('.from("profiles").update(');
    expect(banAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(banAt);
    expect(handler).toContain("sessionsCleared: ban.sessionsCleared");
  });

  test("sessiya tekshiruvi banned qatorini rad etadi", () => {
    expect(auth).toMatch(/if \(!row \|\| row\.banned\) return null/);
  });
});

describe("Panel bo'sh qolmasligi", () => {
  test("yangi funksiya qo'shish formasi mavjud", () => {
    const flags = readFileSync("src/routes/_authenticated/super-admin.flags.tsx", "utf8");
    // Ro'yxat bo'sh bo'lsa administrator faqat shu forma orqali chiqib ketadi.
    expect(flags).toContain("Yangi funksiya qo‘shish");
    expect(flags).toMatch(/save\.mutate\(\{ key, label, enabled: false/);
    expect(flags).toContain("disabled={!(keyIsValid && label) || save.isPending}");
    expect(flags).toMatch(/\/\^\[a-z\]\[a-z0-9_.-\]\{1,63\}\$\//);
  });

  test("audit yozuvi buzilsa xato jurnaliga tushadi", () => {
    const audit = readFileSync("src/lib/audit.server.ts", "utf8");
    expect(audit).toMatch(/console\.error\("\[audit\] failed to write log", error\);/);
    expect(audit).toContain('route: "audit-log-write"');
    expect(audit).toMatch(/level: "warning"/);
  });
});

describe("Parolni admin belgilaydi, hisobni o'chirish qaytarilmaydi", () => {
  const users = readFileSync("src/routes/_authenticated/super-admin.users.tsx", "utf8");
  const telegram = readFileSync("src/lib/telegram-auth.server.ts", "utf8");
  const authFns = readFileSync("src/lib/auth.functions.ts", "utf8");

  test("email orqali tiklash chaqiruvi hech qayerda qolmaydi", () => {
    expect(auth).not.toContain('authFetch("/forget-password"');
    expect(auth).not.toContain("export async function requestPasswordReset");
    expect(authFns).not.toContain("sendPasswordReset");
    expect(telegram).not.toContain("requestPasswordReset");
    // Bot endi parolni tiklashni va'da qilmaydi — parolsiz havolani ko'rsatadi.
    expect(telegram).not.toContain("tiklash havolasi emailingizga yuboriladi");
    expect(telegram).toContain("Email orqali parol tiklash bu serverda yo‘q");
  });

  test("set-user-password endpointi va uning 403/404 javoblari", () => {
    const fn = auth.slice(auth.indexOf("export async function adminSetPassword"));
    expect(fn).toContain('authFetch("/admin/set-user-password"');
    expect(fn).toMatch(/status === 404/);
    expect(fn).toMatch(/status === 403/);
    expect(fn).toContain("--grant=");
  });

  test("--grant Neon Auth admin rolini ham yozadi, --revoke uni qaytaradi", () => {
    const grant = script.slice(script.indexOf("findUser(grantEmail)"));
    expect(grant).toContain(`set role = 'admin'`);
    expect(grant).toContain(`if (roleAfter !== "admin")`);
    const revoke = script.slice(script.indexOf("findUser(revokeEmail)"));
    expect(revoke).toContain(`set role = 'user'`);
  });

  test("o'chirish faqat kalit so'z bilan va oxirgi adminni himoya qiladi", () => {
    const del = functions.slice(functions.indexOf("export const deletePlatformUser"));
    expect(del).toContain("if (data.id === context.userId) throw new Error");
    // Tasdiq so'zi tilga qarab yoziladi (en: DELETE), shuning uchun tekshiruv
    // bitta satrga emas, umumiy jadvalga qaraydi.
    expect(del).toContain("isDeleteConfirmation(data.confirm)");
    expect(del).toContain("preview.adminsTotal <= 1");
    expect(del).toContain("deleteAccount(data.id)");
    expect(del).toContain('action: "user_deleted"');
  });

  test("hisob o'chirish faqat auth qatorini o'chiradi, qolganini CASCADE yechadi", () => {
    const del = server.slice(server.indexOf("export async function deleteAccount"));
    expect(del).toContain('delete from neon_auth."user" where id = ${userId}::uuid returning id');
    expect(del).toContain("if (removed.length === 0)");
    // Raqamlar o'chirish bilan bir tranzaksiyada: aks holda hisobot 0 ko'rsatardi.
    expect(del).toContain("businessesDeleted:");
    expect(server).toContain("export async function previewAccountDeletion");
  });

  test("dialog parolni kamida 8 belgi va tasdiq so'zi yozilganda qabul qiladi", () => {
    expect(users).toContain("disabled={newPassword.length < 8 || setPassword.isPending}");
    expect(users).toContain("disabled={!isDeleteConfirmation(confirmText) || remove.isPending}");
    // So'z interfeys tilidan olinadi: inglizcha panelda "DELETE" so'raladi.
    expect(users).toContain("const confirmWord = t(DELETE_CONFIRM_KEY)");
    expect(users).toContain("placeholder={t(\"Tasdiq uchun {v0} deb yozing\", { v0: confirmWord })}");
    expect(users).toContain("previewUserDeletion");
    expect(users).not.toContain("sendPasswordResetFor");
  });
});
