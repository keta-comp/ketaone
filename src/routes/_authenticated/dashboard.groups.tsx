/**
 * Guruhlar — o‘quv markazining ishchi obyekti.
 *
 * Guruh kursga (services) birinadi, o‘qituvchini, sig‘imni, dars kunlarini va
 * oylik narxni o‘zida saqlaydi. A'zolar ro'yxati shu yerda yuritiladi: o‘quvchi
 * qo'shilganda davomat ro'yxati va oylik to'lov shu guruh bo'yicha shakllanadi.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Users, Wallet, X } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listEmployees } from "@/lib/employees.functions";
import { listServices } from "@/lib/appointments.functions";
import { listCrmCustomers } from "@/lib/customers.functions";
import {
  GROUP_STATUS_LABELS,
  GROUP_STATUSES,
  WEEKDAY_LABELS,
  type GroupStatus,
  lessonDaysLabel,
  monthKey,
  parseLessonDays,
  seatsLeft,
  tuitionPrice,
} from "@/lib/groups";
import {
  addStudyGroupMembers,
  generateGroupTuition,
  listStudyGroupMembers,
  listStudyGroups,
  removeStudyGroupMember,
  saveStudyGroup,
} from "@/lib/groups.functions";
import { t } from "@/lib/i18n";
import { useSectionVisibility } from "@/lib/section-visibility";
import { useSectionTitle, useTerminology } from "@/lib/terminology";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/types";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/groups")({
  head: () => ({
    meta: [
      { title: t("Guruhlar — KetaOne") },
      {
        name: "description",
        content: t("Kurs, o‘qituvchi, sig‘im va oylik narx — bitta guruhda."),
      },
      { property: "og:title", content: t("Guruhlar — KetaOne") },
      {
        property: "og:description",
        content: t("Kurs, o‘qituvchi, sig‘im va oylik narx — bitta guruhda."),
      },
    ],
  }),
  component: GroupsPage,
});

type GroupRow = Awaited<ReturnType<typeof listStudyGroups>>[number];
type MemberRow = Awaited<ReturnType<typeof listStudyGroupMembers>>["members"][number];

const ANY_COURSE = "__any";
const ANY_TEACHER = "__any";
/** Radix `value` bo‘sh satrni yoqtirmaydi — tanlanmagan holat shu belgi bilan ifodalanadi. */
const NO_COURSE = "__none";

const STATUS_TONE: Record<GroupStatus, string> = {
  collecting: "border-warning/30 bg-warning/15 text-warning",
  active: "border-success/30 bg-success/15 text-success",
  finished: "border-border bg-muted text-muted-foreground",
  archived: "border-border bg-muted text-muted-foreground",
};

const EMPTY_FORM = {
  name: "",
  course_id: "",
  teacher_id: ANY_TEACHER,
  monthly_price: "",
  capacity: "12",
  lesson_days: [] as number[],
  starts_on: "",
  ends_on: "",
  status: "collecting" as GroupStatus,
  note: "",
};

function formFromGroup(group: GroupRow) {
  return {
    name: group.name,
    course_id: group.course_id,
    teacher_id: group.teacher_id ?? ANY_TEACHER,
    monthly_price: group.monthly_price ? String(group.monthly_price) : "",
    capacity: String(group.capacity ?? 0),
    lesson_days: parseLessonDays(group.lesson_days),
    starts_on: group.starts_on ?? "",
    ends_on: group.ends_on ?? "",
    status: group.status as GroupStatus,
    note: group.note ?? "",
  };
}

