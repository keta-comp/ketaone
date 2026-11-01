import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { DataTable, Field, NoData, Panel, Pill, fmtDate, fmtMoney, fmtNumber } from "@/components/app/super-admin-ui";
import { getOrganization, setOrganizationPlan, setOrganizationStatus } from "@/lib/super-admin.functions";
import { PLAN_IDS } from "@/lib/billing";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/super-admin/organizations/$id")({
  head: () => ({
    meta: [
      { title: t("Organization profili — KetaOne Control Center") },
      { name: "description", content: t("Bitta biznesning platforma darajasidagi profili: jamoa, CRM, faollik va AI ishlatilishi.") },
      { property: "og:title", content: t("Organization profili — KetaOne Control Center") },
      { property: "og:description", content: t("Biznes profili, jamoa va faollik tarixi.") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrganizationDetailPage,
});

const PLANS = PLAN_IDS;

function OrganizationDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const load = useServerFn(getOrganization);
  const statusFn = useServerFn(setOrganizationStatus);
  const planFn = useServerFn(setOrganizationPlan);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [reason, setReason] = useState("");

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["super-admin-org", id],
    queryFn: () => load({ data: { id } }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["super-admin-org", id] });
    void queryClient.invalidateQueries({ queryKey: ["super-admin-orgs"] });
  };

  const changeStatus = useMutation({
    mutationFn: (input: { status: "active" | "suspended"; reason?: string | null }) =>
      statusFn({ data: { id, status: input.status, reason: input.reason ?? null } }),
    onSuccess: (_r, input) => {
      toast.success(input.status === "suspended" ? t("Organization bloklandi") : t("Organization qayta faollashtirildi"));
      setConfirmSuspend(false);
      setReason("");
      invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, t("Amal bajarilmadi"))),
  });

  const changePlan = useMutation({
    mutationFn: (plan: (typeof PLANS)[number]) => planFn({ data: { id, plan } }),
    onSuccess: () => {
      toast.success(t("Plan o‘zgartirildi"));
      invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, t("Amal bajarilmadi"))),
  });

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <NoData />;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link to="/super-admin/organizations">
          <ArrowLeft className="size-4" /> {t("Organizationlar")}
        </Link>
      </Button>

      <PageHeader
        title={data.business.name}
        description={t("{v0} · {v1} foydalanuvchi", { v0: data.industry ?? "Soha ko‘rsatilmagan", v1: data.members.length })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={data.business.plan} onValueChange={(v) => changePlan.mutate(v as (typeof PLANS)[number])}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLANS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            {data.business.status === "suspended" ? (
              <Button size="sm" onClick={() => changeStatus.mutate({ status: "active" })}>
                {t("Qayta faollashtirish")}
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={() => setConfirmSuspend(true)}>
                {t("Bloklash")}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Asosiy ma’lumot")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Holat")} value={<Pill value={data.business.status} />} />
            <Field label={t("Plan")} value={data.business.plan} />
            <Field label={t("Egasi")} value={data.owner?.name ?? "—"} />
            <Field label={t("Egasining emaili")} value={data.owner?.email ?? "—"} />
            <Field label={t("Telefon")} value={data.owner?.phone ?? "—"} />
            <Field label={t("Yaratilgan")} value={fmtDate(data.business.createdAt)} />
            {data.business.status === "suspended" ? (
              <>
                <Field label={t("Bloklangan vaqt")} value={fmtDate(data.business.suspendedAt)} />
                <Field label={t("Sabab")} value={data.business.suspendReason ?? "—"} />
              </>
            ) : null}
          </div>
        </Panel>
        <Panel title={t("Hajm va foydalanish")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Mijozlar")} value={fmtNumber(data.counts.customers)} />
            <Field label={t("Murojaatlar")} value={fmtNumber(data.counts.leads)} />
            <Field label={t("Buyurtmalar")} value={fmtNumber(data.counts.orders)} />
            <Field label={t("Vazifalar")} value={fmtNumber(data.counts.tasks)} />
            <Field label={t("Tushum (jami)")} value={fmtMoney(data.revenue.crmTurnoverTotal)} />
            <Field label={t("AI so‘rovlari")} value={fmtNumber(data.ai.total)} />
          </div>
        </Panel>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="flex-wrap">
          <TabsTrigger value="users">{t("Jamoa")}</TabsTrigger>
          <TabsTrigger value="crm">CRM</TabsTrigger>
          <TabsTrigger value="activity">{t("Faollik")}</TabsTrigger>
          <TabsTrigger value="usage">{t("AI va foydalanish")}</TabsTrigger>
          <TabsTrigger value="audit">{t("Audit")}</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Panel>
            {data.members.length === 0 ? (
              <NoData label={t("Jamoa a’zolari yo‘q")} />
            ) : (
              <DataTable columns={["Ism", "Email", "Rol", "Holat", "Qo‘shilgan", "Oxirgi faollik"]}>
                {data.members.map((m) => (
                  <tr key={m.userId}>
                    <td className="px-3 py-2">{m.name ?? "—"}</td>
                    <td className="px-3 py-2">{m.email ?? "—"}</td>
                    <td className="px-3 py-2">{m.role}</td>
                    <td className="px-3 py-2"><Pill value={m.status} /></td>
                    <td className="px-3 py-2 text-xs">{fmtDate(m.joinedAt)}</td>
                    <td className="px-3 py-2 text-xs">{fmtDate(m.lastActiveAt)}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="crm" className="mt-4">
          <Panel title={t("CRM konfiguratsiyasi")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("Soha")} value={data.industry ?? "—"} />
              <Field label={t("Modullar")} value={data.modules.length ? data.modules.join(", ") : "—"} />
            </div>
            {data.businessDescription ? (
              <p className="mt-4 text-sm text-muted-foreground">{data.businessDescription}</p>
            ) : null}
          </Panel>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Panel>
            {data.activities.length === 0 ? (
              <NoData label={t("Faollik yozuvlari yo‘q")} />
            ) : (
              <DataTable columns={["Vaqt", "Bo‘lim", "Amal", "Izoh", "Kim"]}>
                {data.activities.map((a, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-xs">{fmtDate(a.created_at)}</td>
                    <td className="px-3 py-2">{a.entity_type}</td>
                    <td className="px-3 py-2">{a.action}</td>
                    <td className="px-3 py-2 text-muted-foreground">{a.detail ?? "—"}</td>
                    <td className="px-3 py-2">{a.actor}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          <Panel title={t("AI ishlatilishi")}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("Jami so‘rov")} value={fmtNumber(data.ai.total)} />
              <Field label={t("Bugun")} value={fmtNumber(data.ai.today)} />
              <Field label={t("Bu oy")} value={fmtNumber(data.ai.thisMonth)} />
              <Field label={t("Kirish tokenlari")} value={fmtNumber(data.ai.inputTokens)} />
              <Field label={t("Chiqish tokenlari")} value={fmtNumber(data.ai.outputTokens)} />
              <Field label={t("Taxminiy narx")} value={<span className="text-muted-foreground">{t("Narx ma’lumoti mavjud emas")}</span>} />
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Panel>
            {data.audit.length === 0 ? (
              <NoData label={t("Audit yozuvlari yo‘q")} />
            ) : (
              <DataTable columns={["Vaqt", "Amal", "Kim", "Holat"]}>
                {data.audit.map((a, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-xs">{fmtDate(a.created_at)}</td>
                    <td className="px-3 py-2">{a.action}</td>
                    <td className="px-3 py-2">{a.actor_email ?? "—"}</td>
                    <td className="px-3 py-2"><Pill value={a.status} /></td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        </TabsContent>
      </Tabs>

      <Dialog open={confirmSuspend} onOpenChange={setConfirmSuspend}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Ushbu organizationni vaqtincha bloklamoqchimisiz?")}</DialogTitle>
            <DialogDescription>
              {t("Xodimlar CRMga kira olmaydi. Hech qanday ma’lumot o‘chirilmaydi.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">{t("Sabab (ixtiyoriy)")}</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSuspend(false)}>{t("Bekor qilish")}</Button>
            <Button
              variant="destructive"
              disabled={changeStatus.isPending}
              onClick={() => changeStatus.mutate({ status: "suspended", reason: reason.trim() || null })}
            >
              {t("Bloklash")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
