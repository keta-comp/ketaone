// Telegram botni bir marta ishga tushiradi: getMe → getWebhookInfo → setWebhook → /buyruqlar.
//
//   node scripts/telegram-setup.mjs              # faqat tekshiradi, hech narsa o'zgarmaydi
//   node scripts/telegram-setup.mjs --apply      # webhook'ni haqiqatan o'zgartiradi
//   node scripts/telegram-setup.mjs --url=https://sayt.uz   # manzilni qo'ldan beradi
//   node scripts/telegram-setup.mjs --envfile=.env.vercel  # token'ni boshqa fayldan o'qiydi
//
// `vercel env pull .env.vercel --environment=production` bilan tortib olingan kalitlarni
// `.env.local` ustiga yozish xavfsiz emas (lokal muhit production bazasiga qaraydi),
// shuning uchun alohida fayl o'qish mumkin.
//
// Flag nomi `--envfile`, `--env-file` emas: Node o'zagi `--env-file`ni yutib
// qo'yadi va skript argumentlarigacha yetmaydi.
//
// Xavfsizlik: token va maxfiy so'z chop etilmaydi. Webhook sarlavha maxfiy so'zi
// TELEGRAM_WEBHOOK_SECRET bo'lsa o'sha, bo'lmasa token'dan HMAC bilan hisoblanadi —
// src/lib/single-bot.server.ts dagi singleBotHeaderSecret() bilan AYNAN bir xil,
// aks holda webhook 401 qaytaradi.
import { createHmac } from "node:crypto";
import fs from "node:fs";

const API = "https://api.telegram.org";
const WEBHOOK_PATH = "/api/public/telegram/webhook";
const DEFAULT_PUBLIC_URL = "https://www.nexora-crm.uz";
const SECRET_SALT = "telegram-webhook";

const envFileArg = process.argv.find((arg) => arg.startsWith("--envfile="));
const ENV_FILES = envFileArg
  ? [envFileArg.slice("--envfile=".length)]
  : [".env.local", ".env"];

function envFromLocal() {
  const vars = {};
  for (const file of ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"([^"]*)"/);
      if (match && !vars[match[1]]) vars[match[1]] = match[2];
    }
  }
  return vars;
}

const local = envFromLocal();
const env = (key) => (process.env[key] || local[key] || "").trim();

const token = env("TELEGRAM_BOT_TOKEN");
if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
  throw new Error("TELEGRAM_BOT_TOKEN topilmadi yoki noto'g'ri formatda (.env.local ga yozing)");
}

const urlArg = process.argv.find((arg) => arg.startsWith("--url="));
const baseUrl = (urlArg ? urlArg.slice("--url=".length) : env("PUBLIC_APP_URL") || DEFAULT_PUBLIC_URL)
  .replace(/\/$/, "");
if (!/^https:\/\/.+/.test(baseUrl))
  throw new Error("Webhook manzili https:// bilan boshlanishi shart (Telegram faqat HTTPS'ni qabul qiladi)");

const webhookUrl = `${baseUrl}${WEBHOOK_PATH}`;
// singleBotHeaderSecret() ning aynan takrori: ustunlik TELEGRAM_WEBHOOK_SECRET'da.
const secretToken =
  env("TELEGRAM_WEBHOOK_SECRET") ||
  createHmac("sha256", token).update(SECRET_SALT).digest("base64url");
const secretSource = env("TELEGRAM_WEBHOOK_SECRET") ? "TELEGRAM_WEBHOOK_SECRET" : "token'dan HMAC";

async function call(method, body = {}) {
  const response = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  const description = json?.description ? String(json.description).split(token).join("[token]") : null;
  if (!json?.ok) throw new Error(`${method}: ${description ?? `HTTP ${response.status}`}`);
  return json.result;
}

const apply = process.argv.includes("--apply");

console.log(`Kutilgan webhook: ${webhookUrl}`);
console.log(`Maxfiy so'z manbasi: ${secretSource} (qiymati ko'rsatilmaydi)`);

const me = await call("getMe");
const before = await call("getWebhookInfo");

console.log(`Bot: @${me.username} (id ${me.id})`);
console.log(`Hozirgi webhook: ${before.url || "(o'rnatilmagan)"}`);
console.log(`Navbatdagi yangilanishlar: ${before.pending_update_count}`);
if (before.last_error_message) {
  console.log(`Oxirgi xato: ${before.last_error_message.split(token).join("[token]")}`);
}

if (before.url === webhookUrl) {
  console.log("Webhook manzili to'g'ri — maxfiy so'z Telegram tomonida tekshirilmaydi, u yerdagi");
  console.log("qiymat shu skript yuborgan bilan bir xil bo'lishi kerak.");
}

if (!apply) {
  console.log("\nHech narsa o'zgartirilmadi. Webhook'ni o'rnatish uchun: --apply qo'shib yuring.");
  process.exit(0);
}

const setResult = await call("setWebhook", {
  url: webhookUrl,
  secret_token: secretToken,
  allowed_updates: ["message", "edited_message", "callback_query"],
  drop_pending_updates: true,
  max_connections: 100,
});
console.log(`\nsetWebhook: ${setResult ? "OK" : "javob tushunarsiz"}`);

// Bot menyupidagi /buyruqlar — HELP_TEXT (src/lib/telegram-report.server.ts) bilan bir xil ro'yxat.
await call("setMyCommands", {
  commands: [
    { command: "today", description: "Bugungi hisobot" },
    { command: "yesterday", description: "Kechagi hisobot" },
    { command: "week", description: "Haftalik hisobot" },
    { command: "month", description: "Oylik hisobot" },
    { command: "qabullar", description: "Bugungi qabullar" },
    { command: "yangi", description: "Yangi qabul qo'shish" },
    { command: "excel", description: "Excel hisobot" },
    { command: "settings", description: "Bildirishnoma sozlamalari" },
    { command: "cancel", description: "Joriy amalni bekor qilish" },
    { command: "help", description: "Yordam" },
  ],
});
console.log("setMyCommands: OK");

const after = await call("getWebhookInfo");
console.log(`\n@${me.username} tayyor → ${after.url}`);
console.log(
  after.url === webhookUrl
    ? "Telegram endi shu manzilga so'rov yuboradi. Botga /start yozib sinab ko'ring."
    : "DIQQAT — Telegram boshqa manzilni ko'rsatyapti, qayta urinib ko'ring.",
);
