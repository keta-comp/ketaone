/**
 * Telegram report bot — biznes egasining ish joyi.
 *
 * Bot saytga kirmasdan ishlaydi: kirish (email/parol yoki bir martalik havola),
 * kunlik/haftalik/oylik hisobot, Excel, bugungi qabullar va qabul qo'shish. AI
 * sotuv suhbati bu botda yuritilmaydi (u alohida kanal), shuning uchun bu modul
 * mijoz xabarlarini boshqarmaydi.
 */
import { randomBytes } from "node:crypto";

import { scrubTelegramToken, telegramCall, webhookBaseUrl } from "./telegram.server";
import {
  buildReportExcel,
  formatReportMessage,
  generateReport,
  type ReportKind,
} from "./report-service.server";

export const GENERIC_ERROR =
  "⚠️ Hisobotni yaratishda xatolik yuz berdi. Iltimos, birozdan keyin qayta urinib ko‘ring.";

export interface TelegramLinkRow {
  id: string;
  telegram_user_id: string;
  user_id: string;
  business_id: string;
  telegram_chat_id: string;
  telegram_username: string | null;
  timezone: string;
  report_time: string;
  daily_reports: boolean;
  notify_new_order: boolean;
  notify_payment: boolean;
  notify_lead: boolean;
  notify_low_stock: boolean;
  notify_booking: boolean;
  linked_at: string;
}

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: "📊 Bugungi hisobot" }, { text: "📅 Kechagi hisobot" }],
    [{ text: "📈 Haftalik hisobot" }, { text: "📆 Oylik hisobot" }],
    [{ text: "🗓 Bugungi qabullar" }, { text: "➕ Yangi qabul" }],
    [{ text: "📥 Excel yuklab olish" }, { text: "⚙️ Sozlamalar" }],
  ],
  resize_keyboard: true,
};

/** Bildirishnoma bayroqlari — bot ichidagi ⚙️ Sozlamalar tugmalari shularni yozadi. */
const NOTIFY_FLAGS = [
  { column: "notify_booking", label: "Yangi qabul" },
  { column: "notify_new_order", label: "Yangi buyurtma" },
  { column: "notify_payment", label: "To‘lov" },
  { column: "notify_lead", label: "Muhim lead" },
  { column: "notify_low_stock", label: "Ombor qoldig‘i" },
] as const;

const REPORT_TIMES = ["09:00", "12:00", "18:00", "21:00"];

export async function sendMessage(
  token: string,
  chatId: string | number,
  text: string,
  replyMarkup?: unknown,
) {
  return telegramCall<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function sendMenu(token: string, chatId: string | number, text: string) {
  return sendMessage(token, chatId, text, MAIN_KEYBOARD);
}

/** Uploads an .xlsx to the chat. Telegram needs multipart for documents. */
export async function sendDocument(
  token: string,
  chatId: string | number,
  base64: string,
  filename: string,
  caption: string,
) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append(
    "document",
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
  );
  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
  });
  if (!response.ok)
    throw new Error(
      `sendDocument failed: ${response.status} ${scrubTelegramToken(await response.text(), token)}`,
    );
}

export async function findLink(telegramUserId: string): Promise<TelegramLinkRow | null> {
  const { supabaseAdmin } = await import("@/lib/platform.server");
  const { data } = await supabaseAdmin
    .from("telegram_links")
    .select(
      "id, telegram_user_id, user_id, business_id, telegram_chat_id, telegram_username, timezone, report_time, daily_reports, notify_new_order, notify_payment, notify_lead, notify_low_stock, notify_booking, linked_at",
    )
    .eq("telegram_user_id", telegramUserId)
    .eq("status", "active")
    .maybeSingle();
  return (data as TelegramLinkRow | null) ?? null;
}

