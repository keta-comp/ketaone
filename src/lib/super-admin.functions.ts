import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { PLAN_IDS } from "./billing";

/** Every function here verifies platform-level authorization inside the handler.
 *  Frontend route guards are convenience only — this is the real boundary. */
async function requireSuperAdmin(context: { supabase: any; userId: string; claims?: any }) {
  const { data, error } = await context.supabase.rpc("is_super_admin");
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Ruxsat yo‘q: faqat Super Admin");
  const { data: profile } = await context.supabase
    .from("profiles")
    .select("email")
    .eq("id", context.userId)
    .maybeSingle();
  return { email: (profile?.email as string | null) ?? null };
}

export const amISuperAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("is_super_admin");
    return data === true;
  });

export const getPlatformOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context);
    const { buildOverview } = await import("./super-admin.server");
    return buildOverview();
  });

export const listOrganizationsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().optional(),
        industry: z.string().optional(),
        plan: z.string().optional(),
        status: z.string().optional(),
        sort: z.string().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const { listOrganizations } = await import("./super-admin.server");
    return listOrganizations(data);
  });

export const getOrganization = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const { getOrganizationDetail } = await import("./super-admin.server");
    return getOrganizationDetail(data.id);
  });

const ORG_STATUSES = ["active", "trial", "suspended", "cancelled"] as const;

export const setOrganizationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(ORG_STATUSES),
        reason: z.string().max(400).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireSuperAdmin(context);
    const { supabaseAdmin } = await import("@/lib/platform.server");
    const { logAudit } = await import("./audit.server");

    const { data: business, error: readError } = await supabaseAdmin
      .from("businesses")
      .select("name, status")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!business) throw new Error("Organization topilmadi");

    const { error } = await supabaseAdmin
      .from("businesses")
      .update({
        status: data.status,
        suspended_at: data.status === "suspended" ? new Date().toISOString() : null,
        suspend_reason: data.status === "suspended" ? data.reason ?? null : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await logAudit({
      actorUserId: context.userId,
      actorEmail: actor.email,
      actorKind: "super_admin",
      action: data.status === "suspended" ? "organization_suspended" : "organization_reactivated",
      targetType: "organization",
      targetId: data.id,
      targetLabel: business?.name ?? null,
      businessId: data.id,
      metadata: { from: business?.status ?? null, to: data.status, reason: data.reason ?? null },
    });
    return { ok: true };
  });

export const setOrganizationPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), plan: z.enum(PLAN_IDS) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireSuperAdmin(context);
    const { supabaseAdmin } = await import("@/lib/platform.server");
    const { logAudit } = await import("./audit.server");

    const { data: business, error: readError } = await supabaseAdmin
      .from("businesses")
      .select("name, plan")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!business) throw new Error("Organization topilmadi");

    const { error } = await supabaseAdmin.from("businesses").update({ plan: data.plan }).eq("id", data.id);
    if (error) throw new Error(error.message);

    await logAudit({
      actorUserId: context.userId,
      actorEmail: actor.email,
      actorKind: "super_admin",
      action: "plan_changed",
      targetType: "organization",
      targetId: data.id,
      targetLabel: business?.name ?? null,
      businessId: data.id,
      metadata: { from: business?.plan ?? null, to: data.plan },
    });
    return { ok: true };
  });

export const listUsersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ search: z.string().optional(), status: z.string().optional(), role: z.string().optional() })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const { listPlatformUsers } = await import("./super-admin.server");
    return listPlatformUsers(data);
  });

export const getPlatformUser = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const { getUserDetail } = await import("./super-admin.server");
    return getUserDetail(data.id);
  });

