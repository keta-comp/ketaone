import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { requirePermission } from "./guards.server";
import { compact } from "./compact";

export const listCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ search: z.string().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("customers")
      .select("*")
      .order("last_interaction_at", { ascending: false })
      .limit(300);
    if (data.search)
      query = query.or(
        `full_name.ilike.%${data.search}%,telegram_username.ilike.%${data.search}%,phone.ilike.%${data.search}%`,
      );
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows;
  });

export const getCustomer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const [customer, orders, conversations] = await Promise.all([
      context.supabase.from("customers").select("*").eq("id", data.id).single(),
      context.supabase
        .from("orders")
        .select("*")
        .eq("customer_id", data.id)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("conversations")
        .select("*")
        .eq("customer_id", data.id)
        .order("last_message_at", { ascending: false }),
    ]);
    if (customer.error) throw new Error(customer.error.message);
    return {
      customer: customer.data,
      orders: orders.data ?? [],
      conversations: conversations.data ?? [],
    };
  });

export const updateCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string(),
        full_name: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requirePermission(
      context.supabase,
      "sales.manage",
      "Sotuv va to'lovlarni faqat ruxsatli xodimlar yuritadi.",
    );
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("customers")
      .update(compact(patch) as never)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
