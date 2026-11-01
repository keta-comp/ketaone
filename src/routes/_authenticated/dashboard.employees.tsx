import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarX2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listBranches } from "@/lib/branches.functions";
import {
  addTimeOff,
  deleteEmployee,
  deleteTimeOff,
  deleteWorkSchedule,
  getEmployeeServices,
  getWorkSchedule,
  listEmployees,
  listTimeOff,
  saveEmployee,
  saveWorkSchedule,
  setEmployeeServices,
} from "@/lib/employees.functions";
import { listServices } from "@/lib/appointments.functions";
import { intlLocale, t } from "@/lib/i18n";
import { useSectionTitle, useTerminology } from "@/lib/terminology";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/employees")({
  head: () => ({
    meta: [
      { title: t("Xodimlar — KetaOne") },
      { name: "description", content: t("Xodimlar, ularning malakasi va ish jadvali.") },
      { property: "og:title", content: t("Xodimlar — KetaOne") },
      { property: "og:description", content: t("Xodimlar, ularning malakasi va ish jadvali.") },
    ],
  }),
  component: EmployeesPage,
});

const WEEKDAYS = [
  { value: 1, label: "Dushanba" },
  { value: 2, label: "Seshanba" },
  { value: 3, label: "Chorshanba" },
  { value: 4, label: "Payshanba" },
  { value: 5, label: "Juma" },
  { value: 6, label: "Shanba" },
  { value: 7, label: "Yakshanba" },
];

