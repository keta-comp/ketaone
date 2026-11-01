import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ErrorState, LoadingState, PageHeader, StatCard } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateRangeFromPreset, REPORT_PRESETS } from "@/lib/crm-core";
import { exportReportExcel, getReport } from "@/lib/workspace.functions";
import { exportBookingCsv, getBookingReport } from "@/lib/booking-reports.functions";
import { formatMoney } from "@/lib/types";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/dashboard/analytics")({
  head: () => ({
    meta: [
      { title: t("Hisobotlar — KetaOne") },
      {
        name: "description",
        content: t("Tushum, buyurtmalar, konversiya, manbalar va jamoa a’zolari bo‘yicha real hisobotlar."),
      },
      { property: "og:title", content: t("Hisobotlar — KetaOne") },
      { property: "og:description", content: t("Davrni tanlang va hisobotni Excelga yuklab oling.") },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const fetchReport = useServerFn(getReport);
  const exportExcel = useServerFn(exportReportExcel);
  const fetchBooking = useServerFn(getBookingReport);
  const exportCsv = useServerFn(exportBookingCsv);
  const [preset, setPreset] = useState("30d");
  const [custom, setCustom] = useState<{ from: string; to: string }>(() => {
    const range = dateRangeFromPreset("30d");
    return { from: range.from.slice(0, 10), to: range.to.slice(0, 10) };
  });
  const [exporting, setExporting] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  const range = useMemo(() => {
    if (preset === "custom") {
      return {
        from: new Date(`${custom.from}T00:00:00`).toISOString(),
        to: new Date(`${custom.to}T23:59:59`).toISOString(),
      };
    }
    return dateRangeFromPreset(preset);
  }, [preset, custom]);

  const query = useQuery({
    queryKey: ["report", range.from, range.to],
    queryFn: () => fetchReport({ data: { from: range.from, to: range.to } }),
  });

  const bookingQuery = useQuery({
    queryKey: ["booking-report", range.from, range.to],
    queryFn: () => fetchBooking({ data: { from: range.from, to: range.to } }),
  });

  const download = async () => {
    setExporting(true);
    try {
      const file = await exportExcel({ data: { from: range.from, to: range.to } });
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(friendlyError(error, t("Yuklab olish xatosi")));
    } finally {
      setExporting(false);
    }
  };

  const downloadCsv = async () => {
    setExportingCsv(true);
    try {
      const file = await exportCsv({ data: { from: range.from, to: range.to } });
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(friendlyError(error, t("Yuklab olish xatosi")));
    } finally {
      setExportingCsv(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t("Hisobotlar")}
        description={t("Barcha raqamlar tanlangan davr uchun bazadan hisoblanadi.")}
        actions={
          <>
            <Button size="sm" variant="outline" className="gap-2" onClick={() => void download()} disabled={exporting}>
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Excel
            </Button>
            <Button size="sm" variant="outline" className="gap-2" onClick={() => void downloadCsv()} disabled={exportingCsv}>
              {exportingCsv ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {t("Qabullar CSV")}
            </Button>
          </>
        }
      />

      <div className="clay-panel flex flex-wrap items-center gap-2 p-4">
        {REPORT_PRESETS.map((item) => (
          <Button
            key={item.key}
            size="sm"
            variant={preset === item.key ? "default" : "outline"}
            onClick={() => setPreset(item.key)}
          >
            {t(item.label)}
          </Button>
        ))}
        {preset === "custom" ? (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={custom.from}
              onChange={(e) => setCustom((p) => ({ ...p, from: e.target.value }))}
              className="h-9 w-40"
            />
            <span className="text-muted-foreground">—</span>
            <Input
              type="date"
              value={custom.to}
              onChange={(e) => setCustom((p) => ({ ...p, to: e.target.value }))}
              className="h-9 w-40"
            />
          </div>
        ) : null}
      </div>

      {query.isPending ? (
        <LoadingState label={t("Hisobot hisoblanmoqda…")} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <ReportBody data={query.data} />
      )}

      <BookingReportSection
        data={bookingQuery.data}
        pending={bookingQuery.isPending}
        error={bookingQuery.error}
        onRetry={() => void bookingQuery.refetch()}
      />
    </>
  );
}

function ReportBody({ data }: { data: Awaited<ReturnType<typeof getReport>> }) {
  const currency = data.currency;
  const days = data.days.map((day) => ({
    ...day,
    label: new Date(day.date).toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit" }),
  }));

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("Tushum")} value={formatMoney(data.kpis.revenue, currency)} />
        <StatCard label={t("Buyurtmalar")} value={data.kpis.orders} hint={t("Yakunlangan: {v0}", { v0: data.kpis.completedOrders })} />
        <StatCard label={t("Konversiya")} value={`${data.kpis.conversionRate}%`} />
        <StatCard label={t("O‘rtacha buyurtma")} value={formatMoney(data.kpis.averageOrderValue, currency)} />
        <StatCard label={t("Yangi mijozlar")} value={data.kpis.newCustomers} />
        <StatCard label={t("Kutilayotgan to‘lovlar")} value={formatMoney(data.kpis.pendingPayments, currency)} />
      </div>

      <section className="clay-panel p-5">
        <h2 className="font-display text-base font-semibold">{t("Tushum dinamikasi")}</h2>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={days}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={70} />
              <Tooltip formatter={(value: number) => formatMoney(value, currency)} />
              <Line type="monotone" dataKey="revenue" stroke="var(--foreground)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="clay-panel p-5">
          <h2 className="font-display text-base font-semibold">{t("Kunlik buyurtmalar")}</h2>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={30} />
                <Tooltip />
                <Bar dataKey="orders" fill="var(--foreground)" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="clay-panel p-5">
          <h2 className="font-display text-base font-semibold">{t("Manbalar")}</h2>
          <div className="mt-3 space-y-2">
            {data.bySource.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("Ma’lumot yo‘q.")}</p>
            ) : (
              data.bySource.map((row) => (
                <div key={row.name} className="clay-inset flex items-center justify-between rounded-2xl px-3 py-2 text-sm">
                  <span>{row.name}</span>
                  <span className="text-muted-foreground">
                    {row.customers} {t("mijoz")}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="clay-panel p-5">
          <h2 className="font-display text-base font-semibold">{t("Jamoa bo‘yicha")}</h2>
          <div className="mt-3 space-y-2">
            {data.byMember.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("Ma’lumot yo‘q.")}</p>
            ) : (
              data.byMember.map((row) => (
                <div key={row.name} className="clay-inset flex items-center justify-between rounded-2xl px-3 py-2 text-sm">
                  <span>{row.name}</span>
                  <span className="text-muted-foreground">
                    {formatMoney(row.revenue, currency)} • {row.orders} buyurtma
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="clay-panel p-5">
          <h2 className="font-display text-base font-semibold">{t("Eng ko‘p sotilganlar")}</h2>
          <div className="mt-3 space-y-2">
            {data.topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("Ma’lumot yo‘q.")}</p>
            ) : (
              data.topProducts.map((row) => (
                <div key={row.name} className="clay-inset flex items-center justify-between rounded-2xl px-3 py-2 text-sm">
                  <span className="truncate">{row.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {row.quantity} {t("dona •")}{" "}{formatMoney(row.revenue, currency)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}

type BookingReportData = Awaited<ReturnType<typeof getBookingReport>>;

function BookingReportSection({
  data,
  pending,
  error,
  onRetry,
}: {
  data: BookingReportData | undefined;
  pending: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  if (pending) return <LoadingState label={t("Qabul hisoboti hisoblanmoqda…")} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!data) return null;

  const k = data.kpis;
  const days = data.byDay.map((day) => ({
    ...day,
    label: new Date(`${day.date}T12:00:00`).toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit" }),
  }));

  return (
    <section className="grid gap-4">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-lg font-semibold">{t("Qabullar hisoboti")}</h2>
        <span className="text-xs text-muted-foreground">{t("Narxlar bron paytidagi snapshot asosida.")}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("Jami qabullar")} value={k.total} hint={t("Kutilayotgan: {v0}", { v0: k.pending })} />
        <StatCard label={t("Bajarilgan")} value={k.completed} hint={k.showRate == null ? t("Ma’lumot yo‘q") : `${t("Kelish darajasi")}: ${k.showRate}%`} />
        <StatCard label={t("Xizmat tushumi")} value={formatMoney(k.revenue)} />
        <StatCard
          label={t("Bekor / kelmadi")}
          value={`${k.cancelled} / ${k.noShow}`}
          hint={
            `${k.cancelRate == null ? "—" : `${k.cancelRate}%`} ${t("bekor")} • ` +
            `${k.noShowRate == null ? "—" : `${k.noShowRate}%`} ${t("kelmadi")}`
          }
        />
      </div>

      {days.length > 0 ? (
        <div className="clay-panel p-5">
          <h3 className="font-display text-base font-semibold">{t("Kunlik qabullar va tushum")}</h3>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={30} />
                <Tooltip />
                <Bar dataKey="booked" fill="var(--muted-foreground)" radius={4} />
                <Bar dataKey="completed" fill="var(--foreground)" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="clay-panel p-5">
          <h3 className="font-display text-base font-semibold">{t("Xizmatlar bo‘yicha")}</h3>
          <div className="mt-3 space-y-2">
            {data.byService.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("Ma’lumot yo‘q.")}</p>
            ) : (
              data.byService.map((row) => (
                <div key={row.name} className="clay-inset flex items-center justify-between rounded-2xl px-3 py-2 text-sm">
                  <span className="truncate">{row.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {row.count} {t("ta •")} {formatMoney(row.revenue)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="clay-panel p-5">
          <h3 className="font-display text-base font-semibold">{t("Xodimlar bo‘yicha")}</h3>
          <div className="mt-3 space-y-2">
            {data.byEmployee.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("Ma’lumot yo‘q.")}</p>
            ) : (
              data.byEmployee.map((row) => (
                <div key={row.name} className="clay-inset flex items-center justify-between rounded-2xl px-3 py-2 text-sm">
                  <span className="truncate">{row.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {row.count} {t("ta")}{row.noShow > 0 ? ` · ${row.noShow} ${t("kelmadi")}` : ""} • {formatMoney(row.revenue)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
