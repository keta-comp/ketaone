import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { requirePermission } from "./guards.server";
import { GROUP_STATUSES, isFull, lastDayOfMonth, monthLabel, tuitionPrice } from "./groups";
import { requireBusinessId } from "./tenant.server";

const ID = z.string().uuid();
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Oy YYYY-MM ko‘rinishida bo‘lsin");

type Money = string | number | null;

type GroupRef = {
  id: string;
  name: string;
  course_id: string;
  teacher_id: string | null;
  monthly_price: Money;
  capacity: number;
  lesson_days: string;
  starts_on: string | null;
  ends_on: string | null;
  status: string;
  note: string;
};
type CourseRef = { id: string; name: string; price: Money };
type TeacherRef = { id: string; full_name: string };
type GroupMemberRef = { group_id: string; student_id: string; monthly_price: Money };

const groupInput = z.object({
  id: ID.optional(),
  name: z.string().trim().min(1).max(80),
  course_id: ID,
  teacher_id: ID.nullable().optional(),
  monthly_price: z.number().nonnegative().max(1_000_000_000),
  capacity: z.number().int().nonnegative().max(10_000),
  lesson_days: z.string().trim().max(40).default(""),
  starts_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  ends_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  status: z.enum(GROUP_STATUSES).default("active"),
  note: z.string().trim().max(2000).default(""),
});

/**
 * Guruhlar ro'yxati. Kurs va o'qituvchi nomlari alohida so'rov bilan yig'iladi:
 * shima ichida murakkab bog'lanish yo'q, lekin natija bir xil tartibda qaytadi.
 */
export const listStudyGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ includeArchived: z.boolean().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requireBusinessId(context.supabase);

    const groupsQuery = data.includeArchived
      ? context.supabase.from("study_groups").select("*").eq("business_id", businessId)
      : context.supabase
          .from("study_groups")
          .select("*")
          .eq("business_id", businessId)
          .neq("status", "archived");

    const [groupsResult, coursesResult, teachersResult, membersResult] = await Promise.all([
      groupsQuery.order("name", { ascending: true }),
      context.supabase.from("services").select("id, name, price").eq("business_id", businessId),
      context.supabase.from("employees").select("id, full_name").eq("business_id", businessId),
      context.supabase
        .from("group_members")
        .select("group_id, student_id, monthly_price")
        .eq("business_id", businessId)
        .eq("status", "active"),
    ]);
    if (groupsResult.error) throw new Error(groupsResult.error.message);

    const groups = (groupsResult.data ?? []) as GroupRef[];
    const courseById = new Map(
      ((coursesResult.data ?? []) as CourseRef[]).map((row) => [row.id, row]),
    );
    const teacherById = new Map(
      ((teachersResult.data ?? []) as TeacherRef[]).map((row) => [row.id, row]),
    );
    const memberRows = (membersResult.data ?? []) as GroupMemberRef[];
    const perGroup = new Map<string, { count: number; sum: number }>();
    for (const row of memberRows) {
      const group = groups.find((entry) => entry.id === row.group_id);
      const course = courseById.get(group?.course_id ?? "");
      const amount = tuitionPrice({
        memberPrice: row.monthly_price,
        groupPrice: group?.monthly_price,
        coursePrice: course?.price,
      });
      const current = perGroup.get(row.group_id) ?? { count: 0, sum: 0 };
      perGroup.set(row.group_id, { count: current.count + 1, sum: current.sum + amount });
    }

    return groups.map((group) => ({
      ...group,
      course_name: courseById.get(group.course_id)?.name ?? "",
      course_price: Number(courseById.get(group.course_id)?.price ?? 0) || 0,
      teacher_name: group.teacher_id ? (teacherById.get(group.teacher_id)?.full_name ?? "") : "",
      member_count: perGroup.get(group.id)?.count ?? 0,
      planned_sum: perGroup.get(group.id)?.sum ?? 0,
    }));
  });

