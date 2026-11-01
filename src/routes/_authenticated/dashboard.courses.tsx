/**
 * Kurslar — o‘quv markazi katalogi.
 *
 * Kurs `services` yozuvi: nomi, bitta dars davomiyligi va oylik narxi. Avval bu
 * sahifa `products` (SKU, zaxira, kam zaxira) edi, ya'ni kurs sotuvga tayyor
 * mahsulotdek ko‘rinardi va guruhlar/uning o‘qituvchisi bilan bog‘lanmasdi.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { listServices, saveService, deleteService } from "@/lib/appointments.functions";
import { listStudyGroups } from "@/lib/groups.functions";
import { t } from "@/lib/i18n";
import { useSectionVisibility } from "@/lib/section-visibility";
import { useSectionTitle } from "@/lib/terminology";
import { formatMoney } from "@/lib/types";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/courses")({
  head: () => ({
    meta: [
      { title: t("Kurslar — KetaOne") },
      { name: "description", content: t("Kurs nomi, dars davomiyligi va oylik narxi.") },
      { property: "og:title", content: t("Kurslar — KetaOne") },
      { property: "og:description", content: t("Kurs nomi, dars davomiyligi va oylik narxi.") },
    ],
  }),
  component: CoursesPage,
});

type CourseRow = Awaited<ReturnType<typeof listServices>>[number];

const EMPTY = { name: "", duration_minutes: "90", price: "" };

function CoursesPage() {
  const queryClient = useQueryClient();
  const fetchCourses = useServerFn(listServices);
  const fetchGroups = useServerFn(listStudyGroups);
  const save = useServerFn(saveService);
  const remove = useServerFn(deleteService);

  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);

  useSectionTitle(t("Kurslar"));
  const { loading, offers } = useSectionVisibility();

  const courses = useQuery({
    queryKey: ["services", "all"],
    queryFn: () => fetchCourses({ data: { includeInactive: true } }),
  });
  const groups = useQuery({
    queryKey: ["study-groups"],
    queryFn: () => fetchGroups({ data: {} }),
  });

  const groupsPerCourse = useMemo(() => {
    const counts = new Map<string, { total: number; active: number; students: number }>();
    for (const group of groups.data ?? []) {
      const current = counts.get(group.course_id) ?? { total: 0, active: 0, students: 0 };
      counts.set(group.course_id, {
        total: current.total + 1,
        active: current.active + (group.status === "active" ? 1 : 0),
        students: current.students + group.member_count,
      });
    }
    return counts;
  }, [groups.data]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["services"] });
    void queryClient.invalidateQueries({ queryKey: ["study-groups"] });
  };

  const saveMutation = useMutation({
    mutationFn: (input: typeof EMPTY & { id?: string; is_active?: boolean }) =>
      save({
        data: {
          ...(input.id ? { id: input.id } : {}),
          name: input.name,
          duration_minutes: Number(input.duration_minutes || 90),
          price: Number(input.price || 0),
          ...(input.is_active === undefined ? {} : { is_active: input.is_active }),
        },
      }),
    onSuccess: () => {
      toast.success(t("Kurs saqlandi"));
      setForm(EMPTY);
      setEditingId(null);
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success(t("Kurs o'chirildi"));
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  // Kurs — faqat o‘quv markazi sohasining sahifasi; boshqa presetlarda menyu da yo‘q,
  // shuning uchun to‘g‘ridan-to‘g‘ri kirilganda ham dashboard'ga qaytamiz.
  if (!loading && !offers("/dashboard/courses")) return <Navigate to="/dashboard" replace />;

  const rows = courses.data ?? [];

  return (
    <>
      <PageHeader
        title={t("Kurslar")}
        description={t("Kurs — guruhlar shu nom va oylik narx bo‘yicha ochiladi.")}
      />

      <form
        className="clay-panel flex flex-wrap items-end gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          saveMutation.mutate({ ...form, ...(editingId ? { id: editingId } : {}) });
        }}
      >
        <div className="min-w-52 flex-1">
          <Label htmlFor="course-name">{t("Kurs nomi")}</Label>
          <Input
            id="course-name"
            required
            placeholder={t("Masalan: Ingliz tili — A2")}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="course-duration">{t("Dars davomiyligi (min)")}</Label>
          <Input
            id="course-duration"
            type="number"
            min="1"
            max="1440"
            required
            className="w-40"
            value={form.duration_minutes}
            onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="course-price">{t("Oylik narx")}</Label>
          <Input
            id="course-price"
            type="number"
            min="0"
            step="1000"
            className="w-44"
            placeholder="0"
            value={form.price}
            onChange={(event) => setForm({ ...form, price: event.target.value })}
          />
        </div>
        <Button type="submit" disabled={saveMutation.isPending}>
          {editingId ? t("Saqlash") : t("Yangi kurs")}
        </Button>
        {editingId ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditingId(null);
              setForm(EMPTY);
            }}
          >
            {t("Bekor qilish")}
          </Button>
        ) : null}
      </form>

      {courses.isLoading ? (
        <LoadingState />
      ) : courses.error ? (
        <ErrorState error={courses.error} onRetry={() => void courses.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("Hozircha kurslar yo‘q")}
          description={t(
            "Birinchi kursni yuqoridagi formada yarating — guruhlar shundan keyin ochiladi.",
          )}
        />
      ) : (
        <div className="clay-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{t("Kurs nomi")}</th>
                <th className="px-4 py-3">{t("Dars")}</th>
                <th className="px-4 py-3">{t("Oylik narx")}</th>
                <th className="px-4 py-3">{t("Guruhlar")}</th>
                <th className="px-4 py-3">{t("Faol")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((course: CourseRow) => {
                const stat = groupsPerCourse.get(course.id) ?? { total: 0, active: 0, students: 0 };
                return (
                  <tr key={course.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium">{course.name}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {t("{minutes} daqiqa", { minutes: course.duration_minutes })}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{formatMoney(Number(course.price))}</td>
                    <td className="px-4 py-3">
                      {stat.total === 0 ? (
                        <span className="text-muted-foreground">{t("Guruh ochilmagan")}</span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <StatusBadge value={t("Faol")} />
                          <span className="tabular-nums">
                            {t("{active} ta faol · {students} o‘quvchi", {
                              active: stat.active,
                              students: stat.students,
                            })}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={course.is_active}
                        disabled={saveMutation.isPending}
                        onCheckedChange={(checked) =>
                          saveMutation.mutate({
                            id: course.id,
                            name: course.name,
                            duration_minutes: String(course.duration_minutes),
                            price: String(course.price),
                            is_active: checked,
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={saveMutation.isPending}
                          onClick={() => {
                            setEditingId(course.id);
                            setForm({
                              name: course.name,
                              duration_minutes: String(course.duration_minutes),
                              price: String(course.price),
                            });
                          }}
                        >
                          {t("Tahrirlash")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("Kursni o'chirish")}
                          disabled={removeMutation.isPending}
                          onClick={() => removeMutation.mutate(course.id)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
