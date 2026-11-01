/**
 * Telegram botidagi qabullar (bronlar) bo'limi.
 *
 * Uch vazifa: bugungi qabullar ro'yxati, saytga kirmasdan tez qabul yaratish va
 * yangi qabul kartochkasini inline tugmalar bilan yetkazish. CRM ma'lumotlariga
 * faqat ulanuvchi foydalanuvchining RLS ostidagi klienti orqali tegiladi.
 */
import {
  APPOINTMENT_STATUS_LABELS,
  BOOKED_STATUSES,
  DEFAULT_BUSINESS_TZ,
  appointmentEnd,
  dayWindows,
  fitsInWindows,
  isWithinTimeOff,
  overlaps,
  zonedParts,
  type AppointmentStatus,
} from "./booking";
import { depositFor } from "./deposit";
import type { DbClient } from "./pg-rest.server";
import { editMessageText, escapeHtml, removeInlineButtons } from "./telegram.server";
import { resolveRange, zoneOffsetMinutes } from "./report-service.server";
import { isMainMenuText, sendMenu, sendMessage, type TelegramLinkRow } from "./telegram-report.server";
import { clearBotState, getBotState, setBotState, type BotBookingDraft } from "./telegram-bot-state.server";

const APPOINTMENT_SELECT =
  "id, starts_at, ends_at, status, service_name, price, note, duration_minutes, employee_id, customer_id, employees:employee_id(id, full_name), customers:customer_id(id, full_name, phone)";

const TIME_PATTERN = /(\d{1,2}):(\d{2})/;
const DATE_PATTERN = /(\d{1,2})[./-](\d{1,2})/;
const CANCEL_MARKUP = { inline_keyboard: [[{ text: "✖️ Bekor qilish", callback_data: "auth:cancel" }]] };

type AppointmentRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  service_name: string | null;
  note: string | null;
  employee_id: string | null;
  customer_id: string | null;
  employees: { id: string; full_name: string } | null;
  customers: { id: string; full_name: string; phone: string | null } | null;
};

async function rlsClient(link: TelegramLinkRow): Promise<DbClient> {
  const { userClient } = await import("./pg-rest.server");
  return userClient(link.user_id);
}

function clock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone });
}

function statusEmoji(status: string): string {
  if (status === "cancelled" || status === "no_show") return "❌";
  if (status === "completed" || status === "arrived") return "✅";
  if (status === "confirmed") return "🟢";
  return "🕓";
}

function appointmentLine(row: AppointmentRow, timeZone: string): string {
  const time = `${clock(row.starts_at, timeZone)}–${clock(row.ends_at, timeZone)}`;
  const customer = escapeHtml(row.customers?.full_name ?? "Nomaʼlum mijoz");
  const employee = escapeHtml(row.employees?.full_name ?? "Xodim tanlanmagan");
  const service = escapeHtml(row.service_name ?? "Xizmat");
  const label = APPOINTMENT_STATUS_LABELS[row.status as AppointmentStatus] ?? row.status;
  return `🕓 <b>${time}</b> — ${customer}\n   ${service} · ${employee} · ${statusEmoji(row.status)} ${label}`;
}

/* ----------------------------- bugungi qabullar ----------------------------- */

