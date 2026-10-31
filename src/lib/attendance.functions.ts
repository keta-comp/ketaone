import { createServerFn } from "@tanstack/react-start";
import type { DbClient } from "./pg-rest.server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { ATTENDANCE_STATUSES, shiftDayIso } from "./attendance";
import { requirePermission } from "./guards.server";
import { requireBusinessId } from "./tenant.server";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana YYYY-MM-DD ko‘rinishida bo‘lsin");
const GROUP = z.string().trim().max(80);
const ID = z.string().uuid();
const CONFLICT = "business_id, student_id, lesson_date, group_name";
const GROUP_SELECT = "id, name";

type StudyGroup = { id: string; name: string };
type StudentRow = { id: string; full_name: string | null; phone: string | null };
type Client = DbClient;

async function findStudyGroup(
  supabase: Client,
  businessId: string,
  groupId: string,
): Promise<StudyGroup | null> {
  const { data } = await supabase
    .from("study_groups")
    .select(GROUP_SELECT)
    .eq("id", groupId)
    .eq("business_id", businessId)
    .maybeSingle();
  return (data as StudyGroup | null) ?? null;
}

/**
 * Belgi bizning o'quvchimizga yoziladi. RLS begona qatorni ko'rsatmaydi, lekin
 * bizning davomatimizga begona mijoz ID'sini o'tkazishga to'shmaydi — shuning
 * uchun ro'yxatdagi har bir ID shu biznesning mijozidir deb tekshiramiz.
 */
async function assertOwnStudents(supabase: Client, businessId: string, studentIds: string[]) {
  const uniqueIds = [...new Set(studentIds)];
  const { data: ownStudents, error } = await supabase
    .from("customers")
    .select("id")
    .eq("business_id", businessId)
    .in("id", uniqueIds);
  if (error) throw new Error(error.message);
  if ((ownStudents ?? []).length !== uniqueIds.length) {
    throw new Error("O'quvchilardan biri topilmadi — sahifani yangilab qayta belgilang.");
  }
}

async function studyGroupsFor(supabase: Client, businessId: string): Promise<StudyGroup[]> {
  const { data } = await supabase
    .from("study_groups")
    .select(GROUP_SELECT)
    .eq("business_id", businessId)
    .neq("status", "archived")
    .order("name", { ascending: true });
  return (data ?? []) as StudyGroup[];
}

/**
 * Ro'yxat: guruh tanlansa — shu guruhning faol a'zolari (group_members),
 * tanlanmasa — faol/VIP o'quvchilarning barchasi. Lead'lar davomatga kirmaydi.
 */
export const getAttendanceDay = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ date: DAY, group: GROUP.optional(), groupId: ID.optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requireBusinessId(context.supabase);
    const from = shiftDayIso(data.date, -60);

    const group = data.groupId
      ? await findStudyGroup(context.supabase, businessId, data.groupId)
      : null;
    if (data.groupId && !group) throw new Error("Guruh topilmadi — sahifani yangilang.");
    const groupName = group?.name ?? data.group ?? "";

    // Belgilar `group_name` bo'yicha o'qiladi: eski (qo'lda yozilgan) davomat ham
    // shu ustunda, yangi yozuvlarda esa nom guruhdan olinadi — ikkalasi bir ro'yxatda.
    const marksQuery = context.supabase
      .from("attendance")
      .select("student_id, group_name, status, note, lesson_date")
      .eq("business_id", businessId)
      .eq("group_name", groupName)
      .gte("lesson_date", from)
      .lte("lesson_date", data.date);

    const [membersResult, studentsResult, marksResult, groups] = await Promise.all([
      group
        ? context.supabase
            .from("group_members")
            .select("student_id")
            .eq("group_id", group.id)
            .eq("status", "active")
        : Promise.resolve({ data: [] as { student_id: string }[], error: null }),
      context.supabase
        .from("customers")
        .select("id, full_name, phone, status")
        .eq("business_id", businessId)
        .in("status", ["active", "vip"])
        .order("full_name", { ascending: true })
        .limit(2000),
      marksQuery,
      studyGroupsFor(context.supabase, businessId),
    ]);
    if (studentsResult.error) throw new Error(studentsResult.error.message);
    if (marksResult.error) throw new Error(marksResult.error.message);

    const memberIds = new Set(
      (membersResult.data ?? []).map((row: { student_id: string }) => row.student_id),
    );
    const students = (studentsResult.data ?? []) as StudentRow[];
    const dayMarks = (marksResult.data ?? []).filter(
      (row: { lesson_date: string }) => row.lesson_date === data.date,
    );
    const markedBy = new Map(dayMarks.map((row: { student_id: string }) => [row.student_id, row]));

    const roster = (group ? students.filter((student) => memberIds.has(student.id)) : students).map(
      (student) => {
        const mark = markedBy.get(student.id) as
          { status: (typeof ATTENDANCE_STATUSES)[number]; note: string } | undefined;
        return {
          id: student.id,
          full_name: student.full_name ?? "",
          phone: student.phone ?? "",
          status: mark?.status ?? null,
          note: mark?.note ?? "",
        };
      },
    );

    // Guruhnomasi bo'yicha qolgan eski belgilar ham tanlanishi uchun ular ro'yxatda qoladi.
    const legacyGroups = [
      ...new Set(
        (marksResult.data ?? [])
          .map((row: { group_name: string }) => row.group_name)
          .filter((name: string) => name && !groups.some((entry) => entry.name === name)),
      ),
    ].sort();

    return {
      roster,
      groups,
      legacyGroups,
      date: data.date,
      group: groupName,
      groupId: group?.id ?? null,
    };
  });

