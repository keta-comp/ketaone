import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { supabaseAdmin } from "@/lib/platform.server";
import { depositFor } from "./deposit";
import { resolvePresetId } from "./presets";
import { can, type MemberRole } from "./roles";
import { requireBusinessId } from "./tenant.server";
import {
  BOOKED_STATUSES,
  appointmentEnd,
  dayWindows,
  fitsInWindows,
  isWithinTimeOff,
  overlaps,
  type AppointmentStatus,
} from "./booking";

/**
 * Public booking (brief 5.3). These server functions run WITHOUT user auth: they
 * read/write through the service-role client and expose only the minimum fields of
 * one business identified by its booking slug. Availability is always re-checked
 * server-side at insert time, and the DB exclusion constraint is the final guard.
 */

// Business timezone is Asia/Tashkent (UTC+5, no DST) per product defaults.
const TZ_OFFSET_MINUTES = -300;

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits;
}

async function resolveBusiness(slug: string): Promise<{ id: string; name: string }> {
  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("id, name, booking_enabled, status")
    .eq("booking_slug", slug)
    .maybeSingle();
  if (!business || !business.booking_enabled || business.status !== "active") {
    throw new Error("Bu biznes uchun onlayn qabul mavjud emas.");
  }
  return { id: business.id, name: business.name };
}

function isoWeekday(dateIso: string): number {
  const day = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function localSlotIso(dateIso: string, minutes: number): string {
  return new Date(Date.parse(`${dateIso}T00:00:00Z`) + (minutes + TZ_OFFSET_MINUTES) * 60_000).toISOString();
}

type PublicEmployee = { id: string; full_name: string; position: string };

async function loadBookingContext(businessId: string, serviceId: string) {
  const serviceQuery = supabaseAdmin
    .from("services")
    .select("id, name, duration_minutes, price, deposit_type, deposit_value")
    .eq("id", serviceId)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .maybeSingle();
  const [serviceResult, employeesResult, capsResult] = await Promise.all([
    serviceQuery,
    supabaseAdmin.from("employees").select("id, full_name, position").eq("business_id", businessId).eq("is_active", true),
    supabaseAdmin.from("employee_services").select("employee_id, service_id").eq("business_id", businessId),
  ]);
  const service = serviceResult.data;
  if (!service) throw new Error("Xizmat topilmadi yoki mavjud emas.");
  const employees = ((employeesResult.data ?? []) as PublicEmployee[]).map((row) => ({
    id: row.id,
    full_name: row.full_name,
    position: row.position ?? "",
  }));
  const capabilityRows = capsResult.data ?? [];
  const capable = new Set(capabilityRows.map((row) => row.employee_id));
  const eligible =
    employees.length === 0 || capable.size === 0
      ? employees
      : employees.filter((employee) =>
          capabilityRows.some((row) => row.employee_id === employee.id && row.service_id === serviceId),
        );
  return { service, employees: eligible };
}

export const getPublicBookingPage = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ slug: z.string().min(3).max(40) }).parse(input))
  .handler(async ({ data }) => {
    // Never leak infrastructure details on a public page.
    try {
      const business = await resolveBusiness(data.slug);
      const [{ data: services }, { data: employees }, { data: settings }, { data: crmConfig }] =
        await Promise.all([
        supabaseAdmin
          .from("services")
          .select("id, name, duration_minutes, price, deposit_type, deposit_value")
          .eq("business_id", business.id)
          .eq("is_active", true)
          .order("name", { ascending: true }),
        supabaseAdmin
          .from("employees")
          .select("id, full_name, position")
          .eq("business_id", business.id)
          .eq("is_active", true)
          .order("full_name", { ascending: true }),
        supabaseAdmin
          .from("business_settings")
          .select("phone, logo_path, working_hours")
          .eq("business_id", business.id)
          .maybeSingle(),
        // Klubda xizmat katalogi «Qurilma va stollar» — ommaviy sahifa shu nomni ko'rsatishi uchun soha kerak.
        supabaseAdmin
          .from("crm_configs")
          .select("industry, config")
          .eq("business_id", business.id)
          .maybeSingle(),
      ]);
      const { signedDownloadUrl } = await import("./storage.server");
      return {
        businessName: business.name,
        // Ommaviy sahifa klubda katalogni «Qurilma va stollar» deb atashi uchun preset yetarli.
        presetId: resolvePresetId(
          crmConfig?.industry,
          (crmConfig?.config as { presetId?: string } | null)?.presetId,
        ),
        phone: settings?.phone ?? "",
        workingHours: settings?.working_hours ?? "",
        logoUrl: settings?.logo_path ? await signedDownloadUrl("branding", settings.logo_path, 3600) : "",
        services: services ?? [],
        employees: ((employees ?? []) as Array<{ id: string; full_name: string; position: string | null }>).map(
          (row) => ({ id: row.id, full_name: row.full_name, position: row.position ?? "" }),
        ),
      };
    } catch {
      throw new Error("Bu biznes uchun onlayn qabul mavjud emas.");
    }
  });