function GroupsPage() {
  const queryClient = useQueryClient();
  const fetchGroups = useServerFn(listStudyGroups);
  const fetchCourses = useServerFn(listServices);
  const fetchTeachers = useServerFn(listEmployees);
  const save = useServerFn(saveStudyGroup);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [courseFilter, setCourseFilter] = useState(ANY_COURSE);
  const [search, setSearch] = useState("");
  const [membersFor, setMembersFor] = useState<string | null>(null);

  useSectionTitle(t("Guruhlar"));
  const { loading, offers } = useSectionVisibility();
  const { term } = useTerminology();
  const person = term("customers");

  const groups = useQuery({
    queryKey: ["study-groups"],
    queryFn: () => fetchGroups({ data: { includeArchived: false } }),
  });
  const courses = useQuery({
    queryKey: ["services", "all"],
    queryFn: () => fetchCourses({ data: { includeInactive: true } }),
  });
  const teachers = useQuery({
    queryKey: ["employees"],
    queryFn: () => fetchTeachers({ data: { includeInactive: false } }),
  });

  const rows = useMemo(() => {
    const all = groups.data ?? [];
    const query = search.trim().toLowerCase();
    return all
      .filter((group) => courseFilter === ANY_COURSE || group.course_id === courseFilter)
      .filter(
        (group) =>
          !query ||
          `${group.name} ${group.course_name} ${group.teacher_name}`.toLowerCase().includes(query),
      );
  }, [groups.data, courseFilter, search]);

  const saveMutation = useMutation({
    mutationFn: (input: { id?: string } & typeof EMPTY_FORM) =>
      save({
        data: {
          ...(input.id ? { id: input.id } : {}),
          name: input.name,
          course_id: input.course_id,
          teacher_id: input.teacher_id === ANY_TEACHER ? null : input.teacher_id,
          monthly_price: Number(input.monthly_price || 0),
          capacity: Number(input.capacity || 0),
          lesson_days: [...input.lesson_days].sort((a, b) => a - b).join(","),
          starts_on: input.starts_on || null,
          ends_on: input.ends_on || null,
          status: input.status,
          note: input.note,
        },
      }),
    onSuccess: () => {
      toast.success(t("Guruh saqlandi"));
      setForm(EMPTY_FORM);
      setEditingId(null);
      setIsOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["study-groups"] });
    },
    onError: (error: unknown) =>
      toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const submit = () => {
    const name = form.name.trim();
    if (!name || !form.course_id) {
      toast.error(t("Guruh nomi va kursni tanlang."));
      return;
    }
    saveMutation.mutate({ ...(editingId ? { id: editingId } : {}), ...form, name });
  };

  const startEdit = (group: GroupRow) => {
    setEditingId(group.id);
    setForm(formFromGroup(group));
    setIsOpen(true);
  };

  // Guruhlar menyuda bo‘lmagan soha sahifasi — to‘g‘ridan-to‘g‘ri kirishda ham qaytaramiz.
  if (!loading && !offers("/dashboard/groups")) return <Navigate to="/dashboard" replace />;

  return (
    <>
      <PageHeader
        title={t("Guruhlar")}
        description={t(
          "{many} shu guruhga birinadi — davomat va oylik guruh bo‘yicha yuritiladi.",
          {
            many: person.many,
          },
        )}
        actions={
          <Button
            onClick={() => {
              setIsOpen((open) => !open);
              setEditingId(null);
              setForm(EMPTY_FORM);
            }}
          >
            <Plus className="size-4" />
            {isOpen ? t("Yopish") : t("Yangi guruh")}
          </Button>
        }
      />

      {isOpen ? (
        <GroupForm
          form={form}
          setForm={setForm}
          courses={courses.data ?? []}
          teachers={teachers.data ?? []}
          editingId={editingId}
          pending={saveMutation.isPending}
          onSubmit={submit}
          onCancel={() => {
            setIsOpen(false);
            setEditingId(null);
            setForm(EMPTY_FORM);
          }}
        />
      ) : null}

      <div className="clay-panel flex flex-wrap items-center gap-2 p-3">
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="w-56" aria-label={t("Kurs bo‘yicha filtr")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_COURSE}>{t("Barchasi kurslar")}</SelectItem>
            {(courses.data ?? []).map((course) => (
              <SelectItem key={course.id} value={course.id}>
                {course.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-9 w-full sm:ml-auto sm:w-60"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("Guruh, kurs yoki o‘qituvchi…")}
        />
        <TuitionButton period={monthKey()} />
      </div>

      {groups.isLoading ? (
        <LoadingState label={t("Guruhlar yuklanmoqda…")} />
      ) : groups.error ? (
        <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("Hozircha guruhlar yo‘q")}
          description={t(
            "Avval kurs yarating, keyin guruhni oching — o‘quvchilar shu guruhga birinadi.",
          )}
          action={
            <Button asChild variant="outline">
              <Link to="/dashboard/courses">{t("Kurslar")}</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              selected={membersFor === group.id}
              onSelect={() => setMembersFor((current) => (current === group.id ? null : group.id))}
              onEdit={() => startEdit(group)}
            />
          ))}
        </div>
      )}

      {membersFor ? (
        <MembersPanel
          groupId={membersFor}
          onClose={() => setMembersFor(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ["study-groups"] })}
        />
      ) : null}
    </>
  );
}

