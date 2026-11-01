import { createServerFn } from "@tanstack/react-start";
import type { DbClient } from "./pg-rest.server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { logActivity } from "./activity.server";
import { can, type MemberRole } from "./roles";
import { requireBusinessId } from "./tenant.server";
import {
  buildPayrollExpense,
  computeStatement,
  dateBoundsIso,
  roundMoney,
  summariseTuition,
  tuitionWindow,
  type TaughtGroup,
  type TuitionPayment,
  type TuitionSummary,
} from "./payroll";

type Client = DbClient;

type Pageable = ReturnType<Client["from"]>;

const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

/**
 * Komissiya va oylik yig'indilari pul hisobi: bitta sahifa bilan cheklash
 * qoidani jim buzadi, shuning uchun to'liq sahifalab o'qiymiz.
 */
async function fetchAll(build: () => Pageable): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) return rows;
  }
  throw new Error(
    "Hisob uchun ma'lumot hajmi juda katta — davrni kichraytirib qaytadan urinib ko'ring.",
  );
}

/** Payroll is a finance concern: owner/admin/manager only (finance.view gate). */
async function requirePayrollAdmin(supabase: Client): Promise<string> {
  const businessId = await requireBusinessId(supabase);
  const { data: role, error } = await supabase.rpc("business_role", { _business_id: businessId });
  if (error) throw new Error(error.message);
  if (!can(role as MemberRole | null, "finance.view")) {
    throw new Error("Ish haqini faqat egasi, admin yoki menejer hisoblaydi.");
  }
  return businessId;
}

/**
 * O'qituvchi sinfning o'zi: uning guruhlariga yozilgan oyliklar.
 * `pending` qatorlari bazaga kirmaydi, faqat reja sifatida qaytariladi.
 */
async function teacherTuition(
  supabase: Client,
  businessId: string,
  employeeId: string,
  periodStart: string,
  periodEnd: string,
): Promise<TuitionSummary> {
  // Xodim tanlanmagan holatda ("none"/bo'sh) so'rovni bazaga yubormaymiz:
  // uuid ustuniga matn berilsa Postgres 22P02 bilan chetlab ketadi.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId)) {
    return { rows: [], groups: [], collected: 0, planned: 0 };
  }
  const { data: groupRows, error } = await supabase
    .from("study_groups")
    .select("id, name, course_id")
    .eq("business_id", businessId)
    .eq("teacher_id", employeeId)
    .order("name");
  if (error) throw new Error(error.message);
  const groups = (groupRows ?? []) as unknown as TaughtGroup[];
  if (!groups.length) return { rows: [], groups: [], collected: 0, planned: 0 };

  const paymentRows = await fetchAll(() =>
    supabase
      .from("payments")
      .select("group_id, amount, status, paid_at, created_at, period_month")
      .eq("business_id", businessId)
      .in(
        "group_id",
        groups.map((group) => group.id),
      )
      .in("status", ["paid", "partial", "pending"])
      .order("id"),
  );

  return summariseTuition(
    groups,
    paymentRows as TuitionPayment[],
    tuitionWindow(periodStart, periodEnd),
  );
}

const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/* ------------------------------ payroll rules ----------------------------- */

export const listPayrollRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePayrollAdmin(context.supabase);
    const { data: rows, error } = await context.supabase
      .from("payroll_rules")
      .select("*, employees(id, full_name)")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const savePayrollRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().optional(),
        employee_id: z.string(),
        base_salary: z.number().nonnegative(),
        commission_percent: z.number().min(0).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePayrollAdmin(context.supabase);

    const { data: employee, error: employeeError } = await context.supabase
      .from("employees")
      .select("id, full_name")
      .eq("id", data.employee_id)
      .maybeSingle();
    if (employeeError) throw new Error(employeeError.message);
    if (!employee) throw new Error("Xodim topilmadi.");

    const row = {
      base_salary: data.base_salary,
      commission_percent: data.commission_percent,
    };
    if (data.id) {
      const { error } = await context.supabase.from("payroll_rules").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("payroll_rules")
        .insert({ ...row, business_id: businessId, employee_id: data.employee_id });
      if (error) {
        if (error.code === "23505") throw new Error("Bu xodim uchun qoida allaqachon mavjud.");
        throw new Error(error.message);
      }
    }
    await logActivity(context.supabase, {
      entityType: "payroll_rule",
      entityId: data.id ?? data.employee_id,
      action: data.id ? "payroll_rule_updated" : "payroll_rule_created",
      detail: `${employee.full_name}: maosh ${row.base_salary}, komissiya ${row.commission_percent}%`,
      actorUserId: context.userId,
    });
    return { ok: true };
  });

