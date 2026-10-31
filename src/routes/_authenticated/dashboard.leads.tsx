import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";
import { Columns3, List } from "lucide-react";
import { LeadKanban } from "@/components/app/LeadKanban";
import { LeadContact, LeadFacts, LeadStageBar } from "@/components/app/LeadCardDetails";
import { LEAD_STATUS_LABELS, leadTaskStates } from "@/lib/lead-kanban";
import { LeadTasks } from "@/components/app/LeadTasks";
import { LeadToOrder } from "@/components/app/LeadToOrder";
import { listTasks } from "@/lib/tasks.functions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LIVE_REFETCH_MS } from "@/lib/polling";
import { getLead, listLeads, updateLead } from "@/lib/crm.functions";
import { listAssignees } from "@/lib/members.functions";
import { notifyLeadStaff } from "@/lib/settings.functions";
import { LEAD_SCORES, LEAD_STATUSES, type LeadScore, type LeadStatus } from "@/lib/types";
import { useHiddenSection } from "@/lib/section-visibility";
import { t } from "@/lib/i18n";

type LeadPatch = {
  id: string;
  phone?: string;
  budget?: string;
  location?: string;
  status?: LeadStatus;
  score?: LeadScore;
  assigned_member_id?: string | null;
  notes?: string;
};

const LEAD_SCORE_LABELS: Record<LeadScore, string> = {
  hot: "Issiq",
  warm: "Iliq",
  cold: "Sovuq",
};

const searchSchema = z.object({ id: z.string().optional(), status: z.string().optional() });

export const Route = createFileRoute("/_authenticated/dashboard/leads")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: t("Lidlar — KetaOne") },
      { name: "description", content: t("AI tomonidan yaratilgan Telegram savdo lidlarini baholang, biriktiring va yakunlang.") },
      { property: "og:title", content: t("Lidlar — KetaOne") },
      { property: "og:description", content: t("Mas'ulga biriktirish imkoniyati bilan AI baholagan Telegram savdo lidlari.") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LeadsPage,
});

