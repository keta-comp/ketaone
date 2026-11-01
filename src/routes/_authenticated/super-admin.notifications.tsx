import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { DataTable, NoData, Panel, fmtDate, fmtNumber } from "@/components/app/super-admin-ui";
import {
  deleteSystemNotification,
  getNotificationTargets,
  listSystemNotifications,
  sendSystemNotification,
} from "@/lib/super-admin.functions";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/super-admin/notifications")({
  head: () => ({
    meta: [
      { title: t("E’lonlar — KetaOne Control Center") },
      { name: "description", content: t("Platforma e’lonlari: texnik ishlar, ogohlantirish va yangilik xabarlari.") },
      { property: "og:title", content: t("E’lonlar — KetaOne Control Center") },
      { property: "og:description", content: t("Organizationlarga platforma e’lonlarini yuborish.") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotificationsPage,
});

type TargetKind = "all" | "organization" | "plan" | "industry";

const KIND_LABEL: Record<string, string> = {
  info: "Ma’lumot",
  warning: "Ogohlantirish",
  maintenance: "Texnik ishlar",
};

function targetLabel(targetKind: TargetKind, targetValue: string | null, businessesName?: string) {
  if (targetKind === "all") return t("Barcha foydalanuvchilar");
  if (targetKind === "organization") return `${t("Organization")}: ${businessesName ?? targetValue ?? "—"}`;
  if (targetKind === "plan") return `${t("Plan")}: ${targetValue ?? "—"}`;
  return `${t("Soha")}: ${targetValue ?? "—"}`;
}

function NotificationsPage() {
  const queryClient = useQueryClient();
  const load = useServerFn(listSystemNotifications);
  const loadTargets = useServerFn(getNotificationTargets);
  const sendFn = useServerFn(sendSystemNotification);
  const deleteFn = useServerFn(deleteSystemNotification);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"info" | "warning" | "maintenance">("info");
  const [targetKind, setTargetKind] = useState<TargetKind>("all");
  const [targetValue, setTargetValue] = useState("");
  const [confirm, setConfirm] = useState(false);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["super-admin-notifications"],
    queryFn: () => load(),
  });
  // Targets come from live rows, so a choice offered here is always a choice the
  // delivery policy can actually resolve to people.
  const targets = useQuery({ queryKey: ["super-admin-notification-targets"], queryFn: () => loadTargets() });

  const send = useMutation({
    mutationFn: () =>
      sendFn({
        data: {
          title: title.trim(),
          body: body.trim(),
          kind,
          target_kind: targetKind,
          target_value: targetKind === "all" ? null : targetValue || null,
        },
      }),
    onSuccess: (result) => {
      toast.success(t("E’lon yuborildi — {v0} foydalanuvchiga yetdi", { v0: fmtNumber(result.audience) }));
      setTitle("");
      setBody("");
      setTargetValue("");
      setConfirm(false);
      void queryClient.invalidateQueries({ queryKey: ["super-admin-notifications"] });
    },
    onError: (e) => toast.error(friendlyError(e, t("Yuborilmadi"))),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success(t("E’lon o‘chirildi"));
      void queryClient.invalidateQueries({ queryKey: ["super-admin-notifications"] });
    },
    onError: (e) => toast.error(friendlyError(e, t("O‘chirilmadi"))),
  });

  const canSend = title.trim().length >= 2 && body.trim().length >= 2 && (targetKind === "all" || !!targetValue);

  const businessName = (id: string | null) =>
    (targets.data?.businesses ?? []).find((b) => b.id === id)?.name ?? id ?? "—";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Platforma e’lonlari")}
        description={t("E’lon foydalanuvchining qo‘ng‘irog‘ida ko‘rinadi. Maqsad hech kimga to‘g‘ri kelmasa, yuborilmaydi.")}
      />

      <Panel title={t("Yangi e’lon")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="title">{t("Sarlavha")}</Label>
            <Input
              id="title"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("Texnik ishlar")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Turi")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="info">{t("Ma’lumot")}</SelectItem>
                <SelectItem value="warning">{t("Ogohlantirish")}</SelectItem>
                <SelectItem value="maintenance">{t("Texnik ishlar")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="body">{t("Matn")}</Label>
            <Textarea id="body" rows={4} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("Kimga")}</Label>
            <Select
              value={targetKind}
              onValueChange={(v) => {
                setTargetKind(v as TargetKind);
                setTargetValue("");
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Barcha organizationlar")}</SelectItem>
                <SelectItem value="organization">{t("Tanlangan organization")}</SelectItem>
                <SelectItem value="plan">{t("Plan bo‘yicha")}</SelectItem>
                <SelectItem value="industry">{t("Soha bo‘yicha")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {targetKind !== "all" ? (
            <div className="space-y-2">
              <Label>{t("Maqsad")}</Label>
              {targetKind === "plan" ? (
                <Select value={targetValue} onValueChange={setTargetValue}>
                  <SelectTrigger><SelectValue placeholder={t("Plan tanlang")} /></SelectTrigger>
                  <SelectContent>
                    {(targets.data?.plans ?? []).map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : targetKind === "organization" ? (
                <Select value={targetValue} onValueChange={setTargetValue}>
                  <SelectTrigger><SelectValue placeholder={t("Organization tanlang")} /></SelectTrigger>
                  <SelectContent>
                    {(targets.data?.businesses ?? []).map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={targetValue} onValueChange={setTargetValue}>
                  <SelectTrigger><SelectValue placeholder={t("Soha tanlang")} /></SelectTrigger>
                  <SelectContent>
                    {(targets.data?.industries ?? []).map((i) => (
                      <SelectItem key={i} value={i}>{i}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : null}
        </div>
        <div className="mt-4">
          <Button size="sm" disabled={!canSend || send.isPending} onClick={() => setConfirm(true)}>
            <Send className="size-4" /> {t("Yuborish")}
          </Button>
        </div>
      </Panel>

      <Panel title={t("Yuborilgan e’lonlar")}>
        {isPending ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (data ?? []).length === 0 ? (
          <NoData label={t("Hali e’lon yuborilmagan")} />
        ) : (
          <DataTable columns={["Vaqt", "Sarlavha", "Turi", "Kimga", "Yetdi", "O‘qildi", ""]}>
            {(data ?? []).map((n) => (
              <tr key={n.id}>
                <td className="px-3 py-2 text-xs">{fmtDate(n.created_at)}</td>
                <td className="px-3 py-2">
                  <span className="block font-medium">{n.title}</span>
                  <span className="text-xs text-muted-foreground">{n.body}</span>
                </td>
                <td className="px-3 py-2">{t(KIND_LABEL[n.kind] ?? n.kind)}</td>
                <td className="px-3 py-2 text-xs">
                  {targetLabel(n.target_kind as TargetKind, n.target_value, n.target_value ? businessName(n.target_value) : undefined)}
                </td>
                <td className="px-3 py-2 tabular-nums">{fmtNumber(n.audience)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {n.audience > 0 ? `${fmtNumber(n.read)} / ${fmtNumber(n.audience)}` : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("O‘chirish")}
                    disabled={revoke.isPending}
                    onClick={() => {
                      if (!window.confirm(t("Ushbu e’lonni o‘chirishni tasdiqlaysizmi?"))) return;
                      void revoke.mutate(n.id);
                    }}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("E’lonni yuborishni tasdiqlaysizmi?")}</DialogTitle>
            <DialogDescription>
              {t("{v0} bu xabarni ko‘radi. Yuborilgandan keyin matnni o‘zgartirib bo‘lmaydi, faqat o‘chirish mumkin.", {
                v0: targetLabel(targetKind, targetValue || null, targetValue ? businessName(targetValue) : undefined),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>{t("Bekor qilish")}</Button>
            <Button disabled={send.isPending} onClick={() => send.mutate()}>{t("Yuborish")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
