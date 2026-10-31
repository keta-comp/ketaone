import { supabaseAdmin } from "@/lib/platform.server";
import { ownerSql } from "./db";
import { audienceCount, countAudiences, type NotificationAudiences } from "./notification-targets";

/** Platform-level data layer for the Super Admin Control Center.
 *  Every value here comes from the live database — no demo numbers anywhere. */

const DAY = 24 * 60 * 60 * 1000;

function iso(date: Date) {
  return date.toISOString();
}

function startOfDayUtc(offsetDays = 0) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

function startOfMonthUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function countRows(table: string, build?: (q: any) => any) {
  let query = supabaseAdmin.from(table as never).select("*", { count: "exact", head: true });
  if (build) query = build(query);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function sum(values: (number | null | undefined)[]) {
  return values.reduce<number>((acc, v) => acc + (Number(v) || 0), 0);
}

export interface PlatformOverview {
  organizations: { total: number; active: number; trial: number; suspended: number; cancelled: number; newToday: number; newThisMonth: number };
  users: { total: number; active: number; suspended: number; activeLast7Days: number; newThisMonth: number };
  revenue: { crmTurnoverTotal: number; crmTurnoverThisMonth: number; subscriptionRevenue: null; mrr: null };
  ai: { total: number; today: number; thisMonth: number; estimatedCost: null };
  records: { customers: number; leads: number; orders: number; payments: number; tasks: number; products: number; conversations: number; messages: number };
  storage: { fileStorageBytes: null; databaseBytes: null; totalRecords: number };
}

export async function buildOverview(): Promise<PlatformOverview> {
  const todayStart = iso(startOfDayUtc());
  const monthStart = iso(startOfMonthUtc());
  const weekStart = iso(new Date(Date.now() - 7 * DAY));

  const [
    orgTotal,
    orgActive,
    orgTrial,
    orgSuspended,
    orgCancelled,
    orgToday,
    orgMonth,
    userTotal,
    userActive,
    userSuspended,
    userWeek,
    userMonth,
    aiTotal,
    aiToday,
    aiMonth,
    customers,
    leads,
    orders,
    tasks,
    products,
    conversations,
    messages,
  ] = await Promise.all([
    countRows("businesses"),
    countRows("businesses", (q) => q.eq("status", "active")),
    countRows("businesses", (q) => q.eq("status", "trial")),
    countRows("businesses", (q) => q.eq("status", "suspended")),
    countRows("businesses", (q) => q.eq("status", "cancelled")),
    countRows("businesses", (q) => q.gte("created_at", todayStart)),
    countRows("businesses", (q) => q.gte("created_at", monthStart)),
    countRows("profiles"),
    countRows("profiles", (q) => q.eq("status", "active")),
    countRows("profiles", (q) => q.eq("status", "suspended")),
    countRows("profiles", (q) => q.gte("last_active_at", weekStart)),
    countRows("profiles", (q) => q.gte("created_at", monthStart)),
    countRows("ai_usage_events"),
    countRows("ai_usage_events", (q) => q.gte("created_at", todayStart)),
    countRows("ai_usage_events", (q) => q.gte("created_at", monthStart)),
    countRows("customers"),
    countRows("leads"),
    countRows("orders"),
    countRows("tasks"),
    countRows("products"),
    countRows("conversations"),
    countRows("messages"),
  ]);

  const { data: paidAll, error: paymentsError } = await supabaseAdmin
    .from("payments")
    .select("amount, paid_at, created_at")
    .eq("status", "paid");
  if (paymentsError) throw new Error(paymentsError.message);

  const rows = paidAll ?? [];
  const crmTurnoverTotal: number = sum(rows.map((r) => r.amount));
  const crmTurnoverThisMonth = sum(
    rows.filter((r) => (r.paid_at ?? r.created_at) >= monthStart).map((r) => r.amount),
  );

  const totalRecords =
    customers + leads + orders + tasks + products + conversations + messages + rows.length;

  return {
    organizations: {
      total: orgTotal,
      active: orgActive,
      trial: orgTrial,
      suspended: orgSuspended,
      cancelled: orgCancelled,
      newToday: orgToday,
      newThisMonth: orgMonth,
    },
    users: {
      total: userTotal,
      active: userActive,
      suspended: userSuspended,
      activeLast7Days: userWeek,
      newThisMonth: userMonth,
    },
    revenue: {
      crmTurnoverTotal,
      crmTurnoverThisMonth,
      // Billing is not connected yet — never invent subscription revenue.
      subscriptionRevenue: null,
      mrr: null,
    },
    ai: { total: aiTotal, today: aiToday, thisMonth: aiMonth, estimatedCost: null },
    records: {
      customers,
      leads,
      orders,
      payments: rows.length,
      tasks,
      products,
      conversations,
      messages,
    },
    storage: { fileStorageBytes: null, databaseBytes: null, totalRecords },
  };
}

export interface OrgRow {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  industry: string | null;
  users: number;
  createdAt: string;
  lastActiveAt: string | null;
  plan: string;
  status: string;
}

export async function listOrganizations(filters: {
  search?: string | undefined;
  industry?: string | undefined;
  plan?: string | undefined;
  status?: string | undefined;
  sort?: string | undefined;
}) {
  const results = await Promise.all([
    supabaseAdmin.from("businesses").select("id, name, owner_id, plan, status, created_at"),
    supabaseAdmin.from("business_members").select("business_id, user_id"),
    supabaseAdmin.from("profiles").select("id, full_name, email, phone"),
    supabaseAdmin.from("crm_configs").select("business_id, industry"),
    supabaseAdmin
      .from("activities")
      .select("business_id, created_at")
      .order("created_at", { ascending: false })
      .limit(4000),
  ]);
  for (const res of results) if (res.error) throw new Error(res.error.message);
  const [{ data: businesses }, { data: members }, { data: profiles }, { data: configs }, { data: acts }] = results;

  const memberCount = new Map<string, number>();
  for (const m of members ?? []) memberCount.set(m.business_id, (memberCount.get(m.business_id) ?? 0) + 1);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const industryBy = new Map((configs ?? []).map((c) => [c.business_id, c.industry]));
  const lastActive = new Map<string, string>();
  for (const a of acts ?? []) if (!lastActive.has(a.business_id)) lastActive.set(a.business_id, a.created_at);

  let rows: OrgRow[] = (businesses ?? []).map((b) => {
    const owner = profileById.get(b.owner_id);
    return {
      id: b.id,
      name: b.name,
      ownerId: b.owner_id,
      ownerName: owner?.full_name ?? null,
      ownerEmail: owner?.email ?? null,
      industry: industryBy.get(b.id) ?? null,
      users: memberCount.get(b.id) ?? 0,
      createdAt: b.created_at,
      lastActiveAt: lastActive.get(b.id) ?? null,
      plan: b.plan,
      status: b.status,
    };
  });

  const term = filters.search?.trim().toLowerCase();
  if (term) {
    rows = rows.filter((r) =>
      [r.name, r.ownerName, r.ownerEmail].some((v) => (v ?? "").toLowerCase().includes(term)),
    );
  }
  if (filters.industry && filters.industry !== "all")
    rows = rows.filter((r) => r.industry === filters.industry);
  if (filters.plan && filters.plan !== "all") rows = rows.filter((r) => r.plan === filters.plan);
  if (filters.status && filters.status !== "all") rows = rows.filter((r) => r.status === filters.status);

  const sort = filters.sort ?? "newest";
  rows.sort((a, b) => {
    if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
    if (sort === "users") return b.users - a.users;
    if (sort === "active") return (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "");
    return b.createdAt.localeCompare(a.createdAt);
  });

  const industries = [...new Set((configs ?? []).map((c) => c.industry).filter(Boolean))] as string[];
  return { rows, industries };
}

export async function getOrganizationDetail(businessId: string) {
  const monthStart = iso(startOfMonthUtc());

  const results = await Promise.all([
    supabaseAdmin.from("businesses").select("*").eq("id", businessId).maybeSingle(),
    supabaseAdmin.from("business_members").select("user_id, role, created_at").eq("business_id", businessId),
    supabaseAdmin
      .from("crm_configs")
      .select("industry, business_description, config, created_at")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabaseAdmin.from("payments").select("amount, status, paid_at, created_at").eq("business_id", businessId),
    supabaseAdmin
      .from("activities")
      .select("action, detail, actor, entity_type, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabaseAdmin
      .from("audit_logs")
      .select("action, actor_email, status, created_at, metadata")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabaseAdmin
      .from("ai_usage_events")
      .select("feature, input_tokens, output_tokens, created_at")
      .eq("business_id", businessId),
  ]);
  for (const res of results) if (res.error) throw new Error(res.error.message);
  const [
    { data: business },
    { data: members },
    { data: config },
    { data: payments },
    { data: activities },
    { data: audit },
    { data: aiEvents },
  ] = results;
  if (!business) throw new Error("Organization topilmadi");

  const memberIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles, error: profilesError } = memberIds.length
    ? await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, phone, status, created_at, last_active_at")
        .in("id", memberIds)
    : { data: [] as never[], error: null };
  if (profilesError) throw new Error(profilesError.message);

  const byBiz = (q: any) => q.eq("business_id", businessId);
  const [customers, leads, orders, tasksCount, products, conversations, messages] = await Promise.all([
    countRows("customers", byBiz),
    countRows("leads", byBiz),
    countRows("orders", byBiz),
    countRows("tasks", byBiz),
    countRows("products", byBiz),
    countRows("conversations", byBiz),
    countRows("messages", byBiz),
  ]);

  const paid = (payments ?? []).filter((p) => p.status === "paid");
  const owner = (profiles ?? []).find((p) => p.id === business.owner_id) ?? null;

  const aiToday = (aiEvents ?? []).filter((e) => e.created_at >= iso(startOfDayUtc())).length;
  const aiMonth = (aiEvents ?? []).filter((e) => e.created_at >= monthStart).length;

  return {
    business: {
      id: business.id,
      name: business.name,
      status: business.status,
      plan: business.plan,
      createdAt: business.created_at,
      suspendedAt: business.suspended_at,
      suspendReason: business.suspend_reason,
    },
    owner: owner
      ? { id: owner.id, name: owner.full_name, email: owner.email, phone: owner.phone }
      : null,
    industry: config?.industry ?? null,
    businessDescription: config?.business_description ?? null,
    modules:
      ((config?.config as { modules?: { key: string; label: string }[] } | null)?.modules ?? []).map(
        (m) => m.label,
      ),
    members: (members ?? []).map((m) => {
      const p = (profiles ?? []).find((x) => x.id === m.user_id);
      return {
        userId: m.user_id,
        role: m.role,
        joinedAt: m.created_at,
        name: p?.full_name ?? null,
        email: p?.email ?? null,
        status: p?.status ?? "active",
        lastActiveAt: p?.last_active_at ?? null,
      };
    }),
    counts: { customers, leads, orders, tasks: tasksCount, products, conversations, messages },
    revenue: {
      crmTurnoverTotal: sum(paid.map((p) => p.amount)),
      crmTurnoverThisMonth: sum(
        paid.filter((p) => (p.paid_at ?? p.created_at) >= monthStart).map((p) => p.amount),
      ),
      subscriptionRevenue: null,
    },
    ai: {
      total: (aiEvents ?? []).length,
      today: aiToday,
      thisMonth: aiMonth,
      inputTokens: sum((aiEvents ?? []).map((e) => e.input_tokens)),
      outputTokens: sum((aiEvents ?? []).map((e) => e.output_tokens)),
      estimatedCost: null,
    },
    activities: activities ?? [],
    audit: audit ?? [],
  };
}

export async function listPlatformUsers(filters: {
  search?: string | undefined;
  status?: string | undefined;
  role?: string | undefined;
}) {
  const results = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, phone, status, created_at, last_active_at")
      .order("created_at", { ascending: false }),
    supabaseAdmin.from("business_members").select("business_id, user_id, role"),
    supabaseAdmin.from("businesses").select("id, name, status"),
    supabaseAdmin.from("user_roles").select("user_id, role"),
    supabaseAdmin.from("platform_admins").select("user_id"),
    supabaseAdmin.from("crm_configs").select("business_id, industry"),
  ]);
  for (const res of results) if (res.error) throw new Error(res.error.message);
  const [{ data: profiles }, { data: members }, { data: businesses }, { data: roles }, { data: admins }, { data: configs }] =
    results;

  const bizById = new Map((businesses ?? []).map((b) => [b.id, b]));
  const industryBy = new Map((configs ?? []).map((c) => [c.business_id, c.industry]));
  const superIds = new Set((admins ?? []).map((a) => a.user_id));
  const roleBy = new Map<string, string>();
  for (const r of roles ?? []) roleBy.set(r.user_id, r.role);

  let rows = (profiles ?? []).map((p) => {
    const membership = (members ?? []).find((m) => m.user_id === p.id);
    const biz = membership ? bizById.get(membership.business_id) : undefined;
    return {
      id: p.id,
      name: p.full_name,
      email: p.email,
      phone: p.phone,
      organizationId: biz?.id ?? null,
      organization: biz?.name ?? null,
      industry: membership ? industryBy.get(membership.business_id) ?? null : null,
      role: superIds.has(p.id) ? "super_admin" : membership?.role ?? roleBy.get(p.id) ?? "receptionist",
      status: p.status,
      createdAt: p.created_at,
      lastActiveAt: p.last_active_at,
    };
  });

  const term = filters.search?.trim().toLowerCase();
  if (term)
    rows = rows.filter((r) =>
      [r.name, r.email, r.organization, r.phone].some((v) => (v ?? "").toLowerCase().includes(term)),
    );
  if (filters.status && filters.status !== "all") rows = rows.filter((r) => r.status === filters.status);
  if (filters.role && filters.role !== "all") rows = rows.filter((r) => r.role === filters.role);

  return rows;
}