export const saveStudyGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => groupInput.parse(input))
  .handler(async ({ data, context }) => {
    const businessId = await requirePermission(
      context.supabase,
      "catalog.manage",
      "Guruhni faqat egasi, admin yoki menejer yaratadi yoki o‘zgartiradi.",
    );

    const { data: course } = await context.supabase
      .from("services")
      .select("id, name")
      .eq("business_id", businessId)
      .eq("id", data.course_id)
      .maybeSingle();
    if (!course) throw new Error("Kurs topilmadi — avval Kurslar bo‘limida yarating.");

    if (data.teacher_id) {
      const { data: teacher, error: teacherError } = await context.supabase
        .from("employees")
        .select("id")
        .eq("business_id", businessId)
        .eq("id", data.teacher_id)
        .maybeSingle();
      if (teacherError) throw new Error(teacherError.message);
      if (!teacher) throw new Error("O‘qituvchi topilmadi yoki sizga tegishli emas.");
    }

    const row = {
      business_id: businessId,
      name: data.name,
      course_id: data.course_id,
      teacher_id: data.teacher_id ?? null,
      monthly_price: data.monthly_price,
      capacity: data.capacity,
      lesson_days: data.lesson_days,
      starts_on: data.starts_on ?? null,
      ends_on: data.ends_on ?? null,
      status: data.status,
      note: data.note,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { data: previous, error: previousError } = await context.supabase
        .from("study_groups")
        .select("name")
        .eq("id", data.id)
        .eq("business_id", businessId)
        .maybeSingle();
      if (previousError) throw new Error(previousError.message);
      if (!previous) throw new Error("Guruh topilmadi.");

      const { error } = await context.supabase
        .from("study_groups")
        .update(row)
        .eq("id", data.id)
        .eq("business_id", businessId);
      if (error) throw new Error(error.message);

      // Davomat belgilari guruh NOMI bilan bog'langan (attendance_one_mark_per_day
      // shu nom ustida), nom o'zgarsa eski yozuvlar guruh ko'rinishida yo'qolib
      // qoladi — shuning uchun ularni yangi nomga ko'chiramiz.
      if (previous.name !== data.name) {
        const { error: moveError } = await context.supabase
          .from("attendance")
          .update({ group_name: data.name, updated_at: new Date().toISOString() })
          .eq("business_id", businessId)
          .eq("group_id", data.id)
          .eq("group_name", previous.name);
        if (moveError) {
          if (moveError.code === "23505") {
            throw new Error(
              "Guruh nomiga mos davomat yozuvlari allaqachon bor — belgilarni o'chiring yoki boshqa nom tanlang.",
            );
          }
          throw new Error(moveError.message);
        }
      }
      return { id: data.id };
    }

    const { data: created, error } = await context.supabase
      .from("study_groups")
      .insert({ ...row, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id };
  });

/** Bir guruhning a'zolari + oylik holati (to‘langan / qoldiq). */
export const listStudyGroupMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ groupId: ID, period: MONTH.optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requireBusinessId(context.supabase);
    const [{ data: group }, { data: members, error }] = await Promise.all([
      context.supabase
        .from("study_groups")
        .select("*")
        .eq("id", data.groupId)
        .eq("business_id", businessId)
        .maybeSingle(),
      context.supabase
        .from("group_members")
        .select("student_id, monthly_price, status, joined_at")
        .eq("business_id", businessId)
        .eq("group_id", data.groupId)
        .eq("status", "active")
        .order("joined_at", { ascending: true }),
    ]);
    if (error) throw new Error(error.message);
    if (!group) throw new Error("Guruh topilmadi.");

    const { data: course } = await context.supabase
      .from("services")
      .select("id, name, price")
      .eq("business_id", businessId)
      .eq("id", group.course_id)
      .maybeSingle();

    const studentIds = (members ?? []).map((row) => row.student_id);
    const students = studentIds.length
      ? await context.supabase
          .from("customers")
          .select("id, full_name, phone, status")
          .eq("business_id", businessId)
          .in("id", studentIds)
      : { data: [] };

    const paid = data.period
      ? await context.supabase
          .from("payments")
          .select("customer_id, amount, status")
          .eq("business_id", businessId)
          .eq("group_id", data.groupId)
          .eq("period_month", data.period)
      : { data: [] };

    const paidByStudent = new Map<string, number>();
    for (const row of paid.data ?? []) {
      if (row.status !== "pending") {
        paidByStudent.set(
          row.customer_id,
          (paidByStudent.get(row.customer_id) ?? 0) + (Number(row.amount) || 0),
        );
      }
    }

    const studentById = new Map((students.data ?? []).map((row) => [row.id, row]));
    return {
      group,
      course_name: course?.name ?? "",
      period: data.period ?? null,
      members: (members ?? []).map((row) => {
        const price = tuitionPrice({
          memberPrice: row.monthly_price,
          groupPrice: group.monthly_price,
          coursePrice: course?.price,
        });
        const paidSum = paidByStudent.get(row.student_id) ?? 0;
        const student = studentById.get(row.student_id);
        return {
          student_id: row.student_id,
          full_name: student?.full_name ?? "",
          phone: student?.phone ?? "",
          monthly_price: price,
          paid_amount: paidSum,
          balance: Math.max(price - paidSum, 0),
        };
      }),
    };
  });

