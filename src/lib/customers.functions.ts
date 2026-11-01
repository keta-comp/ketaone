import { createServerFn } from "@tanstack/react-start";
import type { DbClient } from "./pg-rest.server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { withAssigneeName, withAssigneeNames } from "./assignee.server";
import { compact } from "./compact";
import { can, isAdminRole, type MemberRole } from "./roles";
import { requireBusinessId } from "./tenant.server";

type Client = DbClient;

/** Tenant and role resolved server-side; the database re-checks both through RLS. */
async function memberContext(supabase: Client): Promise<{ businessId: string; role: MemberRole | null }> {
  const businessId = await requireBusinessId(supabase);
  const { data: role, error } = await supabase.rpc("business_role", { _business_id: businessId });
  if (error) throw new Error(error.message);
  return { businessId, role: (role ?? null) as MemberRole | null };
}

const customerInput = z.object({
  id: z.string().optional(),
  full_name: z.string().min(1, "Ism kiritilishi shart"),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  assigned_member_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const listCrmCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().optional(),
        status: z.string().optional(),
        source: z.string().optional(),
        memberId: z.string().optional(),
        sort: z.enum(["recent", "name", "spent"]).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("customers")
      .select(
        "id, full_name, phone, email, location, status, source, notes, total_orders, total_spent, last_contact_at, last_interaction_at, created_at, assigned_member_id, telegram_username, marketing_consent, erased_at",
      )
      .limit(500);

    if (data.status && data.status !== "all") query = query.eq("status", data.status);
    if (data.source && data.source !== "all") query = query.eq("source", data.source);
    if (data.memberId && data.memberId !== "all")
      query = query.eq("assigned_member_id", data.memberId);
    if (data.search) {
      const term = data.search.replace(/[,()]/g, " ");
      query = query.or(
        `full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,telegram_username.ilike.%${term}%`,
      );
    }

    if (data.sort === "name") query = query.order("full_name", { ascending: true });
    else if (data.sort === "spent") query = query.order("total_spent", { ascending: false });
    else query = query.order("last_interaction_at", { ascending: false });

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return withAssigneeNames(context.supabase, rows ?? []);
  });

export const saveCrmCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => customerInput.parse(input))
  .handler(async ({ data, context }) => {
    const businessId = await requireBusinessId(context.supabase);
    // Mijozni kimning javobgar ekanini bizning jamemizdan tanlaymiz: RLS begona
    // a'zoni ko'rsatmaydi, lekin bizning mijozimizga begona ID yozishga to'shmaydi.
    if (data.assigned_member_id) {
      const { data: ownMember, error: memberError } = await context.supabase
        .from("business_members")
        .select("id")
        .eq("business_id", businessId)
        .eq("id", data.assigned_member_id)
        .maybeSingle();
      if (memberError) throw new Error(memberError.message);
      if (!ownMember) throw new Error("Mas'ul a'zo topilmadi — ro'yxatdan qayta tanlang.");
    }
    const { logActivity } = await import("./activity.server");
    const { id, ...payload } = data;

    if (id) {
      const { error } = await context.supabase
        .from("customers")
        .update(compact(payload) as never)
        .eq("id", id);
      if (error) throw new Error(error.message);
      await logActivity(context.supabase, {
        entityType: "customer",
        entityId: id,
        customerId: id,
        action: "customer_updated",
        detail: `${payload.full_name} ma’lumotlari yangilandi`,
        actorUserId: context.userId,
      });
      return { id };
    }

    const { data: created, error } = await context.supabase
      .from("customers")
      .insert(compact(payload) as never)
      .select("id, full_name")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(context.supabase, {
      entityType: "customer",
      entityId: created.id,
      customerId: created.id,
      action: "customer_created",
      detail: `${created.full_name ?? "Mijoz"} yaratildi`,
      actorUserId: context.userId,
    });
    return created;
  });

export const getCustomerProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const { role } = await memberContext(context.supabase);
    const [customer, orders, payments, tasks, activities, conversations] = await Promise.all([
      context.supabase
        .from("customers")
        .select("*")
        .eq("id", data.id)
        .single(),
      context.supabase
        .from("orders")
        .select("id, order_number, status, payment_status, total, discount, created_at")
        .eq("customer_id", data.id)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("payments")
        .select("id, amount, method, status, paid_at, due_date, note, created_at, order_id, orders(order_number)")
        .eq("customer_id", data.id)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("tasks")
        .select("id, title, status, priority, due_date, created_at")
        .eq("customer_id", data.id)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("activities")
        .select("id, action, detail, actor, created_at")
        .eq("customer_id", data.id)
        .order("created_at", { ascending: false })
        .limit(100),
      context.supabase
        .from("conversations")
        .select("id, channel, mode, last_message_preview, last_message_at")
        .eq("customer_id", data.id)
        .order("last_message_at", { ascending: false }),
    ]);
    if (customer.error) throw new Error(customer.error.message);
    const namedCustomer = await withAssigneeName(context.supabase, customer.data);
    return {
      customer: namedCustomer,
      canErase: isAdminRole(role),
      canConsent: can(role, "sales.manage"),
      orders: orders.data ?? [],
      payments: payments.data ?? [],
      tasks: tasks.data ?? [],
      activities: activities.data ?? [],
      conversations: conversations.data ?? [],
    };
  });

/* ------------------------- privacy: consent, export, erasure ------------------------ */