export async function getUserDetail(userId: string) {
  const results = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, phone, status, created_at, last_active_at")
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin.from("business_members").select("business_id, role, created_at").eq("user_id", userId),
    supabaseAdmin.from("platform_admins").select("user_id").eq("user_id", userId),
    supabaseAdmin.from("ai_usage_events").select("feature, created_at").eq("user_id", userId),
    supabaseAdmin
      .from("audit_logs")
      .select("action, status, created_at, ip, metadata")
      .eq("actor_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  for (const res of results) if (res.error) throw new Error(res.error.message);
  const [{ data: profile }, { data: members }, { data: admins }, { data: aiEvents }, { data: audit }] = results;
  if (!profile) throw new Error("Foydalanuvchi topilmadi");

  const bizIds = (members ?? []).map((m) => m.business_id);
  const { data: businesses, error: businessesError } = bizIds.length
    ? await supabaseAdmin.from("businesses").select("id, name, status, plan").in("id", bizIds)
    : { data: [] as never[], error: null };
  if (businessesError) throw new Error(businessesError.message);

  return {
    profile: {
      id: profile.id,
      name: profile.full_name,
      email: profile.email,
      phone: profile.phone,
      status: profile.status,
      createdAt: profile.created_at,
      lastActiveAt: profile.last_active_at,
      isSuperAdmin: (admins ?? []).length > 0,
    },
    memberships: (members ?? []).map((m) => {
      const b = (businesses ?? []).find((x) => x.id === m.business_id);
      return {
        businessId: m.business_id,
        organization: b?.name ?? null,
        organizationStatus: b?.status ?? null,
        plan: b?.plan ?? null,
        role: m.role,
        joinedAt: m.created_at,
      };
    }),
    usage: { aiRequests: (aiEvents ?? []).length },
    audit: audit ?? [],
  };
}

function dayKey(value: string) {
  return value.slice(0, 10);
}

/** Bloklov haqiqiy to'siq bo'lishi uchun yoziladigan qator.
 *
 *  `profiles.status` — panel ko'radigan belgi; haqiqiy tekshiruv esa
 *  `currentSession()` ichidagi `banned` qatori (src/lib/auth.server.ts:193).
 *  Shu yozilmagan "Bloklash" tugmasi foydalanuvchining kirishini to'xtatmaydi,
 *  shuning uchun blokda uning sessiyalari ham o'chiriladi. */
export async function applyAccountBan(userId: string, banned: boolean): Promise<{ sessionsCleared: number }> {
  return ownerSql().begin(async (tx) => {
    const updated = await tx`
      update neon_auth."user"
         set banned = ${banned},
             "banReason" = ${banned ? "Super Admin tomonidan bloklandi" : null},
             "banExpires" = null,
             "updatedAt" = now()
       where id = ${userId}::uuid
      returning id`;
    if (updated.length === 0) throw new Error("Hisob topilmadi (neon_auth.user)");
    const cleared = banned
      ? await tx`delete from neon_auth.session where "userId" = ${userId}::uuid returning token`
      : [];
    return { sessionsCleared: cleared.length };
  });
}

/** O'chirishdan oldin "nima ketadi" raqamlari.
 *
 *  `businesses.owner_id → CASCADE`, `businesses` esa yana 41 jadvalga cascade —
 *  ya'ni egasini o'chirish uning organizatsiyasini to'liq yo'q qiladi. Shu
 *  sababli raqamlar foydalanuvchiga ko'rsatilishi shart. */
export async function previewAccountDeletion(userId: string) {
  return ownerSql().begin(async (tx) => {
    const [account] = await tx`select email, name from neon_auth."user" where id = ${userId}::uuid`;
    if (!account) throw new Error("Hisob topilmadi (neon_auth.user)");
    const [stats] = await tx`
      select (select count(*)::int from public.businesses       where owner_id = ${userId}::uuid) as owned,
             (select count(*)::int from public.business_members where user_id  = ${userId}::uuid) as memberships,
             (select count(*)::int from public.platform_admins  where user_id  = ${userId}::uuid) as admin_rows,
             (select count(*)::int from public.platform_admins) as admins_total`;
    return {
      email: account["email"] as string,
      name: account["name"] as string | null,
      businessesOwned: stats?.["owned"] ?? 0,
      memberships: stats?.["memberships"] ?? 0,
      isPlatformAdmin: (stats?.["admin_rows"] ?? 0) > 0,
      adminsTotal: stats?.["admins_total"] ?? 0,
    };
  });
}

/** Hisobni butunlay o'chirish — sessiyalar, parol yozuvi, profil va (eger u
 *  biznes egasi bo'lsa) organizatsiya ma'lumoti CASCADE bilan ketadi.
 *  Raqamlar o'chirish bilan bir tranzaksiyada olinadi, aks holda "nechta
 *  biznes o'chdi" hisoboti keyingi so'rovda 0 ko'rsatardi. */
export async function deleteAccount(userId: string) {
  return ownerSql().begin(async (tx) => {
    const [stats] = await tx`
      select (select count(*)::int from public.businesses       where owner_id = ${userId}::uuid) as owned,
             (select count(*)::int from public.business_members where user_id  = ${userId}::uuid) as memberships`;
    const removed = await tx`delete from neon_auth."user" where id = ${userId}::uuid returning id`;
    if (removed.length === 0) throw new Error("Hisob topilmadi (neon_auth.user)");
    return {
      businessesDeleted: stats?.["owned"] ?? 0,
      membershipsDeleted: stats?.["memberships"] ?? 0,
    };
  });
}

export async function buildSaasAnalytics(from: string, to: string) {
  const results = await Promise.all([
    supabaseAdmin.from("businesses").select("id, created_at, status"),
    supabaseAdmin.from("profiles").select("id, created_at, last_active_at, status"),
    supabaseAdmin.from("activities").select("business_id, actor_user_id, created_at").gte("created_at", from).lte("created_at", to),
    supabaseAdmin.from("crm_configs").select("business_id, industry"),
  ]);
  // An analytics panel that silently reads an empty array after a failed query would
  // report "0 organizations" as if the platform were empty.
  for (const res of results) if (res.error) throw new Error(res.error.message);
  const [{ data: businesses }, { data: profiles }, { data: activities }, { data: configs }] = results;

  const inRange = (v: string | null | undefined) => !!v && v >= from && v <= to;

  const series = new Map<string, { date: string; organizations: number; users: number }>();
  const ensure = (key: string) => {
    if (!series.has(key)) series.set(key, { date: key, organizations: 0, users: 0 });
    return series.get(key)!;
  };
  for (const b of businesses ?? []) if (inRange(b.created_at)) ensure(dayKey(b.created_at)).organizations += 1;
  for (const p of profiles ?? []) if (inRange(p.created_at)) ensure(dayKey(p.created_at)).users += 1;
  const growth = [...series.values()].sort((a, b) => a.date.localeCompare(b.date));

  const activeOrgIds = new Set((activities ?? []).map((a) => a.business_id));
  const activeUserIds = new Set((activities ?? []).map((a) => a.actor_user_id).filter(Boolean));
  const todayKey = dayKey(iso(startOfDayUtc()));
  const dailyActiveOrgs = new Set(
    (activities ?? []).filter((a) => dayKey(a.created_at) === todayKey).map((a) => a.business_id),
  ).size;

  const industryCounts = new Map<string, number>();
  for (const c of configs ?? []) {
    if (!c.industry) continue;
    industryCounts.set(c.industry, (industryCounts.get(c.industry) ?? 0) + 1);
  }

  // Retention/churn need at least a handful of organizations older than the window.
  const totalOrgs = (businesses ?? []).length;
  const cancelled = (businesses ?? []).filter((b) => b.status === "cancelled" || b.status === "suspended").length;
  const enoughData = totalOrgs >= 10;

  return {
    range: { from, to },
    newOrganizations: (businesses ?? []).filter((b) => inRange(b.created_at)).length,
    newUsers: (profiles ?? []).filter((p) => inRange(p.created_at)).length,
    activeOrganizations: activeOrgIds.size,
    activeUsers: activeUserIds.size,
    dailyActiveOrganizations: dailyActiveOrgs,
    monthlyActiveOrganizations: activeOrgIds.size,
    growth,
    industries: [...industryCounts.entries()]
      .map(([industry, count]) => ({ industry, count }))
      .sort((a, b) => b.count - a.count),
    retention: enoughData ? Math.round(((totalOrgs - cancelled) / totalOrgs) * 100) : null,
    churn: enoughData ? Math.round((cancelled / totalOrgs) * 100) : null,
  };
}

export async function buildAiUsage(from: string, to: string) {
  const results = await Promise.all([
    supabaseAdmin
      .from("ai_usage_events")
      .select("business_id, user_id, feature, model, input_tokens, output_tokens, created_at")
      .gte("created_at", from)
      .lte("created_at", to)
      .order("created_at", { ascending: false }),
    supabaseAdmin.from("businesses").select("id, name"),
    supabaseAdmin.from("profiles").select("id, full_name, email"),
  ]);
  for (const res of results) if (res.error) throw new Error(res.error.message);
  const [{ data: events }, { data: businesses }, { data: profiles }] = results;

  const bizName = new Map((businesses ?? []).map((b) => [b.id, b.name]));
  const userLabel = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? p.id]));

  const byOrg = new Map<string, { label: string; requests: number; tokens: number }>();
  const byUser = new Map<string, { label: string; requests: number; tokens: number }>();
  const byFeature = new Map<string, number>();

  for (const e of events ?? []) {
    const tokens = (e.input_tokens ?? 0) + (e.output_tokens ?? 0);
    const orgKey = e.business_id ?? "unknown";
    const org = byOrg.get(orgKey) ?? { label: bizName.get(orgKey) ?? "—", requests: 0, tokens: 0 };
    org.requests += 1;
    org.tokens += tokens;
    byOrg.set(orgKey, org);

    if (e.user_id) {
      const u = byUser.get(e.user_id) ?? { label: userLabel.get(e.user_id) ?? "—", requests: 0, tokens: 0 };
      u.requests += 1;
      u.tokens += tokens;
      byUser.set(e.user_id, u);
    }
    byFeature.set(e.feature, (byFeature.get(e.feature) ?? 0) + 1);
  }

  const todayStart = iso(startOfDayUtc());
  const monthStart = iso(startOfMonthUtc());
  const [total, today, thisMonth] = await Promise.all([
    countRows("ai_usage_events"),
    countRows("ai_usage_events", (q) => q.gte("created_at", todayStart)),
    countRows("ai_usage_events", (q) => q.gte("created_at", monthStart)),
  ]);

  return {
    totals: { total, today, thisMonth, inRange: (events ?? []).length, estimatedCost: null },
    byOrganization: [...byOrg.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.requests - a.requests),
    byUser: [...byUser.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.requests - a.requests),
    byFeature: [...byFeature.entries()].map(([feature, requests]) => ({ feature, requests })),
    recent: (events ?? []).slice(0, 40),
  };
}