export const setUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["active", "suspended", "pending"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireSuperAdmin(context);
    if (data.id === context.userId) throw new Error("O‘z hisobingizni bloklay olmaysiz");
    const { supabaseAdmin } = await import("@/lib/platform.server");
    const { logAudit } = await import("./audit.server");

    const { data: target, error: readError } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name, status")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!target) throw new Error("Foydalanuvchi topilmadi");

    // Auth qatori birinchi: shu yozilmagan "Bloklash" kirishni to'xtatmaydi,
    // shuning uchun xato bo'lsa profil belgisi ham o'zgarmay qoladi.
    const { applyAccountBan } = await import("./super-admin.server");
    const ban = await applyAccountBan(data.id, data.status === "suspended");

    const { error } = await supabaseAdmin.from("profiles").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);

    await logAudit({
      actorUserId: context.userId,
      actorEmail: actor.email,
      actorKind: "super_admin",
      action: data.status === "suspended" ? "user_suspended" : "user_reactivated",
      targetType: "user",
      targetId: data.id,
      targetLabel: target.email ?? target.full_name ?? null,
      metadata: { from: target.status, to: data.status, sessionsCleared: ban.sessionsCleared },
    });
    return { ok: true, sessionsCleared: ban.sessionsCleared };
  });

/** Changing a role is always scoped to one workspace: an unscoped update would rewrite
 *  the role of this user in every organization they belong to. */
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        businessId: z.string().uuid(),
        role: z.enum(["owner", "admin", "manager", "receptionist", "cashier"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireSuperAdmin(context);
    const { supabaseAdmin } = await import("@/lib/platform.server");
    const { logAudit } = await import("./audit.server");

    const [{ data: target, error: profileError }, { data: adminRow, error: adminError }] = await Promise.all([
      supabaseAdmin.from("profiles").select("email, full_name").eq("id", data.id).maybeSingle(),
      supabaseAdmin.from("platform_admins").select("user_id").eq("user_id", data.id).maybeSingle(),
    ]);
    if (profileError) throw new Error(profileError.message);
    if (adminError) throw new Error(adminError.message);
    if (!target) throw new Error("Foydalanuvchi topilmadi");
    if (adminRow) throw new Error("Platforma administratorining rolini o‘zgartirib bo‘lmaydi");

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("business_members")
      .select("id, role")
      .eq("user_id", data.id)
      .eq("business_id", data.businessId)
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (!membership) throw new Error("Foydalanuvchi bu organization’ning a’zosi emas");

    const { error } = await supabaseAdmin
      .from("business_members")
      .update({ role: data.role })
      .eq("id", membership.id);
    if (error) throw new Error(error.message);

    // user_roles only feeds the platform-wide role label; drop the stale row first so
    // a failed insert can never leave the account with two roles or none at all.
    const { error: dropError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.id)
      .neq("role", data.role);
    if (dropError) throw new Error(dropError.message);
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.id, role: data.role }, { onConflict: "user_id,role" });
    if (roleError) throw new Error(roleError.message);

    await logAudit({
      actorUserId: context.userId,
      actorEmail: actor.email,
      actorKind: "super_admin",
      action: "role_changed",
      targetType: "user",
      targetId: data.id,
      targetLabel: target.email ?? target.full_name ?? null,
      businessId: data.businessId,
      metadata: { from: membership.role, to: data.role },
    });
    return { ok: true };
  });

/** Administrator parolni qo'lda almashtiradi.
 *
 *  Email orqali tiklash bu deployment'da mavjud emas (Neon Auth'da
 *  `/forget-password` route'i yo'q), shuning uchun yagona haqiqiy yo'l — admin
 *  plagidagi set-user-password. Chaqiruvchi sessiyasi Neon Auth'ga uzatiladi. */
export const setUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), password: z.string().min(8).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireSuperAdmin(context);
    const { supabaseAdmin } = await import("@/lib/platform.server");
    const { logAudit } = await import("./audit.server");

    const { data: target, error: readError } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!target) throw new Error("Foydalanuvchi topilmadi");

    const { adminSetPassword } = await import("./auth.server");
    await adminSetPassword(data.id, data.password);

    // Parol matni hech qayerda saqlanmaydi — faqat fakt yoziladi.
    await logAudit({
      actorUserId: context.userId,
      actorEmail: actor.email,
      actorKind: "super_admin",
      action: "user_password_set",
      targetType: "user",
      targetId: data.id,
      targetLabel: target.email ?? target.full_name ?? null,
    });
    return { ok: true };
  });

export const previewUserDeletion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const { previewAccountDeletion } = await import("./super-admin.server");
    return previewAccountDeletion(data.id);
  });