/** One-time code for the secure-link option (browser confirms, no password in chat). */
export async function createLinkRequest(input: {
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername: string | null;
}): Promise<string> {
  const { supabaseAdmin } = await import("@/lib/platform.server");
  const code = randomBytes(24).toString("base64url");
  const { error } = await supabaseAdmin.from("telegram_link_requests").insert({
    code,
    telegram_user_id: input.telegramUserId,
    telegram_chat_id: input.telegramChatId,
    telegram_username: input.telegramUsername,
  });
  if (error) throw new Error(error.message);
  return code;
}

export function linkUrl(code: string): string {
  return `${webhookBaseUrl()}/dashboard/telegram?code=${encodeURIComponent(code)}`;
}

const REPORT_TRIGGERS: { match: RegExp; kind: ReportKind }[] = [
  { match: /^(\/today|\/report|📊\s*bugungi hisobot|bugungi hisobot)$/i, kind: "today" },
  { match: /^(\/yesterday|📅\s*kechagi hisobot|kechagi hisobot)$/i, kind: "yesterday" },
  { match: /^(\/week|📈\s*haftalik hisobot|haftalik hisobot)$/i, kind: "week" },
  { match: /^(\/month|📆\s*oylik hisobot|oylik hisobot)$/i, kind: "month" },
];

const APPOINTMENTS_TRIGGER = /^(\/qabullar|🗓\s*bugungi qabullar|bugungi qabullar)$/i;
const NEW_BOOKING_TRIGGER = /^(\/yangi|➕\s*yangi qabul|yangi qabul)$/i;
const SETTINGS_TRIGGER = /^(\/settings|⚙️\s*sozlamalar|sozlamalar)$/i;
const EXCEL_TRIGGER = /^(\/excel|📥\s*excel yuklab olish|excel)$/i;

/**
 * Doimiy klaviatura tugmalari va buyruqlar. Forma bosqichidagi xabar shunga
 * o'xshasa jarayon buzilmaydi — xaberni router o'zi bajaradi, keyin forma
 * qayerda to'xtagani davom etadi.
 */
const MAIN_MENU_TEXTS = [
  ...REPORT_TRIGGERS.map((item) => item.match),
  APPOINTMENTS_TRIGGER,
  NEW_BOOKING_TRIGGER,
  SETTINGS_TRIGGER,
  EXCEL_TRIGGER,
  /^\/(help|start)\b/i,
];

export function isMainMenuText(text: string): boolean {
  const normalized = text.trim().replace(/@\w+$/, "");
  return MAIN_MENU_TEXTS.some((pattern) => pattern.test(normalized));
}

const HELP_TEXT = [
  "ℹ️ <b>KetaOne bot buyruqlari</b>",
  "",
  "/today — bugungi hisobot",
  "/yesterday — kechagi hisobot",
  "/week — haftalik hisobot",
  "/month — oylik hisobot",
  "/qabullar — bugungi qabullar ro‘yxati",
  "/yangi — yangi qabul qo‘shish",
  "/excel — Excel hisobot",
  "/settings — bildirishta sozlamalari",
  "/cancel — joriy amalni bekor qilish",
  "/help — yordam",
].join("\n");

export async function sendReport(
  token: string,
  link: TelegramLinkRow,
  kind: ReportKind,
  withExcelButton = true,
) {
  const { report, comparison } = await generateReport(link.business_id, kind, link.timezone);
  const markup = withExcelButton
    ? { inline_keyboard: [[{ text: "📥 Excel yuklab olish", callback_data: `excel:${kind}` }]] }
    : undefined;
  await sendMessage(token, link.telegram_chat_id, formatReportMessage(report, comparison), markup);
}

export async function sendExcel(token: string, link: TelegramLinkRow, kind: ReportKind) {
  const { report } = await generateReport(link.business_id, kind, link.timezone);
  const file = buildReportExcel(report);
  await sendDocument(
    token,
    link.telegram_chat_id,
    file.base64,
    file.filename,
    `📥 Excel hisobot — ${report.range.label}`,
  );
}

/* -------------------------------- sozlamalar -------------------------------- */