export const getPublicSlots = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z
      .object({
        slug: z.string().min(3).max(40),
        serviceId: z.string(),
        employeeId: z.string().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const business = await resolveBusiness(data.slug);
    const { service, employees } = await loadBookingContext(business.id, data.serviceId);
    const scoped = data.employeeId ? employees.filter((employee) => employee.id === data.employeeId) : employees;
    if (data.employeeId && scoped.length === 0) throw new Error("Xodim topilmadi.");

    const dayStart = `${data.date}T00:00:00Z`;
    const dayEndIso = localSlotIso(data.date, 24 * 60);
    const nowIso = new Date().toISOString();
    const weekday = isoWeekday(data.date);

    const [{ data: scheduleRows }, { data: timeOffRows }, { data: appointmentRows }] = await Promise.all([
      supabaseAdmin
        .from("work_schedules")
        .select("employee_id, weekday, start_time, end_time, break_start, break_end")
        .eq("business_id", business.id)
        .eq("weekday", weekday),
      supabaseAdmin
        .from("time_off")
        .select("employee_id, starts_at, ends_at")
        .eq("business_id", business.id)
        .lt("starts_at", dayEndIso)
        .gt("ends_at", localSlotIso(data.date, 0)),
      supabaseAdmin
        .from("appointments")
        .select("employee_id, starts_at, ends_at, status, duration_minutes")
        .eq("business_id", business.id)
        .lt("starts_at", dayEndIso)
        .gte("ends_at", dayStart),
    ]);

    const slots: Array<{ starts_at: string; ends_at: string; employee_id: string; employee_name: string }> = [];
    if (scoped.length === 0) {
      // Business without staff (or none capable): offer default-window slots, unassigned.
      const bookedUnassigned = (appointmentRows ?? []).filter(
        (row) =>
          !row.employee_id &&
          BOOKED_STATUSES.has(row.status as AppointmentStatus) &&
          Number(row.duration_minutes ?? 0) > 0,
      );
      for (let minutes = 9 * 60; minutes + service.duration_minutes <= 18 * 60; minutes += 30) {
        const startsAt = localSlotIso(data.date, minutes);
        const endsAt = appointmentEnd(startsAt, service.duration_minutes);
        if (startsAt <= nowIso) continue;
        if (overlapsAny(startsAt, endsAt, bookedUnassigned)) continue;
        slots.push({ starts_at: startsAt, ends_at: endsAt, employee_id: "", employee_name: "" });
      }
    }
    for (const employee of scoped) {
      const offs = (timeOffRows ?? []).filter((row) => row.employee_id === employee.id);
      if (offs.length > 0 && isWithinTimeOff(localSlotIso(data.date, 0), dayEndIso, offs)) continue;
      const booked = (appointmentRows ?? []).filter(
        (row) =>
          row.employee_id === employee.id && BOOKED_STATUSES.has(row.status as AppointmentStatus),
      );
      const employeeSchedule = (scheduleRows ?? []).filter((row) => row.employee_id === employee.id);
      const windows =
        employeeSchedule.length > 0
          ? dayWindows(employeeSchedule)
          : [{ start: 9 * 60, end: 18 * 60 }]; // sensible default when no schedule is configured

      for (const win of windows) {
        for (let minutes = win.start; minutes + service.duration_minutes <= win.end; minutes += 30) {
          const startsAt = localSlotIso(data.date, minutes);
          const endsAt = appointmentEnd(startsAt, service.duration_minutes);
          if (startsAt <= nowIso) continue;
          if (!fitsInWindows(minutes, service.duration_minutes, windows)) continue;
          if (overlapsAny(startsAt, endsAt, booked)) continue;
          slots.push({ starts_at: startsAt, ends_at: endsAt, employee_id: employee.id, employee_name: employee.full_name });
        }
      }
    }

    slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return { slots: slots.slice(0, 60), durationMinutes: service.duration_minutes };
  });

