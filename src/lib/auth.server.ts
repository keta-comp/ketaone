// Neon Auth (hosted Better Auth) bilan ishlash qatlami.
//
// Oqim butunlay server tomonida: brauzer Better Auth bilan to'g'ridan-to'g'ri
// gaplashmaydi, biz o'z domenimizda HttpOnly cookie saqlaymiz. Sessiya haqiqiyligi
// har so'rovda Neon'dagi `neon_auth.session` jadvalidan tekshiriladi — tashqi
// tarmoq chaqiruvi kerak emas.
import { deleteCookie, getCookie, getRequestUrl, setCookie } from "@tanstack/react-start/server";

import { ownerSql } from "./db";

const COOKIE = "keta_session";
const UPSTREAM_COOKIE = "__Secure-neon-auth.session_token";
const MAX_AGE = 60 * 60 * 24 * 7;

export type AuthSession = { userId: string; email: string; name: string | null };

function authBase(): string {
  const base = process.env["NEON_AUTH_ISSUER"];
  if (!base) throw new Error("NEON_AUTH_ISSUER muhit o'zgaruvchisi sozlanmagan.");
  return base.replace(/\/+$/, "");
}

function origin(): string {
  try {
    return getRequestUrl().origin;
  } catch {
    return "http://localhost:8080";
  }
}

type AuthResponse = { status: number; body: unknown; cookie: string | null };

/** Better Auth `callbackURL` nisbiy bo'lsa Origin sarlavhasini talab qiladi. */
async function authFetch(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; cookie?: string | null },
): Promise<AuthResponse> {
  const headers: Record<string, string> = { Origin: origin() };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.cookie) headers["Cookie"] = `${UPSTREAM_COOKIE}=${init.cookie}`;

  const request: RequestInit = { method: init.method, headers };
  if (init.body !== undefined) request.body = JSON.stringify(init.body);
  const response = await fetch(`${authBase()}${path}`, request);

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 300) };
    }
  }

  const raw = response.headers.getSetCookie?.() ?? [];
  const match = raw
    .map((entry) => entry.split(";")[0] ?? "")
    .find((pair) => pair.startsWith(`${UPSTREAM_COOKIE}=`));

  return { status: response.status, body, cookie: match ? match.slice(UPSTREAM_COOKIE.length + 1) : null };
}

