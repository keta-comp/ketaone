// Super Admin darvozasi: platform_admins jadvalini boshqaradi.
//
//   node scripts/super-admin.mjs --list                    # kimlar admin, kimlar mavjud
//   node scripts/super-admin.mjs --grant=egis@sayt.uz      # qanday o'zgarish bo'lishini ko'rsatadi
//   node scripts/super-admin.mjs --grant=egis@sayt.uz --apply
//   node scripts/super-admin.mjs --revoke=egis@sayt.uz --apply
//   node scripts/super-admin.mjs --purge=egis@sayt.uz      # nima yo'qolishini ko'rsatadi
//   node scripts/super-admin.mjs --purge=egis@sayt.uz --apply --confirm=egis@sayt.uz
//   node scripts/super-admin.mjs --envfile=.env.prod       # kalitni boshqa fayldan o'qiydi
//
// Nima uchun skript: platform_admins bo'sh bo'lsa /super-admin sahifasi hamma uchun
// 403 beradi va ichkaridan tuzatib bo'lmaydi (o'z ruxsatingizni o'sha sahifadan
// so'ray olasiz). Yozish faqat service-level — jadvalda app_user uchun INSERT
// siyosati yo'q. Xavfsizlik: baza manzili hech qayerda chop etilmaydi.
//
// --grant neon_auth."user".role = 'admin' ni ham yozadi: Neon Auth'ning
// /admin/set-user-password endpointi shu rolni talab qiladi, platform_admins
// qatori esa faqat o'sha sessiyani sahifaga kiritadi.
//
// Flag nomi `--envfile`, `--env-file` emas: Node o'zagi `--env-file`ni yutib qo'yadi.
import fs from "node:fs";

import postgres from "postgres";

const envFileArg = process.argv.find((arg) => arg.startsWith("--envfile="));
const ENV_FILES = envFileArg ? [envFileArg.slice("--envfile=".length)] : [".env.local", ".env"];

function envFromLocal() {
  const vars = {};
  for (const file of ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S*))\s*$/);
      if (!match || vars[match[1]]) continue;
      vars[match[1]] = (match[2] ?? match[3] ?? match[4]).trim();
    }
  }
  return vars;
}

const local = envFromLocal();
const url = (process.env["NEON_DATABASE_URL"] || local["NEON_DATABASE_URL"] || "").trim();

/** Xato ishga tushirish yordamchi singan stack iz emas, toza satr ko'rsatsin. */
function fail(message) {
  console.error(`xato: ${message}`);
  process.exit(1);
}

if (!url) fail("NEON_DATABASE_URL topilmadi (.env.local ga yozing)");

const apply = process.argv.includes("--apply");
const flag = (name) => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3).trim().toLowerCase() : null;
};
const grantEmail = flag("grant");
const revokeEmail = flag("revoke");
const purgeEmail = flag("purge");
const confirmEmail = flag("confirm");
const chosen = [grantEmail, revokeEmail, purgeEmail].filter(Boolean);
if (chosen.length > 1) fail("--grant, --revoke va --purge birga ishlatilmaydi");
const listOnly = process.argv.includes("--list") || chosen.length === 0;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
for (const email of [grantEmail, revokeEmail, purgeEmail, confirmEmail]) {
  if (email && !EMAIL_RE.test(email)) fail(`Email noto'g'ri ko'rinadi: ${email}`);
}

/** Baza xatoliklarida connection string qaytib kelishi mumkin — uni o'chiramiz. */
const scrub = (message) => String(message).split(url).join("[baza manzili]");

const sql = postgres(url, { connect_timeout: 20, max: 1 });
let failed = false;

async function showList() {
  const admins = await sql`select email, user_id, created_at from public.platform_admins order by created_at`;
  console.log(`platform_admins: ${admins.length} ta qator`);
  for (const a of admins) console.log(`  ${a.email ?? "—"}  (${a.user_id})`);
  const accounts = await sql`select p.id, p.full_name as name, p.email, p.status,
                                    coalesce(u.role, 'user') as auth_role, coalesce(u.banned, false) as banned
                               from public.profiles p
                               left join neon_auth."user" u on u.id = p.id
                              order by p.created_at limit 50`;
  console.log(`\nprofillar (${accounts.length} ta):`);
  for (const u of accounts)
    console.log(
      `  ${u.email}  — ${u.name ?? "ismsiz"}  [${u.status}]  role=${u.auth_role}${u.banned ? "  BLOKLANGAN" : ""}  ${u.id}`,
    );
}

async function findUser(email) {
  const rows = await sql`select id, email, full_name as name from public.profiles
                          where lower(email) = lower(${email}) limit 2`;
  return rows[0] ?? null;
}

/** RLS ostida tekshirish: aynan shu funksiyani server funksiyalari chaqiradi. */
async function amSuperAdmin(userId) {
  return sql.begin(async (tx) => {
    await tx`set local role app_user`;
    await tx`select set_config('app.user_id', ${userId}, true)`;
    const [{ value }] = await tx`select public.is_super_admin()::text as value`;
    return value === "true";
  });
}

/** Neon Auth rolini o'qiydi — admin plugini parolni almashtirish shu rolga qaraydi. */
async function authRole(userId) {
  const rows = await sql`select role from neon_auth."user" where id = ${userId}::uuid`;
  return rows.length ? (rows[0].role ?? "user") : null;
}