/** O'chirish qaytarib bo'lmaydi: bloklangan hisob kirishni yo'qotadi, o'chirilgan
 *  hisob esa butun organizatsiyasi bilan ketadi. Shuning uchun kalit so'z bilan
 *  tasdiq, o'zini va oxirgi administratorni o'chirish taqiqlanadi. */
export const deletePlatformUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), confirm: z.string() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireSuperAdmin(context);
    if (data.id === context.userId) throw new Error("O‘z hisobingizni o‘chira olmaysiz");
    if (data.confirm !== "O‘CHIRISH") throw new Error("Tasdiq matni mos kelmadi");
    const { logAudit } = await import("./audit.server");
    const { previewAccountDeletion, deleteAccount } = await import("./super-admin.server");

    const preview = await previewAccountDeletion(data.id);
    if (preview.isPlatformAdmin && preview.adminsTotal <= 1)
      throw new Error("Bu — platformadagi oxirgi administrator, uni o'chirish darvozani yopadi");

    const removed = await deleteAccount(data.id);
    await logAudit({
      actorUserId: context.userId,
      actorEmail: actor.email,
      actorKind: "super_admin",
      action: "user_deleted",
      targetType: "user",
      targetId: data.id,
      targetLabel: preview.email,
      metadata: { ...removed, businessesOwned: preview.businessesOwned },
    });
    return { ok: true, ...removed };
  });

export const getSaasAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ from: z.string(), to: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const { buildSaasAnalytics } = await import("./super-admin.server");
    return buildSaasAnalytics(data.from, data.to);
  });

export const getAiUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ from: z.string(), to: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const { buildAiUsage } = await import("./super-admin.server");
    return buildAiUsage(data.from, data.to);
  });

export const getAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        action: z.string().optional(),
        businessId: z.string().optional(),
        search: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const { listAuditLogs } = await import("./super-admin.server");
    return listAuditLogs(data);
  });

export const getSecurityOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context);
    const { buildSecurityOverview } = await import("./super-admin.server");
    return buildSecurityOverview();
  });

export const superAdminSearch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ term: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const term = data.term.trim();
    if (term.length < 2) return [];
    const { platformSearch } = await import("./super-admin.server");
    return platformSearch(term);
  });

export const getSystemSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context);
    const { supabaseAdmin } = await import("@/lib/platform.server");
    const { data } = await supabaseAdmin.from("system_settings").select("*").limit(1).maybeSingle();
    return data;
  });

export const saveSystemSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        platform_name: z.string().min(1),
        support_email: z.string().email(),
        support_phone: z.string().min(3),
        default_timezone: z.string().min(1),
        default_currency: z.string().min(1),
        maintenance_mode: z.boolean(),
        maintenance_message: z.string().max(500).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireSuperAdmin(context);
    const { supabaseAdmin } = await import("@/lib/platform.server");
    const { logAudit } = await import("./audit.server");

    const payload = { ...data, maintenance_message: data.maintenance_message ?? null };
    const { data: current } = await supabaseAdmin.from("system_settings").select("id").limit(1).maybeSingle();
    if (current) {
      const { error } = await supabaseAdmin.from("system_settings").update(payload).eq("id", current.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("system_settings").insert(payload);
      if (error) throw new Error(error.message);
    }

    await logAudit({
      actorUserId: context.userId,
      actorEmail: actor.email,
      actorKind: "super_admin",
      action: "system_settings_changed",
      targetType: "system",
      metadata: { maintenance_mode: data.maintenance_mode },
    });
    return { ok: true };
  });

export const getFeatureFlags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context);
    const { supabaseAdmin } = await import("@/lib/platform.server");
    const [{ data: flags }, { data: businesses }] = await Promise.all([
      supabaseAdmin.from("feature_flags").select("*").order("label"),
      supabaseAdmin.from("businesses").select("id, name, plan").order("name"),
    ]);
    return { flags: flags ?? [], businesses: businesses ?? [] };
  });

