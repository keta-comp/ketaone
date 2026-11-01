import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { CustomerDialog } from "@/components/app/crm-dialogs";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { CLUB_CATALOG_LABELS, ServicesCatalog } from "@/components/app/services-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  dayBoundsIso,
  fromLocalInputValue,
  type AppointmentStatus,
} from "@/lib/booking";
import { listBranches } from "@/lib/branches.functions";
import { listCrmCustomers } from "@/lib/customers.functions";
import {
  DEPOSIT_METHODS,
  DEPOSIT_METHOD_LABELS,
  DEPOSIT_STATE_LABELS,
  canRecordDeposit,
  canRefundDeposit,
  depositFor,
  depositOutstanding,
  depositState,
  pendingDepositTotal,
  type DepositMethod,
  type DepositState,
} from "@/lib/deposit";
import { listEmployees } from "@/lib/employees.functions";
import {
  deleteAppointment,
  listAppointments,
  listServices,
  recordDeposit as recordAppointmentDeposit,
  refundDeposit as refundAppointmentDeposit,
  saveAppointment,
  setAppointmentStatus,
} from "@/lib/appointments.functions";
import { intlLocale, t } from "@/lib/i18n";
import { isClubPreset } from "@/lib/presets";
import { useSectionTitle, useTerminology } from "@/lib/terminology";
import { formatMoney } from "@/lib/types";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/appointments")({
  head: () => ({
    meta: [
      { title: t("Qabul va bron — KetaOne") },
      { name: "description", content: t("Xizmatlar, qabul jadvali va bron boshqaruvi.") },
      { property: "og:title", content: t("Qabul va bron — KetaOne") },
      { property: "og:description", content: t("Xizmatlar, qabul jadvali va bron boshqaruvi.") },
    ],
  }),
  component: AppointmentsPage,
});

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + delta);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const STATUS_BADGE: Record<AppointmentStatus, string> = {
  new: "bg-amber-500/10 text-amber-600",
  confirmed: "bg-primary/10 text-primary",
  arrived: "bg-sky-500/10 text-sky-600",
  completed: "bg-emerald-500/10 text-emerald-600",
  cancelled: "bg-muted text-muted-foreground",
  no_show: "bg-destructive/10 text-destructive",
};

const STATUS_DOT: Record<AppointmentStatus, string> = {
  new: "bg-amber-500",
  confirmed: "bg-primary",
  arrived: "bg-sky-500",
  completed: "bg-emerald-500",
  cancelled: "bg-muted-foreground",
  no_show: "bg-destructive",
};

const DEPOSIT_BADGE: Record<DepositState, string> = {
  none: "",
  pending: "bg-amber-500/10 text-amber-700",
  paid: "bg-emerald-500/10 text-emerald-700",
  refunded: "bg-muted text-muted-foreground",
};

type CalendarView = "day" | "week" | "month";

const WEEKDAY_SHORT = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

function shiftMonth(day: string, delta: number): string {
  const date = new Date(`${day.slice(0, 8)}01T12:00:00`);
  date.setMonth(date.getMonth() + delta);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
}

function weekStartIso(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  const weekday = date.getDay() === 0 ? 7 : date.getDay();
  return shiftDay(day, -(weekday - 1));
}

