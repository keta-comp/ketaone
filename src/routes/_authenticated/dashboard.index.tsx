import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  CalendarCheck,
  ClipboardList,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  UserRoundPlus,
  Wallet,
} from "lucide-react";

import { ErrorState, LoadingState, PageHeader, StatCard, StatusBadge } from "@/components/app/primitives";
import { QuickNewButton } from "@/components/app/crm-dialogs";
import { Button } from "@/components/ui/button";
import { LIVE_REFETCH_MS } from "@/lib/polling";
import { getBookingSummary } from "@/lib/appointments.functions";
import { getMyCrmConfig, getWidgetStats } from "@/lib/crm-config.functions";
import { getDashboardKpis } from "@/lib/workspace.functions";
import { hiddenRoutesForPreset, resolvePresetId } from "@/lib/presets";
import { listOrders } from "@/lib/orders.functions";
import { formatMoney } from "@/lib/types";
import { intlLocale, t } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  head: () => ({
    meta: [
      { title: t("Ish ekrani — KetaOne") },
      {
        name: "description",
        content: t("Bugungi tushum, yangi mijozlar va bajarilishi kerak bo‘lgan ishlar bir ekranda."),
      },
      { property: "og:title", content: t("Ish ekrani — KetaOne") },
      { property: "og:description", content: t("Biznesingizning bugungi holati real ma’lumotlar asosida.") },
    ],
  }),
  component: Overview,
});