export async function listAuditLogs(filters: {
  action?: string | undefined;
  businessId?: string | undefined;
  search?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
}) {
  let query = supabaseAdmin
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 200);
  if (filters.action && filters.action !== "all") query = query.eq("action", filters.action);
  if (filters.businessId && filters.businessId !== "all") query = query.eq("business_id", filters.businessId);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const { data: businesses, error: businessesError } = await supabaseAdmin
    .from("businesses")
    .select("id, name");
  if (businessesError) throw new Error(businessesError.message);
  const bizName = new Map((businesses ?? []).map((b) => [b.id, b.name]));

  let rows = (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    actor: r.actor_email ?? r.actor_user_id ?? "system",
    actorKind: r.actor_kind,
    action: r.action,
    target: r.target_label ?? r.target_id ?? null,
    targetType: r.target_type,
    organization: r.business_id ? bizName.get(r.business_id) ?? null : null,
    ip: r.ip,
    status: r.status,
    metadata: r.metadata,
  }));

  const term = filters.search?.trim().toLowerCase();
  if (term)
    rows = rows.filter((r) =>
      [r.actor, r.action, r.target, r.organization].some((v) => (v ?? "").toLowerCase().includes(term)),
    );

  // The action choices are listed without the action filter: otherwise picking an
  // action would erase every other option from the dropdown.
  let actionQuery = supabaseAdmin
    .from("audit_logs")
    .select("action")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (filters.businessId && filters.businessId !== "all") actionQuery = actionQuery.eq("business_id", filters.businessId);
  if (filters.from) actionQuery = actionQuery.gte("created_at", filters.from);
  if (filters.to) actionQuery = actionQuery.lte("created_at", filters.to);
  const { data: actionRows, error: actionError } = await actionQuery;
  if (actionError) throw new Error(actionError.message);
  const actions = [...new Set((actionRows ?? []).map((r) => r.action))].sort();
  const organizations = (businesses ?? []).map((b) => ({ id: b.id, name: b.name }));
  return { rows, actions, organizations };
}