export async function sendTodayAppointments(token: string, link: TelegramLinkRow) {
  const range = resolveRange("today", link.timezone);
  const client = await rlsClient(link);
  const { data, error } = await client
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("business_id", link.business_id)
    .gte("starts_at", range.from)
    .lt("starts_at", range.to)
    .order("starts_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as AppointmentRow[];

  if (!rows.length) {
    await sendMessage(
      token,
      link.telegram_chat_id,
      `📅 <b>Bugungi qabullar</b>\n${range.label}\n\nHozircha qabul yo‘q.`,
      { inline_keyboard: [[{ text: "➕ Yangi qabul", callback_data: "book:start" }]] },
    );
    return;
  }

  const held = rows.filter((row) => row.status !== "cancelled" && row.status !== "no_show").length;
  await sendMessage(
    token,
    link.telegram_chat_id,
    `📅 <b>Bugungi qabullar</b>\n${range.label}\n\nJami: <b>${rows.length}</b> ta, bekor qilinmagan: <b>${held}</b> ta.\n\n` +
      rows.slice(0, 20).map((row) => appointmentLine(row, link.timezone)).join("\n\n"),
    {
      inline_keyboard: [
        [{ text: "➕ Yangi qabul", callback_data: "book:start" }],
        ...rows.slice(0, 8).map((row) => [
          { text: "✅", callback_data: `appt:confirm:${row.id}` },
          { text: "❌", callback_data: `appt:cancel:${row.id}` },
          { text: "👤", callback_data: `appt:customer:${row.id}` },
        ]),
      ],
    },
  );
}

/* ----------------------------- qabul kartochkasi ----------------------------- */

/**
 * Yangi qabulni biznesning qabul bildirishnomasini yoqqan barcha Telegram
 * akkauntlariga tugmalar bilan yuboradi. Hech qachon otib tashlamaydi: chaqiruvchi
 * tomon xato yutiladi, chunki bildirishta qabul muhim emas.
 *
 * `excludeTelegramUserId` — qabulni o'zi qo'shgan akkaunt. U qabulni allaqachon
 * ko'rgan: kartochka bir xil chatga ikkinchi marta qaytib kelmaydi.
 */
export async function sendBookingCard(
  businessId: string,
  appointment: {
    id: string;
    startsAt: string;
    serviceName: string;
    employeeName: string | null;
    customerName: string;
    customerPhone: string;
    source: string;
    depositAmount?: number;
  },
  excludeTelegramUserId?: string,
) {
  const [{ supabaseAdmin }, single, bot] = await Promise.all([
    import("@/lib/platform.server"),
    import("./single-bot.server"),
    import("./telegram-report.server"),
  ]);
  const { data } = await supabaseAdmin
    .from("telegram_links")
    .select("telegram_user_id, telegram_chat_id")
    .eq("business_id", businessId)
    .eq("status", "active")
    .eq("notify_booking", true);
  const allTargets = (data ?? []) as Array<{ telegram_user_id: string; telegram_chat_id: string }>;
  const targets = excludeTelegramUserId
    ? allTargets.filter((row) => row.telegram_user_id !== excludeTelegramUserId)
    : allTargets;
  if (!targets.length) return 0;

  const token = single.singleBotToken();
  const time = new Date(appointment.startsAt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DEFAULT_BUSINESS_TZ,
  });
  const text = [
    "🆕 <b>Yangi qabul</b>",
    "",
    `🕓 ${time}${appointment.employeeName ? ` — ${escapeHtml(appointment.employeeName)}` : ""}`,
    `🛠 ${escapeHtml(appointment.serviceName)}`,
    `👤 ${escapeHtml(appointment.customerName)} (${escapeHtml(appointment.customerPhone)})`,
    ...(appointment.depositAmount && appointment.depositAmount > 0
      ? [`💰 Depozit: ${appointment.depositAmount.toLocaleString("ru-RU")} so’m — <b>to‘lanmagan</b>`]
      : []),
    `📝 ${escapeHtml(appointment.source)}`,
  ].join("\n");
  const markup = {
    inline_keyboard: [
      [
        { text: "✅ Tasdiq", callback_data: `appt:confirm:${appointment.id}` },
        { text: "❌ Bekor", callback_data: `appt:cancel:${appointment.id}` },
        { text: "👤 Mijoz", callback_data: `appt:customer:${appointment.id}` },
      ],
    ],
  };
  await Promise.all(
    targets.map((row) =>
      bot.sendMessage(token, row.telegram_chat_id, text, markup).catch((error: unknown) => {
        console.error("[telegram-booking] card send failed", error);
      }),
    ),
  );
  return targets.length;
}

/**
 * Yangi qabulni ID'si bo'yicha kartochka qilib yuborish — CRM va modul sahifalari
 * faqat qatorni qo'lga kiritadi, ism/telefon/summa bazadan o'qiladi. Qabul
 * yozilgan faktidan keyingi eng oxirgi qadam: xabar borgani bilan qabul
 * yozilishi o'zarmaydi, shuning uchun barcha xatolar yutiladi.
 */
