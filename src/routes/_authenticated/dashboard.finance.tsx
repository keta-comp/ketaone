import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState, PageHeader, StatCard } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { intlLocale, t } from "@/lib/i18n";
import {
  closeCashSession,
  deleteExpense,
  getCashOverview,
  getPnl,
  listCashSessions,
  listExpenses,
  openCashSession,
  saveExpense,
} from "@/lib/finance.functions";
import { EXPENSE_CATEGORIES } from "@/lib/finance";
import { formatMoney } from "@/lib/types";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/finance")({
  head: () => ({
    meta: [
      { title: t("Moliya — KetaOne") },
      { name: "description", content: t("Xarajatlar, kassa smenalari va foyda-zarar hisoboti.") },
      { property: "og:title", content: t("Moliya — KetaOne") },
      { property: "og:description", content: t("Xarajatlar, kassa smenalari va foyda-zarar hisoboti.") },
    ],
  }),
  component: FinancePage,
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStart(): string {
  return today().slice(0, 8) + "01";
}

function ExpensesTab() {
  const queryClient = useQueryClient();
  const fetchExpenses = useServerFn(listExpenses);
  const save = useServerFn(saveExpense);
  const remove = useServerFn(deleteExpense);

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [category, setCategory] = useState("all");

  const [form, setForm] = useState({
    category: "rent",
    amount: "",
    expense_date: today(),
    payment_method: "cash",
    note: "",
  });

  const expenses = useQuery({
    queryKey: ["expenses", from, to, category],
    queryFn: () => fetchExpenses({ data: { from, to, category } }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["expenses"] });

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          category: form.category,
          amount: Number(form.amount),
          expense_date: form.expense_date,
          payment_method: form.payment_method,
          note: form.note || undefined,
        },
      }),
    onSuccess: () => {
      toast.success(t("Xarajat saqlandi"));
      setForm((prev) => ({ ...prev, amount: "", note: "" }));
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success(t("Xarajat o'chirildi"));
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const total = useMemo(
    () => (expenses.data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    [expenses.data],
  );

  return (
    <div className="grid gap-4">
      <form
        className="clay-panel grid gap-3 p-4 sm:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div>
          <Label htmlFor="exp-category">{t("Kategoriya")}</Label>
          <Select value={form.category} onValueChange={(value) => setForm({ ...form, category: value })}>
            <SelectTrigger id="exp-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_CATEGORIES.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {t(item.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="exp-amount">{t("Summa")}</Label>
          <Input
            id="exp-amount"
            type="number"
            min="1"
            step="0.01"
            required
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="exp-date">{t("Sana")}</Label>
          <Input
            id="exp-date"
            type="date"
            required
            value={form.expense_date}
            onChange={(event) => setForm({ ...form, expense_date: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="exp-method">{t("To'lov usuli")}</Label>
          <Select value={form.payment_method} onValueChange={(value) => setForm({ ...form, payment_method: value })}>
            <SelectTrigger id="exp-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">{t("Naqd")}</SelectItem>
              <SelectItem value="card">{t("Karta")}</SelectItem>
              <SelectItem value="transfer">{t("O'tkazma")}</SelectItem>
              <SelectItem value="other">{t("Boshqa")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2 flex items-end">
          <Button type="submit" className="w-full" disabled={saveMutation.isPending}>
            {t("Xarajat qo'shish")}
          </Button>
        </div>
        <div className="sm:col-span-6">
          <Label htmlFor="exp-note">{t("Izoh")}</Label>
          <Textarea
            id="exp-note"
            rows={1}
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
          />
        </div>
      </form>

      <div className="clay-panel flex flex-wrap items-end gap-3 p-4">
        <div>
          <Label htmlFor="exp-from">{t("Sanadan")}</Label>
          <Input id="exp-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="exp-to">{t("Sanagacha")}</Label>
          <Input id="exp-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="exp-filter">{t("Kategoriya")}</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="exp-filter" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Barchasi")}</SelectItem>
              {EXPENSE_CATEGORIES.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {t(item.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto text-sm text-muted-foreground">
          {t("Jami")}: <span className="font-semibold text-foreground">{formatMoney(total)}</span>
        </div>
      </div>

      {expenses.isPending ? (
        <LoadingState />
      ) : expenses.error ? (
        <ErrorState error={expenses.error} onRetry={() => void expenses.refetch()} />
      ) : (expenses.data ?? []).length === 0 ? (
        <EmptyState title={t("Xarajatlar yo'q")} description={t("Bu davrda xarajat qayd etilmagan.")} />
      ) : (
        <div className="clay-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{t("Sana")}</th>
                <th className="px-4 py-3">{t("Kategoriya")}</th>
                <th className="px-4 py-3">{t("Summa")}</th>
                <th className="px-4 py-3">{t("To'lov usuli")}</th>
                <th className="px-4 py-3">{t("Izoh")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(expenses.data ?? []).map((expense) => (
                <tr key={expense.id}>
                  <td className="px-4 py-3 text-muted-foreground">{expense.expense_date}</td>
                  <td className="px-4 py-3">{t(EXPENSE_CATEGORIES.find((c) => c.key === expense.category)?.label ?? expense.category)}</td>
                  <td className="px-4 py-3 tabular-nums font-medium">{formatMoney(Number(expense.amount))}</td>
                  <td className="px-4 py-3 text-muted-foreground">{expense.payment_method}</td>
                  <td className="max-w-56 truncate px-4 py-3 text-muted-foreground">{expense.note || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("Xarajatni o'chirish")}
                      onClick={() => removeMutation.mutate(expense.id)}
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
      )}
    </div>
  );
}

function CashTab() {
  const queryClient = useQueryClient();
  const fetchOverview = useServerFn(getCashOverview);
  const fetchSessions = useServerFn(listCashSessions);
  const open = useServerFn(openCashSession);
  const close = useServerFn(closeCashSession);

  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");

  const overview = useQuery({ queryKey: ["cash-overview"], queryFn: () => fetchOverview() });
  const sessions = useQuery({ queryKey: ["cash-sessions"], queryFn: () => fetchSessions() });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["cash-overview"] });
    void queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
  };

  const openMutation = useMutation({
    mutationFn: () => open({ data: { opening_amount: Number(opening || 0), note: note || undefined } }),
    onSuccess: () => {
      toast.success(t("Kassa ochildi"));
      setOpening("");
      setNote("");
      invalidate();
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const closeMutation = useMutation({
    mutationFn: () => close({ data: { counted_amount: Number(counted || 0), note: note || undefined } }),
    onSuccess: (result) => {
      toast.success(t("Kassa yopildi"));
      setCounted("");
      setNote("");
      invalidate();
      const diff = Number(result.difference ?? 0);
      if (diff !== 0) {
        toast.warning(`${t("Farq")}: ${formatMoney(diff)}`);
      }
    },
    onError: (error: unknown) => toast.error(friendlyError(error, t("Amalga oshmadi"))),
  });

  const active = overview.data?.active ?? null;

  return (
    <div className="grid gap-4">
      {overview.isPending ? (
        <LoadingState />
      ) : overview.error ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : active ? (
        <div className="clay-panel p-4">
          <p className="text-sm text-muted-foreground">
            {t("Kassa ochilgan")}: {new Date(active.opened_at).toLocaleString(intlLocale())}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <StatCard label={t("Boshlang'ich summa")} value={formatMoney(Number(active.opening_amount))} />
            <StatCard label={t("Naqd tushum")} value={formatMoney(Number(active.cash_income ?? 0))} />
            <StatCard label={t("Naqd xarajat")} value={formatMoney(Number(active.cash_expense ?? 0))} />
            <StatCard label={t("Kutilayotgan naqd")} value={formatMoney(Number(active.expected_cash ?? 0))} />
          </div>
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              closeMutation.mutate();
            }}
          >
            <div>
              <Label htmlFor="cash-counted">{t("Sanalgan summa")}</Label>
              <Input
                id="cash-counted"
                type="number"
                min="0"
                step="0.01"
                required
                value={counted}
                onChange={(event) => setCounted(event.target.value)}
              />
            </div>
            <div className="min-w-52 flex-1">
              <Label htmlFor="cash-note">{t("Izoh")}</Label>
              <Input id="cash-note" value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
            <Button type="submit" variant="destructive" disabled={closeMutation.isPending}>
              {t("Kassani yopish")}
            </Button>
          </form>
        </div>
      ) : (
        <form
          className="clay-panel flex flex-wrap items-end gap-3 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            openMutation.mutate();
          }}
        >
          <div>
            <Label htmlFor="cash-opening">{t("Boshlang'ich summa")}</Label>
            <Input
              id="cash-opening"
              type="number"
              min="0"
              step="0.01"
              value={opening}
              onChange={(event) => setOpening(event.target.value)}
              placeholder="0"
            />
          </div>
          <div className="min-w-52 flex-1">
            <Label htmlFor="cash-open-note">{t("Izoh")}</Label>
            <Input id="cash-open-note" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <Button type="submit" disabled={openMutation.isPending}>
            {t("Kassani ochish")}
          </Button>
        </form>
      )}

      {sessions.isPending ? (
        <LoadingState />
      ) : (sessions.data ?? []).length > 0 ? (
        <div className="clay-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{t("Ochildi")}</th>
                <th className="px-4 py-3">{t("Yopildi")}</th>
                <th className="px-4 py-3">{t("Boshlang'ich summa")}</th>
                <th className="px-4 py-3">{t("Kutilayotgan naqd")}</th>
                <th className="px-4 py-3">{t("Sanalgan summa")}</th>
                <th className="px-4 py-3">{t("Farq")}</th>
                <th className="px-4 py-3">{t("Holat")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(sessions.data ?? []).map((session) => (
                <tr key={session.id}>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(session.opened_at).toLocaleString(intlLocale())}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {session.closed_at ? new Date(session.closed_at).toLocaleString(intlLocale()) : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{formatMoney(Number(session.opening_amount))}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {session.expected_cash != null ? formatMoney(Number(session.expected_cash)) : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {session.counted_amount != null ? formatMoney(Number(session.counted_amount)) : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {session.difference != null ? (
                      <span className={Number(session.difference) < 0 ? "text-destructive" : "text-foreground"}>
                        {formatMoney(Number(session.difference))}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {session.status === "open" ? t("Ochiq") : t("Yopilgan")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function PnlTab() {
  const fetchPnl = useServerFn(getPnl);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());

  const pnl = useQuery({ queryKey: ["pnl", from, to], queryFn: () => fetchPnl({ data: { from, to } }) });

  return (
    <div className="grid gap-4">
      <div className="clay-panel flex flex-wrap items-end gap-3 p-4">
        <div>
          <Label htmlFor="pnl-from">{t("Sanadan")}</Label>
          <Input id="pnl-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="pnl-to">{t("Sanagacha")}</Label>
          <Input id="pnl-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
      </div>

      {pnl.isPending ? (
        <LoadingState />
      ) : pnl.error ? (
        <ErrorState error={pnl.error} onRetry={() => void pnl.refetch()} />
      ) : pnl.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label={t("Tushum")} value={formatMoney(pnl.data.income)} />
            <StatCard label={t("Xarajatlar")} value={formatMoney(pnl.data.totalExpenses)} />
            <StatCard label={t("Sof foyda")} value={formatMoney(pnl.data.profit)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="clay-panel p-4">
              <p className="text-sm font-medium">{t("Xarajatlar kategoriyalar bo'yicha")}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(pnl.data.expensesByCategory).map(([category, amount]) => (
                  <li key={category} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t(EXPENSE_CATEGORIES.find((c) => c.key === category)?.label ?? category)}
                    </span>
                    <span className="tabular-nums">{formatMoney(amount)}</span>
                  </li>
                ))}
                {Object.keys(pnl.data.expensesByCategory).length === 0 ? (
                  <li className="text-muted-foreground">{t("Xarajatlar yo'q")}</li>
                ) : null}
              </ul>
            </div>
            <div className="clay-panel p-4">
              <p className="text-sm font-medium">{t("Tushum usullar bo'yicha")}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(pnl.data.incomeByMethod).map(([method, amount]) => (
                  <li key={method} className="flex justify-between">
                    <span className="text-muted-foreground">{method}</span>
                    <span className="tabular-nums">{formatMoney(amount)}</span>
                  </li>
                ))}
                {Object.keys(pnl.data.incomeByMethod).length === 0 ? (
                  <li className="text-muted-foreground">{t("Tushum yo'q")}</li>
                ) : null}
              </ul>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function FinancePage() {
  return (
    <>
      <PageHeader
        title={t("Moliya")}
        description={t("Xarajatlar, kassa smenalari va foyda-zarar hisoboti — barchasi real ma'lumotlar asosida.")}
      />
      <Tabs defaultValue="expenses">
        <TabsList>
          <TabsTrigger value="expenses">{t("Xarajatlar")}</TabsTrigger>
          <TabsTrigger value="cash">{t("Kassa")}</TabsTrigger>
          <TabsTrigger value="pnl">{t("Foyda-zarar")}</TabsTrigger>
        </TabsList>
        <TabsContent value="expenses" className="mt-4">
          <ExpensesTab />
        </TabsContent>
        <TabsContent value="cash" className="mt-4">
          <CashTab />
        </TabsContent>
        <TabsContent value="pnl" className="mt-4">
          <PnlTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
