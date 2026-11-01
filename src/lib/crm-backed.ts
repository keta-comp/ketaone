/**
 * CRM modullarini yadro jadvallariga ulaydigan qatlam (`module.table`).
 *
 * "To'lovlar" va "Qabul" avval `crm_records` ichida yashagan, shuning uchun ular haqiqiy
 * `payments`/`appointments` jadvalini o'qiydigan Ish ekrani KPI'larida, Moliyada, Hisobotlarda,
 * "Qabul va bron" kalendarida va ombora bron sahifasida ko'rinmas edi. Bu qatlam yozuvni bevosita
 * yadro jadvaliga yozadi va uni modul jadvali ko'rinishida (id, title, stage, data, created_at)
 * qaytaradi; ustun xaritasiga tushmagan maydonlar jadvalning `data` ustunida saqlanadi.
 */

import { relationIdKey, type CrmModule } from "./crm-config";
import {
  DEFAULT_BUSINESS_TZ,
  appointmentEnd,
  dayWindows,
  fitsInWindows,
  zonedParts,
} from "./booking";

type Sb = {
  from: (table: string) => any;
};

/** Ustun xaritasidagi maydon kalitlari — sohalarda bir xil ma'no turli nom bilan yuritiladi. */
const CUSTOMER_KEYS = ["kim", "mijoz", "bemor", "mijoz_ismi", "bemor_ismi", "oquvchi", "buyurtchi"];
const DATE_KEYS = ["sana", "qabul_sanasi", "kun", "muddat"];
const TIME_KEYS = ["vaqt", "vaqti", "boshlanish", "soat"];
const DURATION_KEYS = ["davomiylik", "davomiyligi", "duration"];
const EMPLOYEE_KEYS = ["shifokor", "usta", "xodim", "mutaxassis", "briga"];
const SERVICE_KEYS = ["xizmat", "bolim", "hizmat", "service", "protsedura"];
const OBJECT_KEYS = ["obyekt", "obyekti", "uy"];
const PRICE_KEYS = ["tolov", "narx", "summa", "qiymat", "baho"];
const STATUS_KEYS = ["holat", "status", "vaziyat"];
const METHOD_KEYS = ["tur", "tolov_turi", "usuli", "method"];
const NOTE_KEYS = ["izoh", "note", "izohlar", "koment"];

/** Tashkentda yozgi/qishki vaqt almashinuvi yo'q — doim +05:00. */
const TZ_OFFSET = "+05:00";

const PAYMENT_STATUS: Record<string, string> = {
  "To‘landi": "paid",
  "Tolandi": "paid",
  "To'langan": "paid",
  Qisman: "partial",
  "To‘lanmagan": "pending",
  "To'lanmagan": "pending",
  Kutilmoqda: "pending",
  "Qaytarildi": "refunded",
};
const PAYMENT_STATUS_LABEL: Record<string, string> = {
  paid: "To‘landi",
  partial: "Qisman",
  pending: "To‘lanmagan",
  refunded: "Qaytarildi",
};

const PAYMENT_METHOD: Record<string, string> = {
  Naqd: "cash",
  Karta: "card",
  "Pul o‘tkazma": "transfer",
  "Pul o'tkazma": "transfer",
  "O'tkazma": "transfer",
  Boshqa: "other",
};
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Naqd",
  card: "Karta",
  transfer: "Pul o‘tkazma",
  other: "Boshqa",
};

const APPOINTMENT_STATUS: Record<string, string> = {
  Yangi: "new",
  Navbatda: "new",
  Rejalashtirildi: "confirmed",
  Tasdiqlangan: "confirmed",
  "Tasdiqlanmagan": "new",
  Qabulda: "arrived",
  Keldi: "arrived",
  Boshlandi: "arrived",
  Yakunlandi: "completed",
  "Bo‘lib o‘tdi": "completed",
  "Bo'lib o'tdi": "completed",
  Tayyor: "completed",
  "Olib ketildi": "completed",
  "Bekor qilindi": "cancelled",
  Bekor: "cancelled",
  Kelmadi: "no_show",
};

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function numberValue(value: unknown): number | null {
  // Bo'sh satr Number("") hisobida 0 bo'ladi — mavjud bo'lmagan qiymat sifatida qaytaramiz.
  const raw = text(value).replace(/[\s_]/g, "");
  if (raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function pick(data: Record<string, unknown>, keys: string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = text(data[key]);
    if (value) return { key, value };
  }
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Relation maydoni tanlanganida `<key>_id` da UUID saqlanadi. */
function relationUuid(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = text(data[relationIdKey(key)] || data[key]);
    if (UUID_RE.test(value)) return value;
  }
  return null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** ISO vaqtni biznes zonasining kuniga (YYYY-MM-DD) aylantiradi. */
function zonedDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_BUSINESS_TZ }).format(new Date(iso));
}

