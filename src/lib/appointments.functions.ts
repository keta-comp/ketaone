import { createServerFn } from "@tanstack/react-start";
import type { DbClient } from "./pg-rest.server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { requirePermission } from "./guards.server";
import { DEPOSIT_METHODS, DEPOSIT_TYPES, depositFor, depositState } from "@/lib/deposit";
import {
  DEFAULT_BUSINESS_TZ,
  APPOINTMENT_STATUSES,
  BOOKED_STATUSES,
  appointmentEnd,
  dayWindows,
  fitsInWindows,
  isWithinTimeOff,
  zonedParts,
} from "./booking";
import { requireBusinessId } from "./tenant.server";

type Client = DbClient;

/** Booking is open to every workspace member; RLS keeps rows tenant-scoped. */
async function requireBookingBusiness(supabase: Client): Promise<string> {
  return requireBusinessId(supabase);
}

/**
 * Tanlangan obyektlar shu biznesniki — tekshiriladi. RLS begona qatorni ko'rsatmaydi,
 * lekin o'z qatorimizga begona `id` yozishga to'sqinlik qilmaydi: natijada narxi
 * bo'lmagan qabul yoki chet biznesning mijoziga bog'lanib qolgan yozuv chiqadi.
 */
async function assertOwnRecord(
  supabase: Client,
  businessId: string,
  table: "customers" | "employees" | "branches",
  id: string,
  label: string,
): Promise<void> {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("business_id", businessId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`${label} topilmadi — ro'yxatdan qayta tanlang.`);
}

/**
 * Server-side availability: the appointment must fall inside the employee's weekly
 * working windows (when defined) and must not overlap any recorded time off.
 * The DB exclusion constraint still guards against concurrent double-booking.
 */
async function assertEmployeeAvailable(
  supabase: Client,
  employeeId: string,
  startsAt: string,
  endsAt: string,
  durationMinutes: number,
): Promise<void> {
  const [{ data: schedule }, { data: timeOff }] = await Promise.all([
    supabase.from("work_schedules").select("*").eq("employee_id", employeeId),
    supabase
      .from("time_off")
      .select("starts_at, ends_at")
      .eq("employee_id", employeeId)
      .lt("starts_at", endsAt)
      .gt("ends_at", startsAt),
  ]);

  if ((timeOff ?? []).length > 0) {
    throw new Error("Xodim bu vaqtda ta'tilda.");
  }

  const dayRows = schedule ?? [];
  if (dayRows.length === 0) return; // no schedule configured → availability unconstrained

  const { weekday, minutes } = zonedParts(startsAt, DEFAULT_BUSINESS_TZ);
  const windows = dayWindows(dayRows.filter((row) => row.weekday === weekday));
  if (windows.length === 0) {
    throw new Error("Xodim bu kunda ishlamaydi.");
  }
  if (!fitsInWindows(minutes, durationMinutes, windows)) {
    throw new Error("Bron xodim ish vaqtidan tashqarida.");
  }
}

/* -------------------------------- services ------------------------------- */

