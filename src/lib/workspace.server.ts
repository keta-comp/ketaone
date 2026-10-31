import type { DbClient } from "./pg-rest.server";

import { assigneeNameMap } from "./assignee.server";
import { DEFAULT_BUSINESS_TZ } from "./booking";
import { requireBusinessId } from "./tenant.server";

type Client = DbClient;

export function dayStart(offsetDays = 0) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

const num = (v: unknown) => Number(v ?? 0);

/** Biznik zonasi (Toshkent) bo'yicha bugungi sana — `date` ustunlari shu ko'rinishda saqlanadi. */
function zonedDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_BUSINESS_TZ }).format(date);
}

/** Dashboard KPI strip — every value comes from the live database. */
export async function buildKpis(supabase: Client) {
  const businessId = await requireBusinessId(supabase);
  const today = dayStart().toISOString();
  const monthStart = (() => {
    const d = dayStart();
    d.setUTCDate(1);
    return d.toISOString();
  })();
  const soon = dayStart(3).toISOString().slice(0, 10);
  // Xarajat sanasi oddiy kun — biznes zonasidagi bugungi/oy boshi bilan solinadi.
  const todayDay = zonedDay(new Date());
  const monthDay = `${todayDay.slice(0, 7)}-01`;

  const [
    settings,
    paidToday,
    paidMonth,
    spentToday,
    spentMonth,
    newCustomers,
    newLeads,
    activeLeads,
    newOrders,
    pendingPayments,
    openTasks,
  ] = await Promise.all([
    supabase.from("business_settings").select("currency").eq("business_id", businessId).limit(1).maybeSingle(),
    supabase
      .from("payments")
      .select("amount")
      .eq("business_id", businessId)
      .in("status", ["paid", "partial"])
      .gte("paid_at", today),
    supabase
      .from("payments")
      .select("amount")
      .eq("business_id", businessId)
      .in("status", ["paid", "partial"])
      .gte("paid_at", monthStart),
    supabase
      .from("expenses")
      .select("amount")
      .eq("business_id", businessId)
      .gte("expense_date", todayDay),
    supabase
      .from("expenses")
      .select("amount")
      .eq("business_id", businessId)
      .gte("expense_date", monthDay),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("created_at", today),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("created_at", today),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .in("status", ["new", "needs_attention", "assigned", "contacted", "negotiating"]),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("created_at", today),
    supabase
      .from("payments")
      .select("amount, due_date")
      .eq("business_id", businessId)
      .eq("status", "pending"),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .neq("status", "completed")
      .lte("due_date", soon),
  ]);

  const revenueToday = (paidToday.data ?? []).reduce((s, r) => s + num(r.amount), 0);
  const revenueMonth = (paidMonth.data ?? []).reduce((s, r) => s + num(r.amount), 0);
  const pendingRows = pendingPayments.data ?? [];
  const pendingAmount = pendingRows.reduce((s, r) => s + num(r.amount), 0);

  return {
    currency: settings.data?.currency ?? "UZS",
    revenueToday,
    revenueMonth,
    expenseToday: (spentToday.data ?? []).reduce((s, r) => s + num(r.amount), 0),
    expenseMonth: (spentMonth.data ?? []).reduce((s, r) => s + num(r.amount), 0),
    newCustomers: newCustomers.count ?? 0,
    newLeads: newLeads.count ?? 0,
    activeLeads: activeLeads.count ?? 0,
    newOrders: newOrders.count ?? 0,
    pendingPaymentsCount: pendingRows.length,
    pendingPaymentsAmount: pendingAmount,
    dueTasks: openTasks.count ?? 0,
  };
}

export interface TodoAction {
  key: string;
  count: number;
  label: string;
  to: string;
  search?: Record<string, string>;
  tone: "danger" | "warning" | "info";
}