export const setCustomerConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string(), marketing_consent: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { role } = await memberContext(context.supabase);
    if (!can(role, "sales.manage")) throw new Error("Rozilikni mijoz bilan ishlaydigan xodim yangilaydi.");

    const { error } = await context.supabase
      .from("customers")
      .update({ marketing_consent: data.marketing_consent, consent_updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    const { logActivity } = await import("./activity.server");
    await logActivity(context.supabase, {
      entityType: "customer",
      entityId: data.id,
      customerId: data.id,
      action: data.marketing_consent ? "marketing_consent_granted" : "marketing_consent_revoked",
      detail: data.marketing_consent ? "Rozilik berildi" : "Rozilik bekor qilindi",
      actorUserId: context.userId,
    });
    return { ok: true };
  });

/** Copy of everything the workspace holds about one customer (brief 5.4 access request). */
export const exportCustomerData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await memberContext(context.supabase);

    const [customer, appointments, leads, orders, payments, tasks, activities, conversations] = await Promise.all([
      context.supabase.from("customers").select("*").eq("id", data.id).maybeSingle(),
      context.supabase
        .from("appointments")
        .select("id, starts_at, ends_at, status, service_name, price, employee_id, branch_id, created_at")
        .eq("customer_id", data.id)
        .order("starts_at", { ascending: false })
        .limit(1000),
      context.supabase.from("leads").select("*").eq("customer_id", data.id).limit(500),
      context.supabase.from("orders").select("*").eq("customer_id", data.id).limit(500),
      context.supabase.from("payments").select("*").eq("customer_id", data.id).limit(500),
      context.supabase.from("tasks").select("*").eq("customer_id", data.id).limit(500),
      context.supabase.from("activities").select("*").eq("customer_id", data.id).limit(500),
      context.supabase.from("conversations").select("*").eq("customer_id", data.id).limit(200),
    ]);
    if (customer.error) throw new Error(customer.error.message);
    if (!customer.data) throw new Error("Mijoz topilmadi.");

    const conversationIds = (conversations.data ?? []).map((row) => row.id);
    const messages = conversationIds.length
      ? await context.supabase
          .from("messages")
          .select("id, role, content, created_at, metadata")
          .in("conversation_id", conversationIds)
          .limit(2000)
      : { data: [], error: null };

    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorUserId: context.userId,
      action: "customer_data_exported",
      targetType: "customer",
      targetId: data.id,
      businessId: customer.data.business_id,
      metadata: { appointments: appointments.data?.length ?? 0, messages: (messages.data ?? []).length },
    });

    return {
      exported_at: new Date().toISOString(),
      customer: customer.data,
      appointments: appointments.data ?? [],
      leads: leads.data ?? [],
      orders: orders.data ?? [],
      payments: payments.data ?? [],
      tasks: tasks.data ?? [],
      activities: activities.data ?? [],
      conversations: conversations.data ?? [],
      messages: messages.data ?? [],
    };
  });

/**
 * Legal erasure (brief 5.4): identity and communication content go, the financial
 * records that accounting requires stay behind an anonymous customer id.
 */
export const eraseCrmCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string(),
        confirm: z.literal(true, { errorMap: () => ({ message: "O'chirishni tasdiqlang" }) }),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { businessId, role } = await memberContext(context.supabase);
    if (!isAdminRole(role)) {
      throw new Error("Mijoz ma’lumotlarini o’chirish faqat ego yoki admin uchun.");
    }

    const { data: customer, error: loadError } = await context.supabase
      .from("customers")
      .select("id, full_name, erased_at")
      .eq("id", data.id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!customer) throw new Error("Mijoz topilmadi.");
    if (customer.erased_at) throw new Error("Bu mijoz ma’lumotlari allaqachon o’chirilgan.");

    const { data: chats } = await context.supabase
      .from("conversations")
      .select("id")
      .eq("customer_id", data.id);
    const conversationIds = (chats ?? []).map((row) => row.id);

    // Messages first: conversations cascade-delete their rows in some setups.
    if (conversationIds.length) {
      const { error: messageError } = await context.supabase
        .from("messages")
        .delete()
        .in("conversation_id", conversationIds);
      if (messageError) throw new Error(messageError.message);
    }
    const [conversations, activities] = await Promise.all([
      context.supabase.from("conversations").delete().eq("customer_id", data.id).select("id"),
      context.supabase.from("activities").delete().eq("customer_id", data.id).select("id"),
    ]);

    const erasedAt = new Date().toISOString();
    const { error } = await context.supabase
      .from("customers")
      .update({
        full_name: "O’chirilgan mijoz",
        phone: null,
        email: null,
        location: null,
        notes: "",
        telegram_user_id: null,
        telegram_username: null,
        instagram_user_id: null,
        marketing_consent: false,
        consent_updated_at: erasedAt,
        erased_at: erasedAt,
        erased_by: context.userId,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    const { logActivity } = await import("./activity.server");
    await logActivity(context.supabase, {
      entityType: "customer",
      entityId: data.id,
      action: "customer_erased",
      detail: `${customer.full_name ?? "Mijoz"} — PII o’chirildi, moliyaviy yozuvlar saqlandi`,
      actorUserId: context.userId,
    });
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorUserId: context.userId,
      action: "customer_data_erased",
      targetType: "customer",
      targetId: data.id,
      targetLabel: customer.full_name,
      businessId,
      metadata: {
        conversations: conversations.data?.length ?? 0,
        activities: activities.data?.length ?? 0,
      },
    });
    return {
      ok: true,
      erased_at: erasedAt,
      conversations_removed: conversations.data?.length ?? 0,
      activities_removed: activities.data?.length ?? 0,
    };
  });
