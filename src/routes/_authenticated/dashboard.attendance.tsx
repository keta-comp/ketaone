/**
 * Davomat — o‘quv markazlari (va guruh bilan ishlaydigan istalgan soha) uchun
 * bir ekranlik belgilash. Har o‘quvchi uchun bitta qator, holatlar tugmalar bilan
 * bosiladi va yozuv darhol `attendance` jadvaliga tushadi.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_TAP_ORDER,
  type AttendanceStatus,
  shiftDayIso,
  summarize,
  todayIso,
} from "@/lib/attendance";
import {
  getAttendanceDay,
  getAttendanceWeek,
  setAttendanceMany,
  setAttendanceMark,
} from "@/lib/attendance.functions";
import { intlLocale, t } from "@/lib/i18n";
import { useSectionVisibility } from "@/lib/section-visibility";
import { useSectionTitle, useTerminology } from "@/lib/terminology";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard/attendance")({
  head: () => ({
    meta: [
      { title: t("Davomat — KetaOne") },
      { name: "description", content: t("Guruh bo‘yicha kunlik davomat: bir bosishda belgilang.") },
      { property: "og:title", content: t("Davomat — KetaOne") },
      {
        property: "og:description",
        content: t("Guruh bo‘yicha kunlik davomat: bir bosishda belgilang."),
      },
    ],
  }),
  component: AttendancePage,
});

type DayRow = Awaited<ReturnType<typeof getAttendanceDay>>["roster"][number];
type StudyGroup = Awaited<ReturnType<typeof getAttendanceDay>>["groups"][number];
/** Tanlangan guruh: haqiqiy guruh (id) yoki eski qo'lda yozilgan nom. */
type Selection = { id: string } | { name: string } | null;

const WEEKDAY_SHORT = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

const TONE: Record<AttendanceStatus, string> = {
  present: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  late: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  excused: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-400",
  absent: "border-destructive/40 bg-destructive/10 text-destructive",
};

const DOT: Record<AttendanceStatus, string> = {
  present: "bg-emerald-500",
  late: "bg-amber-500",
  excused: "bg-sky-500",
  absent: "bg-destructive",
};

function prettyDay(dayIso: string): string {
  const date = new Date(`${dayIso}T12:00:00`);
  if (dayIso === todayIso()) return t("Bugun");
  return date.toLocaleDateString(intlLocale(), { day: "numeric", month: "long" });
}