/** "Bugun nima qilish kerak?" — derived only from real CRM rows. */
export async function buildTodoActions(supabase: Client, hidden = new Set<string>()): Promise<TodoAction[]> {
  const soon = dayStart(3).toISOString().slice(0, 10);
  const todayDate = dayStart().toISOString().slice(0, 10);

  const [unconfirmedOrders, duePayments, overdueTasks, unconfirmedAppointments, newLeads] = await Promise.all([
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("status", ["new", "confirming"]),
    supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lte("due_date", soon),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .neq("status", "completed")
      .lte("due_date", todayDate),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("status", "new")
      .gte("starts_at", dayStart().toISOString())
      .lt("starts_at", dayStart(1).toISOString()),
    hidden.has("/dashboard/leads")
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .in("status", ["new", "needs_attention"]),
  ]);

  const actions: TodoAction[] = [
    {
      key: "leads",
      count: newLeads.count ?? 0,
      label: "yangi murojaatga javob berilmagan",
      to: "/dashboard/leads",
      tone: "warning",
    },
    {
      key: "orders",
      count: unconfirmedOrders.count ?? 0,
      label: "buyurtma tasdiqlanmagan",
      to: "/dashboard/orders",
      search: { status: "new" },
      tone: "info",
    },
    {
      key: "appointments",
      count: unconfirmedAppointments.count ?? 0,
      label: "bugungi qabul tasdiqlanmagan",
      to: "/dashboard/appointments",
      tone: "warning",
    },
    {
      key: "payments",
      count: duePayments.count ?? 0,
      label: "to‘lov muddati yaqin",
      to: "/dashboard/payments",
      search: { status: "pending" },
      tone: "danger",
    },
    {
      key: "tasks",
      count: overdueTasks.count ?? 0,
      label: "vazifa muddati bugun yoki kechikdi",
      to: "/dashboard/tasks",
      search: { status: "pending" },
      tone: "warning",
    },
  ];

  return actions.filter((a) => a.count > 0 && !hidden.has(a.to));
}

export async function buildSearch(supabase: Client, term: string) {
  const like = `%${term.replace(/[,()]/g, " ")}%`;
  // Murojaatlar bo'limi yo'q: ular qidiruv natijalarida ham chiqmaydi.
  const [customers, orders, payments, tasks] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, phone")
      .or(`full_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
      .limit(5),
    supabase.from("orders").select("id, order_number, total, status").ilike("order_number", like).limit(5),
    supabase.from("payments").select("id, amount, status, note").ilike("note", like).limit(5),
    supabase.from("tasks").select("id, title, status").ilike("title", like).limit(5),
  ]);

  type Hit = { type: string; id: string; title: string; subtitle: string; to: string };
  const hits: Hit[] = [];
  for (const c of customers.data ?? [])
    hits.push({
      type: "Mijoz",
      id: c.id,
      title: c.full_name ?? "Ismsiz mijoz",
      subtitle: c.phone ?? "",
      to: `/dashboard/customers/${c.id}`,
    });
  for (const o of orders.data ?? [])
    hits.push({
      type: "Buyurtma",
      id: o.id,
      title: `#${o.order_number}`,
      subtitle: String(o.total),
      to: `/dashboard/orders`,
    });
  for (const p of payments.data ?? [])
    hits.push({
      type: "To‘lov",
      id: p.id,
      title: String(p.amount),
      subtitle: p.note ?? "",
      to: `/dashboard/payments`,
    });
  for (const t of tasks.data ?? [])
    hits.push({ type: "Vazifa", id: t.id, title: t.title, subtitle: "", to: `/dashboard/tasks` });

  return hits;
}

