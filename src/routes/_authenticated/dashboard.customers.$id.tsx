import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Download, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ErrorState, LoadingState, StatCard, StatusBadge } from "@/components/app/primitives";
import { CustomerDialog, PaymentDialog, TaskDialog } from "@/components/app/crm-dialogs";
import { DentalChart, useOdontogrammaEnabled } from "@/components/app/DentalChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomerLinkedRecords, useCustomerLinkedRecords } from "@/components/app/CustomerLinkedRecords";
import { crmLabel } from "@/lib/crm-core";
import {
  eraseCrmCustomer,
  exportCustomerData,
  getCustomerProfile,
  setCustomerConsent,
} from "@/lib/customers.functions";
import { formatMoney } from "@/lib/types";
import { useSectionVisibility } from "@/lib/section-visibility";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/customers/$id")({
  head: () => ({
    meta: [
      { title: t("Mijoz profili — KetaOne") },
      {
        name: "description",
        content: t("Mijozning to‘lovlari, vazifalari, yozuvlari va aloqa tarixi."),
      },
      { property: "og:title", content: t("Mijoz profili — KetaOne") },
      { property: "og:description", content: t("Bitta ekranda mijoz haqida hamma narsa.") },
    ],
  }),
  component: CustomerProfile,
});

function CustomerProfile() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchProfile = useServerFn(getCustomerProfile);
  const exportData = useServerFn(exportCustomerData);
  const erase = useServerFn(eraseCrmCustomer);
  const saveConsent = useServerFn(setCustomerConsent);
  const [editOpen, setEditOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const linked = useCustomerLinkedRecords(id);
  const dental = useOdontogrammaEnabled();
  const { isHidden } = useSectionVisibility();
  const anamnesis = (linked.data ?? [])
    .filter((r) => r.moduleKey === "bemor_kartasi")
    .map((r) => r.data)
    .find(Boolean);
  const query = useQuery({
    queryKey: ["customer-profile", id],
    queryFn: () => fetchProfile({ data: { id } }),
  });

  if (query.isPending) return <LoadingState label={t("Profil yuklanmoqda…")} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const {
    customer,
    orders,
    payments,
    tasks,
    activities,
    canErase,
    canConsent,
  } = query.data;
  const erasedAt = customer.erased_at ?? null;
  const assignee = customer.assignee_name;
  const currency = "UZS";
  const rowLink = "shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline";
  const showOrders = !isHidden("/dashboard/orders");

  const runPrivacyAction = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(friendlyError(error, t("Xatolik")));
    } finally {
      setBusy(false);
    }
  };

  const downloadExport = () =>
    void runPrivacyAction(async () => {
      const payload = await exportData({ data: { id } });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mijoz-${id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(t("Mijoz ma’lumotlari faylga saqlandi"));
    });

  const toggleConsent = (value: boolean) =>
    void runPrivacyAction(async () => {
      await saveConsent({ data: { id, marketing_consent: value } });
      toast.success(value ? t("Rozilik qayd etildi") : t("Rozilik bekor qilindi"));
      void queryClient.invalidateQueries({ queryKey: ["customer-profile", id] });
    });

  const eraseCustomer = () =>
    void runPrivacyAction(async () => {
      const phrase = t("O‘chirish");
      if (
        window.prompt(
          t(
            "Ism, telefon, aloqa tarixi va xabarlar o‘chiriladi. Moliyaviy yozuvlar qonun bo‘yicha saqlanadi. Davom etish uchun “{v0}” deb yozing.",
            { v0: phrase },
          ),
        ) !== phrase
      )
        return;
      const result = await erase({ data: { id, confirm: true } });
      toast.success(
        t("Ma'lumotlar o'chirildi — {v0} suhbat, {v1} faoliyat yozuvi olib tashlandi", {
          v0: result.conversations_removed,
          v1: result.activities_removed,
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ["customer-profile", id] });
    });

  const paid = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const debt = payments
    .filter((p) => p.status === "pending" || p.status === "partial")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button asChild variant="ghost" size="icon" aria-label={t("Orqaga")}>
            <Link to="/dashboard/customers">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="font-display text-2xl font-semibold">{customer.full_name ?? "Ismsiz mijoz"}</h1>
            <p className="text-sm text-muted-foreground">
              {[customer.phone, customer.email, customer.location].filter(Boolean).join(" • ") ||
                "Aloqa ma’lumoti kiritilmagan"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge value={customer.status} />
              <span className="text-xs text-muted-foreground">{t("Manba:")}{" "}{crmLabel(customer.source)}</span>
              {assignee ? (
                <span className="text-xs text-muted-foreground">
                  {t("Mas’ul:")}
                  <Link
                    to="/dashboard/team"
                    className="text-foreground underline-offset-4 hover:underline"
                  >
                    {" "}{assignee}
                  </Link>
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setTaskOpen(true)}>
            <Plus className="size-4" /> {t("Vazifa")}
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setPaymentOpen(true)}>
            <Plus className="size-4" /> {t("To‘lov")}
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" /> {t("Tahrirlash")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={busy}
            onClick={downloadExport}
          >
            <Download className="size-4" /> {t("Ma'lumotlarni yuklash")}
          </Button>
          {canErase && !erasedAt ? (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1"
              disabled={busy}
              onClick={eraseCustomer}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {erasedAt ? (
        <div className="clay-panel flex items-center gap-2 p-4 text-sm text-destructive">
          <ShieldAlert className="size-4 shrink-0" />
          <span>
            {t("Bu mijozning shaxsiy ma’lumotlari {v0} sana o‘chirilgan.", {
              v0: new Date(erasedAt).toLocaleDateString("uz-UZ"),
            })}
          </span>
          <Badge variant="secondary" className="ml-auto">{t("O‘chirilgan")}</Badge>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {showOrders ? (
          <>
            <Link to="/dashboard/orders" search={{ customerId: id }} className="block">
              <StatCard label={t("Buyurtmalar")} value={customer.total_orders} />
            </Link>
            <Link to="/dashboard/orders" search={{ customerId: id }} className="block">
              <StatCard label={t("Umumiy xarid")} value={formatMoney(customer.total_spent, currency)} />
            </Link>
          </>
        ) : null}
        <Link to="/dashboard/payments" search={{ customerId: id }} className="block">
          <StatCard label={t("To‘langan")} value={formatMoney(paid, currency)} />
        </Link>
        <Link to="/dashboard/payments" search={{ customerId: id }} className="block">
          <StatCard label={t("Qarzdorlik")} value={formatMoney(debt, currency)} />
        </Link>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">{t("Umumiy")}</TabsTrigger>
          {showOrders ? <TabsTrigger value="orders">{t("Buyurtmalar (")}{orders.length})</TabsTrigger> : null}
          <TabsTrigger value="payments">{t("To‘lovlar (")}{payments.length})</TabsTrigger>
          <TabsTrigger value="tasks">{t("Vazifalar (")}{tasks.length})</TabsTrigger>
          {dental.enabled ? <TabsTrigger value="dental">{t("Odontogramma")}</TabsTrigger> : null}
          <TabsTrigger value="linked">{t("Sohaviy yozuvlar")} ({linked.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="activity">{t("Tarix")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="clay-panel mt-3 space-y-3 p-5">
          <Field label={t("Izoh")} value={customer.notes || "—"} />
          <Field
            label={t("Oxirgi aloqa")}
            value={
              customer.last_contact_at
                ? new Date(customer.last_contact_at).toLocaleString("uz-UZ")
                : new Date(customer.last_interaction_at).toLocaleString("uz-UZ")
            }
          />
          <Field label="Telegram" value={customer.telegram_username ? `@${customer.telegram_username}` : "—"} />
          {anamnesis ? (
            <div className="clay-inset rounded-2xl px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("Bemor kartasi")}</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Field label={t("Allergiya")} value={medicalCell(anamnesis["allergiya"])} />
                <Field label={t("Qon guruhi")} value={medicalCell(anamnesis["qon_guruhi"])} />
                <Field label={t("Anamnez")} value={medicalCell(anamnesis["anamnez"])} />
                <Field label={t("Qabul qilinadigan dorilar")} value={medicalCell(anamnesis["dorilar"])} />
              </div>
              <Link
                to="/dashboard/crm/$moduleKey"
                params={{ moduleKey: "bemor_kartasi" }}
                className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("Kartani to‘liq ochish")}
              </Link>
            </div>
          ) : null}
          <div className="clay-inset flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
            <div>
              <p className="text-sm font-medium">{t("Marketing xabarlari uchun rozilik")}</p>
              <p className="text-xs text-muted-foreground">
                {customer.consent_updated_at
                  ? t("O‘zgartirilgan: {v0}", { v0: new Date(customer.consent_updated_at).toLocaleDateString("uz-UZ") })
                  : t("Rozilik hali kiritilmagan.")}
              </p>
            </div>
            <Switch
              checked={Boolean(customer.marketing_consent)}
              disabled={!canConsent || busy || Boolean(erasedAt)}
              onCheckedChange={toggleConsent}
              aria-label={t("Marketing roziligi")}
            />
          </div>
        </TabsContent>

        {showOrders ? (
          <TabsContent value="orders" className="mt-3 space-y-2">
            {orders.length === 0 ? (
              <Empty text="Buyurtma yo‘q." />
            ) : (
              orders.map((order) => (
                <Row
                  key={order.id}
                  title={`#${order.order_number}`}
                  subtitle={`${formatMoney(order.total, currency)} • ${new Date(
                    order.created_at,
                  ).toLocaleDateString("uz-UZ")}`}
                  badge={order.status}
                  action={
                    order.order_number ? (
                      <Link
                        to="/dashboard/orders"
                        search={{ search: order.order_number }}
                        className={rowLink}
                      >
                        {t("Ochish")}
                      </Link>
                    ) : null
                  }
                />
              ))
            )}
          </TabsContent>
        ) : null}

        <TabsContent value="payments" className="mt-3 space-y-2">
          {payments.length === 0 ? (
            <Empty text="To‘lov yo‘q." />
          ) : (
            payments.map((payment) => {
              const order = payment.orders as { order_number: string | null } | null;
              return (
                <Row
                  key={payment.id}
                  title={formatMoney(payment.amount, currency)}
                  subtitle={`${crmLabel(payment.method)} • ${new Date(
                    payment.paid_at ?? payment.created_at,
                  ).toLocaleDateString("uz-UZ")}${payment.note ? ` • ${payment.note}` : ""}`}
                  badge={payment.status}
                  action={
                    showOrders && order?.order_number ? (
                      <Link
                        to="/dashboard/orders"
                        search={{ search: order.order_number }}
                        className={rowLink}
                      >
                        #{order.order_number}
                      </Link>
                    ) : null
                  }
                />
              );
            })
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-3 space-y-2">
          {tasks.length === 0 ? (
            <Empty text="Vazifa yo‘q." />
          ) : (
            tasks.map((task) => (
              <Row
                key={task.id}
                title={task.title}
                subtitle={
                  task.due_date
                    ? t("Muddat: {v0}", { v0: new Date(task.due_date).toLocaleDateString("uz-UZ") })
                    : t("Muddat belgilanmagan")
                }
                badge={task.status}
                action={
                  <Link
                    to="/dashboard/tasks"
                    search={{ customerId: id, search: task.title }}
                    className={rowLink}
                  >
                    {t("Ochish")}
                  </Link>
                }
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="dental" className="mt-3">
          <DentalChart customerId={id} patientName={customer.full_name ?? ""} />
        </TabsContent>

        <TabsContent value="linked" className="mt-3 space-y-2">
          <CustomerLinkedRecords customerId={id} />
        </TabsContent>
        <TabsContent value="activity" className="mt-3 space-y-2">
          {activities.length === 0 ? (
            <Empty text="Tarix bo‘sh." />
          ) : (
            activities.map((activity) => (
              <Row
                key={activity.id}
                title={activity.detail ?? activity.action}
                subtitle={`${activity.actor} • ${new Date(activity.created_at).toLocaleString("uz-UZ")}`}
              />
            ))
          )}
        </TabsContent>
      </Tabs>

      <CustomerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={{
          id: customer.id,
          full_name: customer.full_name,
          phone: customer.phone,
          email: customer.email,
          location: customer.location,
          status: customer.status,
          source: customer.source,
          assigned_member_id: customer.assigned_member_id,
          notes: customer.notes,
        }}
        title={t("Mijozni tahrirlash")}
      />
      <PaymentDialog open={paymentOpen} onOpenChange={setPaymentOpen} defaultCustomerId={id} />
      <TaskDialog open={taskOpen} onOpenChange={setTaskOpen} defaultCustomerId={id} />
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

/** An empty medical field is rendered as a dash — the card never invents a diagnosis. */
function medicalCell(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "—";
}

function Empty({ text }: { text: string }) {
  return <p className="clay-panel p-5 text-sm text-muted-foreground">{text}</p>;
}

function Row({
  title,
  subtitle,
  badge,
  action,
}: {
  title: string;
  subtitle?: string;
  badge?: string | null;
  action?: ReactNode;
}) {
  return (
    <div className="clay-panel flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        {badge ? <StatusBadge value={badge} /> : null}
      </div>
    </div>
  );
}