export const addStudyGroupMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ groupId: ID, studentIds: z.array(ID).min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePermission(
      context.supabase,
      "sales.manage",
      "O‘quvchini guruhga faqat mijoz bilan ishlaydigan xodim qo‘shadi.",
    );
    const { data: group } = await context.supabase
      .from("study_groups")
      .select("id, name, capacity")
      .eq("id", data.groupId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (!group) throw new Error("Guruh topilmadi.");

    const { data: existing } = await context.supabase
      .from("group_members")
      .select("student_id, status")
      .eq("business_id", businessId)
      .eq("group_id", data.groupId);
    const active = new Set(
      (existing ?? []).filter((row) => row.status === "active").map((row) => row.student_id),
    );
    const known = new Map((existing ?? []).map((row) => [row.student_id, row]));
    const toAdd = [...new Set(data.studentIds)].filter((id) => !active.has(id));

    if (toAdd.length) {
      const { data: ownStudents, error: studentError } = await context.supabase
        .from("customers")
        .select("id")
        .eq("business_id", businessId)
        .in("id", toAdd);
      if (studentError) throw new Error(studentError.message);
      const ownIds = new Set((ownStudents ?? []).map((row: { id: string }) => row.id));
      if (ownIds.size !== toAdd.length) throw new Error("O‘quvchilardan biri topilmadi.");
    }

    if (isFull(group.capacity, active.size + toAdd.length)) {
      throw new Error(`“${group.name}” guruhida joy qolmadi.`);
    }

    const now = new Date().toISOString();
    for (const studentId of toAdd) {
      if (known.has(studentId)) {
        const { error } = await context.supabase
          .from("group_members")
          .update({ status: "active", updated_at: now })
          .eq("business_id", businessId)
          .eq("group_id", data.groupId)
          .eq("student_id", studentId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await context.supabase.from("group_members").insert({
          group_id: data.groupId,
          student_id: studentId,
          business_id: businessId,
          status: "active",
          joined_at: now,
        });
        if (error) throw new Error(error.message);
      }
    }
    return { added: toAdd.length };
  });