function AttendancePage() {
  const fetchDay = useServerFn(getAttendanceDay);
  const fetchWeek = useServerFn(getAttendanceWeek);
  const saveMark = useServerFn(setAttendanceMark);
  const saveMany = useServerFn(setAttendanceMany);
  const queryClient = useQueryClient();
  const { term } = useTerminology();
  const person = term("customers");

  const [date, setDate] = useState(todayIso());
  const [selection, setSelection] = useState<Selection>(null);
  const [search, setSearch] = useState("");

  useSectionTitle(t("Davomat"));

  const groupId = selection && "id" in selection ? selection.id : undefined;
  const groupName = selection && "name" in selection ? selection.name : undefined;
  const scope = { ...(groupId ? { groupId } : {}), ...(groupName ? { group: groupName } : {}) };
  const groupKey = groupId ?? groupName ?? "";

  const dayKey = ["attendance", date, groupKey] as const;
  const day = useQuery({
    queryKey: dayKey,
    queryFn: () => fetchDay({ data: { date, ...scope } }),
  });
  const week = useQuery({
    queryKey: ["attendance-week", date, groupKey],
    queryFn: () => fetchWeek({ data: { date, ...scope } }),
  });

  const rows = useMemo(() => {
    const all = day.data?.roster ?? [];
    const query = search.trim().toLowerCase();
    return query
      ? all.filter((row) => `${row.full_name} ${row.phone}`.toLowerCase().includes(query))
      : all;
  }, [day.data, search]);
  const summary = summarize(rows);
  const visibleIds = rows.map((row) => row.id);

  const applyLocal = (ids: string[], status: AttendanceStatus | null) => {
    queryClient.setQueryData(dayKey, (old: typeof day.data) =>
      old
        ? {
            ...old,
            roster: old.roster.map((row) => (ids.includes(row.id) ? { ...row, status } : row)),
          }
        : old,
    );
  };

  const markMutation = useMutation({
    mutationFn: (input: { studentId: string; status: AttendanceStatus | null }) =>
      saveMark({ data: { studentId: input.studentId, date, ...scope, status: input.status } }),
    onMutate: (input) => applyLocal([input.studentId], input.status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance-week"], refetchType: "none" });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("Belgilab bo‘lmadi"));
      void day.refetch();
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (input: { status: AttendanceStatus | null; ids: string[] }) =>
      saveMany({ data: { date, ...scope, status: input.status, studentIds: input.ids } }),
    onMutate: (input) => applyLocal(input.ids, input.status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance-week"], refetchType: "none" });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("Belgilab bo‘lmadi"));
      void day.refetch();
    },
  });

  const toggle = (row: DayRow, status: AttendanceStatus) =>
    markMutation.mutate({ studentId: row.id, status: row.status === status ? null : status });

  return (
    <>
      <PageHeader
        title={t("Davomat")}
        description={t("{many} — bir bosishda belgilanadi, hamma yozuv saqlanadi.", {
          many: person.many,
        })}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label={t("Oldingi kun")}
              onClick={() => setDate(shiftDayIso(date, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Input
              type="date"
              className="w-40"
              value={date}
              onChange={(event) => setDate(event.target.value || todayIso())}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label={t("Keyingi kun")}
              onClick={() => setDate(shiftDayIso(date, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="ghost" onClick={() => setDate(todayIso())}>
              {t("Bugun")}
            </Button>
          </div>
        }
      />

      <div className="clay-panel flex flex-wrap items-center gap-2 p-3">
        <GroupChips
          groups={day.data?.groups ?? []}
          legacyGroups={day.data?.legacyGroups ?? []}
          value={groupKey}
          onPick={setSelection}
        />
        <Input
          className="h-9 w-full sm:ml-auto sm:w-56"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("Ism yoki telefon…")}
        />
      </div>

      <div className="clay-panel flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-40 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="text-lg font-semibold text-foreground">{prettyDay(date)}</p>
            <p className="text-sm text-muted-foreground">
              {summary.marked}/{summary.total} {t("belgilandi")}
            </p>
          </div>
          <Progress
            className="mt-2 h-2"
            value={summary.total ? Math.round((summary.marked / summary.total) * 100) : 0}
          />
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            {ATTENDANCE_TAP_ORDER.map((status) => (
              <span key={status} className="flex items-center gap-1.5 text-muted-foreground">
                <span className={cn("size-2 rounded-full", DOT[status])} />
                {t(ATTENDANCE_STATUS_LABELS[status])}
                <b className="tabular-nums text-foreground">{summary[status]}</b>
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => bulkMutation.mutate({ status: "present", ids: visibleIds })}
            disabled={!visibleIds.length || bulkMutation.isPending}
          >
            {t("Hammasi keldi")}
          </Button>
          <Button
            variant="outline"
            onClick={() => bulkMutation.mutate({ status: null, ids: visibleIds })}
            disabled={!visibleIds.length || bulkMutation.isPending}
          >
            {t("Belgilarni tozalash")}
          </Button>
        </div>
      </div>

      <div className="clay-panel clay-inset flex justify-between gap-1 overflow-x-auto p-2">
        {Array.from({ length: 7 }, (unused, index) => {
          const columnDay = shiftDayIso(date, index - 6);
          const bucket = (week.data ?? {})[columnDay];
          const weekday = WEEKDAY_SHORT[(new Date(`${columnDay}T12:00:00`).getDay() + 6) % 7];
          return (
            <button
              key={columnDay}
              type="button"
              onClick={() => setDate(columnDay)}
              className={cn(
                "clay-hover min-w-20 rounded-2xl px-2 py-2 text-center text-xs",
                columnDay === date ? "bg-primary/10 text-primary" : "text-muted-foreground",
              )}
            >
              <p className="font-medium">
                {weekday} {Number(columnDay.slice(-2))}
              </p>
              <p className="mt-1 tabular-nums">
                {bucket ? `${bucket.present}/${bucket.total}` : "—"}
              </p>
            </button>
          );
        })}
      </div>

      {day.isPending ? (
        <LoadingState label={t("Davomat yuklanmoqda…")} />
      ) : day.error ? (
        <ErrorState error={day.error} onRetry={() => void day.refetch()} />
      ) : !day.data?.roster.length ? (
        <EmptyState
          title={t("{many} yo‘q", { many: person.many })}
          description={
            groupId
              ? t("Bu guruhda a‘zo yo‘q — Guruhlar bo‘limidan {many} qo‘shing.", {
                  many: person.many,
                })
              : t("Davomat ro‘yxati {many} bo‘limidan olinadi.", { many: person.many })
          }
          action={
            <Button asChild>
              {groupId ? (
                <Link to="/dashboard/groups">{t("Guruhlar")}</Link>
              ) : (
                <Link to="/dashboard/customers">{t("Yangi {term}", { term: person.one })}</Link>
              )}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("{many} topilmadi", { many: person.many })}
          description={t("Qidiruvni o‘zgartiring.")}
        />
      ) : (
        <div className="grid gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="clay-panel clay-hover flex flex-wrap items-center gap-3 p-3"
            >
              <div className="min-w-40 flex-1">
                <p className="font-medium text-foreground">{row.full_name || t("Ismsiz")}</p>
                <p className="text-xs text-muted-foreground">{row.phone || "—"}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ATTENDANCE_TAP_ORDER.map((status) => {
                  const active = row.status === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => toggle(row, status)}
                      className={cn(
                        "rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors",
                        active
                          ? TONE[status]
                          : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {t(ATTENDANCE_STATUS_LABELS[status])}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Guruh tanlagichi. Ro'yxat `study_groups`'dan olinadi; guruh nomi bo'yicha
 * qolgan eski belgilar ham tanlash mumkin — aks holda tarix yo'qolib qolardi.
 */
function GroupChips({
  groups,
  legacyGroups,
  value,
  onPick,
}: {
  groups: StudyGroup[];
  legacyGroups: string[];
  value: string;
  onPick: (selection: Selection) => void;
}) {
  const { offers } = useSectionVisibility();
  const chips = [
    { key: "", label: t("Barchasi"), pick: null as Selection },
    ...groups.map((group) => ({ key: `g:${group.id}`, label: group.name, pick: { id: group.id } })),
    ...legacyGroups.map((name) => ({ key: `n:${name}`, label: name, pick: { name } })),
  ];
  const hasGroupsPage = offers("/dashboard/groups");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.key || "__all"}
          type="button"
          onClick={() => onPick(chip.pick)}
          className={cn(
            "rounded-full border px-3 py-1 text-sm transition-colors",
            value === chip.key
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          {chip.label}
        </button>
      ))}
      {groups.length === 0 && hasGroupsPage ? (
        <Button asChild variant="outline" size="sm">
          <Link to="/dashboard/groups">{t("Guruh ochish")}</Link>
        </Button>
      ) : null}
    </div>
  );
}