/** ISO vaqtni biznes zonasining soatiga (HH:MM) aylantiradi. */
function zonedClock(iso: string): string {
  const value = new Intl.DateTimeFormat("en-GB", {
    timeZone: DEFAULT_BUSINESS_TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
  return value.slice(0, 5);
}

function todayZoned(): string {
  return zonedDay(new Date().toISOString());
}

/** Kiritilgan sana/vaqtni tekshirib, +05:00 offsetli ISO boshlanish yasaydi. */
function startsAtFrom(day: string, time: string): string {
  const safeDay = DAY_RE.test(day) ? day : todayZoned();
  const match = TIME_RE.exec(time);
  const hour = match ? Number(match[1]) : 9;
  const minute = match ? Number(match[2]) : 0;
  if (hour > 23 || minute > 59) return `${safeDay}T09:00:00${TZ_OFFSET}`;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${safeDay}T${pad(hour)}:${pad(minute)}:00${TZ_OFFSET}`;
}

export type CrmRecordView = {
  id: string;
  title: string;
  stage: string | null;
  data: Record<string, unknown>;
  created_at: string;
};

async function findByName(sb: Sb, table: "customers" | "employees", businessId: string, name: string): Promise<string | null> {
  const { data: rows } = await sb
    .from(table)
    .select("id")
    .eq("business_id", businessId)
    .ilike("full_name", name)
    .limit(1);
  return (rows ?? [])[0]?.id ?? null;
}

/**
 * Relation maydoni UUID'i `crm_records` yozuviga ham ishora qilishi mumkin — noto'g'ri
 * foreign key bo'lmasligi uchun id nihaoyat shu jadvalda topilgandagina ishlatiladi,
 * aks holda izm nom bo'yicha qidiriladi.
 */
async function resolveId(
  sb: Sb,
  table: "customers" | "employees",
  businessId: string,
  uuid: string | null,
  name: string,
): Promise<string | null> {
  if (uuid) {
    const { data: rows } = await sb
      .from(table)
      .select("id")
      .eq("id", uuid)
      .eq("business_id", businessId)
      .limit(1);
    if ((rows ?? []).length > 0) return uuid;
  }
  return name ? findByName(sb, table, businessId, name) : null;
}

/* -------------------------------- payments -------------------------------- */

function paymentView(row: any, _module: CrmModule): CrmRecordView {
  const data: Record<string, unknown> = { ...(row.data ?? {}) };
  const customerName = text(row.customers?.full_name);
  const amount = Number(row.amount ?? 0);
  const day = row.paid_at ? zonedDay(row.paid_at) : text(row.due_date).slice(0, 10);
  const holat = PAYMENT_STATUS_LABEL[row.status] ?? "";
  const tur = PAYMENT_METHOD_LABEL[row.method] ?? "";

  for (const key of CUSTOMER_KEYS) {
    if (row.customer_id) {
      if (customerName) data[key] = customerName;
      data[relationIdKey(key)] = row.customer_id;
    } else if (!text(data[key]) && row.note) {
      data[key] = row.note;
    }
  }
  data["summa"] = amount;
  for (const key of DATE_KEYS) data[key] = day;
  for (const key of STATUS_KEYS) if (holat) data[key] = holat;
  for (const key of METHOD_KEYS) if (tur) data[key] = tur;
  for (const key of NOTE_KEYS) if (row.note !== null && row.note !== undefined) data[key] = row.note;

  const stored = CUSTOMER_KEYS.map((key) => text(row.data?.[key])).find(Boolean);
  const title = customerName || stored || "To‘lov";
  return {
    id: row.id,
    title: `${title} · ${amount.toLocaleString("ru-RU")}`,
    stage: null,
    data,
    created_at: row.created_at,
  };
}

async function paymentColumns(
  sb: Sb,
  businessId: string,
  userId: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const who = pick(data, CUSTOMER_KEYS);
  const amount = numberValue(data["summa"] ?? pick(data, PRICE_KEYS)?.value) ?? 0;
  const status = PAYMENT_STATUS[text(pick(data, STATUS_KEYS)?.value)] ?? "pending";
  const paid = status === "paid" || status === "partial";
  const day = text(pick(data, DATE_KEYS)?.value);
  const safeDay = DAY_RE.test(day) ? day : todayZoned();
  const note = pick(data, NOTE_KEYS)?.value ?? "";
  const method = PAYMENT_METHOD[text(pick(data, METHOD_KEYS)?.value)] ?? "cash";
  const customerId = await resolveId(
    sb,
    "customers",
    businessId,
    relationUuid(data, CUSTOMER_KEYS),
    who?.value ?? "",
  );

  const row: Record<string, unknown> = {
    business_id: businessId,
    customer_id: customerId,
    amount,
    method,
    status,
    // Mijoz topilmaganda ismini note'da saqlaymiz — aksi holda yozuv kimsasiz qoladi.
    note: note || (customerId ? "" : (who?.value ?? "")),
    paid_at: paid ? `${safeDay}T12:00:00${TZ_OFFSET}` : null,
    due_date: paid ? null : safeDay,
    created_by: userId,
    data,
  };
  return row;
}

/* ------------------------------ appointments ------------------------------ */

function appointmentView(row: any, module: CrmModule): CrmRecordView {
  const data: Record<string, unknown> = { ...(row.data ?? {}) };
  const customerName = text(row.customers?.full_name);
  const day = zonedDay(row.starts_at);
  const time = zonedClock(row.starts_at);
  const serviceName = row.service_name ?? row.services?.name ?? "";
  const holat = labelForStatus(module, row.status);

  for (const key of CUSTOMER_KEYS) {
    if (row.customer_id) {
      if (customerName) data[key] = customerName;
      data[relationIdKey(key)] = row.customer_id;
    }
  }
  for (const key of DATE_KEYS) data[key] = day;
  for (const key of TIME_KEYS) data[key] = time;
  for (const key of DURATION_KEYS) data[key] = row.duration_minutes ?? "";
  if (row.employee_id) {
    const employeeName = text(row.employees?.full_name);
    for (const key of EMPLOYEE_KEYS) {
      if (employeeName) data[key] = employeeName;
      data[relationIdKey(key)] = row.employee_id;
    }
  }
  if (serviceName) {
    for (const key of [...SERVICE_KEYS, ...OBJECT_KEYS]) data[key] = serviceName;
  }
  for (const key of PRICE_KEYS) {
    data[key] = row.price === null || row.price === undefined ? "" : Number(row.price);
  }
  for (const key of STATUS_KEYS) if (holat) data[key] = holat;
  if (row.note) for (const key of NOTE_KEYS) data[key] = row.note;

  const stored = CUSTOMER_KEYS.map((key) => text(row.data?.[key])).find(Boolean);
  const title = customerName || stored || serviceName || "Qabul";
  return {
    id: row.id,
    title: `${title} · ${day} ${time}`,
    stage: null,
    data,
    created_at: row.created_at,
  };
}

/** Modul o'z variantlarini saqlab qoladi: ustun qiymatini forma lug'atiga qaytaramiz. */
function labelForStatus(module: CrmModule, status: string): string {
  for (const key of STATUS_KEYS) {
    const field = (module.fields ?? []).find((f) => f.key === key);
    const match = (field?.options ?? []).find((option) => APPOINTMENT_STATUS[option] === status);
    if (match) return match;
  }
  return Object.entries(APPOINTMENT_STATUS).find(([, value]) => value === status)?.[0] ?? status;
}

async function appointmentColumns(
  sb: Sb,
  businessId: string,
  userId: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const startsAt = startsAtFrom(text(pick(data, DATE_KEYS)?.value), text(pick(data, TIME_KEYS)?.value));
  const rawDuration = numberValue(pick(data, DURATION_KEYS)?.value);
  const duration = rawDuration && rawDuration > 0 ? Math.round(rawDuration) : 30;
  const who = pick(data, CUSTOMER_KEYS);
  const worker = pick(data, EMPLOYEE_KEYS);
  const service = pick(data, [...SERVICE_KEYS, ...OBJECT_KEYS]);
  const price = numberValue(pick(data, PRICE_KEYS)?.value);
  const status = APPOINTMENT_STATUS[text(pick(data, STATUS_KEYS)?.value)] ?? "confirmed";
  const endsAt = appointmentEnd(startsAt, duration);

  const customerId = await resolveId(
    sb,
    "customers",
    businessId,
    relationUuid(data, CUSTOMER_KEYS),
    who?.value ?? "",
  );
  const employeeId = await resolveId(
    sb,
    "employees",
    businessId,
    relationUuid(data, EMPLOYEE_KEYS),
    worker?.value ?? "",
  );
  if (employeeId) await assertEmployeeAvailable(sb, employeeId, startsAt, duration);

  return {
    business_id: businessId,
    customer_id: customerId,
    employee_id: employeeId,
    service_name: service?.value ?? null,
    price,
    duration_minutes: duration,
    starts_at: startsAt,
    ends_at: endsAt,
    status,
    note: pick(data, NOTE_KEYS)?.value ?? "",
    created_by: userId,
    data,
  };
}

/** Xodim ta'tilda yoki ish jadvalidan tashqarida bo'lsa — qabulni shu yerda to'xtatamiz. */
async function assertEmployeeAvailable(
  sb: Sb,
  employeeId: string,
  startsAt: string,
  duration: number,
): Promise<void> {
  const endsAt = appointmentEnd(startsAt, duration);
  const [{ data: timeOff }, { data: schedule }] = await Promise.all([
    sb
      .from("time_off")
      .select("id")
      .eq("employee_id", employeeId)
      .lt("starts_at", endsAt)
      .gt("ends_at", startsAt),
    sb
      .from("work_schedules")
      .select("weekday, start_time, end_time, break_start, break_end")
      .eq("employee_id", employeeId),
  ]);
  if ((timeOff ?? []).length > 0) throw new Error("Xodim bu vaqtda ta'tilda.");

  const days = schedule ?? [];
  if (days.length === 0) return; // jadval sozlanmagan — cheklov yo'q

  const { weekday, minutes } = zonedParts(startsAt, DEFAULT_BUSINESS_TZ);
  const windows = dayWindows(days.filter((row: any) => row.weekday === weekday));
  if (windows.length === 0) throw new Error("Xodim bu kunda ishlamaydi.");
  if (!fitsInWindows(minutes, duration, windows)) {
    throw new Error("Qabul xodim ish vaqtidan tashqarida.");
  }
}

/* --------------------------------- public --------------------------------- */

export function backedTableOf(module: CrmModule | undefined): "payments" | "appointments" | null {
  if (!module || module.link) return null;
  return module.table ?? null;
}

/** Eski saqlangan konfiguratsiyalarda `table` bo'lmasligi mumkin — sahifa jadvalni belgilaydi. */
const LINKED_CORE_TABLE: Record<string, "payments" | "appointments"> = {
  "/dashboard/appointments": "appointments",
  "/dashboard/payments": "payments",
};

/**
 * Dashboard vidjetlari yozuvlarni qayerda saqlashini emas, qayerdan o'qishini aniqlaydi:
 * presetlarning `qabul`/`to'lovlar` moduli yadro jadvalida ham, sahifaga ham bog'langan,
 * shuning uchun bunda `link` jadvalni bekor qilmaydi.
 */
export function widgetTableOf(module: CrmModule | undefined): "payments" | "appointments" | null {
  if (!module) return null;
  if (module.table) return module.table;
  return module.link ? (LINKED_CORE_TABLE[module.link] ?? null) : null;
}

const SELECT: Record<"payments" | "appointments", string> = {
  payments: "*, customers(id, full_name, phone)",
  appointments:
    "*, customers(id, full_name, phone), employees:employee_id(id, full_name), services(id, name, duration_minutes, price)",
};

const ORDER: Record<"payments" | "appointments", { column: string; ascending: boolean }> = {
  payments: { column: "created_at", ascending: false },
  appointments: { column: "starts_at", ascending: false },
};

export async function listBackedRecords(
  sb: Sb,
  businessId: string,
  module: CrmModule,
): Promise<CrmRecordView[]> {
  const table = backedTableOf(module);
  if (!table) return [];
  const { column, ascending } = ORDER[table];
  const { data: rows, error } = await sb
    .from(table)
    .select(SELECT[table])
    .eq("business_id", businessId)
    .order(column, { ascending })
    .limit(500);
  if (error) throw new Error(error.message);
  const view = table === "payments" ? paymentView : appointmentView;
  return (rows ?? []).map((row: any) => view(row, module));
}

export async function saveBackedRecord(
  sb: Sb,
  input: {
    businessId: string;
    userId: string;
    module: CrmModule;
    id?: string | undefined;
    data: Record<string, unknown>;
  },
): Promise<{ id: string }> {
  const table = backedTableOf(input.module);
  if (!table) throw new Error("Modul yadro jadvaliga ulanmagan.");
  const row =
    table === "payments"
      ? await paymentColumns(sb, input.businessId, input.userId, input.data)
      : await appointmentColumns(sb, input.businessId, input.userId, input.data);

  if (input.id) {
    const { business_id, created_by, ...patch } = row as Record<string, unknown>;
    void business_id;
    void created_by;
    const { data: updated, error } = await sb
      .from(table)
      .update(patch)
      .eq("id", input.id)
      .eq("business_id", input.businessId)
      .select("id");
    if (error) throw new Error(conflictMessage(table, error));
    if (!(updated ?? []).length) throw new Error("Yozuv topilmadi yoki bu biznesga tegishli emas.");
    return { id: input.id };
  }

  const { data: created, error } = await sb.from(table).insert(row).select("id").single();
  if (error) throw new Error(conflictMessage(table, error));

  if (table === "appointments" && created?.id) {
    const { sendAppointmentCardById } = await import("./telegram-appointments.server");
    await sendAppointmentCardById(input.businessId, created.id, `CRM — ${input.module.label}`);
  }

  return { id: created?.id };
}

export async function deleteBackedRecord(
  sb: Sb,
  businessId: string,
  table: "payments" | "appointments",
  id: string,
): Promise<boolean> {
  const { data: deleted, error } = await sb
    .from(table)
    .delete()
    .eq("id", id)
    .eq("business_id", businessId)
    .select("id");
  if (error) throw new Error(error.message);
  return (deleted ?? []).length > 0;
}

/** Vidget sanovi/summasi yadro jadvalidan olinadi. */
export async function backedWidgetValue(
  sb: Sb,
  businessId: string,
  module: CrmModule,
  kind: "module_count" | "module_count_today" | "field_sum",
  options: {
    where?: { field: string; value: string } | undefined;
    todayStart: string;
    todayEnd: string;
  },
): Promise<number> {
  const table = widgetTableOf(module);
  if (!table) return 0;
  const sumColumn = table === "payments" ? "amount" : "price";
  let query = sb.from(table).select(kind === "field_sum" ? sumColumn : "id").eq("business_id", businessId);
  if (kind === "module_count_today") {
    // "Bugungi" — kun oralig'i: ertangi qabul yoki to'lov bugungi hisobga kirmasin.
    const column = table === "payments" ? "paid_at" : "starts_at";
    query = query.gte(column, options.todayStart).lt(column, options.todayEnd);
  }
  if (options.where) {
    const column = filterColumn(table, options.where.field, options.where.value);
    query = column ? query.eq(column[0], column[1]) : query.eq(`data->>${options.where.field}`, options.where.value);
  }
  const { data: rows, error } = await query;
  if (error) return 0;
  if (kind !== "field_sum") return (rows ?? []).length;
  return (rows ?? []).reduce((sum: number, row: any) => sum + Number(row[sumColumn] ?? 0), 0);
}

/** `where: {holat: "To'lanmagan"}` → status='pending'; xarita bo'lmasa jsonb bo'yicha solinadi. */
function filterColumn(table: "payments" | "appointments", field: string, value: string): [string, unknown] | null {
  if (!STATUS_KEYS.includes(field)) return null;
  const normalised = value.replace(/‘/g, "'");
  const lookup = table === "payments" ? PAYMENT_STATUS : APPOINTMENT_STATUS;
  const status = lookup[value] ?? lookup[normalised];
  return status ? ["status", status] : null;
}

function conflictMessage(table: "payments" | "appointments", error: { code?: string; message: string }): string {
  if (table === "appointments" && error.code === "23P01") {
    return "Bu xodim tanlangan vaqtda band — boshqa vaqt yoki xodim tanlang.";
  }
  return error.message;
}