function LeadsPage() {
  const params = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchLeads = useServerFn(listLeads);
  const fetchLead = useServerFn(getLead);
  const fetchAssignees = useServerFn(listAssignees);
  const saveLead = useServerFn(updateLead);
  const notify = useServerFn(notifyLeadStaff);
  const hidden = useHiddenSection("/dashboard/leads");

  const status = params.status ?? "all";
  const openId = params.id ?? null;
  const [view, setView] = useState("kanban");
  const [score, setScore] = useState("all");
  const [search, setSearch] = useState("");

  const setStatus = (next: string) =>
    void navigate({
      to: "/dashboard/leads",
      search: (prev) => ({ ...prev, status: next === "all" ? undefined : next }),
    });
  const setOpenId = (next: string | null) =>
    void navigate({
      to: "/dashboard/leads",
      search: (prev) => ({ ...prev, id: next ?? undefined }),
    });

  const leads = useQuery({
    queryKey: ["leads", status, score, search],
    queryFn: () => fetchLeads({ data: { status, score, search } }),
    refetchInterval: LIVE_REFETCH_MS,
    enabled: !hidden,
  });

  const detail = useQuery({
    queryKey: ["lead", openId],
    queryFn: () => {
      if (!openId) throw new Error(t("Lid topilmadi"));
      return fetchLead({ data: { id: openId } });
    },
    enabled: Boolean(openId) && !hidden,
  });

  const fetchTasks = useServerFn(listTasks);
  const tasks = useQuery({ queryKey: ["tasks", "all-leads"], queryFn: () => fetchTasks({ data: {} }) });
  const taskStates = leadTaskStates(leads.data ?? [], tasks.data ?? []);

  const assignees = useQuery({ queryKey: ["assignees"], queryFn: () => fetchAssignees() });

  const mutation = useMutation({
    mutationFn: (input: LeadPatch) => saveLead({ data: input }),
    onSuccess: () => {
      toast.success(t("Lid yangilandi"));
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["lead"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t("Lidni yangilab bo'lmadi")),
  });

  const notifyMutation = useMutation({
    mutationFn: (leadId: string) =>
      notify({ data: { leadId, reason: "Manual escalation from CRM" } }),
    onSuccess: () => toast.success(t("Jamoa guruhiga yuborildi")),
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : t("Telegram xabarnomasi yuborilmadi")),
  });

  const lead = detail.data?.lead;

  if (hidden) return <Navigate to="/dashboard" replace />;

  return (
    <Tabs value={view} onValueChange={setView} className="space-y-5">
      <PageHeader title={t("Murojaatlar")} description={t("AI agenti aniqlagan, baholagan va yo'naltirgan har bir so'rov.")} actions={
        <TabsList aria-label={t("Lidlar ko‘rinishi")}>
          <TabsTrigger value="kanban"><Columns3 className="mr-2 size-4" />{t("Kanban")}</TabsTrigger>
          <TabsTrigger value="table"><List className="mr-2 size-4" />{t("Jadval")}</TabsTrigger>
        </TabsList>
      } />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Label htmlFor="lead-search">{t("Mahsulot bo'yicha qidirish")}</Label>
          <Input
            id="lead-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("iPhone 15, krossovka…")}
          />
        </div>
        <div className="w-44">
          <Label>{t("Holat")}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Barcha holatlar")}</SelectItem>
              {LEAD_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(LEAD_STATUS_LABELS[value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Label>{t("Baho")}</Label>
          <Select value={score} onValueChange={setScore}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Barchasi")}</SelectItem>
              {LEAD_SCORES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(LEAD_SCORE_LABELS[value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <TabsContent value={view}>
      {leads.isPending ? (
        <LoadingState label={t("Yuklanmoqda…")} />
      ) : leads.error ? (
        <ErrorState error={leads.error} onRetry={() => void leads.refetch()} />
      ) : view === "kanban" ? (
        <LeadKanban rows={leads.data} taskStates={taskStates} pending={mutation.isPending} {...(mutation.isPending && mutation.variables?.id ? { movingId: mutation.variables.id } : {})} onOpen={setOpenId} onMove={(id, status) => mutation.mutate({ id, status })} />
      ) : leads.data.length === 0 ? (
        <EmptyState
          title={t("Bu filtrga mos lid topilmadi")}
          description={t("Mijozlar Telegram botingizga yozganda lidlar shu yerda avtomatik paydo bo'ladi.")}
        />
      ) : (
        <div className="clay-inset overflow-x-auto rounded-2xl">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{t("Mijoz")}</th>
                <th className="px-4 py-3">{t("Qiziqish")}</th>
                <th className="px-4 py-3">{t("Baho")}</th>
                <th className="px-4 py-3">{t("Holat")}</th>
                <th className="px-4 py-3">{t("Mas’ul")}</th>
                <th className="px-4 py-3">{t("Yaratildi")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.data.map((row) => {
                const customer = row.customers as {
                  id: string | null;
                  full_name: string | null;
                  telegram_username: string | null;
                  phone: string | null;
                } | null;
                const assignee = row.assignee_name;
                return (
                  <tr key={row.id} className="clay-hover">
                    <td className="px-4 py-3">
                      {customer?.id ? (
                        <Link
                          to="/dashboard/customers/$id"
                          params={{ id: customer.id }}
                          className="font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {customer.full_name ?? t("Telegram mijozi")}
                        </Link>
                      ) : (
                        <p className="font-medium text-foreground">{t("Telegram mijozi")}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {customer?.telegram_username ? `@${customer.telegram_username}` : (customer?.phone ?? "—")}
                      </p>
                    </td>
                    <td className="max-w-64 px-4 py-3 text-muted-foreground">
                      <p className="truncate">{row.requested_product ?? "—"}</p>
                      <p className="truncate text-xs">{row.ai_summary ?? ""}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={row.score} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={row.status} />
                    </td>
                     <td className="px-4 py-3 text-muted-foreground">
                      {row.assigned_member_id ? (
                        <Link to="/dashboard/team" className="underline-offset-4 hover:underline">
                          {assignee ?? t("Mas’ul")}
                        </Link>
                      ) : (
                        t("Biriktirilmagan")
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm" className="clay-raised" onClick={() => setOpenId(row.id)}>
                        {t("Ochish")}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </TabsContent>

      <Sheet open={Boolean(openId)} onOpenChange={(next) => setOpenId(next ? openId : null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("Lid tafsilotlari")}</SheetTitle>
          </SheetHeader>
          {detail.isPending ? (
            <LoadingState />
          ) : detail.error ? (
            <ErrorState error={detail.error} />
          ) : lead ? (
            <div className="space-y-5 px-4 pb-8">
              <LeadStageBar
                status={lead.status as LeadStatus}
                disabled={mutation.isPending}
                onChange={(next) => mutation.mutate({ id: lead.id, status: next })}
              />
              <LeadTasks
                key={`tasks-${lead.id}`}
                leadId={lead.id}
                customerId={lead.customer_id ?? null}
                memberId={lead.assigned_member_id ?? null}
              />
              <LeadContact customer={lead.customers as Parameters<typeof LeadContact>[0]["customer"]} />
              <LeadToOrder key={`order-${lead.id}`} lead={lead} />
              <div className="clay-panel p-4 text-sm">
                {lead.requested_product ? (
                  <p className="font-medium text-foreground">{t("Mahsulot")}: {lead.requested_product}</p>
                ) : null}
                 <p className="text-xs text-muted-foreground">{lead.ai_summary ?? t("AI xulosasi hali yo'q")}</p>
                {lead.handoff_reason ? (
                  <p className="mt-2 text-xs text-warning">{t("Uzatish sababi:")}{" "}{lead.handoff_reason}</p>
                ) : null}
              </div>

              <LeadFacts
                key={`facts-${lead.id}`}
                disabled={mutation.isPending}
                initial={{ phone: lead.phone ?? "", budget: lead.budget ?? "", location: lead.location ?? "" }}
                onSave={(facts) => mutation.mutate({ id: lead.id, ...facts })}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>{t("Holat")}</Label>
                  <Select
                    value={lead.status}
                    onValueChange={(value) =>
                      mutation.mutate({ id: lead.id, status: value as LeadStatus })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_STATUSES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(LEAD_STATUS_LABELS[value])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("Baho")}</Label>
                  <Select
                    value={lead.score}
                    onValueChange={(value) =>
                      mutation.mutate({ id: lead.id, score: value as LeadScore })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_SCORES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(LEAD_SCORE_LABELS[value])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label>{t("Biriktirilgan mas’ul")}</Label>
                  <Select
                    value={lead.assigned_member_id ?? "none"}
                    onValueChange={(value) =>
                      mutation.mutate({
                        id: lead.id,
                        assigned_member_id: value === "none" ? null : value,
                        ...(value === "none" ? {} : { status: "assigned" as LeadStatus }),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("Biriktirilmagan")}</SelectItem>
                      {(assignees.data ?? []).map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <LeadNotes
                key={lead.id}
                initial={lead.notes ?? ""}
                onSave={(notes) => mutation.mutate({ id: lead.id, notes })}
              />

              <Button
                variant="secondary"
                className="w-full clay-raised"
                disabled={notifyMutation.isPending}
                onClick={() => notifyMutation.mutate(lead.id)}
              >
                {t("Jamoa guruhiga yuborish")}
              </Button>

              <div>
                <p className="text-sm font-medium text-foreground">{t("Voqealar tarixi")}</p>
                <div className="mt-2 space-y-2">
                  {(detail.data?.events ?? []).map((event) => (
                    <div key={event.id} className="clay-inset rounded-xl p-2.5 text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium capitalize text-foreground">
                          {event.event_type.replace(/_/g, " ")}
                        </span>
                        <span className="text-muted-foreground">
                          {new Date(event.created_at).toLocaleString()}
                        </span>
                      </div>
                      {event.detail ? <p className="mt-1 text-muted-foreground">{event.detail}</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </Tabs>
  );
}

function LeadNotes({ initial, onSave }: { initial: string; onSave: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <Label htmlFor="lead-notes">{t("Mas’ul eslatmalari")}</Label>
      <Textarea
        id="lead-notes"
        value={value}
        rows={4}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t("Juma kuniga yetkazib berish kelishildi, to'lov kutilmoqda…")}
      />
      <Button size="sm" variant="outline" className="mt-2 clay-raised" onClick={() => onSave(value)}>
        {t("Eslatmalarni saqlash")}
      </Button>
    </div>
  );
}
