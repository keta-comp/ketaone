import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { MetricCard, NoData, Panel, downloadBase64Xlsx, fmtNumber } from "@/components/app/super-admin-ui";
import { exportPlatformExcel, getSaasAnalytics } from "@/lib/super-admin.functions";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/super-admin/analytics")({
  head: () => ({
    meta: [
      { title: t("Analitika — KetaOne Control Center") },
      { name: "description", content: t("Platforma o‘sishi: yangi organizationlar, foydalanuvchilar, faollik va churn.") },
      { property: "og:title", content: t("Analitika — KetaOne Control Center") },
      { property: "og:description", content: t("Platforma o‘sishi va faollik ko‘rsatkichlari.") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalyticsPage,
});

const PRESETS: Record<string, number | "year"> = {
  today: 0,
  "7": 7,
  "30": 30,
  "90": 90,
  year: "year",
};

function rangeFor(preset: string, customFrom: string, customTo: string) {
  if (preset === "custom" && customFrom && customTo) {
    return { from: new Date(`${customFrom}T00:00:00Z`).toISOString(), to: new Date(`${customTo}T23:59:59Z`).toISOString() };
  }
  const now = new Date();
  const to = now.toISOString();
  const value = PRESETS[preset] ?? 30;
  if (value === "year") {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(), to };
  }
  const days = value as number;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)).toISOString();
  return { from, to };
}

function AnalyticsPage() {
  const [preset, setPreset] = useState("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);

  const load = useServerFn(getSaasAnalytics);
  const exportFn = useServerFn(exportPlatformExcel);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["super-admin-analytics", range.from, range.to],
    queryFn: () => load({ data: range }),
  });

  const exportExcel = async () => {
    try {
      const file = await exportFn({ data: { kind: "analytics", from: range.from, to: range.to } });
      downloadBase64Xlsx(file.base64, file.filename);
    } catch (e) {
      toast.error(friendlyError(e, t("Eksport qilinmadi")));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Analitika")}
        description={t("Faqat bazadagi haqiqiy ma’lumot. Yetarli ma’lumot bo‘lmasa ko‘rsatkich yashiriladi.")}
        actions={
          <Button variant="outline" size="sm" onClick={() => void exportExcel()}>
            <Download className="size-4" /> Excel
          </Button>
        }
      />

      <Panel>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select value={preset} onValueChange={setPreset}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">{t("Bugun")}</SelectItem>
              <SelectItem value="7">{t("Oxirgi 7 kun")}</SelectItem>
              <SelectItem value="30">{t("Oxirgi 30 kun")}</SelectItem>
              <SelectItem value="90">{t("Oxirgi 90 kun")}</SelectItem>
              <SelectItem value="year">{t("Bu yil")}</SelectItem>
              <SelectItem value="custom">{t("Boshqa davr")}</SelectItem>
            </SelectContent>
          </Select>
          {preset === "custom" ? (
            <>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </>
          ) : null}
        </div>
      </Panel>

      {isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <NoData />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label={t("Yangi organization")} value={fmtNumber(data.newOrganizations)} />
            <MetricCard label={t("Yangi foydalanuvchi")} value={fmtNumber(data.newUsers)} />
            <MetricCard label={t("Faol organization")} value={fmtNumber(data.activeOrganizations)} />
            <MetricCard label={t("Faol foydalanuvchi")} value={fmtNumber(data.activeUsers)} />
            <MetricCard label={t("Bugun faol organization")} value={fmtNumber(data.dailyActiveOrganizations)} />
            <MetricCard label={t("Davrda faol organization")} value={fmtNumber(data.monthlyActiveOrganizations)} />
            <MetricCard
              label={t("Ushlab qolish")}
              value={data.retention === null ? "—" : `${data.retention}%`}
              hint={data.retention === null ? t("Taqqoslash uchun yetarli ma’lumot mavjud emas") : undefined}
            />
            <MetricCard
              label={t("Churn")}
              value={data.churn === null ? "—" : `${data.churn}%`}
              hint={data.churn === null ? t("Taqqoslash uchun yetarli ma’lumot mavjud emas") : undefined}
            />
          </div>

          <Panel title={t("O‘sish")} description={t("Kun bo‘yicha yangi organization va foydalanuvchilar.")}>
            {data.growth.length === 0 ? (
              <NoData label={t("Tanlangan davrda ma’lumot yo‘q")} />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.growth}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" fontSize={11} />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <Tooltip />
                    <Line type="monotone" dataKey="organizations" name="Organization" stroke="currentColor" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="users" name="Foydalanuvchi" stroke="currentColor" strokeOpacity={0.4} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Panel title={t("Sohalar bo‘yicha organizationlar")}>
            {data.industries.length === 0 ? (
              <NoData />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.industries}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="industry" fontSize={11} />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name="Organization" fill="currentColor" radius={8} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