const SETTABLE_COLUMNS = new Set<string>(["daily_reports", ...NOTIFY_FLAGS.map((flag) => flag.column)]);

function settingsText(link: TelegramLinkRow): string {
  const onOff = (value: boolean) => (value ? "🟢" : "⚪️");
  return [
    "⚙️ <b>Sozlamalar</b>",
    "",
    `Kunlik hisobot: ${onOff(link.daily_reports)} soat <b>${link.report_time}</b>da`,
    `Vaqt mintaqasi: ${link.timezone}`,
    "",
    "Tugmani bosib bildirishnomalarni yoqing yoki o‘chiring:",
  ].join("\n");
}

function settingsMarkup(link: TelegramLinkRow) {
  return {
    inline_keyboard: [
      ...NOTIFY_FLAGS.map((flag) => [
        {
          text: `${link[flag.column] ? "🟢" : "⚪️"} ${flag.label}`,
          callback_data: `set:${flag.column}`,
        },
      ]),
      [
        { text: `${link.daily_reports ? "🟢" : "⚪️"} Kunlik hisobot`, callback_data: "set:daily_reports" },
        { text: "⏰ Vaqtni tanlash", callback_data: "time:pick" },
      ],
      [
        { text: "🗓 Bugungi qabullar", callback_data: "bookings:today" },
        { text: "◀️ Menyu", callback_data: "menu" },
      ],
    ],
  };
}

async function sendSettings(token: string, link: TelegramLinkRow) {
  await sendMessage(token, link.telegram_chat_id, settingsText(link), settingsMarkup(link));
}

/** Faqat oq ro'yxatdagi ustunlar yoziladi; qiymat qatorning joriy holatidan olinadi. */
async function toggleSetting(token: string, link: TelegramLinkRow, column: string) {
  if (!SETTABLE_COLUMNS.has(column)) return;
  const current = link[column as keyof TelegramLinkRow] === true;
  const { userClient } = await import("./pg-rest.server");
  const { error } = await userClient(link.user_id)
    .from("telegram_links")
    .update({ [column]: !current })
    .eq("id", link.id);
  if (error) {
    await sendMessage(token, link.telegram_chat_id, "⚠️ Sozlamani saqlab bo‘lmadi.");
    return;
  }
  (link as unknown as Record<string, unknown>)[column] = !current;
  await sendSettings(token, link);
}

