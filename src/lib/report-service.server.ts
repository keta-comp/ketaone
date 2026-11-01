/**
 * Reusable report service. One source of truth (the CRM database) feeds the web
 * reports page, the Telegram report bot and any future channel (email, etc.).
 * Every number here is computed from real rows — no demo values anywhere.
 */
import { assigneeNameMap } from "./assignee.server";
import { buildWorkbookBase64 } from "./excel.server";

export type ReportKind = "today" | "yesterday" | "week" | "month";

const MONTHS_UZ = [
  "yanvar",
  "fevral",
  "mart",
  "aprel",
  "may",
  "iyun",
  "iyul",
  "avgust",
  "sentabr",
  "oktabr",
  "noyabr",
  "dekabr",
];

/** Minutes that `timeZone` is ahead of UTC at the given instant. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second"),
    );
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch {
    return 0;
  }
}

/** Local wall-clock parts (Y/M/D H:M) in the given timezone. */
export function zoneNowParts(timeZone: string, at = new Date()) {
  const offset = zoneOffsetMinutes(timeZone, at);
  const shifted = new Date(at.getTime() + offset * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    offset,
    dateKey: shifted.toISOString().slice(0, 10),
  };
}

/** Converts a local wall-clock moment in `timeZone` to a UTC ISO string. */
function zoneToUtcIso(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): string {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offset = zoneOffsetMinutes(timeZone, new Date(guess));
  return new Date(guess - offset * 60000).toISOString();
}

export interface ReportRange {
  from: string;
  to: string;
  label: string;
  kind: ReportKind | "custom";
}

/** Date range for a report kind, always in the user's own timezone. */
export function resolveRange(kind: ReportKind, timeZone: string, at = new Date()): ReportRange {
  const now = zoneNowParts(timeZone, at);
  const dayStart = (y: number, m: number, d: number) => zoneToUtcIso(timeZone, y, m, d, 0, 0, 0, 0);
  const dayEnd = (y: number, m: number, d: number) => zoneToUtcIso(timeZone, y, m, d, 23, 59, 59, 999);
  const shiftDays = (days: number) => {
    const base = new Date(Date.UTC(now.year, now.month - 1, now.day));
    base.setUTCDate(base.getUTCDate() + days);
    return { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate() };
  };

  if (kind === "today") {
    return {
      from: dayStart(now.year, now.month, now.day),
      to: dayEnd(now.year, now.month, now.day),
      label: `${now.day}-${MONTHS_UZ[now.month - 1]}, ${now.year}`,
      kind,
    };
  }
  if (kind === "yesterday") {
    const y = shiftDays(-1);
    return {
      from: dayStart(y.y, y.m, y.d),
      to: dayEnd(y.y, y.m, y.d),
      label: `${y.d}-${MONTHS_UZ[y.m - 1]}, ${y.y}`,
      kind,
    };
  }
  if (kind === "week") {
    const start = shiftDays(-6);
    return {
      from: dayStart(start.y, start.m, start.d),
      to: dayEnd(now.year, now.month, now.day),
      label: `${start.d}–${now.day} ${MONTHS_UZ[now.month - 1]}`,
      kind,
    };
  }
  const lastDay = new Date(Date.UTC(now.year, now.month, 0)).getUTCDate();
  return {
    from: dayStart(now.year, now.month, 1),
    to: dayEnd(now.year, now.month, lastDay),
    label: `${MONTHS_UZ[now.month - 1]} ${now.year}`,
    kind,
  };
}

/** Previous period of the same length — used for week-over-week comparison. */
export function previousRange(range: ReportRange): { from: string; to: string } {
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.to);
  const span = toMs - fromMs + 1;
  return { from: new Date(fromMs - span).toISOString(), to: new Date(fromMs - 1).toISOString() };
}

const num = (value: unknown) => Number(value ?? 0) || 0;

export interface BusinessReport {
  businessName: string;
  currency: string;
  range: ReportRange;
  revenue: number;
  orders: number;
  completedOrders: number;
  newCustomers: number;
  conversion: number;
  pendingPaymentsCount: number;
  pendingPaymentsAmount: number;
  topProducts: { name: string; quantity: number; revenue: number }[];
  topMember: { name: string; revenue: number } | null;
  sources: { name: string; customers: number }[];
  rows: {
    orders: Record<string, unknown>[];
    payments: Record<string, unknown>[];
    customers: Record<string, unknown>[];
  };
}

/**
 * Builds a full report for one business. Uses the service client, so every query
 * is explicitly scoped by business_id — organization isolation is never implicit.
 */