/** Bir o'quvchining belgisi. `status: null` belgini o'chiradi (qayta o'ylab topilganda). */
export const setAttendanceMark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        studentId: ID,
        date: DAY,
        group: GROUP.optional(),
        groupId: ID.optional(),
        status: z.enum(ATTENDANCE_STATUSES).nullable(),
        note: z.string().trim().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePermission(
      context.supabase,
      "appointments.manage",
      "Davomatni faqat qabul, menejer, admin yoki egasi belgilaydi.",
    );
    const group = data.groupId
      ? await findStudyGroup(context.supabase, businessId, data.groupId)
      : null;
    if (data.groupId && !group) throw new Error("Guruh topilmadi — sahifani yangilang.");
    const groupName = group?.name ?? data.group ?? "";

    if (data.status === null) {
      let query = context.supabase
        .from("attendance")
        .delete()
        .eq("business_id", businessId)
        .eq("student_id", data.studentId)
        .eq("lesson_date", data.date)
        .eq("group_name", groupName);
      if (group) query = query.eq("group_id", group.id);
      const { error } = await query;
      if (error) throw new Error(error.message);
      return { ok: true as const };
    }

    const now = new Date().toISOString();
    await assertOwnStudents(context.supabase, businessId, [data.studentId]);
    const { error } = await context.supabase.from("attendance").upsert(
      {
        business_id: businessId,
        student_id: data.studentId,
        lesson_date: data.date,
        group_name: groupName,
        group_id: group?.id ?? null,
        status: data.status,
        note: data.note ?? "",
        marked_by: context.userId,
        updated_at: now,
      },
      { onConflict: CONFLICT },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** "Barchasini keldi" — ekrandagi ro'yxat bir bosishda yoziladi. */
export const setAttendanceMany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        date: DAY,
        group: GROUP.optional(),
        groupId: ID.optional(),
        status: z.enum(ATTENDANCE_STATUSES).nullable(),
        studentIds: z.array(ID).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePermission(
      context.supabase,
      "appointments.manage",
      "Davomatni faqat qabul, menejer, admin yoki egasi belgilaydi.",
    );
    if (!data.studentIds.length) return { ok: true as const, count: 0 };

    const group = data.groupId
      ? await findStudyGroup(context.supabase, businessId, data.groupId)
      : null;
    if (data.groupId && !group) throw new Error("Guruh topilmadi — sahifani yangilang.");
    const groupName = group?.name ?? data.group ?? "";

    if (data.status === null) {
      let query = context.supabase
        .from("attendance")
        .delete()
        .eq("business_id", businessId)
        .eq("lesson_date", data.date)
        .eq("group_name", groupName)
        .in("student_id", data.studentIds);
      if (group) query = query.eq("group_id", group.id);
      const { error } = await query;
      if (error) throw new Error(error.message);
      return { ok: true as const, count: data.studentIds.length };
    }

    const now = new Date().toISOString();
    await assertOwnStudents(context.supabase, businessId, data.studentIds);
    const { error } = await context.supabase.from("attendance").upsert(
      data.studentIds.map((studentId: string) => ({
        business_id: businessId,
        student_id: studentId,
        lesson_date: data.date,
        group_name: groupName,
        group_id: group?.id ?? null,
        status: data.status,
        marked_by: context.userId,
        updated_at: now,
      })),
      { onConflict: CONFLICT },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const, count: data.studentIds.length };
  });

/** Haftalik jadval: 7 kun bo'yicha qisqa statistika (davomat ekrani ustidagi tasma). */
export const getAttendanceWeek = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ date: DAY, group: GROUP.optional(), groupId: ID.optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requireBusinessId(context.supabase);
    const from = shiftDayIso(data.date, -6);

    const group = data.groupId
      ? await findStudyGroup(context.supabase, businessId, data.groupId)
      : null;
    const groupName = group?.name ?? data.group ?? "";

    const { data: rows, error } = await context.supabase
      .from("attendance")
      .select("lesson_date, status")
      .eq("business_id", businessId)
      .eq("group_name", groupName)
      .gte("lesson_date", from)
      .lte("lesson_date", data.date);
    if (error) throw new Error(error.message);

    const perDay: Record<string, { present: number; total: number }> = {};
    for (const row of rows ?? []) {
      const bucket = (perDay[row.lesson_date] ??= { present: 0, total: 0 });
      bucket.total += 1;
      if (row.status === "present" || row.status === "late") bucket.present += 1;
    }
    return perDay;
  });