export const saveFeatureFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        key: z.string().min(1),
        label: z.string().min(1),
        enabled: z.boolean(),
        target_plan: z.string().nullable().optional(),
        target_business_id: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireSuperAdmin(context);
    const { supabaseAdmin } = await import("@/lib/platform.server");
    const { logAudit } = await import("./audit.server");

    const { error } = await supabaseAdmin.from("feature_flags").upsert(
      {
        key: data.key,
        label: data.label,
        enabled: data.enabled,
        target_plan: data.target_plan ?? null,
        target_business_id: data.target_business_id ?? null,
      },
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);

    await logAudit({
      actorUserId: context.userId,
      actorEmail: actor.email,
      actorKind: "super_admin",
      action: "feature_flag_changed",
      targetType: "feature_flag",
      targetId: data.key,
      targetLabel: data.label,
      metadata: { enabled: data.enabled, target_plan: data.target_plan ?? null },
    });
    return { ok: true };
  });

export const listSystemNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context);
    const { listSentNotifications } = await import("./super-admin.server");
    return listSentNotifications();
  });

/** The real choices the send form may offer: only plans/organizations/industries that
 *  exist in the database, because those are exactly what the delivery policy matches on. */
export const getNotificationTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context);
    const { listNotificationTargets } = await import("./super-admin.server");
    return listNotificationTargets();
  });

export const sendSystemNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().min(2).max(120),
        body: z.string().min(2).max(1000),
        kind: z.enum(["info", "warning", "maintenance"]),
        target_kind: z.enum(["all", "organization", "plan", "industry"]),
        target_value: z.string().max(200).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireSuperAdmin(context);
    const { supabaseAdmin } = await import("@/lib/platform.server");
    const { logAudit } = await import("./audit.server");
    const { audienceCount, buildNotificationAudiences } = await import("./super-admin.server");

    if (data.target_kind === "all") {
      data.target_value = null;
    } else if (!data.target_value) {
      throw new Error("Maqsadni tanlang");
    }

    // A target that matches nothing would deliver the announcement to zero people
    // while the journal still says "sent" — so the value is resolved before inserting.
    const audiences = await buildNotificationAudiences();
    if (data.target_kind === "organization") {
      if (!audiences.byBusiness.has(data.target_value as string)) {
        throw new Error("Organization topilmadi yoki bloklangan.");
      }
    } else if (data.target_kind === "plan") {
      if (!(PLAN_IDS as readonly string[]).includes(data.target_value as string)) {
        throw new Error("Bunday plan mavjud emas.");
      }
    }

    const audience = audienceCount(audiences, data.target_kind, data.target_value ?? null);
    if (audience === 0) throw new Error("Bu maqsadga mos faol foydalanuvchi yo‘q — e’lon yuborilmadi.");

    const { data: created, error } = await supabaseAdmin
      .from("system_notifications")
      .insert({
        title: data.title,
        body: data.body,
        kind: data.kind,
        target_kind: data.target_kind,
        target_value: data.target_value ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await logAudit({
      actorUserId: context.userId,
      actorEmail: actor.email,
      actorKind: "super_admin",
      action: "notification_sent",
      targetType: "notification",
      targetId: created?.id ?? null,
      targetLabel: data.title,
      metadata: { kind: data.kind, target: data.target_kind, value: data.target_value ?? null, audience },
    });
    return { ok: true, id: created?.id ?? null, audience };
  });

/** Withdrawing an announcement also drops its read receipts (FK ON DELETE CASCADE). */
export const deleteSystemNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const actor = await requireSuperAdmin(context);
    const { supabaseAdmin } = await import("@/lib/platform.server");
    const { logAudit } = await import("./audit.server");

    const { data: removed, error } = await supabaseAdmin
      .from("system_notifications")
      .delete()
      .eq("id", data.id)
      .select("id, title");
    if (error) throw new Error(error.message);
    if ((removed ?? []).length === 0) throw new Error("E’lon topilmadi");

    await logAudit({
      actorUserId: context.userId,
      actorEmail: actor.email,
      actorKind: "super_admin",
      action: "notification_revoked",
      targetType: "notification",
      targetId: data.id,
      targetLabel: removed?.[0]?.title ?? null,
    });
    return { ok: true };
  });