function boundsFor(view: CalendarView, day: string): { from: string; to: string } {
  if (view === "day") return dayBoundsIso(day);
  if (view === "week") {
    const from = new Date(`${weekStartIso(day)}T00:00:00`);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const from = new Date(`${day.slice(0, 8)}01T00:00:00`);
  const to = new Date(from);
  to.setMonth(to.getMonth() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function localDay(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type AppointmentRow = {
  id: string;
  starts_at: string;
  status: string;
  service_name: string | null;
  customers: unknown;
  deposit_amount?: unknown;
  deposit_paid_amount?: unknown;
  deposit_paid_at?: unknown;
  deposit_refunded_at?: unknown;
};

function MiniAppointment({ row, onOpen, noPerson }: { row: AppointmentRow; onOpen: () => void; noPerson: string }) {
  const status = row.status as AppointmentStatus;
  const customer = (row.customers ?? null) as { full_name?: string | null } | null;
  const pendingDeposit = canRecordDeposit(row);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-muted"
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[status])} />
      <span className="tabular-nums font-medium">
        {new Date(row.starts_at).toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" })}
      </span>
      <span className="truncate text-muted-foreground">{customer?.full_name ?? row.service_name ?? noPerson}</span>
      {pendingDeposit ? <Wallet className="size-3 shrink-0 text-amber-600" aria-hidden /> : null}
    </button>
  );
}

function defaultStartLocal(day: string): string {
  const now = new Date();
  const hour = day === today() ? Math.min(now.getHours() + 1, 22) : 9;
  return `${day}T${String(hour).padStart(2, "0")}:00`;
}

function ScheduleTab() {
  const queryClient = useQueryClient();
  const fetchAppointments = useServerFn(listAppointments);
  const fetchServices = useServerFn(listServices);
  const fetchEmployees = useServerFn(listEmployees);
  const fetchCustomers = useServerFn(listCrmCustomers);
  const fetchBranches = useServerFn(listBranches);
  const save = useServerFn(saveAppointment);
  const setStatus = useServerFn(setAppointmentStatus);
  const remove = useServerFn(deleteAppointment);
  const { term, service: serviceTerm } = useTerminology();
  const booking = term("appointments");
  const person = term("customers");
  const staff = term("employees");
  const catalogTerm = serviceTerm();

  const [view, setView] = useState<CalendarView>("day");
  const [day, setDay] = useState(today());
  const bounds = useMemo(() => boundsFor(view, day), [view, day]);

  const [form, setForm] = useState({
    service_id: "",
    customer_id: "",
    employee_id: "",
    branch_id: "",
    starts_at: defaultStartLocal(today()),
    duration_minutes: "60",
    note: "",
  });

  const appointments = useQuery({
    queryKey: ["appointments", bounds.from],
    queryFn: () => fetchAppointments({ data: { from: bounds.from, to: bounds.to } }),
  });
  const services = useQuery({ queryKey: ["services"], queryFn: () => fetchServices({ data: {} }) });
  // Navbatda yo'q mijoz: qabul formasidan chiqmasdan tez qo'shamiz.
  const [quickCustomer, setQuickCustomer] = useState(false);
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: () => fetchEmployees({ data: {} }) });
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => fetchBranches({ data: {} }) });
  const customers = useQuery({
    queryKey: ["customers-booking"],
    queryFn: () => fetchCustomers({ data: { sort: "name" } }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["appointments"] });

  const saveMutation = useMutation({
    mutationFn: () => {
      const startsAt = fromLocalInputValue(form.starts_at);
      return save({
        data: {
          service_id: form.service_id || null,
          customer_id: form.customer_id || null,
          employee_id: form.employee_id || null,
          branch_id: form.branch_id || null,
          starts_at: startsAt,
          duration_minutes: Number(form.duration_minutes) || 60,
          note: form.note || undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("{term} qo'shildi", { term: booking.one }));
      setForm((prev) => ({ ...prev, customer_id: "", note: "" }));
      // Qo'shilgan qabul darhol ko'rinishi uchun kalendar shu kundagi joyga o'tadi.
      setDay(form.starts_at.slice(0, 10));
      setView("day");
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: AppointmentStatus }) => setStatus({ data: input }),
    onSuccess: () => {
      toast.success(t("Holat yangilandi"));
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success(t("{term} o'chirildi", { term: booking.one }));
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const [depositMethod, setDepositMethod] = useState<DepositMethod>("cash");
  const [onlyPendingDeposit, setOnlyPendingDeposit] = useState(false);

  const depositMutation = useMutation({
    mutationFn: (id: string) => recordAppointmentDeposit({ data: { id, method: depositMethod } }),
    onSuccess: () => {
      toast.success(t("Depozit qabul qilindi"));
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const refundMutation = useMutation({
    mutationFn: (id: string) => refundAppointmentDeposit({ data: { id } }),
    onSuccess: () => {
      toast.success(t("Depozit qaytarildi"));
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const employees = (employeesQuery.data ?? []).map((employee) => ({
    id: employee.id,
    label: employee.full_name,
  }));

  const allRows = appointments.data ?? [];
  const rows = onlyPendingDeposit ? allRows.filter((row) => depositOutstanding(row) > 0) : allRows;
  const pendingDeposits = pendingDepositTotal(allRows);
  const selectedService = (services.data ?? []).find((service) => service.id === form.service_id) ?? null;
  const selectedDeposit = selectedService ? depositFor(selectedService, Number(selectedService.price)) : 0;

  return (
    <div className="grid gap-4">
      <form
        className="clay-panel grid gap-3 p-4 sm:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="sm:col-span-2">
          <Label htmlFor="apt-service">{catalogTerm.one}</Label>
          <Select
            value={form.service_id}
            onValueChange={(value) => {
              const service = (services.data ?? []).find((item) => item.id === value);
              setForm((prev) => ({
                ...prev,
                service_id: value === "none" ? "" : value,
                duration_minutes: service ? String(service.duration_minutes) : prev.duration_minutes,
              }));
            }}
          >
            <SelectTrigger id="apt-service">
              <SelectValue placeholder={t("{term}ni tanlang", { term: catalogTerm.one })} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("{term}siz", { term: catalogTerm.one })}</SelectItem>
              {(services.data ?? []).map((service) => (
                <SelectItem key={service.id} value={service.id}>
                  {service.name} · {service.duration_minutes} {t("min")}
                  {depositFor(service, Number(service.price)) > 0
                    ? ` · ${t("depozit {sum}", { sum: formatMoney(depositFor(service, Number(service.price))) })}`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedDeposit > 0 ? (
            <p className="mt-1 text-xs text-amber-700">
              {t("Bu xizmat uchun depozit: {sum}", { sum: formatMoney(selectedDeposit) })}
            </p>
          ) : null}
        </div>
        <div className="sm:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="apt-customer">{person.one}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setQuickCustomer(true)}
            >
              <Plus className="size-3.5" />
              {t("Tez qo'shish")}
            </Button>
          </div>
          <Select
            value={form.customer_id}
            onValueChange={(value) => setForm((prev) => ({ ...prev, customer_id: value === "none" ? "" : value }))}
          >
            <SelectTrigger id="apt-customer">
              <SelectValue placeholder={t("{term}ni tanlang", { term: person.one })} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("{term}siz", { term: person.one })}</SelectItem>
              {(customers.data ?? []).map((customer) => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.full_name || customer.phone || customer.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="apt-employee">{staff.one}</Label>
          <Select
            value={form.employee_id}
            onValueChange={(value) => setForm((prev) => ({ ...prev, employee_id: value === "none" ? "" : value }))}
          >
            <SelectTrigger id="apt-employee">
              <SelectValue placeholder={t("Tanlang")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("Biriktirilmagan")}</SelectItem>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(branches.data ?? []).length > 0 ? (
          <div className="sm:col-span-2">
            <Label htmlFor="apt-branch">{t("Filial")}</Label>
            <Select
              value={form.branch_id}
              onValueChange={(value) => setForm((prev) => ({ ...prev, branch_id: value === "none" ? "" : value }))}
            >
              <SelectTrigger id="apt-branch">
                <SelectValue placeholder={t("Filialni tanlang")} />
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
        <div className="sm:col-span-2">
          <Label htmlFor="apt-start">{t("Boshlanish vaqti")}</Label>
          <Input
            id="apt-start"
            type="datetime-local"
            required
            value={form.starts_at}
            onChange={(event) => setForm({ ...form, starts_at: event.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="apt-duration">{t("Davomiyligi (daq.)")}</Label>
          <Input
            id="apt-duration"
            type="number"
            min={5}
            max={1440}
            step={5}
            required
            value={form.duration_minutes}
            onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="apt-note">{t("Izoh")}</Label>
          <Textarea
            id="apt-note"
            rows={1}
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
          />
        </div>
        <div className="flex items-end sm:col-span-2">
          <Button type="submit" className="w-full" disabled={saveMutation.isPending}>
            {t("Yangi {term}", { term: booking.one })}
          </Button>
        </div>
      </form>

      <CustomerDialog
        open={quickCustomer}
        onOpenChange={setQuickCustomer}
        onSaved={(saved) => setForm((prev) => ({ ...prev, customer_id: saved.id }))}
      />

      <div className="clay-panel flex flex-wrap items-center gap-3 p-4">
        <div className="flex rounded-xl bg-muted p-1">
          {(["day", "week", "month"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={cn(
                "rounded-lg px-3 py-1 text-sm font-medium transition-colors",
                view === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(option === "day" ? "Kun" : option === "week" ? "Hafta" : "Oy")}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("Oldingi davr")}
          onClick={() =>
            setDay(view === "day" ? shiftDay(day, -1) : view === "week" ? shiftDay(day, -7) : shiftMonth(day, -1))
          }
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Input type="date" className="w-40" value={day} onChange={(event) => setDay(event.target.value || today())} />
        <Button
          variant="outline"
          size="icon"
          aria-label={t("Keyingi davr")}
          onClick={() =>
            setDay(view === "day" ? shiftDay(day, 1) : view === "week" ? shiftDay(day, 7) : shiftMonth(day, 1))
          }
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="ghost" onClick={() => setDay(today())}>
          {t("Bugun")}
        </Button>
        {pendingDeposits.count > 0 ? (
          <Button
            variant={onlyPendingDeposit ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => setOnlyPendingDeposit((prev) => !prev)}
          >
            <Wallet className="size-4" />
            {t("Depozit kutilapti: {count} ta · {sum}", {
              count: pendingDeposits.count,
              sum: formatMoney(pendingDeposits.sum),
            })}
          </Button>
        ) : null}
        <span className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="size-4" />
          {rows.length} {t("ta {term}", { term: booking.one })}
        </span>
      </div>

      {appointments.isPending ? (
        <LoadingState />
      ) : appointments.error ? (
        <ErrorState error={appointments.error} onRetry={() => void appointments.refetch()} />
      ) : view === "day" ? (
        rows.length === 0 ? (
          <EmptyState
            title={
              onlyPendingDeposit
                ? t("Bu davrda depoziti to‘lanmagan {term} yo'q", { term: booking.one })
                : t("Bu kunga {term} yo'q", { term: booking.one })
            }
            description={t("Yuqoridagi forma orqali yangi {term} qo'shing.", { term: booking.one })}
          />
        ) : (
          <div className="grid gap-3">
            {rows.map((row) => {
              const status = row.status as AppointmentStatus;
              const customer = row.customers as { full_name?: string | null; phone?: string | null } | null;
              const employee = row.employees as { full_name?: string | null } | null;
              const branch = row.branches as { name?: string } | null;
              const serviceName = row.service_name ?? t("{term}siz", { term: catalogTerm.one });
              const deposit = depositState(row);
              const depositSum =
                deposit === "paid"
                  ? Number(row.deposit_paid_amount ?? row.deposit_amount ?? 0)
                  : Number(row.deposit_amount ?? 0);
              const depositMethodLabel = DEPOSIT_METHOD_LABELS[row.deposit_method as DepositMethod];
              return (
                <div key={row.id} className="clay-panel flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-28 text-center">
                    <p className="text-lg font-semibold tabular-nums">
                      {new Date(row.starts_at).toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {new Date(row.ends_at).toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="min-w-40 flex-1">
                    <p className="font-medium">
                      {serviceName}
                      {row.price != null ? (
                        <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
                          {formatMoney(Number(row.price))}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {customer?.full_name || customer?.phone || t("{term}siz", { term: person.one })}
                      {employee?.full_name ? ` · ${employee.full_name}` : ""}
                      {branch?.name ? ` · ${branch.name}` : ""}
                    </p>
                    {row.note ? <p className="mt-1 text-xs text-muted-foreground">{row.note}</p> : null}
                  </div>
                  <Badge className={cn("border-0", STATUS_BADGE[status])}>
                    {t(APPOINTMENT_STATUS_LABELS[status] ?? row.status)}
                  </Badge>
                  <Select
                    value={status}
                    onValueChange={(value) => statusMutation.mutate({ id: row.id, status: value as AppointmentStatus })}
                    disabled={statusMutation.isPending}
                  >
                    <SelectTrigger className="h-9 w-44" aria-label={t("Holatni o'zgartirish")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {APPOINTMENT_STATUSES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {t(APPOINTMENT_STATUS_LABELS[option])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {deposit !== "none" ? (
                    <div className="flex w-full flex-wrap items-center gap-2 border-t border-border/60 pt-2 sm:w-auto sm:border-t-0 sm:pt-0">
                      <Badge className={cn("gap-1 border-0", DEPOSIT_BADGE[deposit])}>
                        <Wallet className="size-3" />
                        {t(DEPOSIT_STATE_LABELS[deposit])} · {formatMoney(depositSum)}
                        {deposit === "paid" && depositMethodLabel ? ` · ${t(depositMethodLabel)}` : ""}
                      </Badge>
                      {canRecordDeposit(row) ? (
                        <>
                          <Select
                            value={depositMethod}
                            onValueChange={(value) => setDepositMethod(value as DepositMethod)}
                          >
                            <SelectTrigger className="h-8 w-28" aria-label={t("To‘lov usuli")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DEPOSIT_METHODS.map((method) => (
                                <SelectItem key={method} value={method}>
                                  {t(DEPOSIT_METHOD_LABELS[method])}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={depositMutation.isPending}
                            onClick={() => depositMutation.mutate(row.id)}
                          >
                            {t("Depozitni qabul qilish")}
                          </Button>
                        </>
                      ) : null}
                      {canRefundDeposit(row) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={refundMutation.isPending}
                          onClick={() => refundMutation.mutate(row.id)}
                        >
                          {t("Qaytarish")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("{term}ni o'chirish", { term: booking.one })}
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(row.id)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
        )
      ) : view === "week" ? (
        <div className="clay-panel overflow-x-auto">
          <div className="grid min-w-[52rem] grid-cols-7">
            {Array.from({ length: 7 }, (unused, index) => {
              const columnDay = shiftDay(weekStartIso(day), index);
              const dayRows = rows.filter((row) => localDay(row.starts_at) === columnDay);
              const isToday = columnDay === today();
              return (
                <div key={columnDay} className="min-h-40 border-r border-border p-2 last:border-r-0">
                  <button
                    type="button"
                    onClick={() => {
                      setDay(columnDay);
                      setView("day");
                    }}
                    className={cn(
                      "mb-2 w-full rounded-lg px-2 py-1 text-left text-xs font-medium",
                      isToday ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {WEEKDAY_SHORT[(new Date(`${columnDay}T12:00:00`).getDay() + 6) % 7]}{" "}
                    {new Date(`${columnDay}T12:00:00`).getDate()}
                  </button>
                  <div className="grid gap-1">
                    {dayRows.map((row) => (
                      <MiniAppointment
                        key={row.id}
                        row={row}
                        noPerson={t("{term}siz", { term: person.one })}
                        onOpen={() => {
                          setDay(localDay(row.starts_at));
                          setView("day");
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="clay-panel p-3">
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAY_SHORT.map((label) => (
              <div key={label} className="py-1">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {(() => {
              const first = `${day.slice(0, 8)}01`;
              const lead = (new Date(`${first}T12:00:00`).getDay() + 6) % 7;
              const daysInMonth = new Date(
                Number(first.slice(0, 4)),
                Number(first.slice(5, 7)),
                0,
              ).getDate();
              const cells: Array<string | null> = [
                ...Array.from({ length: lead }, () => null),
                ...Array.from({ length: daysInMonth }, (unused, index) => `${first.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`),
              ];
              return cells.map((cell, index) => {
                if (!cell) return <div key={`blank-${index}`} className="min-h-20 rounded-xl bg-muted/30" />;
                const dayRows = rows.filter((row) => localDay(row.starts_at) === cell);
                const isToday = cell === today();
                return (
                  <button
                    key={cell}
                    type="button"
                    onClick={() => {
                      setDay(cell);
                      setView("day");
                    }}
                    className={cn(
                      "min-h-20 rounded-xl border border-border/60 p-1.5 text-left align-top transition-colors hover:bg-muted",
                      isToday && "border-primary/40 bg-primary/5",
                    )}
                  >
                    <p className={cn("text-xs font-medium", isToday ? "text-primary" : "text-muted-foreground")}>
                      {Number(cell.slice(-2))}
                    </p>
                    <div className="mt-1 grid gap-0.5">
                      {dayRows.slice(0, 3).map((row) => {
                        const status = row.status as AppointmentStatus;
                        return (
                          <p key={row.id} className="flex items-center gap-1 truncate text-[11px]">
                            <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[status])} />
                            <span className="tabular-nums">
                              {new Date(row.starts_at).toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <span className="truncate text-muted-foreground">
                              {(row.customers as { full_name?: string } | null)?.full_name ?? row.service_name ?? ""}
                            </span>
                          </p>
                        );
                      })}
                      {dayRows.length > 3 ? (
                        <p className="text-[11px] text-muted-foreground">+{dayRows.length - 3}</p>
                      ) : null}
                    </div>
                  </button>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

function AppointmentsPage() {
  const { term, service: serviceTerm, presetId } = useTerminology();
  const booking = term("appointments");
  const catalog = serviceTerm();
  const isClub = isClubPreset(presetId);
  useSectionTitle(booking.many);
  return (
    <>
      <PageHeader
        title={booking.many}
        description={t("{many}: {services} jadvali va bandligi shu yerda boshqariladi.", {
          many: booking.many,
          services: catalog.many,
        })}
      />
      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">{t("Jadval")}</TabsTrigger>
          <TabsTrigger value="services">{catalog.many}</TabsTrigger>
        </TabsList>
        <TabsContent value="schedule" className="mt-4">
          <ScheduleTab />
        </TabsContent>
        <TabsContent value="services" className="mt-4">
          <ServicesCatalog labels={isClub ? CLUB_CATALOG_LABELS : undefined} />
        </TabsContent>
      </Tabs>
    </>
  );
}