export async function sendAppointmentCardById(
  businessId: string,
  appointmentId: string,
  source: string,
  excludeTelegramUserId?: string,
): Promise<number> {
  try {
    const { supabaseAdmin } = await import("@/lib/platform.server");
    const { data } = await supabaseAdmin
      .from("appointments")
      .select("starts_at, service_name, deposit_amount, note, customers:customer_id(full_name, phone), employees:employee_id(full_name)")
      .eq("business_id", businessId)
      .eq("id", appointmentId)
      .maybeSingle();
    const row = (data ?? null) as unknown as {
      starts_at: string;
      service_name: string | null;
      deposit_amount: string | number | null;
      customers: { full_name: string; phone: string | null } | null;
      employees: { full_name: string } | null;
    } | null;
    if (!row) return 0;
    return await sendBookingCard(
      businessId,
      {
        id: appointmentId,
        startsAt: row.starts_at,
        serviceName: row.service_name ?? "Xizmat",
        employeeName: row.employees?.full_name ?? null,
        customerName: row.customers?.full_name ?? "Nomaʼlum mijoz",
        customerPhone: row.customers?.phone ?? "—",
        source,
        ...(row.deposit_amount === null ? {} : { depositAmount: Number(row.deposit_amount) }),
      },
      excludeTelegramUserId,
    );
  } catch (error) {
    console.error("[telegram-booking] card by id failed", error);
    return 0;
  }
}

/* ------------------------------- inline amallar ------------------------------- */
async function loadAppointment(link: TelegramLinkRow, id: string): Promise<AppointmentRow | null> {
  const client = await rlsClient(link);
  const { data } = await client
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("business_id", link.business_id)
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as AppointmentRow | null) ?? null;
}

/** Botdagi amallar ham sayt bilan bir xil rol tekshiruvidan o'tadi. */
async function mayManageAppointments(link: TelegramLinkRow): Promise<boolean> {
  const client = await rlsClient(link);
  const { can } = await import("./roles");
  const { data: role } = await client.rpc("business_role", { _business_id: link.business_id });
  return can(role as never, "appointments.manage");
}

