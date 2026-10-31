/** drizzle-kit introspect chiqaradigan src/db/schema.ts ni tuzatadi:
 *  1) bo'sh satr defaulti `.default(')` — generator xatosi, `.default('')` bo'ladi;
 *  2) neon_auth."user" jadvali introspectga kirmaydi, lekin tashqi kalitlar unga
 *     havola qiladi — `userInNeonAuth` eksporti qo'shiladi (fayl oxiriga);
 *  3) bytea ustunlari `unknown("...")` bo'lib chiqadi (generator bytea'ni taniydi
 *     deb o'ylamaymiz) — `bytea("...")` ga almashtiriladi.
 *  Introspectdan keyin har safar ishlatiladi (qarang: scripts/neon-sync.mjs). */
import fs from "node:fs";

const FILE = "src/db/schema.ts";
let s = fs.readFileSync(FILE, "utf8");

const emptyDefaults = (s.match(/\.default\('\)/g) ?? []).length;
s = s.split(".default(')").join(".default('')");

if (!s.includes("pgSchema")) {
  s = s.replace(/import \{[^}]*\} from "drizzle-orm\/pg-core"/, (m) => m.replace("import {", "import { pgSchema,"));
}

// bytea → drizzle-orm'da haqiqiy tur; unknown() kompilyatsiya bo'lmaydi.
const byteaColumns = (s.match(/\/\/ TODO: failed to parse database type 'bytea'/g) ?? []).length;
if (byteaColumns) {
  s = s.replace(/\/\/ TODO: failed to parse database type 'bytea'\n(\s*)(\w+): unknown\(/g, "$1$2: bytea(");
  if (!s.includes("const bytea = customType")) {
    s = s.replace(/import \{([^}]*)\} from "drizzle-orm\/pg-core"/, (m, names) =>
      names.includes("customType") ? m : m.replace(names, `${names.trim()}, customType`),
    );
    // Drizzle 0.45 pg-core'da bytea turi yo'q — Postgres turini o'zimiz xaritalaymiz.
    s = s.replace(
      /(import \{ sql \} from "drizzle-orm"\n)/,
      '$1\nconst bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });\n',
    );
  }
}

if (!/^export const userInNeonAuth = /m.test(s)) {
  s += `
// drizzle-kit introspect neon_auth sxemasini chiqarmaydi, ammo public jadvallaridagi
// tashqi kalitlar shu jadvalga qaraydi. Blok qo'lda yozilgan (Better Auth sxemasi).
// schema.ts uni user deb, relations.ts esa generator beradigan userInNeonAuth deb
// ataydi — ikkala nom bir jadvalga qaraydi.
const neonAuth = pgSchema("neon_auth");
export const user = neonAuth.table("user", {
  id: uuid().primaryKey().notNull(),
  name: text().notNull(),
  email: text().notNull(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  role: text(),
  banned: boolean(),
  banReason: text(),
  banExpires: timestamp("banExpires", { withTimezone: true, mode: "string" }),
});
export const userInNeonAuth = user;
`;
}

fs.writeFileSync(FILE, s);
console.log(
  `tuzatildi: bo'sh defaultlar ${emptyDefaults} ta, bytea ustunlari ${byteaColumns} ta, ` +
    `neon_auth.user jadvali ${/^export const userInNeonAuth = /m.test(s) ? "qo'shildi" : "allaqachon bor"}`,
);