export async function buildBusinessReport(
  businessId: string,
  range: ReportRange,
): Promise<BusinessReport> {
  const { supabaseAdmin } = await import("@/lib/platform.server");
  const [settings, orders, payments, customers, items] = await Promise.all([
    supabaseAdmin
      .from("business_settings")
      .select("currency, business_name")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("orders")
      .select("id, order_number, total, status, payment_status, created_at, assigned_member_id, customer_id")
      .eq("business_id", businessId)
      .gte("created_at", range.from)
      .lte("created_at", range.to)
      .limit(5000),
    supabaseAdmin
      .from("payments")
      .select("id, amount, method, status, paid_at, created_at, customer_id")
      .eq("business_id", businessId)
      .gte("created_at", range.from)
      .lte("created_at", range.to)
      .limit(5000),
    supabaseAdmin
      .from("customers")
      .select("id, full_name, phone, source, status, created_at")
      .eq("business_id", businessId)
      .gte("created_at", range.from)
      .lte("created_at", range.to)
      .limit(5000),
    supabaseAdmin
      .from("order_items")
      .select("order_id, product_name, quantity, line_total, created_at")
      .eq("business_id", businessId)
      .gte("created_at", range.from)
      .lte("created_at", range.to)
      .limit(5000),
  ]);

  const orderRows = (orders.data ?? []).filter((o) => o.status !== "cancelled");
  const paymentRows = payments.data ?? [];
  const customerRows = customers.data ?? [];
  const memberNames = await assigneeNameMap(businessId);

  const revenue = paymentRows
    .filter((p) => p.status === "paid" || p.status === "partial")
    .reduce((sum, p) => sum + num(p.amount), 0);
  const pending = paymentRows.filter((p) => p.status === "pending" || p.status === "partial");
  const completedOrders = orderRows.filter((o) => o.status === "delivered").length;

  const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const item of items.data ?? []) {
    const entry = productMap.get(item.product_name) ?? { name: item.product_name, quantity: 0, revenue: 0 };
    entry.quantity += item.quantity;
    entry.revenue += num(item.line_total);
    productMap.set(item.product_name, entry);
  }

  const memberRevenue = new Map<string, number>();
  for (const order of orderRows) {
    if (!order.assigned_member_id) continue;
    memberRevenue.set(
      order.assigned_member_id,
      (memberRevenue.get(order.assigned_member_id) ?? 0) + num(order.total),
    );
  }
  const topMemberEntry = [...memberRevenue.entries()].sort((a, b) => b[1] - a[1])[0];

  const sourceMap = new Map<string, number>();
  for (const customer of customerRows) {
    const key = customer.source || "other";
    sourceMap.set(key, (sourceMap.get(key) ?? 0) + 1);
  }

  const customerNames = new Map(customerRows.map((c) => [c.id, c.full_name]));

  return {
    businessName: settings.data?.business_name ?? "KetaOne",
    currency: settings.data?.currency ?? "UZS",
    range,
    revenue,
    orders: orderRows.length,
    completedOrders,
    newCustomers: customerRows.length,
    // Konversiya — buyurtmalarning yetkazib berilganlari (Murojaatlar bo'limi ochildi).
    conversion: orderRows.length ? Math.round((completedOrders / orderRows.length) * 1000) / 10 : 0,
    pendingPaymentsCount: pending.length,
    pendingPaymentsAmount: pending.reduce((sum, p) => sum + num(p.amount), 0),
    topProducts: [...productMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    topMember: topMemberEntry
      ? { name: memberNames.get(topMemberEntry[0]) ?? "Mas’ul", revenue: topMemberEntry[1] }
      : null,
    sources: [...sourceMap.entries()]
      .map(([name, customerCount]) => ({ name, customers: customerCount }))
      .sort((a, b) => b.customers - a.customers),
    rows: {
      orders: orderRows.map((order) => ({
        "Buyurtma ID": order.order_number,
        Sana: order.created_at.slice(0, 10),
        Mijoz: customerNames.get(order.customer_id) ?? "",
        Summa: num(order.total),
        Status: order.status,
        "To‘lov holati": order.payment_status,
        "Mas’ul": order.assigned_member_id ? (memberNames.get(order.assigned_member_id) ?? "") : "",
      })),
      payments: paymentRows.map((payment) => ({
        "To‘lov ID": payment.id.slice(0, 8),
        Sana: (payment.paid_at ?? payment.created_at).slice(0, 10),
        Mijoz: customerNames.get(payment.customer_id ?? "") ?? "",
        Summa: num(payment.amount),
        Usul: payment.method,
        Status: payment.status,
      })),
      customers: customerRows.map((customer) => ({
        "Mijoz ID": customer.id.slice(0, 8),
        Ism: customer.full_name ?? "",
        Telefon: customer.phone ?? "",
        Manba: customer.source ?? "",
        Status: customer.status ?? "",
        Yaratilgan: customer.created_at.slice(0, 10),
      })),
    },
  };
}

