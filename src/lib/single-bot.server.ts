/**
 * Single-bot mode. The platform serves ONE Telegram bot whose token lives in the
 * TELEGRAM_BOT_TOKEN server secret. No token is ever stored in the database or
 * exposed to the browser.
 */
import { createHmac } from "node:crypto";

import { getMe, getWebhookInfo, webhookBaseUrl } from "./telegram.server";

export const SINGLE_WEBHOOK_PATH = "/api/public/telegram/webhook";

/**
 * Secret Telegram has to echo back in `x-telegram-bot-api-secret-token`.
 * TELEGRAM_WEBHOOK_SECRET wins when it is set, so the secret can be rotated
 * without touching the bot token; otherwise it is derived from the token by
 * HMAC, which needs no extra configuration and never leaves the server.
 * scripts/telegram-setup.mjs repeats this exact formula — keep both in step.
 */
export function singleBotHeaderSecret(token: string): string {
  const explicit = process.env["TELEGRAM_WEBHOOK_SECRET"]?.trim();
  if (explicit) return explicit;
  return createHmac("sha256", token).update("telegram-webhook").digest("base64url");
}

export function singleWebhookUrl(): string {
  return `${webhookBaseUrl()}${SINGLE_WEBHOOK_PATH}`;
}

export function singleBotToken(): string {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  if (!token) {
    console.error("[telegram] TELEGRAM_BOT_TOKEN is not configured");
    throw new Error("Telegram boti vaqtincha sozlanmagan — administratorga murojaat qiling.");
  }
  return token.trim();
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

export type BotWebhookState = "not_configured" | "ok" | "missing" | "wrong_url" | "unreachable";

export type BotWebhookStatus = {
  /** TELEGRAM_BOT_TOKEN mavjud va Telegram uni qabul qilyapti. */
  configured: boolean;
  username: string | null;
  webhook: BotWebhookState;
  pendingUpdates: number;
  /** Telegramning oxirgi yetkazish xatosi — maxfiy ma'lumot yo'q, faqat sabab. */
  lastError: string | null;
};

const NOT_CONFIGURED: BotWebhookStatus = {
  configured: false,
  username: null,
  webhook: "not_configured",
  pendingUpdates: 0,
  lastError: null,
};

let statusCache: { at: number; value: BotWebhookStatus } | null = null;
const STATUS_TTL_MS = 60_000;

/**
 * Read-only bot health for the CRM status card. setWebhook is deliberately NOT
 * called from a request: pointing the production webhook is an admin action that
 * runs through scripts/telegram-setup.mjs with explicit approval.
 */
export async function inspectSingleBotWebhook(): Promise<BotWebhookStatus> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  if (!process.env["TELEGRAM_BOT_TOKEN"]) {
    return NOT_CONFIGURED;
  }
  const token = singleBotToken();
  try {
    const [me, info] = await Promise.all([getMe(token), getWebhookInfo(token)]);
    const expected = singleWebhookUrl();
    const status: BotWebhookStatus = {
      configured: true,
      username: me.username ?? null,
      webhook: !info.url ? "missing" : info.url === expected ? "ok" : "wrong_url",
      pendingUpdates: info.pending_update_count ?? 0,
      lastError: info.last_error_message ?? null,
    };
    statusCache = { at: Date.now(), value: status };
    return status;
  } catch (error) {
    console.error("[telegram] bot status check failed", error);
    return { ...NOT_CONFIGURED, lastError: "unreachable" };
  }
}
