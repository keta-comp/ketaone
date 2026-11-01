import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Calculator, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { listEmployees } from "@/lib/employees.functions";
import { listServices } from "@/lib/appointments.functions";
import {
  approvePayrollStatement,
  deletePayrollStatement,
  generatePayrollStatement,
  listPayrollRules,
  listPayrollStatements,
  listServiceOverrides,
  listTeacherTuition,
  markPayrollStatementPaid,
  savePayrollRule,
  saveServiceOverride,
  updatePayrollStatement,
} from "@/lib/payroll.functions";
import { PAYROLL_STATUS_LABELS, monthPeriod, type PayrollStatus } from "@/lib/payroll";
import { crmLabel } from "@/lib/crm-core";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/types";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/payroll")({
  head: () => ({
    meta: [
      { title: t("Oylik va komissiya — KetaOne") },
      { name: "description", content: t("Xodimlarning oylik hisob-kitoblari, komissiyalar va tasdiq oqimi.") },
      { property: "og:title", content: t("Oylik va komissiya — KetaOne") },
      { property: "og:description", content: t("Maosh, xizmat komissiyasi, bonus, avans va ushlab qolishlar.") },
    ],
  }),
  component: PayrollPage,
});

const STATUS_BADGE: Record<PayrollStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-primary/10 text-primary",
  paid: "bg-emerald-500/10 text-emerald-600",
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

type EmployeeOption = { id: string; full_name: string };