/** O'chirishdan oldin nima yo'qolishini sanaydi (CASCADE zonalari bilan). */
async function deletionPreview(userId) {
  const [stats] = await sql`
    select (select count(*)::int from public.businesses        where owner_id = ${userId}::uuid) as owned,
           (select count(*)::int from public.business_members  where user_id  = ${userId}::uuid) as memberships,
           (select count(*)::int from public.platform_admins   where user_id  = ${userId}::uuid) as admin_rows,
           (select count(*)::int from public.platform_admins)                    as admins_total,
           (select count(*)::int from neon_auth.session         where "userId" = ${userId}::uuid) as sessions`;
  return stats;
}

try {
  if (listOnly) {
    await showList();
  } else if (purgeEmail) {
    const user = await findUser(purgeEmail);
    if (!user) throw new Error(`Hisob topilmadi: ${purgeEmail}. Avval --list bilan tekshiring.`);
    const stats = await deletionPreview(user.id);
    console.log(`${purgeEmail} (${user.id}) uchun o'chirish ro'yxati:`);
    console.log(`  egasi bo'lgan bizneslar: ${stats.owned}  (har birining mijozlari, bronlari, to'lovlari, fayllari ham ketadi)`);
    console.log(`  a'zoliklar:              ${stats.memberships}`);
    console.log(`  sessiyalar:              ${stats.sessions}`);
    console.log(`  super admin qatori:      ${stats.admin_rows ? "bor" : "yo'q"}`);
    if (stats.admin_rows && stats.admins_total <= 1)
      throw new Error("Bu — platformadagi oxirgi administrator. Uni o'chirish /super-admin darvozani ham yopadi.");
    if (!apply || confirmEmail !== purgeEmail) {
      console.log(
        apply
          ? `\nSINOV: ehtiyot bo'ling. Ro'yxatdagi emailni --confirm=<email> bilan takror yozing.`
          : `\nSINOV: hech narsa o'chirilmadi. --apply va --confirm=${purgeEmail} qo'shing.`,
      );
    } else {
      const removed = await sql`delete from neon_auth."user" where id = ${user.id}::uuid returning id`;
      if (removed.length === 0) throw new Error("Qator o'chilmadi — hisob topilmadi.");
      const left = await sql`select 1 from public.profiles where id = ${user.id}::uuid`;
      if (left.length > 0) throw new Error("Hisob o'chirildi, ammo profil qatori qoldi — CASCADE siyosatini tekshiring.");
      const adminsLeft = await sql`select count(*)::int as n from public.platform_admins`;
      console.log(`ok: ${purgeEmail} o'chirildi. platform_adminsda ${adminsLeft[0].n} ta admin qoldi.`);
    }
  } else if (revokeEmail) {
    const user = await findUser(revokeEmail);
    if (!user) throw new Error(`Hisob topilmadi: ${revokeEmail}`);
    const existing = await sql`select 1 from public.platform_admins where user_id = ${user.id}`;
    const role = await authRole(user.id);
    if (existing.length === 0 && role !== "admin") {
      console.log(`${revokeEmail} allaqachon super admin emas.`);
    } else if (!apply) {
      console.log(
        `SINOV: o'chiriladi ${revokeEmail} (${user.id}) — platform_admins qatori va neon_auth roli "${role}" → "user". Bajarish uchun --apply qo'shing.`,
      );
    } else {
      await sql`delete from public.platform_admins where user_id = ${user.id}`;
      await sql`update neon_auth."user" set role = 'user', "updatedAt" = now() where id = ${user.id}::uuid`;
      const still = await amSuperAdmin(user.id);
      if (still) throw new Error("O'chirildi, ammo is_super_admin() hali true — RLS/siyosatni tekshiring.");
      const roleAfter = await authRole(user.id);
      if (roleAfter === "admin")
        throw new Error("platform_admins tozalandi, ammo neon_auth roli 'admin' qoldi — parol endpointi ochiq qoladi.");
      console.log(`ok: ${revokeEmail} super admin emas (is_super_admin() = false, role = ${roleAfter}).`);
    }
  } else {
    const user = await findUser(grantEmail);
    if (!user) throw new Error(`Hisob topilmadi: ${grantEmail}. Avval --list bilan tekshiring.`);
    const before = await amSuperAdmin(user.id);
    const roleBefore = await authRole(user.id);
    if (before && roleBefore === "admin") {
      console.log(`${grantEmail} allaqachon super admin — o'zgartirish kerak emas.`);
    } else if (!apply) {
      console.log(
        `SINOV: ${grantEmail} (${user.id}) super admin qilinadi va neon_auth roli "${roleBefore}" → "admin" bo'ladi. Ro'yxatga olish uchun --apply qo'shing.`,
      );
    } else {
      await sql`insert into public.platform_admins (user_id, email)
                values (${user.id}, ${user.email}) on conflict (user_id) do nothing`;
      await sql`update neon_auth."user" set role = 'admin', "updatedAt" = now() where id = ${user.id}::uuid`;
      const after = await amSuperAdmin(user.id);
      if (!after) throw new Error("Qator yozildi, ammo is_super_admin() false — RLS siyosatini tekshiring.");
      const roleAfter = await authRole(user.id);
      if (roleAfter !== "admin")
        throw new Error("platform_admins yozildi, ammo neon_auth roli 'admin' bo'lmadi — parolni almashtirish 403 beradi.");
      console.log(`ok: ${grantEmail} super admin (is_super_admin() = true, role = admin).`);
      console.log("Sahifaga kirish uchun qaytadan kiring: /super-admin");
    }
  }
} catch (error) {
  failed = true;
  console.error(`xato: ${scrub(error?.message ?? error)}`);
} finally {
  await sql.end({ timeout: 5 }).catch(() => undefined);
}

// Undici keep-alive socketi Windows'da yopilishda 127 exit beradi — chiqishni o'zimiz belgilaymiz.
process.exit(failed ? 1 : 0);
