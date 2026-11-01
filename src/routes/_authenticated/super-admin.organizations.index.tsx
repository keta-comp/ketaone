import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { DataTable, NoData, Panel, Pill, fmtDate, fmtNumber } from "@/components/app/super-admin-ui";
import { downloadBase64Xlsx } from "@/components/app/super-admin-ui";
import { exportPlatformExcel, listOrganizationsFn } from "@/lib/super-admin.functions";
import { PLAN_IDS } from "@/lib/billing";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/super-admin/organizations/")({
  head: () => ({
    meta: [
      { title: t("Organizationlar — KetaOne Control Center") },
      { name: "description", content: t("KetaOne platformasidagi barcha bizneslar ro‘yxati, holati va faolligi.") },
      { property: "og:title", content: t("Organizationlar — KetaOne Control Center") },
      { property: "og:description", content: t("Barcha bizneslar: soha, foydalanuvchilar soni, holat va plan.") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrganizationsPage,
});

const PLANS = PLAN_IDS;
const STATUSES = ["active", "trial", "suspended", "cancelled"];

function OrganizationsPage() {
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("all");
  const [plan, setPlan] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("newest");

  const load = useServerFn(listOrganizationsFn);
  const exportFn = useServerFn(exportPlatformExcel);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["super-admin-orgs", search, industry, plan, status, sort],
    queryFn: () => load({ data: { search, industry, plan, status, sort } }),
  });

  const exportExcel = async () => {
    try {
      const file = await exportFn({ data: { kind: "organizations" } });
      downloadBase64Xlsx(file.base64, file.filename);
    } catch (e) {
      toast.error(friendlyError(e, t("Eksport qilinmadi")));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Organizationlar")}
        description={t("KetaOne'dan foydalanayotgan barcha bizneslar.")}
        actions={
          <Button variant="outline" size="sm" onClick={() => void exportExcel()}>
            <Download className="size-4" /> Excel
          </Button>
        }
      />

      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Nom, egasi yoki email")}
          />
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger><SelectValue placeholder={t("Soha")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Barcha sohalar")}</SelectItem>
              {(data?.industries ?? []).map((i) => (
                <SelectItem key={i} value={i}>{i}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={plan} onValueChange={setPlan}>
            <SelectTrigger><SelectValue placeholder={t("Plan")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Barcha planlar")}</SelectItem>
              {PLANS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder={t("Holat")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Barcha holatlar")}</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger><SelectValue placeholder={t("Saralash")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">{t("Eng yangi")}</SelectItem>
              <SelectItem value="oldest">{t("Eng eski")}</SelectItem>
              <SelectItem value="active">{t("Eng faol")}</SelectItem>
              <SelectItem value="users">{t("Ko‘p foydalanuvchi")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Panel>

      <Panel>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (data?.rows ?? []).length === 0 ? (
          <NoData label={t("Organization topilmadi")} />
        ) : (
          <DataTable
            columns={["Organization", "Egasi", "Soha", "Foydalanuvchi", "Yaratilgan", "Oxirgi faollik", "Plan", "Holat"]}
          >
            {(data?.rows ?? []).map((row) => (
              <tr key={row.id} className="hover:bg-muted/40">
                <td className="px-3 py-2">
                  <Link to="/super-admin/organizations/$id" params={{ id: row.id }} className="font-medium underline-offset-4 hover:underline">
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span className="block">{row.ownerName ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">{row.ownerEmail ?? ""}</span>
                </td>
                <td className="px-3 py-2">{row.industry ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{fmtNumber(row.users)}</td>
                <td className="px-3 py-2 text-xs">{fmtDate(row.createdAt)}</td>
                <td className="px-3 py-2 text-xs">{fmtDate(row.lastActiveAt)}</td>
                <td className="px-3 py-2">{row.plan}</td>
                <td className="px-3 py-2"><Pill value={row.status} /></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