function overlapsAny(
  startsAt: string,
  endsAt: string,
  rows: Array<{ starts_at: string; ends_at: string }>,
): boolean {
  return rows.some((row) => overlaps(startsAt, endsAt, row.starts_at, row.ends_at));
}

export const createPublicBooking = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        slug: z.string().min(3).max(40),
        serviceId: z.string(),
        employeeId: z.string().optional(),
        starts_at: z.string().datetime(),
        full_name: z.string().trim().min(2).max(120),
        phone: z
          .string()
          .trim()
          .regex(/^[+\d][\d\s()-]{6,19}$/, "Telefon raqami noto'g'ri."),
        note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const business = await resolveBusiness(data.slug);
    const phone = normalizePhone(data.phone);

    // Spam throttle: max 5 requests per phone per business per hour.
    const { count } = await supabaseAdmin
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .eq("phone", phone)
      .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
    if ((count ?? 0) >= 5) {
      throw new Error("Juda ko'p so'rov yuborildi — bir soatdan so'ng qayta urinib ko'ring.");
    }
    await supabaseAdmin.from("booking_requests").insert({ business_id: business.id, phone });

    const { service, employees } = await loadBookingContext(business.id, data.serviceId);
    const endsAt = appointmentEnd(data.starts_at, service.duration_minutes);
    // Mijoz saytda ko'rgan summa qabulga snapshot bo'lib yoziladi — keyinchalik
    // xizmat qoidasi o'zgarsa ham undan so'raladigan depozit barqaror qoladi.
    const depositAmount = depositFor(service, Number(service.price));

    // Server-side re-check: pick the requested (or first free) employee whose
    // schedule, time off and existing bookings allow this slot.
    const dateIso = data.starts_at.slice(0, 10);
    const weekday = isoWeekday(dateIso);
    const candidates = data.employeeId ? employees.filter((employee) => employee.id === data.employeeId) : employees;
    if (data.employeeId && candidates.length === 0) throw new Error("Xodim topilmadi.");

    const [{ data: scheduleRows }, { data: timeOffRows }, { data: appointmentRows }] = await Promise.all([
      supabaseAdmin.from("work_schedules").select("employee_id, start_time, end_time, break_start, break_end").eq("business_id", business.id).eq("weekday", weekday),
      supabaseAdmin
        .from("time_off")
        .select("employee_id, starts_at, ends_at")
        .eq("business_id", business.id)
        .lt("starts_at", endsAt)
        .gt("ends_at", data.starts_at),
      supabaseAdmin
        .from("appointments")
        .select("employee_id, starts_at, ends_at, status")
        .eq("business_id", business.id)
        .lt("starts_at", endsAt)
        .gt("ends_at", data.starts_at),
    ]);

    // Wall-clock minutes of the slot in the business timezone.
    const slotMinutes =
      (Date.parse(data.starts_at) - Date.parse(`${dateIso}T00:00:00Z`)) / 60_000 - TZ_OFFSET_MINUTES;
    const bookedBy = new Map<string, Array<{ starts_at: string; ends_at: string }>>();
    for (const row of appointmentRows ?? []) {
      if (!row.employee_id || !BOOKED_STATUSES.has(row.status as AppointmentStatus)) continue;
      const list = bookedBy.get(row.employee_id) ?? [];
      list.push({ starts_at: row.starts_at, ends_at: row.ends_at });
      bookedBy.set(row.employee_id, list);
    }
    const offBy = new Map<string, Array<{ starts_at: string; ends_at: string }>>();
    for (const row of timeOffRows ?? []) {
      const list = offBy.get(row.employee_id) ?? [];
      list.push({ starts_at: row.starts_at, ends_at: row.ends_at });
      offBy.set(row.employee_id, list);
    }
    const scheduleBy = new Map<string, Array<{ start_time: string; end_time: string; break_start: string | null; break_end: string | null }>>();
    for (const row of scheduleRows ?? []) {
      const list = scheduleBy.get(row.employee_id) ?? [];
      list.push({ start_time: row.start_time, end_time: row.end_time, break_start: row.break_start, break_end: row.break_end });
      scheduleBy.set(row.employee_id, list);
    }

    const chosen =
      candidates.length === 0 && !data.employeeId
        ? null
        : candidates.find((employee) => {
            if ((offBy.get(employee.id) ?? []).length > 0) return false;
            const rows = scheduleBy.get(employee.id) ?? [];
            if (rows.length > 0 && !fitsInWindows(slotMinutes, service.duration_minutes, dayWindows(rows))) return false;
            return !overlapsAny(data.starts_at, endsAt, bookedBy.get(employee.id) ?? []);
          }) ?? null;
    if (chosen === undefined) throw new Error("Bu vaqt endi band — boshqa vaqtni tanlang.");
    if (!data.employeeId && candidates.length === 0) {
      // Staff-less business: still guard against two customers booked at once.
      const unassignedBooked = (appointmentRows ?? []).filter(
        (row) => !row.employee_id && BOOKED_STATUSES.has(row.status as AppointmentStatus),
      );
      if (overlapsAny(data.starts_at, endsAt, unassignedBooked)) {
        throw new Error("Bu vaqt endi band — boshqa vaqtni tanlang.");
      }
    }

    // Customer lookup/creation on a canonical +998 phone form.
    const digitsOnly = phone;
    const canonicalPhone = digitsOnly.length === 9 ? `+998${digitsOnly}` : data.phone;
    const { data: existingCustomer } = await supabaseAdmin
      .from("customers")
      .select("id")
      .eq("business_id", business.id)
      .eq("phone", canonicalPhone)
      .limit(1)
      .maybeSingle();
    let customerId = existingCustomer?.id ?? null;
    if (!customerId) {
      const { data: fallback } = await supabaseAdmin
        .from("customers")
        .select("id")
        .eq("business_id", business.id)
        .eq("phone", data.phone)
        .limit(1)
        .maybeSingle();
      customerId = fallback?.id ?? null;
    }
    if (!customerId) {
      const { data: created } = await supabaseAdmin
        .from("customers")
        .insert({ business_id: business.id, phone: canonicalPhone, full_name: data.full_name })
        .select("id")
        .single();
      customerId = created?.id ?? null;
    }

    const { data: createdAppointment, error } = await supabaseAdmin
      .from("appointments")
      .insert({
        business_id: business.id,
        service_id: service.id,
        service_name: service.name,
        price: Number(service.price),
        duration_minutes: service.duration_minutes,
        deposit_amount: depositAmount > 0 ? depositAmount : null,
        customer_id: customerId,
        employee_id: chosen?.id ?? null,
        branch_id: null,
        starts_at: data.starts_at,
        ends_at: endsAt,
        status: "new",
        note: data.note ? `Onlayn: ${data.note}` : "Onlayn bron",
      })
      .select("id")
      .maybeSingle();
    if (error) {
      if (error.code === "23P01") throw new Error("Bu vaqt endi band — boshqa vaqtni tanlang.");
      throw new Error(error.message);
    }
    const appointmentId = (createdAppointment as { id: string } | null)?.id ?? null;

    if (appointmentId) {
      try {
        const { sendBookingCard } = await import("./telegram-appointments.server");
        await sendBookingCard(business.id, {
          id: appointmentId,
          startsAt: data.starts_at,
          serviceName: service.name,
          employeeName: chosen?.full_name ?? null,
          customerName: data.full_name,
          customerPhone: canonicalPhone,
          source: "Onlayn qabul (sayt)",
        });
      } catch {
        // Notifications are best-effort and must never fail a booking.
      }
    }

    return {
      ok: true,
      starts_at: data.starts_at,
      ends_at: endsAt,
      employee_name: chosen?.full_name ?? "",
      deposit_amount: depositAmount,
    };
  });