function GroupForm({
  form,
  setForm,
  courses,
  teachers,
  editingId,
  pending,
  onSubmit,
  onCancel,
}: {
  form: typeof EMPTY_FORM;
  setForm: (value: (prev: typeof EMPTY_FORM) => typeof EMPTY_FORM) => void;
  courses: { id: string; name: string; price: string | number }[];
  teachers: { id: string; full_name: string | null }[];
  editingId: string | null;
  pending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const coursePrice = courses.find((course) => course.id === form.course_id)?.price;

  return (
    <form
      className="clay-panel grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <Label htmlFor="group-name">{t("Guruh nomi")}</Label>
        <Input
          id="group-name"
          required
          maxLength={80}
          placeholder={t("Masalan: A2 — 1-guruh")}
          value={form.name}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
        />
      </div>
      <div>
        <Label htmlFor="group-course">{t("Kurs")}</Label>
        <Select
          value={form.course_id || NO_COURSE}
          onValueChange={(value) =>
            setForm((prev) => ({ ...prev, course_id: value === NO_COURSE ? "" : value }))
          }
        >
          <SelectTrigger id="group-course">
            <SelectValue placeholder={t("Kursni tanlang")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_COURSE}>{t("Kursni tanlang")}</SelectItem>
            {courses.map((course) => (
              <SelectItem key={course.id} value={course.id}>
                {course.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="group-teacher">{t("O‘qituvchi")}</Label>
        <Select
          value={form.teacher_id}
          onValueChange={(value) => setForm((prev) => ({ ...prev, teacher_id: value }))}
        >
          <SelectTrigger id="group-teacher">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_TEACHER}>{t("Belgilanmagan")}</SelectItem>
            {teachers.map((teacher) => (
              <SelectItem key={teacher.id} value={teacher.id}>
                {teacher.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="group-status">{t("Holat")}</Label>
        <Select
          value={form.status}
          onValueChange={(value) => setForm((prev) => ({ ...prev, status: value as GroupStatus }))}
        >
          <SelectTrigger id="group-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUP_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {t(GROUP_STATUS_LABELS[status])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="group-price">{t("Oylik narx")}</Label>
        <Input
          id="group-price"
          type="number"
          min="0"
          step="1000"
          placeholder={coursePrice ? formatMoney(Number(coursePrice)) : "0"}
          value={form.monthly_price}
          onChange={(event) => setForm((prev) => ({ ...prev, monthly_price: event.target.value }))}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Bo‘sh qolsa kurs narxi ishlatiladi.")}
        </p>
      </div>
      <div>
        <Label htmlFor="group-capacity">{t("Sig‘im (0 = cheksiz)")}</Label>
        <Input
          id="group-capacity"
          type="number"
          min="0"
          max="10000"
          value={form.capacity}
          onChange={(event) => setForm((prev) => ({ ...prev, capacity: event.target.value }))}
        />
      </div>
      <div>
        <Label htmlFor="group-starts">{t("Boshlanish")}</Label>
        <Input
          id="group-starts"
          type="date"
          value={form.starts_on}
          onChange={(event) => setForm((prev) => ({ ...prev, starts_on: event.target.value }))}
        />
      </div>
      <div>
        <Label htmlFor="group-ends">{t("Tugash")}</Label>
        <Input
          id="group-ends"
          type="date"
          value={form.ends_on}
          onChange={(event) => setForm((prev) => ({ ...prev, ends_on: event.target.value }))}
        />
      </div>
      <div className="sm:col-span-2">
        <Label>{t("Dars kunlari")}</Label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {WEEKDAY_LABELS.map((label, index) => {
            const day = index + 1;
            const on = form.lesson_days.includes(day);
            return (
              <button
                key={label}
                type="button"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    lesson_days: on
                      ? prev.lesson_days.filter((entry) => entry !== day)
                      : [...prev.lesson_days, day],
                  }))
                }
                className={cn(
                  "rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors",
                  on
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="group-note">{t("Izoh")}</Label>
        <Input
          id="group-note"
          maxLength={2000}
          value={form.note}
          onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
        />
      </div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {editingId ? t("Saqlash") : t("Guruh ochish")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("Bekor qilish")}
        </Button>
      </div>
    </form>
  );
}

function GroupCard({
  group,
  selected,
  onSelect,
  onEdit,
}: {
  group: GroupRow;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const left = seatsLeft(group.capacity, group.member_count);
  const days = lessonDaysLabel(group.lesson_days);

  return (
    <div className={cn("clay-panel flex flex-col gap-3 p-4", selected && "ring-2 ring-primary/40")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{group.name}</p>
          <p className="truncate text-sm text-muted-foreground">
            {group.course_name || t("Kurs tanlanmagan")}
            {group.teacher_name ? ` · ${group.teacher_name}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium",
            STATUS_TONE[group.status as GroupStatus] ?? STATUS_TONE.finished,
          )}
        >
          {t(GROUP_STATUS_LABELS[group.status as GroupStatus] ?? group.status)}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Detail
          label={t("Oylik")}
          value={formatMoney(
            tuitionPrice({ groupPrice: group.monthly_price, coursePrice: group.course_price }),
          )}
        />
        <Detail
          label={t("O‘rin")}
          value={
            left === null
              ? `${group.member_count} ${t("kishi")}`
              : `${group.member_count}/${group.capacity}`
          }
        />
        <Detail label={t("Kunlar")} value={days || t("Belgilanmagan")} />
        <Detail label={t("Reja")} value={formatMoney(group.planned_sum)} />
      </dl>

      {left !== null && left <= 0 ? (
        <p className="text-xs font-medium text-destructive">{t("Guruh to‘lgan")}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant={selected ? "default" : "outline"} size="sm" onClick={onSelect}>
          <Users className="size-4" />
          {t("A‘zolar ({count})", { count: group.member_count })}
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          {t("Tahrirlash")}
        </Button>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Oylik hisob-kitob tugmasi. `groupId` berilmasa barcha faol guruhlar bo'yicha
 * ishlaydi — oy boshida bir bosish yetarli.
 */
function TuitionButton({ period, groupId }: { period: string; groupId?: string }) {
  const queryClient = useQueryClient();
  const generate = useServerFn(generateGroupTuition);

  const mutation = useMutation({
    mutationFn: () => generate({ data: groupId ? { period, groupId } : { period } }),
    onSuccess: (result) => {
      toast.success(
        result.created
          ? t("{period}: {count} ta oylik hisoblandi ({amount}).", {
              period,
              count: result.created,
              amount: formatMoney(result.total),
            })
          : t("{period}: yangi oylik yo‘q — {skipped} ta allaqachon hisoblangan.", {
              period,
              skipped: result.skipped,
            }),
      );
      void queryClient.invalidateQueries({ queryKey: ["study-groups"] });
      void queryClient.invalidateQueries({ queryKey: ["study-group-members"] });
      void queryClient.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (error: unknown) =>
      toast.error(friendlyError(error, t("Hisoblab bo‘lmadi"))),
  });

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      <Wallet className="size-4" />
      {groupId ? t("Oylikni hisoblash") : t("Barcha guruhlar oyligi")}
    </Button>
  );
}

function MembersPanel({
  groupId,
  onClose,
  onSaved,
}: {
  groupId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fetchMembers = useServerFn(listStudyGroupMembers);
  const fetchStudents = useServerFn(listCrmCustomers);
  const add = useServerFn(addStudyGroupMembers);
  const drop = useServerFn(removeStudyGroupMember);

  const [period, setPeriod] = useState(monthKey());
  const [search, setSearch] = useState("");

  const members = useQuery({
    queryKey: ["study-group-members", groupId, period],
    queryFn: () => fetchMembers({ data: { groupId, period } }),
  });
  const students = useQuery({
    queryKey: ["study-group-candidates", search],
    queryFn: () => fetchStudents({ data: { search, status: "active", sort: "name" } }),
  });

  const invalidate = () => {
    void members.refetch();
    onSaved();
  };

  const addMutation = useMutation({
    mutationFn: (studentId: string) => add({ data: { groupId, studentIds: [studentId] } }),
    onSuccess: () => {
      toast.success(t("O‘quvchi qo‘shildi"));
      setSearch("");
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(friendlyError(error, t("Qo‘shib bo‘lmadi"))),
  });

  const removeMutation = useMutation({
    mutationFn: (studentId: string) => drop({ data: { groupId, studentId } }),
    onSuccess: () => {
      toast.success(t("Guruhdan olib tashlandi"));
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const memberIds = new Set((members.data?.members ?? []).map((row) => row.student_id));
  const candidates = (students.data ?? [])
    .filter((student) => !memberIds.has(student.id))
    .slice(0, 8);
  const totalDue = (members.data?.members ?? []).reduce((sum, row) => sum + row.balance, 0);

  return (
    <section className="clay-panel grid gap-3 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">
            {members.data?.group?.name ?? t("A‘zolar")}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {members.data?.course_name ?? ""}
          </p>
        </div>
        <Input
          type="month"
          className="w-40"
          value={period}
          onChange={(event) => setPeriod(event.target.value || monthKey())}
          aria-label={t("Oylik davri")}
        />
        <TuitionButton period={period} groupId={groupId} />
        <Button variant="ghost" size="icon" aria-label={t("Yopish")} onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-52 flex-1">
          <Label htmlFor="member-search">{t("O‘quvchini qidirib qo‘shish")}</Label>
          <Input
            id="member-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("Ism yoki telefon…")}
          />
        </div>
      </div>

      {search.trim().length >= 2 ? (
        <div className="clay-inset flex flex-wrap gap-2 p-2">
          {candidates.length === 0 ? (
            <p className="px-2 py-1 text-sm text-muted-foreground">{t("O‘quvchi topilmadi")}</p>
          ) : (
            candidates.map((student) => (
              <Button
                key={student.id}
                variant="outline"
                size="sm"
                disabled={addMutation.isPending}
                onClick={() => addMutation.mutate(student.id)}
              >
                <Plus className="size-4" />
                {student.full_name || t("Ismsiz")}
              </Button>
            ))
          )}
        </div>
      ) : null}

      {members.isLoading ? (
        <LoadingState />
      ) : members.error ? (
        <ErrorState error={members.error} onRetry={() => void members.refetch()} />
      ) : (members.data?.members ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("Bu guruhda hozircha o‘quvchi yo‘q — yuqoridagi qidiruvdan qo‘shing.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-2">{t("O‘quvchi")}</th>
                <th className="px-2 py-2">{t("Oylik")}</th>
                <th className="px-2 py-2">{t("To‘langan")}</th>
                <th className="px-2 py-2">{t("Qoldiq")}</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(members.data?.members ?? []).map((row: MemberRow) => (
                <tr key={row.student_id}>
                  <td className="px-2 py-2">
                    <p className="font-medium text-foreground">{row.full_name || t("Ismsiz")}</p>
                    <p className="text-xs text-muted-foreground">{row.phone || "—"}</p>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{formatMoney(row.monthly_price)}</td>
                  <td className="px-2 py-2 tabular-nums">{formatMoney(row.paid_amount)}</td>
                  <td
                    className={cn(
                      "px-2 py-2 tabular-nums",
                      row.balance > 0 ? "font-medium text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {formatMoney(row.balance)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(row.student_id)}
                    >
                      {t("Chiqarish")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("{period} uchun jami qoldiq: {amount}", {
              period,
              amount: formatMoney(totalDue),
            })}
          </p>
        </div>
      )}
    </section>
  );
}