export function formatMoneyPlain(value: number, currency: string): string {
  const rounded = Math.round(value);
  const grouped = rounded.toLocaleString("ru-RU").replace(/\u00A0/g, " ");
  return currency === "UZS" ? `${grouped} so‘m` : `${grouped} ${currency}`;
}

const TITLES: Record<ReportKind, string> = {
  today: "Bugungi hisobot",
  yesterday: "Kechagi hisobot",
  week: "Haftalik hisobot",
  month: "Oylik hisobot",
};

/** Short Telegram message. Comparison text is omitted when there is no prior data. */
export function formatReportMessage(
  report: BusinessReport,
  comparison?: { revenue: number; hasData: boolean },
): string {
  const kind = (report.range.kind === "custom" ? "today" : report.range.kind) as ReportKind;
  const lines = [
    `📊 <b>KetaOne</b>`,
    `${TITLES[kind]}`,
    "",
    `📅 ${report.range.label}`,
    "",
    `💰 Tushum: <b>${formatMoneyPlain(report.revenue, report.currency)}</b>`,
    `🛒 Buyurtmalar: <b>${report.orders}</b> ta`,
    `👥 Yangi mijozlar: <b>${report.newCustomers}</b> ta`,
    `✅ Yakunlangan savdolar: <b>${report.completedOrders}</b> ta`,
    `💳 Kutilayotgan to‘lovlar: <b>${report.pendingPaymentsCount}</b> ta (${formatMoneyPlain(
      report.pendingPaymentsAmount,
      report.currency,
    )})`,
    `📈 Konversiya: <b>${report.conversion}%</b>`,
  ];

  if (comparison) {
    lines.push("");
    if (!comparison.hasData) {
      lines.push("📈 Taqqoslash uchun yetarli ma’lumot mavjud emas.");
    } else {
      const diff = Math.round(((report.revenue - comparison.revenue) / comparison.revenue) * 1000) / 10;
      const arrow = diff > 0 ? "📈" : diff < 0 ? "📉" : "➖";
      lines.push(`${arrow} O‘tgan davrga nisbatan: <b>${diff > 0 ? "+" : ""}${diff}%</b>`);
    }
  }

  if (report.topProducts.length) {
    lines.push("", "🏆 Eng ko‘p sotilgan:");
    for (const product of report.topProducts.slice(0, 3)) {
      lines.push(`• ${product.name} — ${product.quantity} ta`);
    }
  }
  if (report.topMember) {
    lines.push("", `⭐ Eng samarali xodim: ${report.topMember.name}`);
  }
  if (report.sources.length) {
    lines.push("", `📌 Mijoz manbalari: ${report.sources.slice(0, 3).map((s) => `${s.name} (${s.customers})`).join(", ")}`);
  }

  return lines.join("\n");
}

/** Excel workbook (base64) for a report: Umumiy, Savdolar, To‘lovlar, Mijozlar. */
export function buildReportExcel(report: BusinessReport): { base64: string; filename: string } {
  const base64 = buildWorkbookBase64([
    {
      name: "Umumiy",
      rows: [
        {
          Davr: report.range.label,
          Tushum: report.revenue,
          Buyurtmalar: report.orders,
          "Yangi mijozlar": report.newCustomers,
          "Yakunlangan savdolar": report.completedOrders,
          "Kutilayotgan to‘lovlar": report.pendingPaymentsAmount,
          "Konversiya %": report.conversion,
          Valyuta: report.currency,
        },
      ],
    },
    { name: "Savdolar", rows: report.rows.orders },
    { name: "To‘lovlar", rows: report.rows.payments },
    { name: "Mijozlar", rows: report.rows.customers },
  ]);
  return {
    base64,
    filename: `ketaone-hisobot-${report.range.from.slice(0, 10)}.xlsx`,
  };
}

/** Full report for a business + kind, including week-over-week comparison. */
export async function generateReport(businessId: string, kind: ReportKind, timeZone: string) {
  const range = resolveRange(kind, timeZone);
  const report = await buildBusinessReport(businessId, range);
  if (kind !== "week" && kind !== "month") return { report, comparison: undefined };
  const previous = previousRange(range);
  const prior = await buildBusinessReport(businessId, { ...range, ...previous, kind: "custom" });
  return {
    report,
    comparison: { revenue: prior.revenue, hasData: prior.revenue > 0 || prior.orders > 0 },
  };
}