export async function buildSecurityOverview() {
  const { data: logs, error } = await supabaseAdmin
    .from("audit_logs")
    .select("*")
    .in("action", [
      "login",
      "login_failed",
      "user_suspended",
      "user_reactivated",
      "organization_suspended",
      "organization_reactivated",
      "role_changed",
      "system_settings_changed",
      "notification_sent",
      "feature_flag_changed",
    ])
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);

  const rows = logs ?? [];
  const dayAgo = iso(new Date(Date.now() - DAY));
  const failed = rows.filter((r) => r.action === "login_failed");

  // Repeated failures from the same email within 24h is the only signal we can prove.
  const failCounts = new Map<string, number>();
  for (const f of failed.filter((r) => r.created_at >= dayAgo)) {
    const key = f.actor_email ?? f.ip ?? "—";
    failCounts.set(key, (failCounts.get(key) ?? 0) + 1);
  }

  return {
    recentLogins: rows.filter((r) => r.action === "login").slice(0, 40),
    failedLogins: failed.slice(0, 40),
    failedLast24h: failed.filter((r) => r.created_at >= dayAgo).length,
    suspicious: [...failCounts.entries()]
      .filter(([, count]) => count >= 3)
      .map(([actor, count]) => ({ actor, count })),
    adminActions: rows.filter((r) => r.actor_kind === "super_admin").slice(0, 40),
  };
}