function ScheduleEditor({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const fetchSchedule = useServerFn(getWorkSchedule);
  const save = useServerFn(saveWorkSchedule);
  const remove = useServerFn(deleteWorkSchedule);

  const schedule = useQuery({
    queryKey: ["work-schedule", employeeId],
    queryFn: () => fetchSchedule({ data: { employeeId } }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["work-schedule", employeeId] });

  const saveMutation = useMutation({
    mutationFn: (input: {
      id?: string;
      weekday: number;
      start_time: string;
      end_time: string;
      break_start: string | null;
      break_end: string | null;
    }) => save({ data: { employee_id: employeeId, ...input } }),
    onSuccess: () => {
      toast.success(t("Jadval saqlandi"));
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const rowsByWeekday = new Map((schedule.data ?? []).map((row) => [row.weekday, row]));

  return (
    <div className="clay-panel overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3">{t("Kun")}</th>
            <th className="px-4 py-3">{t("Boshlanish")}</th>
            <th className="px-4 py-3">{t("Tugash")}</th>
            <th className="px-4 py-3">{t("Tanaffus")}</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {WEEKDAYS.map((day) => {
            const existing = rowsByWeekday.get(day.value);
            return (
              <tr key={day.value}>
                <td className="px-4 py-3 font-medium">{t(day.label)}</td>
                <ScheduleCells
                  weekday={day.value}
                  existing={existing}
                  onSave={(input) => saveMutation.mutate(input)}
                  onDelete={() => existing && removeMutation.mutate(existing.id)}
                  pending={saveMutation.isPending || removeMutation.isPending}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type ScheduleRow = {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
};

function ScheduleCells({
  weekday,
  existing,
  onSave,
  onDelete,
  pending,
}: {
  weekday: number;
  existing: ScheduleRow | undefined;
  onSave: (input: {
    id?: string;
    weekday: number;
    start_time: string;
    end_time: string;
    break_start: string | null;
    break_end: string | null;
  }) => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const [start, setStart] = useState(existing ? existing.start_time.slice(0, 5) : "09:00");
  const [end, setEnd] = useState(existing ? existing.end_time.slice(0, 5) : "18:00");
  const [breakStart, setBreakStart] = useState(existing?.break_start ? existing.break_start.slice(0, 5) : "");
  const [breakEnd, setBreakEnd] = useState(existing?.break_end ? existing.break_end.slice(0, 5) : "");

  if (!existing) {
    return (
      <>
        <td className="px-4 py-3 text-muted-foreground">—</td>
        <td className="px-4 py-3 text-muted-foreground">—</td>
        <td className="px-4 py-3 text-muted-foreground">—</td>
        <td className="px-4 py-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onSave({
                weekday,
                start_time: start,
                end_time: end,
                break_start: breakStart || null,
                break_end: breakEnd || null,
              });
            }}
          >
            <Input type="time" className="h-8 w-28" value={start} onChange={(e) => setStart(e.target.value)} required />
            <Input type="time" className="h-8 w-28" value={end} onChange={(e) => setEnd(e.target.value)} required />
            <Input
              type="time"
              className="h-8 w-28"
              value={breakStart}
              onChange={(e) => setBreakStart(e.target.value)}
              aria-label={t("Tanaffus boshlanishi")}
            />
            <Input
              type="time"
              className="h-8 w-28"
              value={breakEnd}
              onChange={(e) => setBreakEnd(e.target.value)}
              aria-label={t("Tanaffus tugashi")}
            />
            <Button type="submit" size="sm" disabled={pending}>
              {t("Qo'shish")}
            </Button>
          </form>
        </td>
      </>
    );
  }

  return (
    <>
      <td className="px-4 py-3 tabular-nums">{existing.start_time.slice(0, 5)}</td>
      <td className="px-4 py-3 tabular-nums">{existing.end_time.slice(0, 5)}</td>
      <td className="px-4 py-3 tabular-nums">
        {existing.break_start && existing.break_end
          ? `${existing.break_start.slice(0, 5)}–${existing.break_end.slice(0, 5)}`
          : "—"}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onSave({
                id: existing.id,
                weekday,
                start_time: start,
                end_time: end,
                break_start: breakStart || null,
                break_end: breakEnd || null,
              });
            }}
          >
            <Input type="time" className="h-8 w-28" value={start} onChange={(e) => setStart(e.target.value)} required />
            <Input type="time" className="h-8 w-28" value={end} onChange={(e) => setEnd(e.target.value)} required />
            <Input
              type="time"
              className="h-8 w-28"
              value={breakStart}
              onChange={(e) => setBreakStart(e.target.value)}
              aria-label={t("Tanaffus boshlanishi")}
            />
            <Input
              type="time"
              className="h-8 w-28"
              value={breakEnd}
              onChange={(e) => setBreakEnd(e.target.value)}
              aria-label={t("Tanaffus tugashi")}
            />
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {t("Saqlash")}
            </Button>
          </form>
          <Button variant="ghost" size="icon" aria-label={t("Jadvalni o'chirish")} onClick={onDelete} disabled={pending}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </td>
    </>
  );
}

function ServicesEditor({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const fetchServices = useServerFn(listServices);
  const fetchAssigned = useServerFn(getEmployeeServices);
  const assign = useServerFn(setEmployeeServices);

  const services = useQuery({ queryKey: ["services"], queryFn: () => fetchServices({ data: {} }) });
  const assigned = useQuery({
    queryKey: ["employee-services", employeeId],
    queryFn: () => fetchAssigned({ data: { employeeId } }),
  });

  const mutation = useMutation({
    mutationFn: (serviceIds: string[]) => assign({ data: { employeeId, serviceIds } }),
    onSuccess: () => {
      toast.success(t("Malaka saqlandi"));
      void queryClient.invalidateQueries({ queryKey: ["employee-services", employeeId] });
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const current = new Set(assigned.data ?? []);
  const toggle = (serviceId: string) => {
    const next = new Set(current);
    if (next.has(serviceId)) next.delete(serviceId);
    else next.add(serviceId);
    mutation.mutate([...next]);
  };

  if (services.isPending || assigned.isPending) return <LoadingState />;

  return (
    <div className="clay-panel p-4">
      <p className="text-sm text-muted-foreground">{t("Xodim qaysi xizmatlarni bajara oladi?")}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {(services.data ?? []).map((service) => (
          <label key={service.id} className="flex items-center gap-2 text-sm">
            <Switch checked={current.has(service.id)} onCheckedChange={() => toggle(service.id)} />
            <span>{service.name}</span>
          </label>
        ))}
        {(services.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Xizmatlar yo'q")}</p>
        ) : null}
      </div>
    </div>
  );
}

function TimeOffEditor({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const fetchTimeOff = useServerFn(listTimeOff);
  const add = useServerFn(addTimeOff);
  const remove = useServerFn(deleteTimeOff);

  const [form, setForm] = useState({ starts_at: "", ends_at: "", reason: "" });

  const timeOff = useQuery({
    queryKey: ["time-off", employeeId],
    queryFn: () => fetchTimeOff({ data: { employeeId } }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["time-off", employeeId] });

  const addMutation = useMutation({
    mutationFn: () =>
      add({
        data: {
          employee_id: employeeId,
          starts_at: new Date(form.starts_at).toISOString(),
          ends_at: new Date(form.ends_at).toISOString(),
          reason: form.reason || undefined,
        },
      }),
    onSuccess: () => {
      toast.success(t("Ta'til qo'shildi"));
      setForm({ starts_at: "", ends_at: "", reason: "" });
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  return (
    <div className="grid gap-3">
      <form
        className="clay-panel flex flex-wrap items-end gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          addMutation.mutate();
        }}
      >
        <div>
          <Label htmlFor="off-start">{t("Boshlanish")}</Label>
          <Input
            id="off-start"
            type="datetime-local"
            required
            value={form.starts_at}
            onChange={(event) => setForm({ ...form, starts_at: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="off-end">{t("Tugash")}</Label>
          <Input
            id="off-end"
            type="datetime-local"
            required
            value={form.ends_at}
            onChange={(event) => setForm({ ...form, ends_at: event.target.value })}
          />
        </div>
        <div className="min-w-40 flex-1">
          <Label htmlFor="off-reason">{t("Sabab")}</Label>
          <Input
            id="off-reason"
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
            placeholder={t("Ta'til, kasal, o'qish...")}
          />
        </div>
        <Button type="submit" disabled={addMutation.isPending}>
          {t("Ta'til qo'shish")}
        </Button>
      </form>

      {(timeOff.data ?? []).length > 0 ? (
        <div className="clay-panel overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {(timeOff.data ?? []).map((off) => (
                <tr key={off.id}>
                  <td className="px-4 py-3">
                    <CalendarX2 className="mr-2 inline size-4 text-muted-foreground" />
                    <span className="tabular-nums">{new Date(off.starts_at).toLocaleString(intlLocale())}</span>
                    {" — "}
                    <span className="tabular-nums">{new Date(off.ends_at).toLocaleString(intlLocale())}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{off.reason || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("Ta'tilni o'chirish")}
                      onClick={() => removeMutation.mutate(off.id)}
                      disabled={removeMutation.isPending}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">{t("Ta'tillar qayd etilmagan.")}</p>
      )}
    </div>
  );
}

function EmployeesPage() {
  const queryClient = useQueryClient();
  const { term } = useTerminology();
  const staff = term("employees");
  const fetchEmployees = useServerFn(listEmployees);
  const fetchBranches = useServerFn(listBranches);
  const save = useServerFn(saveEmployee);
  const remove = useServerFn(deleteEmployee);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: "", position: "", phone: "", branch_id: "" });

  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => fetchEmployees({ data: { includeInactive: true } }),
  });
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => fetchBranches({ data: {} }) });
  useSectionTitle(staff.many);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["employees"] });
    void queryClient.invalidateQueries({ queryKey: ["appointments"] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          full_name: form.full_name,
          position: form.position || undefined,
          phone: form.phone || undefined,
          branch_id: form.branch_id ? form.branch_id : null,
        },
      }),
    onSuccess: () => {
      toast.success(t("{term} qo'shildi", { term: staff.one }));
      setForm({ full_name: "", position: "", phone: "", branch_id: "" });
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const toggleMutation = useMutation({
    mutationFn: (input: {
      id: string;
      full_name: string;
      position: string;
      phone: string;
      branch_id: string | null;
      is_active: boolean;
    }) => save({ data: input }),
    onSuccess: () => invalidate(),
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: (_result, id) => {
      toast.success(t("{term} o'chirildi", { term: staff.one }));
      if (selectedId === id) setSelectedId(null);
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const selected = (employees.data ?? []).find((employee) => employee.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title={staff.many}
        description={t("Ustalar, shifokorlar va qabul xodimlari — malaka, ish jadvali va ta'tillar.")}
      />

      <form
        className="clay-panel grid gap-3 p-4 sm:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="sm:col-span-2">
          <Label htmlFor="emp-name">{t("To'liq ism")}</Label>
          <Input
            id="emp-name"
            required
            value={form.full_name}
            onChange={(event) => setForm({ ...form, full_name: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="emp-position">{t("Lavozim")}</Label>
          <Input
            id="emp-position"
            value={form.position}
            onChange={(event) => setForm({ ...form, position: event.target.value })}
            placeholder={staff.one}
          />
        </div>
        <div>
          <Label htmlFor="emp-phone">{t("Telefon")}</Label>
          <Input
            id="emp-phone"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-5 sm:flex-row sm:items-end">
          {(branches.data ?? []).length > 0 ? (
            <div className="flex-1">
              <Label htmlFor="emp-branch">{t("Filial")}</Label>
              <Select
                value={form.branch_id}
                onValueChange={(value) => setForm({ ...form, branch_id: value === "none" ? "" : value })}
              >
                <SelectTrigger id="emp-branch">
                  <SelectValue placeholder={t("Filialsiz")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("Filialsiz")}</SelectItem>
                  {(branches.data ?? []).map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <Button type="submit" disabled={saveMutation.isPending}>
            {t("Yangi {term}", { term: staff.one })}
          </Button>
        </div>
      </form>

      {employees.isPending ? (
        <LoadingState />
      ) : employees.error ? (
        <ErrorState error={employees.error} onRetry={() => void employees.refetch()} />
      ) : (employees.data ?? []).length === 0 ? (
        <EmptyState
          title={t("Hozircha {many} yo'q", { many: staff.many })}
          description={t("Bronlarni biriktirish uchun xodim qo'shing.")}
        />
      ) : (
        <div className="clay-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{staff.one}</th>
                <th className="px-4 py-3">{t("Lavozim")}</th>
                <th className="px-4 py-3">{t("Filial")}</th>
                <th className="px-4 py-3">{t("Faol")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(employees.data ?? []).map((employee) => {
                const branch = employee.branches as { name?: string } | null;
                return (
                  <tr key={employee.id} className={selectedId === employee.id ? "bg-primary/5" : undefined}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{employee.full_name}</p>
                      <p className="text-xs text-muted-foreground">{employee.phone || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{employee.position || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{branch?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={employee.is_active}
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({
                            id: employee.id,
                            full_name: employee.full_name,
                            position: employee.position,
                            phone: employee.phone,
                            branch_id: employee.branch_id,
                            is_active: checked,
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("Jadval va malaka")}
                          onClick={() => setSelectedId(selectedId === employee.id ? null : employee.id)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("Xodimni o'chirish")}
                          onClick={() => removeMutation.mutate(employee.id)}
                          disabled={removeMutation.isPending}
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

      {selected ? (
        <div className="grid gap-4">
          <p className="text-sm font-medium">
            {t("Tanlangan xodim")}: {selected.full_name}
          </p>
          <Tabs defaultValue="schedule">
            <TabsList>
              <TabsTrigger value="schedule">{t("Ish jadvali")}</TabsTrigger>
              <TabsTrigger value="services">{t("Malaka")}</TabsTrigger>
              <TabsTrigger value="timeoff">{t("Ta'tillar")}</TabsTrigger>
            </TabsList>
            <TabsContent value="schedule" className="mt-4">
              <ScheduleEditor employeeId={selected.id} />
            </TabsContent>
            <TabsContent value="services" className="mt-4">
              <ServicesEditor employeeId={selected.id} />
            </TabsContent>
            <TabsContent value="timeoff" className="mt-4">
              <TimeOffEditor employeeId={selected.id} />
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
    </>
  );
}
