/**
 * Single-bot mode. The platform serves ONE Telegram bot whose token lives in the
 * TELEGRAM_BOT_TOKEN server secret. No token is ever stored in the database or
 * exposed to the browser.
 */
import { createHmac } from "node:crypto";

import { getMe, getWebhookInfo, telegramCall, webhookBaseUrl } from "./telegram.server";

export const SINGLE_WEBHOOK_PATH = "/api/public/telegram/webhook";

export function singleBotToken(): string {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) {
    console.error("[telegram] TELEGRAM_BOT_TOKEN is not configured");
    throw new Error("Telegram boti vaqtincha sozlanmagan — administratorga murojaat qiling.");
  }
  return token.trim();
}

/** Header secret Telegram must echo back. Derived from the token, so it needs no storage. */
export function singleBotHeaderSecret(token: string): string {
  return createHmac("sha256", token).update("telegram-webhook").digest("base64url");
}

export function singleWebhookUrl(): string {
  return `${webhookBaseUrl()}${SINGLE_WEBHOOK_PATH}`;
}

let businessIdCache: { at: number; value: string } | null = null;
const BUSINESS_TTL_MS = 300_000;

/** The single workspace that owns every conversation. Cached to keep the webhook fast. */
export async function singleBusinessId(): Promise<string> {
  if (businessIdCache && Date.now() - businessIdCache.at < BUSINESS_TTL_MS) return businessIdCache.value;
  const { supabaseAdmin } = await import("@/lib/platform.server");
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No business workspace exists yet");
  businessIdCache = { at: Date.now(), value: data.id };
  return data.id;
}

export async function ensureSingleBotWebhook() {
  const token = singleBotToken();
  const url = singleWebhookUrl();
  const info = await getWebhookInfo(token);
  if (info.url !== url) {
    await telegramCall(token, "setWebhook", {
      url,
      secret_token: singleBotHeaderSecret(token),
      allowed_updates: ["message", "edited_message", "callback_query"],
      drop_pending_updates: true,
      max_connections: 100,
    });
  }
  const me = await getMe(token);
  return { url, username: me.username, pending: info.pending_update_count };
}