export const removeStudyGroupMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ groupId: ID, studentId: ID }).parse(input))
  .handler(async ({ data, context }) => {
    const businessId = await requirePermission(
      context.supabase,
      "sales.manage",
      "O‘quvchini guruhdan faqat mijoz bilan ishlaydigan xodim chiqaradi.",
    );
    const { error } = await context.supabase
      .from("group_members")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("business_id", businessId)
      .eq("group_id", data.groupId)
      .eq("student_id", data.studentId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** O‘quvchi kartasidagi guruhlar belgisi — dialogda tanlangan to‘plamga moslaydi. */
export const syncStudentGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ studentId: ID, groupIds: z.array(ID).max(50) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePermission(
      context.supabase,
      "sales.manage",
      "O‘quvchining guruhlarini faqat mijoz bilan ishlaydigan xodim o‘zgartiradi.",
    );
    const wanted = new Set(data.groupIds);

    // ID'lar orqali yozish: RLS chet biznesning qatorini ko'rsatmaydi, shuning
    // uchun ro'yxatda yo'q ID — bu begona biznes yoki noto'g'ri ma'lumot.
    const { data: ownStudent, error: studentError } = await context.supabase
      .from("customers")
      .select("id")
      .eq("business_id", businessId)
      .eq("id", data.studentId)
      .maybeSingle();
    if (studentError) throw new Error(studentError.message);
    if (!ownStudent) throw new Error("O‘quvchi topilmadi.");

    let ownGroupIds = new Set<string>();
    if (wanted.size) {
      const { data: ownGroups, error: groupError } = await context.supabase
        .from("study_groups")
        .select("id")
        .eq("business_id", businessId)
        .in("id", [...wanted]);
      if (groupError) throw new Error(groupError.message);
      ownGroupIds = new Set((ownGroups ?? []).map((row: { id: string }) => row.id));
    }
    for (const groupId of wanted) {
      if (!ownGroupIds.has(groupId)) throw new Error("Guruh topilmadi yoki sizga tegishli emas.");
    }

    const { data: current } = await context.supabase
      .from("group_members")
      .select("group_id, status")
      .eq("business_id", businessId)
      .eq("student_id", data.studentId);
    const now = new Date().toISOString();

    for (const row of current ?? []) {
      const shouldBeActive = wanted.has(row.group_id);
      if (shouldBeActive && row.status !== "active") {
        const { error } = await context.supabase
          .from("group_members")
          .update({ status: "active", updated_at: now })
          .eq("business_id", businessId)
          .eq("student_id", data.studentId)
          .eq("group_id", row.group_id);
        if (error) throw new Error(error.message);
      } else if (!shouldBeActive && row.status === "active") {
        const { error } = await context.supabase
          .from("group_members")
          .update({ status: "archived", updated_at: now })
          .eq("business_id", businessId)
          .eq("student_id", data.studentId)
          .eq("group_id", row.group_id);
        if (error) throw new Error(error.message);
      }
    }

    const linked = new Set((current ?? []).map((row) => row.group_id));
    let added = 0;
    for (const groupId of wanted) {
      if (linked.has(groupId)) continue;
      const { error } = await context.supabase.from("group_members").insert({
        group_id: groupId,
        student_id: data.studentId,
        business_id: businessId,
        status: "active",
        joined_at: now,
      });
      if (error) throw new Error(error.message);
      added += 1;
    }
    return { ok: true as const, added };
  });

export const listStudentGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ studentId: ID }).parse(input))
  .handler(async ({ data, context }) => {
    const businessId = await requireBusinessId(context.supabase);
    const { data: rows } = await context.supabase
      .from("group_members")
      .select("group_id")
      .eq("business_id", businessId)
      .eq("student_id", data.studentId)
      .eq("status", "active");
    return { groupIds: (rows ?? []).map((row) => row.group_id) };
  });

/**
 * Oylik hisob-kitob: guruh a'zolariga shu oy uchun to'lov yozuvi ochadi.
 * `payments` — jamoaning birinchi pul jadvali, shuning uchun parallel "qarzdorlik"
 * jadvali yasalmaydi: oylik = `group_id` + `period_month` bilan yozilgan pending to'lov.
 * Bir (guruh, o‘quvchi) juftligiga oyda bitta yozuv ochiladi; narxi belgilanmagan
 * a'zolar va allaqachon hisoblanganlar `skipped` bilan qaytadi.
 */