async function changeReportTime(token: string, link: TelegramLinkRow, value: string) {
  if (value === "pick") {
    await sendMessage(token, link.telegram_chat_id, "⏰ Kunlik hisobot qaysi soatda kelsin?", {
      inline_keyboard: [REPORT_TIMES.map((time) => ({ text: time, callback_data: `time:${time}` }))],
    });
    return;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return;
  const { userClient } = await import("./pg-rest.server");
  const { error } = await userClient(link.user_id)
    .from("telegram_links")
    .update({ report_time: value, daily_reports: true })
    .eq("id", link.id);
  if (error) {
    await sendMessage(token, link.telegram_chat_id, "⚠️ Soatni saqlab bo‘lmadi.");
    return;
  }
  link.report_time = value;
  link.daily_reports = true;
  await sendSettings(token, link);
}

/* -------------------------------- marshrutlash -------------------------------- */

/**
 * Bir matn xabarini ishlaydi. Ketma-ketlik muhim: kirish suhbati parolni oladigan
 * yagona bosqich, shuning uchun u boshqa barcha buyruqlardan oldin tekshiriladi.
 */
export async function handleTelegramText(input: {
  token: string;
  chatId: number | string;
  telegramUserId: string;
  username: string | null;
  text: string;
  messageId: number | string;
}) {
  const { token, chatId, telegramUserId, username, text, messageId } = input;
  const normalized = text.trim().replace(/@\w+$/, "");

  const auth = await import("./telegram-auth.server");
  if (await auth.handleAuthText({ token, chatId, telegramUserId, username, text, messageId })) return;

  const link = await findLink(telegramUserId);
  if (!link) {
    const intro = /^\/start\b/.test(normalized)
      ? "👋 <b>KetaOne</b>ga xush kelibsiz.\n\nSaytga kirmasdan ishlang: hisobotlar, bugungi qabullar va yangi qabul — hammasi shu botda."
      : "Avval KetaOne akkauntingiz bilan kiring.";
    await auth.sendAuthIntro({ token, chatId, telegramUserId, username, intro });
    return;
  }

  const bookings = await import("./telegram-appointments.server");
  if (await bookings.handleBookingText({ token, chatId, telegramUserId, text, link })) return;

  if (String(link.telegram_chat_id) !== String(chatId)) {
    const { supabaseAdmin } = await import("@/lib/platform.server");
    await supabaseAdmin
      .from("telegram_links")
      .update({ telegram_chat_id: String(chatId) })
      .eq("id", link.id);
    link.telegram_chat_id = String(chatId);
  }

  if (/^\/start\b/.test(normalized)) {
    await sendMenu(token, chatId, "✅ Akkauntingiz ulangan. Kerakli bo‘limni tanlang:");
    return;
  }
  if (/^\/help\b/.test(normalized)) {
    await sendMenu(token, chatId, HELP_TEXT);
    return;
  }
  if (SETTINGS_TRIGGER.test(normalized)) {
    await sendSettings(token, link);
    return;
  }
  if (EXCEL_TRIGGER.test(normalized)) {
    await sendMessage(token, chatId, "📥 Qaysi davr uchun Excel kerak?", {
      inline_keyboard: [
        [
          { text: "Bugun", callback_data: "excel:today" },
          { text: "Hafta", callback_data: "excel:week" },
          { text: "Oy", callback_data: "excel:month" },
        ],
      ],
    });
    return;
  }
  if (APPOINTMENTS_TRIGGER.test(normalized)) {
    await bookings.sendTodayAppointments(token, link);
    return;
  }
  if (NEW_BOOKING_TRIGGER.test(normalized)) {
    await bookings.startQuickBooking(token, link);
    return;
  }

  const trigger = REPORT_TRIGGERS.find((item) => item.match.test(normalized));
  if (trigger) {
    await sendReport(token, link, trigger.kind);
    return;
  }

  await sendMenu(token, chatId, "Quyidagi bo‘limlardan birini tanlang 👇");
}

/** Inline tugmalar: kirish, qabul amallari, sozlamalar va Excel davri. */
export async function handleTelegramCallback(input: {
  token: string;
  callbackId: string;
  chatId: number | string;
  messageId: number | string;
  telegramUserId: string;
  username: string | null;
  data: string;
}) {
  const { token, callbackId, chatId, messageId, telegramUserId, username, data } = input;
  await telegramCall(token, "answerCallbackQuery", { callback_query_id: callbackId }).catch(() => {});

  const auth = await import("./telegram-auth.server");
  if (await auth.handleAuthCallback({ token, chatId, telegramUserId, username, data })) return;

  const link = await findLink(telegramUserId);
  if (!link) {
    await sendMessage(token, chatId, "Avval KetaOne akkauntingiz bilan kiring.");
    return;
  }

  const bookings = await import("./telegram-appointments.server");
  if (await bookings.handleAppointmentCallback({ token, chatId, messageId, link, data })) return;

  if (data === "menu") {
    await sendMenu(token, chatId, "Kerakli bo‘limni tanlang 👇");
    return;
  }
  if (data.startsWith("set:")) {
    await toggleSetting(token, link, data.slice("set:".length));
    return;
  }
  if (data.startsWith("time:")) {
    await changeReportTime(token, link, data.slice("time:".length));
    return;
  }
  const match = /^excel:(today|yesterday|week|month)$/.exec(data);
  if (!match) return;
  await sendMessage(token, chatId, "📥 Excel hisobot tayyorlanmoqda...");
  await sendExcel(token, link, match[1] as ReportKind);
}