async function setStatus(link: TelegramLinkRow, id: string, status: AppointmentStatus) {
  const client = await rlsClient(link);
  const { error } = await client
    .from("appointments")
    .update({ status })
    .eq("business_id", link.business_id)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function sendCustomerCard(token: string, link: TelegramLinkRow, row: AppointmentRow) {
  const customer = row.customers;
  if (!customer) {
    await sendMessage(token, link.telegram_chat_id, "👤 Bu qabulga mijoz bog‘lanmagan.");
    return;
  }
  const client = await rlsClient(link);
  const [{ count: visits }, { count: orders }] = await Promise.all([
    client
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("business_id", link.business_id)
      .eq("customer_id", customer.id),
    client
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("business_id", link.business_id)
      .eq("customer_id", customer.id),
  ]);
  await sendMessage(
    token,
    link.telegram_chat_id,
    [
      "👤 <b>Mijoz</b>",
      "",
      `Ism: <b>${escapeHtml(customer.full_name)}</b>`,
      `Telefon: <b>${escapeHtml(customer.phone ?? "—")}</b>`,
      `Qabullar: <b>${visits ?? 0}</b> ta`,
      `Buyurtmalar: <b>${orders ?? 0}</b> ta`,
    ].join("\n"),
    { inline_keyboard: [[{ text: "📅 Bugungi qabullar", callback_data: "bookings:today" }]] },
  );
}

export async function handleAppointmentCallback(input: {
  token: string;
  chatId: string | number;
  messageId: string | number;
  link: TelegramLinkRow;
  data: string;
}): Promise<boolean> {
  const { token, chatId, messageId, link, data } = input;
  if (data === "bookings:today") {
    await sendTodayAppointments(token, link);
    return true;
  }
  if (data === "book:start") {
    await startQuickBooking(token, link);
    return true;
  }
  if (data === "book:new" || data.startsWith("book:cust:")) {
    await handleCustomerChoiceCallback({ token, chatId, link, data });
    return true;
  }
  if (!data.startsWith("appt:")) return false;

  const [, action, id] = data.split(":");
  if (!id) return false;
  const row = await loadAppointment(link, id);
  if (!row) {
    await sendMessage(token, chatId, "⚠️ Bu qabul topilmadi yoki sizning biznesingizga tegishli emas.");
    return true;
  }

  if (action === "customer") {
    await sendCustomerCard(token, link, row);
    return true;
  }
  if (action !== "confirm" && action !== "cancel") return false;

  if (!(await mayManageAppointments(link))) {
    await sendMessage(token, chatId, "⛔️ Qabullarni tasdiqlash huquqi sizning rolingizda yo‘q.");
    return true;
  }

  const status: AppointmentStatus = action === "confirm" ? "confirmed" : "cancelled";
  await setStatus(link, id, status);
  const headline = action === "confirm" ? "✅ <b>Qabul tasdiqlangan</b>" : "❌ <b>Qabul bekor qilindi</b>";
  await editMessageText(
    token,
    chatId,
    messageId,
    `${headline}\n${clock(row.starts_at, link.timezone)} · ${escapeHtml(row.customers?.full_name ?? "Mijoz")}`,
  );
  await removeInlineButtons(token, chatId, messageId);
  return true;
}

/* ----------------------------- tez qabul yaratish ----------------------------- */

export async function startQuickBooking(token: string, link: TelegramLinkRow) {
  await askCustomer(token, link.telegram_user_id, link.telegram_chat_id, {});
}

/* ---------------------------- mijozni qidirish ---------------------------- */

type CustomerRow = { id: string; full_name: string | null; phone: string | null };

/** `or(...)` ifodasi vergul bilan bo'linadi — qatorga tushgan belgilar tashlanadi. */
function searchTerm(text: string): string {
  return text.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** "901234567" va "998901234567" → 9 xonali raqam; boshqa holatda null. */
function localPhone(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  if (digits.length === 9) return digits;
  if (digits.length === 12 && digits.startsWith("998")) return digits.slice(3);
  return null;
}

async function searchCustomers(
  client: DbClient,
  businessId: string,
  expression: string,
): Promise<CustomerRow[]> {
  const { data } = await client
    .from("customers")
    .select("id, full_name, phone")
    .eq("business_id", businessId)
    .or(expression)
    .limit(8);
  return (data ?? []) as unknown as CustomerRow[];
}

function customerLabel(row: CustomerRow): string {
  const name = escapeHtml((row.full_name ?? "Nomaʼlum mijoz").trim());
  const phone = row.phone ? ` · ${escapeHtml(row.phone)}` : "";
  return `${name}${phone}`;
}

async function askCustomer(token: string, telegramUserId: string, chatId: string | number, draft: BotBookingDraft) {
  await setBotState({ telegramUserId, chatId: String(chatId), step: "booking_name", data: { booking: draft } });
  await sendMessage(
    token,
    chatId,
    draft.phone
      ? `🆕 <b>Yangi mijoz</b>\n\n<b>+998${draft.phone}</b> uchun mijoz <b>ismni</b> yozing.`
      : "➕ <b>Yangi qabul</b>\n\n1-qadam: mijoz <b>ismi</b> yoki <b>telefon raqami</b>ni yozing.\n\nMasalan: <code>Aziza</code> yoki <code>901234567</code>",
    CANCEL_MARKUP,
  );
}

async function askPhone(token: string, telegramUserId: string, chatId: string | number, draft: BotBookingDraft) {
  await setBotState({ telegramUserId, chatId: String(chatId), step: "booking_phone", data: { booking: draft } });
  await sendMessage(
    token,
    chatId,
    `2-qadam: <b>${escapeHtml(draft.name ?? "mijoz")}</b> uchun <b>telefon raqami</b>ni yuboring.\n\nMasalan: <code>901234567</code>`,
    CANCEL_MARKUP,
  );
}

async function askTime(token: string, telegramUserId: string, chatId: string | number, draft: BotBookingDraft) {
  await setBotState({ telegramUserId, chatId: String(chatId), step: "booking_when", data: { booking: draft } });
  await sendMessage(
    token,
    chatId,
    `👤 <b>${escapeHtml(customerDisplayName(draft))}</b>\n\nQabul <b>vaqtini</b> yozing.\n\nMasalan: <code>30.10 15:00</code> yoki <code>ertaga 11:30</code>.`,
    CANCEL_MARKUP,
  );
}

function customerDisplayName(draft: BotBookingDraft): string {
  return draft.customerName || draft.name || "Mijoz";
}

/** Topilgan mijozlar ro'yxati — tanlansa qabul o'sha yozuvga bog'lanadi. */
async function offerCustomers(
  token: string,
  telegramUserId: string,
  chatId: string | number,
  draft: BotBookingDraft,
  rows: CustomerRow[],
) {
  const next: BotBookingDraft = { ...draft, picking: true };
  await setBotState({ telegramUserId, chatId: String(chatId), step: "booking_pick", data: { booking: next } });
  await sendMessage(
    token,
    chatId,
    `👥 <b>${rows.length}</b> ta mijoz topildi. Qaysi biriga qabul ochamiz?\n\n` +
      rows.map((row) => `• ${customerLabel(row)}`).join("\n"),
    {
      inline_keyboard: [
        ...rows.map((row) => [{ text: customerLabel(row), callback_data: `book:cust:${row.id}` }]),
        [{ text: "➕ Yangi mijoz qo‘shish", callback_data: "book:new" }],
        [{ text: "✖️ Bekor qilish", callback_data: "auth:cancel" }],
      ],
    },
  );
}

/** 1-qadam: ism yoki raqam bo'yicha mavjud mijozni qidiradi, topilmasa yangi oqimga o'tadi. */
async function handleCustomerSearch(input: {
  token: string;
  chatId: string | number;
  telegramUserId: string;
  link: TelegramLinkRow;
  draft: BotBookingDraft;
  text: string;
  picking?: boolean;
}) {
  const { token, chatId, telegramUserId, link, text } = input;
  // Ro'yxat ochiq bo'lganda vaqtni oldin yozib yuborishadi: avval mijoz kerak.
  if (input.picking && !/\p{L}/u.test(text)) {
    await sendMessage(
      token,
      chatId,
      "Avval <b>mijozni tanlang</b> ro'yxatdan yoki <b>➕ Yangi mijoz qo‘shish</b> tugmasini bosing.",
      CANCEL_MARKUP,
    );
    return;
  }
  // Oldingi tanlash qatnab qolmasligi uchun mijoz maydonlari tozalanadi.
  const draft: BotBookingDraft = { search: text.trim() };
  if (input.draft.name) draft.name = input.draft.name;
  if (input.draft.phone) draft.phone = input.draft.phone;
  const client = await rlsClient(link);
  const phone = localPhone(text);

  if (phone) {
    const rows = await searchCustomers(client, link.business_id, `phone.eq.+998${phone},phone.eq.${phone}`);
    if (rows.length) return offerCustomers(token, telegramUserId, chatId, draft, rows);
    draft.phone = phone;
    delete draft.search;
    return askCustomer(token, telegramUserId, chatId, draft);
  }

  const name = text.trim();
  if (name.length < 2 || name.length > 120) {
    await sendMessage(token, chatId, "Ismni 2–120 belgi bilan yozing yoki telefon raqamini yuboring.", CANCEL_MARKUP);
    return;
  }
  const term = searchTerm(name);
  const rows = term
    ? await searchCustomers(client, link.business_id, `full_name.ilike.%${term}%,phone.ilike.%${term}%`)
    : [];
  if (rows.length) return offerCustomers(token, telegramUserId, chatId, draft, rows);

  draft.name = name;
  delete draft.search;
  if (draft.phone) return askTime(token, telegramUserId, chatId, draft);
  return askPhone(token, telegramUserId, chatId, draft);
}

/** Mijoz ro'yxatidagi tugmalar: mavjud yozuvni tanlash yoki yangisini ochish. */
export async function handleCustomerChoiceCallback(input: {
  token: string;
  chatId: string | number;
  link: TelegramLinkRow;
  data: string;
}): Promise<void> {
  const { token, chatId, link, data } = input;
  const telegramUserId = link.telegram_user_id;
  const state = await getBotState(telegramUserId);
  const draft = state?.data.booking ?? {};
  if (state?.state !== "booking_pick") {
    await sendMessage(
      token,
      chatId,
      "⏱️ Mijoz tanlash tugagi eskirgan — <b>➕ Yangi qabul</b> tugmasidan qayta boshlang.",
    );
    return;
  }

  if (data === "book:new") {
    const search = draft.search ?? "";
    const next: BotBookingDraft = {};
    const searchPhone = localPhone(search);
    if (draft.phone) next.phone = draft.phone;
    else if (searchPhone) next.phone = searchPhone;
    if (search && !searchPhone) next.name = search;
    await sendMessage(token, chatId, `🆕 <b>Yangi mijoz</b>${next.name ? `: ${escapeHtml(next.name)}` : ""}`);
    if (next.name && next.phone) return askTime(token, telegramUserId, chatId, next);
    if (next.name) return askPhone(token, telegramUserId, chatId, next);
    return askCustomer(token, telegramUserId, chatId, next);
  }

  const customerId = data.slice("book:cust:".length);
  const client = await rlsClient(link);
  const { data: row } = await client
    .from("customers")
    .select("id, full_name, phone")
    .eq("business_id", link.business_id)
    .eq("id", customerId)
    .maybeSingle();
  const chosen = row as CustomerRow | null | undefined;
  if (!chosen) {
    await sendMessage(token, chatId, "⚠️ Bu mijoz topilmadi yoki sizning biznesingizga tegishli emas.");
    return;
  }
  await askTime(token, telegramUserId, chatId, {
    customerId: chosen.id,
    customerName: chosen.full_name ?? "Mijoz",
    customerPhone: chosen.phone ?? "",
  });
}

/** "15:00", "30.10 15:00", "ertaga 15:00" → UTC ISO. Vaqt majburiy, sana — ixtiyoriy. */
export function parseWhen(text: string, timeZone: string): string | null {
  const time = TIME_PATTERN.exec(text);
  if (!time) return null;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (hour > 23 || minute > 59) return null;

  const shift = zoneOffsetMinutes(timeZone, new Date());
  const zoneNow = new Date(Date.now() + shift * 60_000);
  let year = zoneNow.getUTCFullYear();
  let month = zoneNow.getUTCMonth() + 1;
  let day = zoneNow.getUTCDate();

  const date = DATE_PATTERN.exec(text);
  if (date) {
    day = Number(date[1]);
    month = Number(date[2]);
  } else if (/ertaga/i.test(text)) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const toUtc = (y: number, m: number, d: number) => {
    const guess = Date.UTC(y, m - 1, d, hour, minute);
    return new Date(guess - zoneOffsetMinutes(timeZone, new Date(guess)) * 60_000).toISOString();
  };
  const iso = toUtc(year, month, day);
  // Sana ko'rsatilmasa va vaqt o'tib ketgan bo'lsa — qabul ertaga boradi.
  if (!date && Date.parse(iso) <= Date.now()) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return toUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  }
  return iso;
}

type EmployeeRow = { id: string; full_name: string };

async function firstFreeEmployee(input: {
  client: DbClient;
  businessId: string;
  serviceId: string | null;
  startsAt: string;
  endsAt: string;
  duration: number;
}): Promise<{ names: string[]; chosen: EmployeeRow | null; busy: boolean }> {
  const { client, businessId, startsAt, endsAt, duration } = input;
  const [{ data: employeeRows }, capabilityResult] = await Promise.all([
    client.from("employees").select("id, full_name").eq("business_id", businessId).eq("is_active", true),
    input.serviceId
      ? client.from("employee_services").select("employee_id").eq("business_id", businessId).eq("service_id", input.serviceId)
      : Promise.resolve({ data: [] as Array<{ employee_id: string }> | null }),
  ]);
  const all = (employeeRows ?? []) as unknown as EmployeeRow[];
  const capable = new Set(((capabilityResult.data ?? []) as Array<{ employee_id: string }>).map((row) => row.employee_id));
  const employees = capable.size ? all.filter((row) => capable.has(row.id)) : all;
  const names = employees.map((row) => row.full_name);
  if (!employees.length) return { names, chosen: null, busy: false };

  const { weekday, minutes } = zonedParts(startsAt, DEFAULT_BUSINESS_TZ);
  const [scheduleResult, timeOffResult, bookedResult] = await Promise.all([
    client
      .from("work_schedules")
      .select("employee_id, start_time, end_time, break_start, break_end")
      .eq("business_id", businessId)
      .eq("weekday", weekday)
      .in("employee_id", employees.map((row) => row.id)),
    client
      .from("time_off")
      .select("employee_id, starts_at, ends_at")
      .eq("business_id", businessId)
      .lt("starts_at", endsAt)
      .gt("ends_at", startsAt),
    client
      .from("appointments")
      .select("employee_id, starts_at, ends_at, status")
      .eq("business_id", businessId)
      .lt("starts_at", endsAt)
      .gt("ends_at", startsAt),
  ]);

  const schedules = (scheduleResult.data ?? []) as unknown as Array<{
    employee_id: string;
    start_time: string;
    end_time: string;
    break_start: string | null;
    break_end: string | null;
  }>;
  const timeOff = (timeOffResult.data ?? []) as unknown as Array<{ employee_id: string; starts_at: string; ends_at: string }>;
  const booked = (bookedResult.data ?? []) as unknown as Array<{
    employee_id: string | null;
    starts_at: string;
    ends_at: string;
    status: string;
  }>;

  for (const employee of employees) {
    if (
      isWithinTimeOff(startsAt, endsAt, timeOff.filter((row) => row.employee_id === employee.id))
    ) {
      continue;
    }
    const rows = schedules.filter((row) => row.employee_id === employee.id);
    if (rows.length && !fitsInWindows(minutes, duration, dayWindows(rows))) continue;
    const taken = booked.some(
      (row) =>
        row.employee_id === employee.id &&
        BOOKED_STATUSES.has(row.status as AppointmentStatus) &&
        overlaps(startsAt, endsAt, row.starts_at, row.ends_at),
    );
    if (taken) continue;
    return { names, chosen: employee, busy: false };
  }
  return { names, chosen: null, busy: true };
}

async function findOrCreateCustomer(
  client: DbClient,
  businessId: string,
  name: string,
  phone: string,
): Promise<string | null> {
  const canonical = `+998${phone}`;
  const { data: existing } = await client
    .from("customers")
    .select("id")
    .eq("business_id", businessId)
    .in("phone", [canonical, phone])
    .limit(1)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;
  const { data: created } = await client
    .from("customers")
    .insert({ business_id: businessId, full_name: name, phone: canonical })
    .select("id")
    .maybeSingle();
  return (created as { id: string } | null)?.id ?? null;
}

async function createFromDraft(token: string, link: TelegramLinkRow, draft: BotBookingDraft, startsAt: string) {
  if (!(await mayManageAppointments(link))) {
    await sendMessage(token, link.telegram_chat_id, "⛔️ Qabul qo‘shish huquqi sizning rolingizda yo‘q.", CANCEL_MARKUP);
    return;
  }

  const client = await rlsClient(link);
  const name = (draft.name ?? draft.customerName ?? "").trim();
  const phone = (draft.phone ?? "").replace(/\D/g, "");
  const phoneLabel = phone ? `+998${phone}` : (draft.customerPhone ?? "").trim() || "raqam kiritilmagan";

  const { data: serviceRow } = await client
    .from("services")
    .select("id, name, duration_minutes, price, deposit_type, deposit_value")
    .eq("business_id", link.business_id)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();
  const service = serviceRow as
    | {
        id: string;
        name: string;
        duration_minutes: number;
        price: string | number;
        deposit_type: string;
        deposit_value: string | number;
      }
    | null
    | undefined;
  const duration = service?.duration_minutes ?? 30;
  const depositAmount = depositFor(service, service ? Number(service.price) : null);
  const endsAt = appointmentEnd(startsAt, duration);

  const { names, chosen, busy } = await firstFreeEmployee({
    client,
    businessId: link.business_id,
    serviceId: service?.id ?? null,
    startsAt,
    endsAt,
    duration,
  });
  if (busy) {
    await sendMessage(
      token,
      link.telegram_chat_id,
      `⛔️ Bu vaqtda barcha xodimlar band (${escapeHtml(names.join(", "))}).\n\nBoshqa vaqt yozing yoki /cancel bosing.`,
      CANCEL_MARKUP,
    );
    return;
  }

  // Tanlangan mijoz mavjud yozuvga bog'lanadi; yangi bo'lsa shu yerda ochiladi.
  const customerId = draft.customerId ?? (await findOrCreateCustomer(client, link.business_id, name, phone));
  const { data: created, error } = await client
    .from("appointments")
    .insert({
      business_id: link.business_id,
      service_id: service?.id ?? null,
      service_name: service?.name ?? null,
      price: service ? Number(service.price) : null,
      duration_minutes: duration,
      deposit_amount: depositAmount > 0 ? depositAmount : null,
      customer_id: customerId,
      employee_id: chosen?.id ?? null,
      starts_at: startsAt,
      ends_at: endsAt,
      status: "confirmed",
      note: "Telegram botdan qo'shildi",
      created_by: link.user_id,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23P01") {
      await sendMessage(token, link.telegram_chat_id, "⛔️ Bu vaqt endi band — boshqa vaqtni yozing.", CANCEL_MARKUP);
      return;
    }
    throw new Error(error.message);
  }

  await clearBotState(link.telegram_user_id);
  const who = customerDisplayName(draft);
  await sendMenu(
    token,
    link.telegram_chat_id,
    `✅ <b>Qabul qo‘shildi</b>\n\n${clock(startsAt, link.timezone)}–${clock(endsAt, link.timezone)}\n` +
      `${escapeHtml(who)} · ${escapeHtml(phoneLabel)}\n${escapeHtml(service?.name ?? "Xizmat")}` +
      `${chosen ? ` · ${escapeHtml(chosen.full_name)}` : ""}` +
      (depositAmount > 0 ? `\n\n💰 Depozit: ${depositAmount.toLocaleString("ru-RU")} so’m — qabulga yozilganda to‘lanadi.` : ""),
  );

  const appointmentId = (created as { id: string } | null)?.id;
  if (appointmentId) {
    await sendBookingCard(
      link.business_id,
      {
        id: appointmentId,
        startsAt,
        serviceName: service?.name ?? "Xizmat",
        employeeName: chosen?.full_name ?? null,
        customerName: who,
        customerPhone: phoneLabel,
        source: "Telegram botdan qo'shildi",
        depositAmount,
      },
      link.telegram_user_id,
    ).catch((error: unknown) => console.error("[telegram-booking] card", error));
  }
}

export async function handleBookingText(input: {
  token: string;
  chatId: string | number;
  telegramUserId: string;
  text: string;
  link: TelegramLinkRow;
}): Promise<boolean> {
  const state = await getBotState(input.telegramUserId);
  const step = state?.state;
  if (
    step !== "booking_name" &&
    step !== "booking_pick" &&
    step !== "booking_phone" &&
    step !== "booking_when"
  ) {
    return false;
  }

  const { token, chatId, telegramUserId, link } = input;
  const text = input.text.trim();
  const draft: BotBookingDraft = { ...(state?.data.booking ?? {}) };

  if (text === "/cancel" || /^\/start\b/.test(text)) {
    await clearBotState(telegramUserId);
    return false;
  }

  // Menyu tugmasi bosilsa qabul yozib olinadi, lekin bosqich o'rnida qoladi:
  // foydalanuvchi hisobotni ko'rib formsaga qaytishi mumkin.
  if (isMainMenuText(text)) return false;

  // Ism yozilgan bosqichda matn qayta qidiruv: ro'yxat ochiq bo'lsa ham,
  // boshqa nom yozib mavjud mijozni topish mumkin.
  if (step === "booking_name" || step === "booking_pick") {
    await handleCustomerSearch({
      token,
      chatId,
      telegramUserId,
      link,
      draft,
      text,
      picking: step === "booking_pick",
    });
    return true;
  }

  if (step === "booking_phone") {
    const local = localPhone(text);
    if (!local) {
      await sendMessage(
        token,
        chatId,
        "Raqam formati noto‘g‘ri. 9 belgili raqam yuboring, masalan: <code>901234567</code>",
        CANCEL_MARKUP,
      );
      return true;
    }
    draft.phone = local;
    delete draft.search;
    await askTime(token, telegramUserId, chatId, draft);
    return true;
  }

  const startsAt = parseWhen(text, link.timezone);
  if (!startsAt) {
    await sendMessage(
      token,
      chatId,
      "Vaqtni tushunmadim. Soatni ikki nuqta bilan yozing, masalan: <code>15:00</code> yoki <code>30.10 15:00</code>.",
      CANCEL_MARKUP,
    );
    return true;
  }
  await createFromDraft(token, link, draft, startsAt);
  return true;
}