export const listServices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ includeInactive: z.boolean().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireBookingBusiness(context.supabase);
    let query = context.supabase.from("services").select("*").order("name", { ascending: true });
    if (!data.includeInactive) query = query.eq("is_active", true);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(120),
        duration_minutes: z.number().int().positive().max(1440),
        price: z.number().nonnegative(),
        is_active: z.boolean().optional(),
        deposit_type: z.enum(DEPOSIT_TYPES).optional(),
        deposit_value: z.number().nonnegative().max(1_000_000_000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePermission(
      context.supabase,
      "catalog.manage",
      "Katalogni faqat egasi, admin yoki menejer boshqaradi.",
    );
    // Qoida yuborilmagani saqlanadi: ro'yxatdagi faqat "faol" tugmasi bosilganda
    // depozit sozlamasining o'chib ketmasligi shundan.
    let depositPatch: Record<string, unknown> = {};
    if (data.deposit_type) {
      const value = data.deposit_type === "none" ? 0 : (data.deposit_value ?? 0);
      if (data.deposit_type === "percent" && value > 100) {
        throw new Error("Depozit foizi 100 dan oshmasligi kerak.");
      }
      depositPatch = { deposit_type: data.deposit_type, deposit_value: value };
    }
    const row = {
      name: data.name,
      duration_minutes: data.duration_minutes,
      price: data.price,
      ...depositPatch,
    };
    if (data.id) {
      const patch = data.is_active === undefined ? row : { ...row, is_active: data.is_active };
      const { error } = await context.supabase.from("services").update(patch).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase.from("services").insert({
        ...row,
        is_active: data.is_active ?? true,
        business_id: businessId,
        created_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await requirePermission(
      context.supabase,
      "catalog.manage",
      "Katalogni faqat egasi, admin yoki menejer boshqaradi.",
    );
    const { error } = await context.supabase.from("services").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------ appointments ----------------------------- */

const APPOINTMENT_SELECT =
  "*, services(id, name, duration_minutes, price), customers(id, full_name, phone), employees:employee_id(id, full_name), branches(id, name)";

export const listAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        employeeId: z.string().optional(),
        branchId: z.string().optional(),
        status: z.enum(APPOINTMENT_STATUSES).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireBookingBusiness(context.supabase);
    let query = context.supabase
      .from("appointments")
      .select(APPOINTMENT_SELECT)
      .order("starts_at", { ascending: true })
      .limit(500);
    if (data.from) query = query.gte("starts_at", data.from);
    if (data.to) query = query.lt("starts_at", data.to);
    if (data.employeeId) query = query.eq("employee_id", data.employeeId);
    if (data.branchId && data.branchId !== "all") query = query.eq("branch_id", data.branchId);
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().optional(),
        service_id: z.string().nullable().optional(),
        customer_id: z.string().nullable().optional(),
        employee_id: z.string().nullable().optional(),
        branch_id: z.string().nullable().optional(),
        starts_at: z.string().datetime(),
        duration_minutes: z.number().int().positive().max(1440).optional(),
        note: z.string().max(500).optional(),
        status: z.enum(APPOINTMENT_STATUSES).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePermission(
      context.supabase,
      "appointments.manage",
      "Qabullarni faqat qabul xodimi, menejer, admin yoki egasi boshqaradi.",
    );

    let duration = data.duration_minutes;
    let snapshot: { name: string; price: number; duration_minutes: number } | null = null;
    let depositRule: { deposit_type: string; deposit_value: number } | null = null;
    if (data.service_id) {
      const { data: service, error } = await context.supabase
        .from("services")
        .select("duration_minutes, name, price, deposit_type, deposit_value")
        .eq("business_id", businessId)
        .eq("id", data.service_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      // Xizmat topilmasa avval narxi bo'lmagan qabul yozib qo'yilar edi.
      if (!service) throw new Error("Xizmat topilmadi — ro'yxatdan qayta tanlang.");
      snapshot = {
        name: service.name,
        price: Number(service.price),
        duration_minutes: service.duration_minutes,
      };
      depositRule = {
        deposit_type: service.deposit_type,
        deposit_value: Number(service.deposit_value),
      };
      if (duration === undefined) duration = service.duration_minutes;
    }
    if (duration === undefined) throw new Error("Xizmat yoki davomiylikni tanlang.");
    const endsAt = appointmentEnd(data.starts_at, duration);

    for (const [table, id, label] of [
      ["customers", data.customer_id, "Mijoz"],
      ["employees", data.employee_id, "Xodim"],
      ["branches", data.branch_id, "Filial"],
    ] as const) {
      if (id) await assertOwnRecord(context.supabase, businessId, table, id, label);
    }

    if (data.employee_id) {
      await assertEmployeeAvailable(
        context.supabase,
        data.employee_id,
        data.starts_at,
        endsAt,
        duration,
      );
    }

    // Depozit snapshoti xizmat qoidasidan hisoblanadi. To'langan depoziti bo'lgan
    // qabul tahrirlansa summa o'zgarmaydi — mijozga aytilgan pul orqaga qaytarilmaydi.
    let depositAmount = depositFor(depositRule, snapshot?.price ?? null);
    if (data.id) {
      const { data: existing, error: existingError } = await context.supabase
        .from("appointments")
        .select("deposit_amount, deposit_paid_at")
        .eq("id", data.id)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (existing?.deposit_paid_at) depositAmount = Number(existing.deposit_amount ?? 0) || 0;
    }

    const row = {
      service_id: data.service_id ?? null,
      service_name: snapshot?.name ?? null,
      price: snapshot?.price ?? null,
      duration_minutes: duration,
      deposit_amount: depositAmount > 0 ? depositAmount : null,
      customer_id: data.customer_id ?? null,
      employee_id: data.employee_id ?? null,
      branch_id: data.branch_id ?? null,
      starts_at: data.starts_at,
      ends_at: endsAt,
      note: data.note ?? "",
      status: data.status ?? "confirmed",
    };

    if (data.id) {
      const { error } = await context.supabase.from("appointments").update(row).eq("id", data.id);
      if (error) throw conflictError(error);
      return { ok: true, id: data.id };
    }

    const { data: created, error } = await context.supabase
      .from("appointments")
      .insert({ ...row, business_id: businessId, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw conflictError(error);

    const appointmentId = created?.id ?? null;
    if (appointmentId) {
      const { sendAppointmentCardById } = await import("./telegram-appointments.server");
      await sendAppointmentCardById(businessId, appointmentId, "CRM — qabulxona");
    }

    return { ok: true, id: appointmentId };
  });

export const setAppointmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string(), status: z.enum(APPOINTMENT_STATUSES) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requirePermission(
      context.supabase,
      "appointments.manage",
      "Qabullarni faqat qabul xodimi, menejer, admin yoki egasi boshqaradi.",
    );
    const { error } = await context.supabase
      .from("appointments")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await requirePermission(
      context.supabase,
      "appointments.manage",
      "Qabullarni faqat qabul xodimi, menejer, admin yoki egasi boshqaradi.",
    );
    const { error } = await context.supabase.from("appointments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Exclusion constraint appointments_no_double_booking fires as 23P01. */
function conflictError(error: { code?: string; message: string }): Error {
  if (error.code === "23P01") {
    return new Error("Bu xodim tanlangan vaqtda band — boshqa vaqt yoki xodim tanlang.");
  }
  return new Error(error.message);
}

/* -------------------------------- deposits -------------------------------- */

/**
 * Depozitni qabul qilish: qabulda holat yoziladi, pul esa To'lovlar daftariga
 * tushadi. Takror yozib bo'lmaydi — avval qaytarish kerak.
 */
export const recordDeposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string(),
        method: z.enum(DEPOSIT_METHODS),
        amount: z.number().positive().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePermission(
      context.supabase,
      "appointments.manage",
      "Qabullarni faqat qabul xodimi, menejer, admin yoki egasi boshqaradi.",
    );
    const { data: appointment, error } = await context.supabase
      .from("appointments")
      .select("id, customer_id, service_name, deposit_amount, deposit_paid_at, deposit_refunded_at")
      .eq("id", data.id)
      .eq("business_id", businessId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!appointment) throw new Error("Qabul topilmadi.");

    const state = depositState(appointment);
    if (state === "none") throw new Error("Bu qabul uchun depozit belgilanmagan.");
    if (state === "paid") throw new Error("Depozit allaqachon qabul qilingan.");

    const required = Number(appointment.deposit_amount ?? 0) || 0;
    // Mijoz kamroq berdi — o'sha qabul qilingan pul yoziladi, talab qilingan summa emas.
    const amount = Math.round(data.amount && data.amount > 0 ? data.amount : required);
    const now = new Date().toISOString();
    const depositNote = `Depozit · ${appointment.service_name || "Qabul"}`;

    const { error: ledgerError } = await context.supabase.from("payments").insert({
      business_id: businessId,
      customer_id: appointment.customer_id ?? null,
      appointment_id: appointment.id,
      amount,
      method: data.method,
      status: "paid",
      paid_at: now,
      note: depositNote,
      created_by: context.userId,
    });
    if (ledgerError) throw new Error(ledgerError.message);

    const { error: updateError } = await context.supabase
      .from("appointments")
      .update({
        deposit_paid_at: now,
        deposit_paid_amount: amount,
        deposit_method: data.method,
        deposit_refunded_at: null,
      })
      .eq("id", appointment.id)
      .eq("business_id", businessId);
    if (updateError) throw new Error(updateError.message);

    const { notifyCurrentBusiness } = await import("./telegram-notify.server");
    await notifyCurrentBusiness(
      context.supabase as never,
      "payment",
      `💰 <b>Depozit qabul qilindi</b> — ${amount.toLocaleString("ru-RU")} so’m\n${depositNote}`,
    );

    return { ok: true as const, amount };
  });

/**
 * Depozitni qaytarish (mijoz bekor qildi yoki xizmat bo'lmadi). Holat tozalanadi,
 * to'lov yozuvi esa "refunded" bo'ladi — pul daftaridan yo'qolmaydi, sababi ko'rinadi.
 */
export const refundDeposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    const businessId = await requirePermission(
      context.supabase,
      "finance.view",
      "Bu amal faqat moliyaga ruxsati bo'lgan xodimlar uchun.",
    );
    const { data: appointment, error } = await context.supabase
      .from("appointments")
      .select(
        "id, service_name, deposit_amount, deposit_paid_amount, deposit_paid_at, deposit_refunded_at",
      )
      .eq("id", data.id)
      .eq("business_id", businessId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (depositState(appointment) !== "paid") throw new Error("Qaytariladigan depozit yo'q.");

    const now = new Date().toISOString();
    const { error: updateError } = await context.supabase
      .from("appointments")
      .update({
        deposit_refunded_at: now,
        deposit_paid_at: null,
        deposit_paid_amount: null,
        deposit_method: "",
      })
      .eq("id", data.id)
      .eq("business_id", businessId);
    if (updateError) throw new Error(updateError.message);

    const { error: ledgerError } = await context.supabase
      .from("payments")
      .update({
        status: "refunded",
        note: `Depozit qaytarildi · ${appointment?.service_name || "Qabul"}`,
      })
      .eq("business_id", businessId)
      .eq("appointment_id", data.id)
      .eq("status", "paid");
    if (ledgerError) throw new Error(ledgerError.message);

    return { ok: true as const };
  });

/* ------------------------------ kpi summary ------------------------------ */

export const getBookingSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireBookingBusiness(context.supabase);
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");

    // Period bounds in the business timezone (Asia/Tashkent), matching booking rules.
    const zonedNoon = new Date(now.toLocaleString("en-US", { timeZone: DEFAULT_BUSINESS_TZ }));
    const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const todayIso = isoDay(zonedNoon);
    const weekday = zonedNoon.getDay() === 0 ? 7 : zonedNoon.getDay();
    const weekStart = new Date(zonedNoon);
    weekStart.setDate(weekStart.getDate() - (weekday - 1));
    const monthStart = new Date(zonedNoon.getFullYear(), zonedNoon.getMonth(), 1);

    const from = (dayIso: string) => new Date(`${dayIso}T00:00:00`).toISOString();
    const todayFrom = from(todayIso);
    const todayTo = new Date(`${todayIso}T00:00:00`);
    todayTo.setDate(todayTo.getDate() + 1);
    const weekTo = new Date(weekStart);
    weekTo.setDate(weekTo.getDate() + 7);
    const monthTo = new Date(monthStart);
    monthTo.setMonth(monthTo.getMonth() + 1);

    const [{ data: monthRows, error }, { data: upcomingRows, error: upError }] = await Promise.all([
      context.supabase
        .from("appointments")
        .select(
          "id, starts_at, status, price, customers:customer_id(id, full_name), employees:employee_id(id, full_name)",
        )
        .gte("starts_at", from(isoDay(monthStart)))
        .order("starts_at", { ascending: true })
        .limit(1000),
      context.supabase
        .from("appointments")
        .select(
          "id, starts_at, ends_at, status, service_name, price, customers:customer_id(id, full_name, phone), employees:employee_id(id, full_name)",
        )
        .gte("starts_at", now.toISOString())
        .order("starts_at", { ascending: true })
        .limit(40),
    ]);
    if (error) throw new Error(error.message);
    if (upError) throw new Error(upError.message);

    const rows = monthRows ?? [];
    const held = (row: { status: string }) => row.status !== "cancelled";
    const inRange = (row: { starts_at: string }, lo: string, hi: string) =>
      row.starts_at >= lo && row.starts_at < hi;

    const upcoming = (upcomingRows ?? [])
      .filter((row) => BOOKED_STATUSES.has(row.status as never))
      .slice(0, 5);

    return {
      todayCount: rows.filter((row) => held(row) && inRange(row, todayFrom, todayTo.toISOString()))
        .length,
      weekCount: rows.filter(
        (row) => held(row) && inRange(row, from(isoDay(weekStart)), weekTo.toISOString()),
      ).length,
      monthCount: rows.filter(held).length,
      pendingConfirm: rows.filter((row) => row.status === "new").length,
      cancelledMonth: rows.filter((row) => row.status === "cancelled").length,
      noShowMonth: rows.filter((row) => row.status === "no_show").length,
      revenueMonth: rows
        .filter((row) => row.status === "completed")
        .reduce((sum, row) => sum + Number(row.price ?? 0), 0),
      upcoming,
    };
  });
