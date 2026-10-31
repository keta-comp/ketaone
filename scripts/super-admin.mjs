// Super Admin darvozasi: platform_admins jadvalini boshqaradi.
//
//   node scripts/super-admin.mjs --list                    # kimlar admin, kimlar mavjud
//   node scripts/super-admin.mjs --grant=egis@sayt.uz      # qanday o'zgarish bo'lishini ko'rsatadi
//   node scripts/super-admin.mjs --grant=egis@sayt.uz --apply
//   node scripts/super-admin.mjs --revoke=egis@sayt.uz --apply
//   node scripts/super-admin.mjs --envfile=.env.prod       # kalitni boshqa fayldan o'qiydi
//
// Nima uchun skript: platform_admins bo'sh bo'lsa /super-admin sahifasi hamma uchun
// 403 beradi va ichkaridan tuzatib bo'lmaydi (o'z ruxsatingizni o'sha sahifadan
// so'ray olasiz). Yozish faqat service-level — jadvalda app_user uchun INSERT
// siyosati yo'q. Xavfsizlik: baza manzili hech qayerda chop etilmaydi.
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
const listOnly = process.argv.includes("--list") || (!grantEmail && !revokeEmail);
if (grantEmail && revokeEmail) fail("--grant va --revoke birga ishlatilmaydi");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
for (const email of [grantEmail, revokeEmail]) {
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
  const accounts = await sql`select id, full_name as name, email, status, created_at
                               from public.profiles order by created_at limit 50`;
  console.log(`\nprofillar (${accounts.length} ta):`);
  for (const u of accounts) console.log(`  ${u.email}  — ${u.name ?? "ismsiz"}  [${u.status}]  ${u.id}`);
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

try {
  if (listOnly) {
    await showList();
  } else if (revokeEmail) {
    const user = await findUser(revokeEmail);
    if (!user) throw new Error(`Hisob topilmadi: ${revokeEmail}`);
    const existing = await sql`select 1 from public.platform_admins where user_id = ${user.id}`;
    if (existing.length === 0) {
      console.log(`${revokeEmail} allaqachon super admin emas.`);
    } else if (!apply) {
      console.log(`SINOV: o'chiriladi ${revokeEmail} (${user.id}). Ro'yxatdan chiqarish uchun --apply qo'shing.`);
    } else {
      await sql`delete from public.platform_admins where user_id = ${user.id}`;
      const still = await amSuperAdmin(user.id);
      if (still) throw new Error("O'chirildi, ammo is_super_admin() hali true — RLS/siyosatni tekshiring.");
      console.log(`ok: ${revokeEmail} super admin emas (is_super_admin() = false).`);
    }
  } else {
    const user = await findUser(grantEmail);
    if (!user) throw new Error(`Hisob topilmadi: ${grantEmail}. Avval --list bilan tekshiring.`);
    const before = await amSuperAdmin(user.id);
    if (before) {
      console.log(`${grantEmail} allaqachon super admin — o'zgartirish kerak emas.`);
    } else if (!apply) {
      console.log(`SINOV: ${grantEmail} (${user.id}) super admin qilinadi. Ro'yxatga olish uchun --apply qo'shing.`);
    } else {
      await sql`insert into public.platform_admins (user_id, email)
                values (${user.id}, ${user.email}) on conflict (user_id) do nothing`;
      const after = await amSuperAdmin(user.id);
      if (!after) throw new Error("Qator yozildi, ammo is_super_admin() false — RLS siyosatini tekshiring.");
      console.log(`ok: ${grantEmail} super admin (is_super_admin() = true).`);
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