function PayrollPage() {
  const fetchEmployees = useServerFn(listEmployees);
  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => fetchEmployees({ data: {} }),
  });

  const employees: EmployeeOption[] = (employeesQuery.data ?? []).map((employee) => ({
    id: employee.id,
    full_name: employee.full_name,
  }));

  return (
    <>
      <PageHeader
        title={t("Oylik va komissiya")}
        description={t(
          "Maosh plus komissiya: bajarilgan xizmatlar va o'z guruhlarining to'langan oyliklari asosida. Bu buxgalteriya yoki soliq maslahati emas.",
        )}
      />
      {employeesQuery.isPending ? (
        <LoadingState />
      ) : employeesQuery.error ? (
        <ErrorState error={employeesQuery.error} onRetry={() => void employeesQuery.refetch()} />
      ) : (
        <Tabs defaultValue="statements">
          <TabsList>
            <TabsTrigger value="statements">{t("Hisob-kitoblar")}</TabsTrigger>
            <TabsTrigger value="rules">{t("Qoidalar")}</TabsTrigger>
          </TabsList>
          <TabsContent value="statements">
            <StatementsTab employees={employees} />
          </TabsContent>
          <TabsContent value="rules">
            <RulesTab employees={employees} />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

/* -------------------------------- statements ------------------------------- */

type StatementRow = {
  id: string;
  period_start: string;
  period_end: string;
  service_revenue: number;
  base_amount: number;
  commission_amount: number;
  bonus_amount: number;
  advance_amount: number;
  deduction_amount: number;
  total_computed: number;
  total_paid: number;
  status: string;
  note: string;
  paid_method?: string | null;
  expense_id?: string | null;
  employees: { full_name?: string | null } | null;
};

type EditDraft = {
  id: string;
  bonus_amount: string;
  advance_amount: string;
  deduction_amount: string;
  note: string;
};

type PayMethod = "cash" | "card" | "transfer" | "other";
const PAY_METHODS: PayMethod[] = ["cash", "card", "transfer", "other"];

function StatementsTab({ employees }: { employees: EmployeeOption[] }) {
  const queryClient = useQueryClient();
  const fetchStatements = useServerFn(listPayrollStatements);
  const fetchRules = useServerFn(listPayrollRules);
  const generate = useServerFn(generatePayrollStatement);
  const update = useServerFn(updatePayrollStatement);
  const approve = useServerFn(approvePayrollStatement);
  const markPaid = useServerFn(markPayrollStatementPaid);
  const remove = useServerFn(deletePayrollStatement);

  const [month, setMonth] = useState(currentMonth());
  const [employeeId, setEmployeeId] = useState<string>(employees[0]?.id ?? "none");
  const [form, setForm] = useState({ bonus_amount: "", advance_amount: "", deduction_amount: "", note: "" });
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [paidMethod, setPaidMethod] = useState<PayMethod>("cash");

  const period = useMemo(() => {
    const [year, mm] = month.split("-").map(Number);
    return monthPeriod(year ?? 2026, mm ?? 1);
  }, [month]);

  const statements = useQuery({
    queryKey: ["payroll-statements", month],
    queryFn: () => fetchStatements({ data: { period_start: period.period_start } }),
  });

  const rules = useQuery({ queryKey: ["payroll-rules"], queryFn: () => fetchRules() });
  const commissionPercent = useMemo(() => {
    const rule = ((rules.data ?? []) as unknown as RuleRow[]).find(
      (row) => row.employee_id === employeeId,
    );
    return Number(rule?.commission_percent ?? 0);
  }, [rules.data, employeeId]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["payroll-statements"] });
    void queryClient.invalidateQueries({ queryKey: ["payroll-tuition"] });
  };
  const onError = (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi")));

  const generateMutation = useMutation({
    mutationFn: () =>
      generate({
        data: {
          employee_id: employeeId,
          period_start: period.period_start,
          period_end: period.period_end,
          bonus_amount: form.bonus_amount ? Number(form.bonus_amount) : undefined,
          advance_amount: form.advance_amount ? Number(form.advance_amount) : undefined,
          deduction_amount: form.deduction_amount ? Number(form.deduction_amount) : undefined,
          note: form.note || undefined,
        },
      }),
    onSuccess: (result) => {
      toast.success(result.recomputed ? t("Hisob-kitob qayta hisoblandi") : t("Hisob-kitob hisoblandi"));
      setForm({ bonus_amount: "", advance_amount: "", deduction_amount: "", note: "" });
      invalidate();
    },
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: (draft: EditDraft) =>
      update({
        data: {
          id: draft.id,
          bonus_amount: Number(draft.bonus_amount || 0),
          advance_amount: Number(draft.advance_amount || 0),
          deduction_amount: Number(draft.deduction_amount || 0),
          note: draft.note,
        },
      }),
    onSuccess: () => {
      toast.success(t("Saqlandi"));
      setEditing(null);
      invalidate();
    },
    onError,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approve({ data: { id } }),
    onSuccess: () => {
      toast.success(t("Tasdiqlandi"));
      invalidate();
    },
    onError,
  });

  const paidMutation = useMutation({
    mutationFn: (id: string) => markPaid({ data: { id, payment_method: paidMethod } }),
    onSuccess: () => {
      toast.success(t("To'langan deb belgilandi va moliyaga xarajat yozildi"));
      invalidate();
    },
    onError,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success(t("O'chirildi"));
      invalidate();
    },
    onError,
  });

  const rows = (statements.data ?? []) as unknown as StatementRow[];
  const selected = employees.find((employee) => employee.id === employeeId);

  return (
    <div className="grid gap-4">
      <form
        className="clay-panel grid gap-3 p-4 sm:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault();
          generateMutation.mutate();
        }}
      >
        <div className="sm:col-span-2">
          <Label htmlFor="pr-employee">{t("Xodim")}</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger id="pr-employee">
              <SelectValue placeholder={t("Xodimni tanlang")} />
            </SelectTrigger>
            <SelectContent>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-1">
          <Label htmlFor="pr-month">{t("Oy")}</Label>
          <Input id="pr-month" type="month" required value={month} onChange={(event) => setMonth(event.target.value || currentMonth())} />
        </div>
        <div className="sm:col-span-1">
          <Label htmlFor="pr-bonus">{t("Bonus")}</Label>
          <Input id="pr-bonus" type="number" min="0" step="1000" className="w-full" value={form.bonus_amount} placeholder="0"
            onChange={(event) => setForm({ ...form, bonus_amount: event.target.value })} />
        </div>
        <div className="sm:col-span-1">
          <Label htmlFor="pr-advance">{t("Avans")}</Label>
          <Input id="pr-advance" type="number" min="0" step="1000" className="w-full" value={form.advance_amount} placeholder="0"
            onChange={(event) => setForm({ ...form, advance_amount: event.target.value })} />
        </div>
        <div className="sm:col-span-1">
          <Label htmlFor="pr-deduction">{t("Ushlab qolish")}</Label>
          <Input id="pr-deduction" type="number" min="0" step="1000" className="w-full" value={form.deduction_amount} placeholder="0"
            onChange={(event) => setForm({ ...form, deduction_amount: event.target.value })} />
        </div>
        <div className="sm:col-span-4">
          <Label htmlFor="pr-note">{t("Izoh")}</Label>
          <Input id="pr-note" value={form.note} maxLength={500}
            onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </div>
        <div className="flex items-end sm:col-span-2">
          <Button type="submit" className="w-full" disabled={generateMutation.isPending || !selected}>
            <Calculator className="size-4" />
            {t("Hisoblash")}
          </Button>
        </div>
      </form>

      <div className="clay-panel flex flex-wrap items-end gap-3 p-4">
        <div>
          <Label htmlFor="pr-pay-method">{t("To'lov usuli")}</Label>
          <Select value={paidMethod} onValueChange={(value) => setPaidMethod(value as PayMethod)}>
            <SelectTrigger id="pr-pay-method" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAY_METHODS.map((method) => (
                <SelectItem key={method} value={method}>{crmLabel(method)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("To‘langan deb belgilanganda xarajatlar ro‘zatiga “Oylik” yozuvi qo‘shiladi.")}
        </p>
      </div>

      <TuitionBasis employeeId={employeeId} period={period} commissionPercent={commissionPercent} />

      {statements.isPending ? (
        <LoadingState />
      ) : statements.error ? (
        <ErrorState error={statements.error} onRetry={() => void statements.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("Bu oy uchun hisob-kitob yo'q")}
          description={t("Yuqoridagi forma orqali bajarilgan xizmatlar asosida hisoblab chiqing.")}
        />
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => {
            const status = (PAYROLL_STATUS_LABELS[row.status as PayrollStatus] ? row.status : "draft") as PayrollStatus;
            const isEditing = editing?.id === row.id;
            return (
              <div key={row.id} className="clay-panel grid gap-3 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-40 flex-1">
                    <p className="font-medium">{row.employees?.full_name ?? t("Xodim")} </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {row.period_start} — {row.period_end}
                      {row.note ? ` · ${row.note}` : ""}
                    </p>
                  </div>
                  <Badge className={cn("border-0", STATUS_BADGE[status])}>{t(PAYROLL_STATUS_LABELS[status])}</Badge>
                  <p className="text-lg font-semibold tabular-nums">{formatMoney(Number(row.total_computed))}</p>
                  {status === "draft" ? (
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditing({
                            id: row.id,
                            bonus_amount: String(row.bonus_amount),
                            advance_amount: String(row.advance_amount),
                            deduction_amount: String(row.deduction_amount),
                            note: row.note,
                          })
                        }
                      >
                        <Pencil className="size-3.5" />
                        {t("Tahrir")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={approveMutation.isPending}
                        onClick={() => approveMutation.mutate(row.id)}
                      >
                        {t("Tasdiqlash")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("O'chirish")}
                        disabled={removeMutation.isPending}
                        onClick={() => removeMutation.mutate(row.id)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  ) : status === "approved" ? (
                    <Button size="sm" disabled={paidMutation.isPending} onClick={() => paidMutation.mutate(row.id)}>
                      {t("To'langan")}
                    </Button>
                  ) : (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {t("To'langan")}: {formatMoney(Number(row.total_paid))}
                        {row.paid_method ? ` · ${crmLabel(row.paid_method)}` : ""}
                      </p>
                      {row.expense_id ? (
                        <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                          <Link to="/dashboard/finance">{t("Xarajat yozuvi")}</Link>
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
                <div className="clay-inset grid gap-2 rounded-2xl px-4 py-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
                  <span>{t("Tushum")}: <b className="tabular-nums">{formatMoney(Number(row.service_revenue))}</b></span>
                  <span>{t("Maosh")}: <b className="tabular-nums">{formatMoney(Number(row.base_amount))}</b></span>
                  <span>{t("Komissiya")}: <b className="tabular-nums">{formatMoney(Number(row.commission_amount))}</b></span>
                  <span>{t("Bonus")}: <b className="tabular-nums">{formatMoney(Number(row.bonus_amount))}</b></span>
                  <span>{t("Avans")}: <b className="tabular-nums">{formatMoney(Number(row.advance_amount))}</b></span>
                  <span>{t("Ushlab qolish")}: <b className="tabular-nums">{formatMoney(Number(row.deduction_amount))}</b></span>
                </div>
                {isEditing && editing ? (
                  <form
                    className="grid gap-2 sm:grid-cols-5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      updateMutation.mutate(editing);
                    }}
                  >
                    <div>
                      <Label htmlFor="edit-bonus">{t("Bonus")}</Label>
                      <Input id="edit-bonus" type="number" min="0" value={editing.bonus_amount}
                        onChange={(event) => setEditing({ ...editing, bonus_amount: event.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="edit-advance">{t("Avans")}</Label>
                      <Input id="edit-advance" type="number" min="0" value={editing.advance_amount}
                        onChange={(event) => setEditing({ ...editing, advance_amount: event.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="edit-deduction">{t("Ushlab qolish")}</Label>
                      <Input id="edit-deduction" type="number" min="0" value={editing.deduction_amount}
                        onChange={(event) => setEditing({ ...editing, deduction_amount: event.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="edit-note">{t("Izoh")}</Label>
                      <Textarea id="edit-note" rows={1} value={editing.note}
                        onChange={(event) => setEditing({ ...editing, note: event.target.value })} />
                    </div>
                    <div className="flex items-end gap-2 sm:col-span-5">
                      <Button type="submit" disabled={updateMutation.isPending}>{t("Saqlash")}</Button>
                      <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t("Bekor qilish")}</Button>
                    </div>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ tuition basis ------------------------------ */

/**
 * O'qituvchi haqining bazasi — tanlangan xodim o'qitadigan guruhlarining
 * to'langan oyliklari. Hisoblash tugmasini bosmasdan turib tekshiriladi.
 */
function TuitionBasis({
  employeeId,
  period,
  commissionPercent,
}: {
  employeeId: string;
  period: { period_start: string; period_end: string };
  commissionPercent: number;
}) {
  const fetchTuition = useServerFn(listTeacherTuition);
  const tuition = useQuery({
    queryKey: ["payroll-tuition", employeeId, period.period_start],
    queryFn: () =>
      fetchTuition({
        data: {
          employee_id: employeeId,
          period_start: period.period_start,
          period_end: period.period_end,
        },
      }),
    enabled: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId),
  });

  const data = tuition.data;
  if (!data || data.groups.length === 0) return null;
  const commission = Math.round((data.collected * commissionPercent) / 100);

  return (
    <section className="clay-panel grid gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-base font-semibold">{t("Guruh oyliklari")}</h2>
        <Badge className="border-0 bg-muted text-muted-foreground">{commissionPercent}%</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "Komissiya faqat to'langan oyliklardan hisoblanadi; kutilayotgan to'lovlar hisobga kirmaydi.",
        )}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {data.groups.map((group) => (
          <div
            key={group.id}
            className="clay-inset flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
            <span className="tabular-nums text-xs text-muted-foreground">
              {t("To'langan")}: {formatMoney(group.collected)}
              {group.planned > 0 ? ` · ${t("Kutilmoqda")}: ${formatMoney(group.planned)}` : ""}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        <span>
          {t("Jami to'langan")}: <b className="tabular-nums">{formatMoney(data.collected)}</b>
        </span>
        <span>
          {t("Kutilmoqda")}: <b className="tabular-nums">{formatMoney(data.planned)}</b>
        </span>
        <span>
          {t("Komissiya")}: <b className="tabular-nums">{formatMoney(commission)}</b>
        </span>
      </div>
    </section>
  );
}

/* ---------------------------------- rules --------------------------------- */

type RuleRow = {
  id: string;
  employee_id: string;
  base_salary: number;
  commission_percent: number;
  employees: { full_name?: string | null } | null;
};

type OverrideRow = {
  service_id: string;
  commission_percent: number | null;
  services: { name?: string } | null;
};

function RulesTab({ employees }: { employees: EmployeeOption[] }) {
  const queryClient = useQueryClient();
  const fetchRules = useServerFn(listPayrollRules);
  const saveRule = useServerFn(savePayrollRule);
  const fetchOverrides = useServerFn(listServiceOverrides);
  const saveOverride = useServerFn(saveServiceOverride);
  const fetchServices = useServerFn(listServices);

  const [ruleForm, setRuleForm] = useState({ id: "", employee_id: employees[0]?.id ?? "", base_salary: "", commission_percent: "" });
  const [overrideEmployee, setOverrideEmployee] = useState<string>(employees[0]?.id ?? "none");
  const [newOverride, setNewOverride] = useState({ service_id: "", commission_percent: "" });

  const rules = useQuery({ queryKey: ["payroll-rules"], queryFn: () => fetchRules() });
  const overrides = useQuery({
    queryKey: ["payroll-overrides", overrideEmployee],
    queryFn: () => fetchOverrides({ data: { employee_id: overrideEmployee } }),
    enabled: overrideEmployee !== "none",
  });
  const services = useQuery({ queryKey: ["services"], queryFn: () => fetchServices({ data: {} }) });

  const onError = (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi")));

  const saveRuleMutation = useMutation({
    mutationFn: () =>
      saveRule({
        data: {
          id: ruleForm.id || undefined,
          employee_id: ruleForm.employee_id,
          base_salary: Number(ruleForm.base_salary || 0),
          commission_percent: Number(ruleForm.commission_percent || 0),
        },
      }),
    onSuccess: () => {
      toast.success(t("Qoida saqlandi"));
      setRuleForm({ id: "", employee_id: employees[0]?.id ?? "", base_salary: "", commission_percent: "" });
      void queryClient.invalidateQueries({ queryKey: ["payroll-rules"] });
    },
    onError,
  });

  const saveOverrideMutation = useMutation({
    mutationFn: (input: { employee_id: string; service_id: string; commission_percent: number | null }) =>
      saveOverride({ data: input }),
    onSuccess: () => {
      toast.success(t("Foiz saqlandi"));
      setNewOverride({ service_id: "", commission_percent: "" });
      void queryClient.invalidateQueries({ queryKey: ["payroll-overrides"] });
    },
    onError,
  });

  const ruleRows = (rules.data ?? []) as unknown as RuleRow[];
  const overrideRows = (overrides.data ?? []) as unknown as OverrideRow[];

  return (
    <div className="grid gap-4">
      <form
        className="clay-panel grid gap-3 p-4 sm:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          saveRuleMutation.mutate();
        }}
      >
        <div className="sm:col-span-2">
          <Label htmlFor="rule-employee">{t("Xodim")}</Label>
          <Select
            value={ruleForm.employee_id}
            onValueChange={(value) => setRuleForm({ ...ruleForm, employee_id: value, id: "" })}
          >
            <SelectTrigger id="rule-employee">
              <SelectValue placeholder={t("Xodimni tanlang")} />
            </SelectTrigger>
            <SelectContent>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="rule-base">{t("Oylik maosh")}</Label>
          <Input id="rule-base" type="number" min="0" step="100000" value={ruleForm.base_salary} placeholder="0"
            onChange={(event) => setRuleForm({ ...ruleForm, base_salary: event.target.value })} />
        </div>
        <div>
          <Label htmlFor="rule-percent">{t("Komissiya (%)")}</Label>
          <Input id="rule-percent" type="number" min="0" max="100" step="0.5" value={ruleForm.commission_percent} placeholder="0"
            onChange={(event) => setRuleForm({ ...ruleForm, commission_percent: event.target.value })} />
        </div>
        <div className="flex items-end">
          <Button type="submit" className="w-full" disabled={saveRuleMutation.isPending || !ruleForm.employee_id}>
            {ruleForm.id ? t("Yangilash") : t("Qoida qo'shish")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-5">
          {t(
            "Bu foiz xodimning bajarilgan xizmatlariga va o'qitadigan guruhlarining to'langan oyliklariga qo'llanadi.",
          )}
        </p>
      </form>

      {rules.isPending ? (
        <LoadingState />
      ) : rules.error ? (
        <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />
      ) : ruleRows.length === 0 ? (
        <EmptyState title={t("Hozircha qoida yo'q")} description={t("Har bir xodim uchun maosh va komissiya foizini belgilang.")} />
      ) : (
        <div className="clay-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{t("Xodim")}</th>
                <th className="px-4 py-3">{t("Oylik maosh")}</th>
                <th className="px-4 py-3">{t("Komissiya (%)")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ruleRows.map((rule) => (
                <tr key={rule.id}>
                  <td className="px-4 py-3 font-medium">{rule.employees?.full_name ?? t("Xodim")}</td>
                  <td className="px-4 py-3 tabular-nums">{formatMoney(Number(rule.base_salary))}</td>
                  <td className="px-4 py-3 tabular-nums">{Number(rule.commission_percent)}%</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setRuleForm({
                          id: rule.id,
                          employee_id: rule.employee_id,
                          base_salary: String(rule.base_salary),
                          commission_percent: String(rule.commission_percent),
                        })
                      }
                    >
                      <Pencil className="size-3.5" />
                      {t("Tahrir")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="clay-panel grid gap-3 p-4">
        <h2 className="font-display text-base font-semibold">{t("Xizmat bo'yicha komissiya")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("Bu foizlar xodim uchun umumiy qoidadan ustun hisoblanadi.")}
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="ov-employee">{t("Xodim")}</Label>
            <Select value={overrideEmployee} onValueChange={setOverrideEmployee}>
              <SelectTrigger id="ov-employee">
                <SelectValue placeholder={t("Xodimni tanlang")} />
              </SelectTrigger>
              <SelectContent>
                {employees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ov-service">{t("Xizmat")}</Label>
            <Select value={newOverride.service_id} onValueChange={(value) => setNewOverride({ ...newOverride, service_id: value })}>
              <SelectTrigger id="ov-service">
                <SelectValue placeholder={t("Xizmatni tanlang")} />
              </SelectTrigger>
              <SelectContent>
                {(services.data ?? []).map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ov-percent">{t("Komissiya (%)")}</Label>
            <Input id="ov-percent" type="number" min="0" max="100" step="0.5" value={newOverride.commission_percent} placeholder="0"
              onChange={(event) => setNewOverride({ ...newOverride, commission_percent: event.target.value })} />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={
                saveOverrideMutation.isPending ||
                !newOverride.service_id ||
                overrideEmployee === "none" ||
                newOverride.commission_percent === ""
              }
              onClick={() =>
                saveOverrideMutation.mutate({
                  employee_id: overrideEmployee,
                  service_id: newOverride.service_id,
                  commission_percent: Number(newOverride.commission_percent),
                })
              }
            >
              <Plus className="size-4" />
              {t("Saqlash")}
            </Button>
          </div>
        </div>

        {overrides.isPending && overrideEmployee !== "none" ? (
          <LoadingState />
        ) : overrideRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Bu xodim uchun qo'shimcha foiz belgilanmagan.")}</p>
        ) : (
          <div className="grid gap-2">
            {overrideRows.map((row) => (
              <OverrideRowEditor
                key={row.service_id}
                serviceName={row.services?.name ?? row.service_id}
                initial={row.commission_percent == null ? "" : String(row.commission_percent)}
                saving={saveOverrideMutation.isPending}
                onSave={(percent) =>
                  saveOverrideMutation.mutate({ employee_id: overrideEmployee, service_id: row.service_id, commission_percent: percent })
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OverrideRowEditor({
  serviceName,
  initial,
  saving,
  onSave,
}: {
  serviceName: string;
  initial: string;
  saving: boolean;
  onSave: (percent: number | null) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="clay-inset flex flex-wrap items-center gap-3 rounded-2xl px-4 py-2">
      <span className="min-w-40 flex-1 text-sm font-medium">{serviceName}</span>
      <Input
        aria-label={`${serviceName} ${t("Komissiya (%)")}`}
        type="number"
        min="0"
        max="100"
        step="0.5"
        className="w-28"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button size="sm" variant="outline" disabled={saving} onClick={() => onSave(value === "" ? null : Number(value))}>
        {t("Saqlash")}
      </Button>
    </div>
  );
}