function persist(cookie: string) {
  setCookie(COOKIE, cookie, {
    httpOnly: true,
    secure: origin().startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

function upstreamUserId(body: unknown): string {
  const user = (body as { user?: { id?: unknown } } | null)?.user;
  return typeof user?.id === "string" ? user.id : "";
}

function upstreamMessage(body: unknown, fallback: string): string {
  const raw = (body as { message?: unknown } | null)?.message;
  const message = typeof raw === "string" ? raw : null;
  if (!message) return fallback;
  // Better Auth xabarlari inglizcha — eng keng tarqalganlari tarjima qilinadi.
  if (/already exists|already registered/i.test(message)) return "Bu email allaqachon ro'yxatdan o'tgan.";
  if (/invalid email or password|invalid credentials/i.test(message)) return "Email yoki parol xato.";
  if (/password/i.test(message) && /short|length/i.test(message))
    return "Parol juda qisqa — kamida 8 belgi kiriting.";
  if (/user not found/i.test(message)) return "Bunday foydalanuvchi topilmadi.";
  return message;
}

export async function signUpWithPassword(input: { email: string; password: string; name: string }) {
  const response = await authFetch("/sign-up/email", {
    method: "POST",
    body: { email: input.email, password: input.password, name: input.name },
  });
  if (response.status >= 400 || !response.cookie) {
    throw new Error(upstreamMessage(response.body, "Ro'yxatdan o'tish amalga oshmadi."));
  }
  persist(response.cookie);
  return { userId: upstreamUserId(response.body) };
}

async function verifyPassword(input: { email: string; password: string }): Promise<{ userId: string; cookie: string }> {
  const response = await authFetch("/sign-in/email", {
    method: "POST",
    body: { email: input.email, password: input.password },
  });
  const userId = upstreamUserId(response.body);
  if (response.status >= 400 || !response.cookie || !userId) {
    throw new Error(upstreamMessage(response.body, "Email yoki parol xato."));
  }
  return { userId, cookie: response.cookie };
}

export async function signInWithPassword(input: { email: string; password: string }) {
  const { userId, cookie } = await verifyPassword(input);
  persist(cookie);
  return { userId };
}

/**
 * Brauzersiz kirish tekshiruvi (Telegram boti). Cookie saqlanmaydi va tekshiruv uchun
 * ochilgan sessiya darhol yopiladi — botda ishonch manbai faqat telegram_links
 * yozuvi, parol esa hech qayerda qolmaydi.
 */
export async function authenticateWithoutSession(input: { email: string; password: string }) {
  const { userId, cookie } = await verifyPassword(input);
  await authFetch("/sign-out", { method: "POST", body: {}, cookie }).catch(() => {});
  return { userId };
}

export async function signOut() {
  const cookie = getCookie(COOKIE);
  if (cookie) {
    try {
      await authFetch("/sign-out", { method: "POST", body: {}, cookie });
    } catch {
      // Tashqi chaqiruv muvaffaqiyatsiz bo'lsa ham lokal cookie o'chiriladi.
    }
  }
  deleteCookie(COOKIE, { path: "/" });
}

/** Parolni token bilan yangilash.
 *
 *  "Havola yuborish" funksiyasi o'chirildi: Neon Auth hosting'da
 *  `/forget-password` route'i mavjud emas (404), chunki email transporti
 *  sozlanmagan. Xabari kelmaydigan tugmani ko'rsatish — production'da
 *  ishlamaydigan funksiya demo qilish bo'lardi. Parolni admin belgilaydi
 *  (`adminSetPassword`), bu funksiya esa token qo'lga topsa ishlaydi. */
export async function resetPassword(token: string, newPassword: string) {
  const response = await authFetch("/reset-password", {
    method: "POST",
    body: { token, newPassword },
  });
  if (response.status >= 400) {
    throw new Error(upstreamMessage(response.body, "Parol yangilanmadi."));
  }
}

/** Administrator parolni o'zi belgilaydi.
 *
 *  `/admin/set-user-password` mavjud — u chaqiruvchining sessiyasida
 *  `role = "admin"` bo'lishini talab qiladi, shuning uchun `--grant` shu rolni
 *  ham yozadi. */
export async function adminSetPassword(userId: string, newPassword: string) {
  const cookie = getCookie(COOKIE);
  if (!cookie) throw new Error("Sessiya topilmadi — qaytadan kiring.");
  const response = await authFetch("/admin/set-user-password", {
    method: "POST",
    body: { userId, newPassword },
    cookie,
  });
  if (response.status === 404)
    throw new Error("Neon Auth admin plagini yoqish kerak — parol almashtirish endpointi topilmadi.");
  if (response.status === 403)
    throw new Error(
      "Sizning hisobingizda admin roli yo'q: node scripts/super-admin.mjs --grant=<email> --apply ni qayta ishga tushiring.",
    );
  if (response.status >= 400) {
    throw new Error(upstreamMessage(response.body, "Parol almashtirilmadi."));
  }
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const cookie = getCookie(COOKIE);
  if (!cookie) throw new Error("Sessiya topilmadi — qaytadan kiring.");
  const response = await authFetch("/change-password", {
    method: "POST",
    body: { currentPassword, newPassword, revokeOtherSessions: true },
    cookie,
  });
  if (response.status >= 400) {
    throw new Error(upstreamMessage(response.body, "Parol yangilanmadi."));
  }
}

/** Cookie'dagi sessiya tokenini Neon'dagi Better Auth jadvaliga solishtiradi. */
export async function currentSession(): Promise<AuthSession | null> {
  const cookie = getCookie(COOKIE);
  if (!cookie) return null;
  const token = cookie.split(".")[0];
  if (!token) return null;

  const rows = await ownerSql()<{ user_id: string; email: string; name: string | null; banned: boolean | null }[]>`
    select s."userId" as user_id, u.email, u.name, u.banned
    from neon_auth.session s
    join neon_auth."user" u on u.id = s."userId"
    where s.token = ${token} and s."expiresAt" > now()
    limit 1
  `;
  const row = rows[0];
  if (!row || row.banned) return null;
  return { userId: row.user_id, email: row.email, name: row.name };
}

export async function requireSession(): Promise<AuthSession> {
  const session = await currentSession();
  if (!session) throw new Error("Unauthorized: sessiya topilmadi");
  return session;
}
