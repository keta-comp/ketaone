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
    expect(script.match(/if \(!apply\)/g) ?? []).toHaveLength(2);
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