export const exportPlatformExcel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: z.enum(["organizations", "users", "analytics", "usage"]),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const { buildWorkbookBase64 } = await import("./excel.server");
    const { listOrganizations, listPlatformUsers, buildSaasAnalytics, buildAiUsage } = await import(
      "./super-admin.server"
    );

    const from = data.from ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const to = data.to ?? new Date().toISOString();

    if (data.kind === "organizations") {
      const { rows } = await listOrganizations({});
      return {
        filename: "organizations.xlsx",
        base64: buildWorkbookBase64([
          {
            name: "Organizations",
            rows: rows.map((r) => ({
              Organization: r.name,
              Owner: r.ownerName ?? "",
              Email: r.ownerEmail ?? "",
              Soha: r.industry ?? "",
              Foydalanuvchilar: r.users,
              Plan: r.plan,
              Holat: r.status,
              Yaratilgan: r.createdAt,
              "Oxirgi faollik": r.lastActiveAt ?? "",
            })),
          },
        ]),
      };
    }

    if (data.kind === "users") {
      const rows = await listPlatformUsers({});
      return {
        filename: "users.xlsx",
        base64: buildWorkbookBase64([
          {
            name: "Users",
            rows: rows.map((r) => ({
              Ism: r.name ?? "",
              Email: r.email ?? "",
              Telefon: r.phone ?? "",
              Organization: r.organization ?? "",
              Rol: r.role,
              Soha: r.industry ?? "",
              Holat: r.status,
              Yaratilgan: r.createdAt,
              "Oxirgi faollik": r.lastActiveAt ?? "",
            })),
          },
        ]),
      };
    }

    if (data.kind === "analytics") {
      const report = await buildSaasAnalytics(from, to);
      return {
        filename: "analytics.xlsx",
        base64: buildWorkbookBase64([
          {
            name: "Umumiy",
            rows: [
              { "Ko‘rsatkich": "Yangi organizationlar", Qiymat: report.newOrganizations },
              { "Ko‘rsatkich": "Yangi foydalanuvchilar", Qiymat: report.newUsers },
              { "Ko‘rsatkich": "Faol organizationlar", Qiymat: report.activeOrganizations },
              { "Ko‘rsatkich": "Faol foydalanuvchilar", Qiymat: report.activeUsers },
              { "Ko‘rsatkich": "Retention %", Qiymat: report.retention ?? "ma’lumot yetarli emas" },
              { "Ko‘rsatkich": "Churn %", Qiymat: report.churn ?? "ma’lumot yetarli emas" },
            ],
          },
          { name: "O‘sish", rows: report.growth },
          { name: "Sohalar", rows: report.industries },
        ]),
      };
    }

    const usage = await buildAiUsage(from, to);
    return {
      filename: "ai-usage.xlsx",
      base64: buildWorkbookBase64([
        {
          name: "Umumiy",
          rows: [
            { "Ko‘rsatkich": "Jami so‘rovlar", Qiymat: usage.totals.total },
            { "Ko‘rsatkich": "Bugun", Qiymat: usage.totals.today },
            { "Ko‘rsatkich": "Bu oy", Qiymat: usage.totals.thisMonth },
          ],
        },
        {
          name: "Organizationlar",
          rows: usage.byOrganization.map((o) => ({
            Organization: o.label,
            "So‘rovlar": o.requests,
            Tokenlar: o.tokens,
          })),
        },
        {
          name: "Foydalanuvchilar",
          rows: usage.byUser.map((u) => ({ Foydalanuvchi: u.label, "So‘rovlar": u.requests, Tokenlar: u.tokens })),
        },
      ]),
    };
  });

/* -------------------------------- errors ---------------------------------- */

export const listErrorEventsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        hours: z.number().int().min(1).max(720).default(24),
        route: z.string().max(300).optional(),
        limit: z.number().int().min(10).max(500).default(200),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context);
    const { listErrorEvents } = await import("./super-admin.server");
    return listErrorEvents(data);
  });

export const clearErrorEventsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        fingerprint: z.string().min(1).max(600).optional(),
        olderThanDays: z.number().int().min(0).max(365).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireSuperAdmin(context);
    const { logAudit } = await import("./audit.server");
    const { clearErrorEvents } = await import("./super-admin.server");
    const result = await clearErrorEvents(data);
    await logAudit({
      actorUserId: context.userId,
      actorEmail: actor.email,
      actorKind: "super_admin",
      action: "error_events_cleared",
      targetType: "error_events",
      metadata: { ...data, deleted: result.deleted },
    });
    return result;
  });