function Overview() {
  const navigate = useNavigate();
  const fetchKpis = useServerFn(getDashboardKpis);
  const fetchOrders = useServerFn(listOrders);
  const fetchConfig = useServerFn(getMyCrmConfig);
  const fetchWidgets = useServerFn(getWidgetStats);
  const fetchBookings = useServerFn(getBookingSummary);

  const kpis = useQuery({ queryKey: ["kpis"], queryFn: () => fetchKpis(), refetchInterval: LIVE_REFETCH_MS });
  const bookings = useQuery({
    queryKey: ["booking-summary"],
    queryFn: () => fetchBookings(),
    refetchInterval: LIVE_REFETCH_MS,
  });
  const crmConfig = useQuery({ queryKey: ["crm-config"], queryFn: () => fetchConfig() });
  const presetId = resolvePresetId(crmConfig.data?.industry, crmConfig.data?.config?.presetId);
  // Preset bo'limi yashirgan sahifaga havola ham, uning ma'lumot so'rovi ham bo'lmaydi.
  const hidden = hiddenRoutesForPreset(presetId);
  const showOrders = !hidden.has("/dashboard/orders");
  const orders = useQuery({
    queryKey: ["orders", "recent"],
    queryFn: () => fetchOrders({ data: {} }),
    refetchInterval: LIVE_REFETCH_MS,
    enabled: showOrders,
  });
  const widgetStats = useQuery({
    queryKey: ["crm-widgets"],
    queryFn: () => fetchWidgets(),
    enabled: !!crmConfig.data?.hasConfig,
  });

  if (kpis.isPending) return <LoadingState label={t("Ko‘rsatkichlar yuklanmoqda…")} />;
  if (kpis.error) return <ErrorState error={kpis.error} onRetry={() => void kpis.refetch()} />;

  const data = kpis.data.kpis;
  const todos = kpis.data.todos;
  const currency = data.currency;
  const terms = crmConfig.data?.config?.terminology ?? {};

  return (
    <>
      <PageHeader
        title={t("Ish ekrani")}
        description={t("Bugungi holat — barcha raqamlar bazadagi real ma’lumotlardan.")}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard/analytics">{t("Hisobotlar")}</Link>
            </Button>
            <QuickNewButton
              industry={crmConfig.data?.industry}
              stages={crmConfig.data?.config?.pipelineStages}
              size="sm"
            />
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Link to="/dashboard/payments" className="block">
          <StatCard
            label={t("Bugungi tushum")}
            value={formatMoney(data.revenueToday, currency)}
            hint={`Bu oy: ${formatMoney(data.revenueMonth, currency)}`}
            icon={<TrendingUp className="size-4" />}
          />
        </Link>
        <Link to="/dashboard/finance" className="block">
          <StatCard
            label={t("Bugungi xarajat")}
            value={formatMoney(data.expenseToday, currency)}
            hint={`Bu oy: ${formatMoney(data.expenseMonth, currency)}`}
            icon={<TrendingDown className="size-4" />}
          />
        </Link>
        <Link to="/dashboard/customers" className="block">
          <StatCard
            label={terms["customer"] ? t("Yangi {v0}", { v0: terms["customer"].toLowerCase() }) : t("Yangi mijozlar")}
            value={data.newCustomers}
            hint={t("Bugun qo‘shilgan")}
            icon={<UserRoundPlus className="size-4" />}
          />
        </Link>
        {showOrders ? (
          <Link to="/dashboard/orders" className="block">
            <StatCard
              label={t("Yangi buyurtmalar")}
              value={data.newOrders}
              hint={t("Bugun yaratilgan")}
              icon={<ShoppingCart className="size-4" />}
            />
          </Link>
        ) : null}
        <Link to="/dashboard/payments" search={{ status: "pending" }} className="block">
          <StatCard
            label={t("Kutilayotgan to‘lovlar")}
            value={formatMoney(data.pendingPaymentsAmount, currency)}
            hint={t("{v0} ta to‘lov", { v0: data.pendingPaymentsCount })}
            icon={<Wallet className="size-4" />}
          />
        </Link>
        <Link to="/dashboard/tasks" className="block">
          <StatCard
            label={t("Yaqin vazifalar")}
            value={data.dueTasks}
            hint={t("3 kun ichida bajarilishi kerak")}
            icon={<ClipboardList className="size-4" />}
          />
        </Link>
      </div>

      {bookings.data ? (
        <section className="clay-panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">{t("Qabullar")}</h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard/appointments">{t("Barchasi")}</Link>
            </Button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t("Bugungi qabullar")}
              value={bookings.data.todayCount}
              hint={`${t("Hafta")}: ${bookings.data.weekCount} · ${t("Oy")}: ${bookings.data.monthCount}`}
              icon={<CalendarCheck className="size-4" />}
            />
            <StatCard
              label={t("Tasdiqlanmagan bronlar")}
              value={bookings.data.pendingConfirm}
              hint={t("Holati 'yangi' bo'lgan bronlar")}
            />
            <StatCard
              label={t("Bekor qilingan / kelmagan (oy)")}
              value={`${bookings.data.cancelledMonth} / ${bookings.data.noShowMonth}`}
              hint={t("Shu oy ichida")}
            />
            <StatCard
              label={t("Xizmat tushumi (oy)")}
              value={formatMoney(bookings.data.revenueMonth, currency)}
              hint={t("Yakunlangan bronlar narxi bo'yicha")}
            />
          </div>
          {bookings.data.upcoming.length > 0 ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {bookings.data.upcoming.map((appointment) => {
                const customer = (appointment.customers ?? null) as { full_name?: string | null } | null;
                const employee = (appointment.employees ?? null) as { full_name?: string | null } | null;
                return (
                  <div key={appointment.id} className="clay-inset flex items-center justify-between gap-3 rounded-2xl px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {new Date(appointment.starts_at).toLocaleString(intlLocale(), {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" — "}
                        {customer?.full_name ?? appointment.service_name ?? "—"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{employee?.full_name ?? t("Xodimsiz")}</p>
                    </div>
                    <StatusBadge value={appointment.status} />
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="clay-panel p-5">
        <h2 className="font-display text-lg font-semibold">{t("Bugun nima qilish kerak?")}</h2>
        {todos.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Hammasi joyida — kechiktirilgan ish yo‘q.")}
          </p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {todos.map((todo) => (
              <button
                key={todo.key}
                type="button"
                onClick={() =>
                  void navigate({
                    to: todo.to,
                    ...(todo.search ? { search: todo.search } : {}),
                  } as never)
                }
                className="clay-inset clay-hover flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left"
              >
                <span className="text-sm">
                  <span className="font-semibold tabular-nums">{todo.count}</span>{" "}{t("ta")} {t(todo.label)}
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </section>

      {crmConfig.data?.hasConfig && (crmConfig.data.config?.dashboardWidgets?.length ?? 0) > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(crmConfig.data.config?.dashboardWidgets ?? [])
            .filter((widget) => showOrders || widget.kind !== "legacy_today_orders")
            .map((widget) => (
            <StatCard
              key={widget.key}
              label={t(widget.label)}
              value={
                widget.kind === "legacy_today_revenue" || widget.kind === "field_sum"
                  ? formatMoney(widgetStats.data?.widgets?.[widget.key] ?? 0, currency)
                  : (widgetStats.data?.widgets?.[widget.key] ?? 0)
              }
            />
          ))}
        </div>
      ) : null}

      <div className="grid gap-4">
        {showOrders ? (
          <section className="clay-panel p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold">{t("Oxirgi buyurtmalar")}</h2>
              <Button asChild variant="ghost" size="sm">
                <Link to="/dashboard/orders">{t("Barchasi")}</Link>
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {(orders.data ?? []).slice(0, 5).map((order) => (
                <div key={order.id} className="clay-inset flex items-center justify-between gap-3 rounded-2xl px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">#{order.order_number}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatMoney(order.total, currency)}
                    </p>
                  </div>
                  <StatusBadge value={order.status} />
                </div>
              ))}
              {(orders.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("Hozircha buyurtma yo‘q.")}</p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