/* ----------------------------- payroll statements ------------------------- */

const STATEMENT_SELECT = "*, employees(id, full_name)";

export const listPayrollStatements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        employee_id: z.string().optional(),
        period_start: dateIso.optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requirePayrollAdmin(context.supabase);
    let query = context.supabase
      .from("payroll_statements")
      .select(STATEMENT_SELECT)
      .order("period_start", { ascending: false })
      .limit(200);
    if (data.employee_id) query = query.eq("employee_id", data.employee_id);
    if (data.period_start) query = query.eq("period_start", data.period_start);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const generatePayrollStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        employee_id: z.string(),
        period_start: dateIso,
        period_end: dateIso,
        bonus_amount: z.number().nonnegative().optional(),
        advance_amount: z.number().nonnegative().optional(),
        deduction_amount: z.number().nonnegative().optional(),
        note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePayrollAdmin(context.supabase);
    if (data.period_end < data.period_start) {
      throw new Error("Davr tugash sanasi boshlanishidan oldin bo'lishi mumkin emas.");
    }

    const bounds = dateBoundsIso(data.period_start, data.period_end);

    const [
      { data: employee, error: employeeError },
      { data: rule },
      { data: overrideRows, error: overrideError },
      appointments,
      { data: existing, error: existingError },
    ] = await Promise.all([
      context.supabase.from("employees").select("id, full_name").eq("id", data.employee_id).maybeSingle(),
      context.supabase.from("payroll_rules").select("*").eq("employee_id", data.employee_id).maybeSingle(),
      context.supabase
        .from("employee_services")
        .select("service_id, commission_percent")
        .eq("employee_id", data.employee_id)
        .not("commission_percent", "is", null),
      fetchAll(() =>
        context.supabase
          .from("appointments")
          .select("service_id, price")
          .eq("employee_id", data.employee_id)
          .eq("status", "completed")
          .gte("starts_at", bounds.from)
          .lt("starts_at", bounds.to)
          .order("id"),
      ),
      context.supabase
        .from("payroll_statements")
        .select("*")
        .eq("employee_id", data.employee_id)
        .eq("period_start", data.period_start)
        .maybeSingle(),
    ]);
    if (employeeError) throw new Error(employeeError.message);
    if (!employee) throw new Error("Xodim topilmadi.");
    if (overrideError) throw new Error(overrideError.message);
    if (existingError) throw new Error(existingError.message);

    if (existing && existing.status !== "draft") {
      throw new Error("Bu davr uchun hisob-kitob allaqachon tasdiqlangan yoki to'langan.");
    }

    const tuition = await teacherTuition(
      context.supabase,
      businessId,
      data.employee_id,
      data.period_start,
      data.period_end,
    );

    const totals = computeStatement({
      baseSalary: Number(rule?.base_salary ?? 0),
      ruleCommissionPercent: Number(rule?.commission_percent ?? 0),
      rows: [
        ...(appointments as { service_id: string | null; price: number | string | null }[]).map(
          (row) => ({ service_id: row.service_id, price: Number(row.price ?? 0) }),
        ),
        ...tuition.rows,
      ],
      overrides: (overrideRows ?? []).map((row) => ({
        service_id: row.service_id,
        commission_percent: Number(row.commission_percent ?? 0),
      })),
      bonusAmount: data.bonus_amount ?? Number(existing?.bonus_amount ?? 0),
      advanceAmount: data.advance_amount ?? Number(existing?.advance_amount ?? 0),
      deductionAmount: data.deduction_amount ?? Number(existing?.deduction_amount ?? 0),
    });

    const row = {
      service_revenue: totals.serviceRevenue,
      base_amount: Number(rule?.base_salary ?? 0),
      commission_amount: totals.commissionAmount,
      bonus_amount: data.bonus_amount ?? Number(existing?.bonus_amount ?? 0),
      advance_amount: data.advance_amount ?? Number(existing?.advance_amount ?? 0),
      deduction_amount: data.deduction_amount ?? Number(existing?.deduction_amount ?? 0),
      total_computed: totals.totalComputed,
      period_end: data.period_end,
      note: data.note ?? existing?.note ?? "",
    };

    if (existing) {
      const { error } = await context.supabase.from("payroll_statements").update(row).eq("id", existing.id);
      if (error) throw new Error(error.message);
      await logActivity(context.supabase, {
        entityType: "payroll_statement",
        entityId: existing.id,
        action: "payroll_recomputed",
        detail: `${employee.full_name} ${data.period_start} — qayta hisoblandi`,
        actorUserId: context.userId,
      });
      return { ok: true, id: existing.id, recomputed: true };
    }

    const { data: created, error } = await context.supabase
      .from("payroll_statements")
      .insert({
        ...row,
        business_id: businessId,
        employee_id: data.employee_id,
        period_start: data.period_start,
        status: "draft",
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("Bu davr uchun hisob-kitob allaqachon mavjud.");
      throw new Error(error.message);
    }
    await logActivity(context.supabase, {
      entityType: "payroll_statement",
      entityId: created?.id ?? null,
      action: "payroll_generated",
      detail: `${employee.full_name} ${data.period_start}…${data.period_end}: ${totals.totalComputed}${
        tuition.collected > 0 ? ` (guruh oyliklari ${tuition.collected})` : ""
      }`,
      actorUserId: context.userId,
    });
    return { ok: true, id: created?.id ?? null, recomputed: false };
  });