export interface ReportResult {
  currency: string;
  from: string;
  to: string;
  kpis: {
    revenue: number;
    orders: number;
    completedOrders: number;
    leads: number;
    wonLeads: number;
    conversionRate: number;
    averageOrderValue: number;
    newCustomers: number;
    pendingPayments: number;
  };
  days: { date: string; label: string; revenue: number; orders: number; leads: number }[];
  bySource: { name: string; leads: number; customers: number }[];
  byMember: { name: string; orders: number; revenue: number; leads: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
}

export async function buildReport(supabase: Client, from: string, to: string): Promise<ReportResult> {
  const businessId = await requireBusinessId(supabase);
  const [settings, orders, leads, customers, payments, items] = await Promise.all([
    supabase.from("business_settings").select("currency").limit(1).maybeSingle(),
    supabase
      .from("orders")
      .select("id, total, status, created_at, assigned_member_id")
      .gte("created_at", from)
      .lte("created_at", to),
    supabase
      .from("leads")
      .select("id, status, source, created_at, assigned_member_id")
      .gte("created_at", from)
      .lte("created_at", to),
    supabase.from("customers").select("id, source, created_at").gte("created_at", from).lte("created_at", to),
    supabase.from("payments").select("amount, status, paid_at, created_at").gte("created_at", from).lte("created_at", to),
    supabase
      .from("order_items")
      .select("product_name, quantity, line_total, created_at")
      .gte("created_at", from)
      .lte("created_at", to)
      .limit(5000),
  ]);

  const orderRows = (orders.data ?? []).filter((o) => o.status !== "cancelled");
  const paymentRows = payments.data ?? [];
  const revenue = paymentRows
    .filter((p) => p.status === "paid" || p.status === "partial")
    .reduce((s, p) => s + num(p.amount), 0);
  const pendingPayments = paymentRows.filter((p) => p.status === "pending").reduce((s, p) => s + num(p.amount), 0);
  const leadRows = leads.data ?? [];
  const wonLeads = leadRows.filter((l) => l.status === "won").length;
  const completedOrders = orderRows.filter((o) => o.status === "delivered").length;
  const orderTotal = orderRows.reduce((s, o) => s + num(o.total), 0);

  // day buckets
  const dayMap = new Map<string, { date: string; label: string; revenue: number; orders: number; leads: number }>();
  const cursor = new Date(from);
  const end = new Date(to);
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    dayMap.set(key, { date: key, label: key.slice(5), revenue: 0, orders: 0, leads: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const p of paymentRows) {
    if (p.status !== "paid" && p.status !== "partial") continue;
    const key = (p.paid_at ?? p.created_at).slice(0, 10);
    const bucket = dayMap.get(key);
    if (bucket) bucket.revenue += num(p.amount);
  }
  for (const o of orderRows) {
    const bucket = dayMap.get(o.created_at.slice(0, 10));
    if (bucket) bucket.orders += 1;
  }
  for (const l of leadRows) {
    const bucket = dayMap.get(l.created_at.slice(0, 10));
    if (bucket) bucket.leads += 1;
  }

  // sources
  const sourceMap = new Map<string, { name: string; leads: number; customers: number }>();
  const bumpSource = (name: string, field: "leads" | "customers") => {
    const key = name || "other";
    const entry = sourceMap.get(key) ?? { name: key, leads: 0, customers: 0 };
    entry[field] += 1;
    sourceMap.set(key, entry);
  };
  for (const l of leadRows) bumpSource(l.source ?? "other", "leads");
  for (const c of customers.data ?? []) bumpSource(c.source ?? "other", "customers");

  // team members who closed deals
  const memberNames = await assigneeNameMap(businessId);
  const memberMap = new Map<string, { name: string; orders: number; revenue: number; leads: number }>();
  const memberEntry = (id: string | null) => {
    const key = id ?? "unassigned";
    const name = id ? (memberNames.get(id) ?? "Mas’ul") : "Tayinlanmagan";
    const entry = memberMap.get(key) ?? { name, orders: 0, revenue: 0, leads: 0 };
    memberMap.set(key, entry);
    return entry;
  };
  for (const o of orderRows) {
    const entry = memberEntry(o.assigned_member_id);
    entry.orders += 1;
    entry.revenue += num(o.total);
  }
  for (const l of leadRows) memberEntry(l.assigned_member_id).leads += 1;

  // products
  const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const item of items.data ?? []) {
    const entry = productMap.get(item.product_name) ?? { name: item.product_name, quantity: 0, revenue: 0 };
    entry.quantity += item.quantity;
    entry.revenue += num(item.line_total);
    productMap.set(item.product_name, entry);
  }

  return {
    currency: settings.data?.currency ?? "UZS",
    from,
    to,
    kpis: {
      revenue,
      orders: orderRows.length,
      completedOrders,
      leads: leadRows.length,
      wonLeads,
      conversionRate: leadRows.length ? Math.round((wonLeads / leadRows.length) * 1000) / 10 : 0,
      averageOrderValue: orderRows.length ? Math.round(orderTotal / orderRows.length) : 0,
      newCustomers: (customers.data ?? []).length,
      pendingPayments,
    },
    days: [...dayMap.values()],
    bySource: [...sourceMap.values()].sort((a, b) => b.leads + b.customers - (a.leads + a.customers)),
    byMember: [...memberMap.values()].sort((a, b) => b.revenue - a.revenue),
    topProducts: [...productMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
  };
}