/* ------------------------- owner-side booking link ------------------------- */

export const getMyBookingLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const businessId = await requireBusinessId(context.supabase);
    const { data: business, error } = await context.supabase
      .from("businesses")
      .select("name, booking_slug, booking_enabled, status")
      .eq("id", businessId)
      .single();
    if (error) throw new Error(error.message);
    let slug = business?.booking_slug ?? null;
    if (!slug) {
      slug = businessId.replace(/-/g, "").slice(0, 16);
      const { error: updateError } = await context.supabase
        .from("businesses")
        .update({ booking_slug: slug })
        .eq("id", businessId);
      if (updateError) throw new Error(updateError.message);
    }
    return { slug, enabled: business?.booking_enabled ?? false, businessName: business?.name ?? "" };
  });

export const setMyBookingEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const businessId = await requireBusinessId(context.supabase);
    const { data: role, error } = await context.supabase.rpc("business_role", { _business_id: businessId });
    if (error) throw new Error(error.message);
    if (!can(role as MemberRole | null, "members.manage")) {
      throw new Error("Onlayn qabulni faqat egasi yoki admin yoqadi/o'chiradi.");
    }
    const { error: updateError } = await context.supabase
      .from("businesses")
      .update({ booking_enabled: data.enabled })
      .eq("id", businessId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true };
  });