export async function platformSearch(term: string) {
  const like = `%${term}%`;
  const results = await Promise.all([
    supabaseAdmin.from("businesses").select("id, name, status").ilike("name", like).limit(10),
    supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .or(`full_name.ilike.${like},email.ilike.${like}`)
      .limit(10),
    supabaseAdmin
      .from("customers")
      .select("id, full_name, phone, business_id")
      .or(`full_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
      .limit(10),
    supabaseAdmin.from("orders").select("id, order_number, total, business_id").ilike("order_number", like).limit(10),
  ]);
  for (const res of results) if (res.error) throw new Error(res.error.message);
  const [{ data: businesses }, { data: profiles }, { data: customers }, { data: orders }] = results;

  return [
    ...(businesses ?? []).map((b) => ({
      kind: "Organization",
      label: b.name,
      hint: b.status,
      to: `/super-admin/organizations/${b.id}`,
    })),
    ...(profiles ?? []).map((p) => ({
      kind: "Foydalanuvchi",
      label: p.full_name ?? p.email ?? p.id,
      hint: p.email ?? "",
      to: `/super-admin/users`,
    })),
    ...(customers ?? []).map((c) => ({
      kind: "Mijoz",
      label: c.full_name ?? "—",
      hint: c.phone ?? "",
      to: `/super-admin/organizations/${c.business_id}`,
    })),
    ...(orders ?? []).map((o) => ({
      kind: "Buyurtma",
      label: o.order_number,
      hint: String(o.total),
      to: `/super-admin/organizations/${o.business_id}`,
    })),
  ];
}

/* --------------------------- announcement delivery ------------------------ */

export { audienceCount, type NotificationAudiences } from "./notification-targets";

/** Audience sizes for platform announcements, resolved with the same rules the
 *  system_notifications RLS policy applies. */
export async function buildNotificationAudiences(): Promise<NotificationAudiences> {
  const [members, businesses, configs, profiles] = await Promise.all([
    supabaseAdmin.from("business_members").select("business_id, user_id"),
    supabaseAdmin.from("businesses").select("id, plan, status"),
    supabaseAdmin.from("crm_configs").select("business_id, industry"),
    supabaseAdmin.from("profiles").select("id, status"),
  ]);
  for (const res of [members, businesses, configs, profiles]) {
    if (res.error) throw new Error(res.error.message);
  }
  return countAudiences({
    members: members.data ?? [],
    businesses: businesses.data ?? [],
    configs: configs.data ?? [],
    profiles: profiles.data ?? [],
  });
}

/** How many times each announcement has actually been opened in the CRM bell. */
export async function buildNotificationReads(): Promise<Map<string, number>> {
  const { data, error } = await supabaseAdmin.from("notification_reads").select("notification_id");
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(row.notification_id, (counts.get(row.notification_id) ?? 0) + 1);
  return counts;
}

export interface SentNotification {
  id: string;
  title: string;
  body: string;
  kind: string;
  target_kind: string;
  target_value: string | null;
  created_at: string;
  audience: number;
  read: number;
}

export async function listSentNotifications(): Promise<SentNotification[]> {
  const [{ data: rows, error }, audiences, reads] = await Promise.all([
    supabaseAdmin
      .from("system_notifications")
      .select("id, title, body, kind, target_kind, target_value, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    buildNotificationAudiences(),
    buildNotificationReads(),
  ]);
  if (error) throw new Error(error.message);
  return (rows ?? []).map((r) => ({
    ...r,
    audience: audienceCount(audiences, r.target_kind, r.target_value ?? null),
    read: reads.get(r.id) ?? 0,
  }));
}

/** Real industries and plans currently in use — the only targets a send can name. */
export async function listNotificationTargets() {
  const [businesses, configs] = await Promise.all([
    supabaseAdmin.from("businesses").select("id, name, plan").order("name"),
    supabaseAdmin.from("crm_configs").select("industry"),
  ]);
  for (const res of [businesses, configs]) if (res.error) throw new Error(res.error.message);
  const industries = [...new Set((configs.data ?? []).map((c) => c.industry).filter(Boolean))].sort() as string[];
  // Plans a send cannot name are not offered: until the plan-vocabulary migration runs,
  // a stored legacy name would appear here and then be rejected by the send itself.
  const { PLAN_IDS } = await import("./billing");
  const live = new Set((businesses.data ?? []).map((b) => b.plan));
  const plans = PLAN_IDS.filter((p) => live.has(p));
  return { businesses: businesses.data ?? [], industries, plans };
}

/* ------------------------------ error trail ------------------------------- */

/** Server-side failure trail for the pilot. One row per fingerprint per bucket. */
export async function listErrorEvents(filters: { hours: number; route?: string | undefined; limit: number }) {
  const since = new Date(Date.now() - filters.hours * 60 * 60 * 1000).toISOString();
  let query = supabaseAdmin
    .from("error_events")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(filters.limit);
  if (filters.route && filters.route !== "all") query = query.eq("route", filters.route);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return {
    rows,
    routes: Array.from(new Set(rows.map((row) => row.route).filter(Boolean))).sort(),
    count: rows.length,
  };
}

/** Clears a resolved fingerprint, or prunes everything older than N days. */
export async function clearErrorEvents(input: { fingerprint?: string | undefined; olderThanDays?: number | undefined }) {
  if (!input.fingerprint && input.olderThanDays == null) {
    throw new Error("Fingerprint yoki necha kundandan eski ekanligini ko'rsating.");
  }
  let query = supabaseAdmin.from("error_events").delete();
  if (input.fingerprint) query = query.eq("fingerprint", input.fingerprint);
  if (input.olderThanDays != null) {
    query = query.lt("created_at", new Date(Date.now() - input.olderThanDays * DAY).toISOString());
  }
  const { data, error } = await query.select("id");
  if (error) throw new Error(error.message);
  return { deleted: (data ?? []).length };
}