export const generateGroupTuition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ period: MONTH, groupId: ID.optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePermission(
      context.supabase,
      "finance.view",
      "Oylik hisob-kitobni faqat egasi, admin yoki menejer boshlaydi.",
    );

    const groupsResult = data.groupId
      ? await context.supabase
          .from("study_groups")
          .select("*")
          .eq("id", data.groupId)
          .eq("business_id", businessId)
          .maybeSingle()
      : await context.supabase
          .from("study_groups")
          .select("*")
          .eq("business_id", businessId)
          .in("status", ["collecting", "active"])
          .order("name", { ascending: true });
    if (groupsResult.error) throw new Error(groupsResult.error.message);

    const candidates = (
      data.groupId ? [groupsResult.data] : (groupsResult.data ?? [])
    ) as (GroupRef | null)[];
    const groups = candidates.filter((row): row is GroupRef => Boolean(row));
    if (!groups.length) {
      throw new Error(data.groupId ? "Guruh topilmadi." : "Oylik hisoblanadigan faol guruh yo‘q.");
    }

    const groupIds = groups.map((group) => group.id);
    const [coursesResult, membersResult, paymentsResult] = await Promise.all([
      context.supabase.from("services").select("id, price").eq("business_id", businessId),
      context.supabase
        .from("group_members")
        .select("group_id, student_id, monthly_price")
        .eq("business_id", businessId)
        .eq("status", "active")
        .in("group_id", groupIds),
      context.supabase
        .from("payments")
        .select("customer_id, group_id")
        .eq("business_id", businessId)
        .eq("period_month", data.period)
        .in("group_id", groupIds),
    ]);
    if (membersResult.error) throw new Error(membersResult.error.message);
    if (paymentsResult.error) throw new Error(paymentsResult.error.message);

    const coursePrice = new Map(
      ((coursesResult.data ?? []) as { id: string; price: Money }[]).map((row) => [
        row.id,
        row.price,
      ]),
    );
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const invoiced = new Set(
      (paymentsResult.data ?? []).map(
        (row: { customer_id: string; group_id: string }) => `${row.group_id}|${row.customer_id}`,
      ),
    );

    let created = 0;
    let skipped = 0;
    let total = 0;
    for (const member of (membersResult.data ?? []) as GroupMemberRef[]) {
      const group = groupById.get(member.group_id);
      if (!group) continue;
      const amount = tuitionPrice({
        memberPrice: member.monthly_price,
        groupPrice: group.monthly_price,
        coursePrice: coursePrice.get(group.course_id),
      });
      if (!amount || invoiced.has(`${member.group_id}|${member.student_id}`)) {
        skipped += 1;
        continue;
      }
      const { error } = await context.supabase.from("payments").insert({
        business_id: businessId,
        customer_id: member.student_id,
        group_id: member.group_id,
        period_month: data.period,
        amount,
        status: "pending",
        method: "cash",
        due_date: lastDayOfMonth(data.period),
        note: `${group.name} — ${monthLabel(data.period)} oylik`,
        created_by: context.userId,
      });
      if (error) {
        // Ikkita brauzer bir oylikni bir vaqtda bosasa bazadagi unikal indeks
        // (payments_group_tuition_uniq) ikkinchisini ushlaydi — bu holat xato
        // emas, allaqachon hisoblangan degan ma'noni beradi.
        if (error.code === "23505") {
          skipped += 1;
          continue;
        }
        throw new Error(error.message);
      }
      invoiced.add(`${member.group_id}|${member.student_id}`);
      created += 1;
      total += amount;
    }
    return { created, skipped, total, period: data.period };
  });