/**
 * Hisoblashdan oldin ko'rish uchun: bu xodimning guruhlarida qancha oylik
 * to'langan va qanchasi kutilmoqda. O'qituvchi haqining bazasi shu.
 */
export const listTeacherTuition = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        employee_id: z.string(),
        period_start: dateIso,
        period_end: dateIso,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePayrollAdmin(context.supabase);
    if (data.period_end < data.period_start) {
      throw new Error("Davr tugash sanasi boshlanishidan oldin bo'lishi mumkin emas.");
    }
    return teacherTuition(
      context.supabase,
      businessId,
      data.employee_id,
      data.period_start,
      data.period_end,
    );
  });

export const updatePayrollStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string(),
        bonus_amount: z.number().nonnegative().optional(),
        advance_amount: z.number().nonnegative().optional(),
        deduction_amount: z.number().nonnegative().optional(),
        note: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requirePayrollAdmin(context.supabase);
    const { data: statement, error: loadError } = await context.supabase
      .from("payroll_statements")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!statement) throw new Error("Hisob-kitob topilmadi.");
    if (statement.status !== "draft") {
      throw new Error("Tasdiqlangan yoki to'langan hisob-kitobni o'zgartirib bo'lmaydi.");
    }

    const bonus = data.bonus_amount ?? Number(statement.bonus_amount);
    const advance = data.advance_amount ?? Number(statement.advance_amount);
    const deduction = data.deduction_amount ?? Number(statement.deduction_amount);
    const { error } = await context.supabase
      .from("payroll_statements")
      .update({
        bonus_amount: bonus,
        advance_amount: advance,
        deduction_amount: deduction,
        total_computed: roundMoney(
          Number(statement.base_amount) + Number(statement.commission_amount) + bonus - advance - deduction,
        ),
        note: data.note ?? statement.note,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const approvePayrollStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await requirePayrollAdmin(context.supabase);
    const { data: statement, error: loadError } = await context.supabase
      .from("payroll_statements")
      .select("id, status, employees(id, full_name)")
      .eq("id", data.id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!statement) throw new Error("Hisob-kitob topilmadi.");
    if (statement.status !== "draft") {
      throw new Error("Faqat qoralama hisob-kitob tasdiqlanadi.");
    }
    const { error } = await context.supabase
      .from("payroll_statements")
      .update({ status: "approved", approved_by: context.userId, approved_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    const employee = (statement.employees as { full_name?: string } | null)?.full_name ?? "Xodim";
    await logActivity(context.supabase, {
      entityType: "payroll_statement",
      entityId: data.id,
      action: "payroll_approved",
      detail: `${employee} hisob-kitobi tasdiqlandi`,
      actorUserId: context.userId,
    });
    return { ok: true };
  });

export const markPayrollStatementPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string(),
        paid_amount: z.number().nonnegative().optional(),
        payment_method: z.enum(["cash", "card", "transfer", "other"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePayrollAdmin(context.supabase);
    const { data: statement, error: loadError } = await context.supabase
      .from("payroll_statements")
      .select("status, total_computed, period_start, period_end, expense_id, employees(id, full_name)")
      .eq("id", data.id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!statement) throw new Error("Hisob-kitob topilmadi.");
    if (statement.status !== "approved") {
      throw new Error("Avval hisob-kitobni tasdiqlang.");
    }
    const employee = (statement.employees as { full_name?: string } | null)?.full_name ?? "Xodim";
    const paid = data.paid_amount ?? Number(statement.total_computed);
    const method = data.payment_method ?? "cash";
    const paidAt = new Date();

    // One ledger row per statement: a second call reuses the existing expense.
    let expenseId = statement.expense_id ?? null;
    const createdExpense = !expenseId;
    if (createdExpense) {
      const expense = buildPayrollExpense({
        employeeName: employee,
        periodStart: statement.period_start,
        periodEnd: statement.period_end,
        amount: paid,
        paymentMethod: method,
        paidAt,
      });
      if (expense) {
        const { data: row, error: expenseError } = await context.supabase
          .from("expenses")
          .insert({ ...expense, business_id: businessId, created_by: context.userId })
          .select("id")
          .single();
        if (expenseError) throw new Error(expenseError.message);
        expenseId = row?.id ?? null;
      }
    }

    const { error } = await context.supabase
      .from("payroll_statements")
      .update({ status: "paid", total_paid: paid, paid_at: paidAt.toISOString(), paid_method: method, expense_id: expenseId })
      .eq("id", data.id)
      .eq("status", "approved");
    if (error) {
      // Losing the status race must not leave a orphaned expense behind.
      if (createdExpense && expenseId) {
        await context.supabase.from("expenses").delete().eq("id", expenseId);
      }
      throw new Error(error.message);
    }
    await logActivity(context.supabase, {
      entityType: "payroll_statement",
      entityId: data.id,
      action: "payroll_paid",
      detail: `${employee}: ${paid} to'landi (${method})${expenseId ? ", moliyaga 'Oylik' xarajati yozildi" : ""}`,
      actorUserId: context.userId,
    });
    return { ok: true, expense_id: expenseId };
  });

/* ------------------------ per-service commission overrides ------------------------ */

export const listServiceOverrides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ employee_id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await requirePayrollAdmin(context.supabase);
    const { data: rows, error } = await context.supabase
      .from("employee_services")
      .select("service_id, commission_percent, services(id, name)")
      .eq("employee_id", data.employee_id);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveServiceOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        employee_id: z.string(),
        service_id: z.string(),
        commission_percent: z.number().min(0).max(100).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePayrollAdmin(context.supabase);
    // Foiz bizning xodimimiz va bizning xizmatimiz juftligiga yoziladi: RLS
    // begona qatorni ko'rsatmaydi, lekin bizning qatorimizga begona ID o'tkazadi.
    for (const [table, id, label] of [
      ["employees", data.employee_id, "Xodim"],
      ["services", data.service_id, "Xizmat"],
    ] as const) {
      const { data: ownRow, error: ownError } = await context.supabase
        .from(table)
        .select("id")
        .eq("business_id", businessId)
        .eq("id", id)
        .maybeSingle();
      if (ownError) throw new Error(ownError.message);
      if (!ownRow) throw new Error(`${label} topilmadi — ro'yxatdan qayta tanlang.`);
    }
    const { data: existing, error: loadError } = await context.supabase
      .from("employee_services")
      .select("service_id")
      .eq("employee_id", data.employee_id)
      .eq("service_id", data.service_id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (existing) {
      const { error } = await context.supabase
        .from("employee_services")
        .update({ commission_percent: data.commission_percent })
        .eq("employee_id", data.employee_id)
        .eq("service_id", data.service_id);
      if (error) throw new Error(error.message);
    } else if (data.commission_percent !== null) {
      // Setting an override also grants the capability for that service.
      const { error } = await context.supabase.from("employee_services").insert({
        business_id: businessId,
        employee_id: data.employee_id,
        service_id: data.service_id,
        commission_percent: data.commission_percent,
      });
      if (error) {
        if (error.code === "23505") throw new Error("Bu xizmat uchun foiz allaqachon belgilangan.");
        throw new Error(error.message);
      }
    }
    await logActivity(context.supabase, {
      entityType: "payroll_rule",
      entityId: data.employee_id,
      action: "commission_override_saved",
      detail: `xizmat ${data.service_id}: ${data.commission_percent ?? "qoida foizi"}%`,
      actorUserId: context.userId,
    });
    return { ok: true };
  });

export const deletePayrollStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await requirePayrollAdmin(context.supabase);
    const { data: statement, error: loadError } = await context.supabase
      .from("payroll_statements")
      .select("status")
      .eq("id", data.id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!statement) throw new Error("Hisob-kitob topilmadi.");
    if (statement.status !== "draft") {
      throw new Error("Tasdiqlangan yoki to'langan hisob-kitob o'chirilmaydi.");
    }
    const { error } = await context.supabase.from("payroll_statements").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
