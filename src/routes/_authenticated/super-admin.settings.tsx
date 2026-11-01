import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { Panel } from "@/components/app/super-admin-ui";
import { getSystemSettings, saveSystemSettings } from "@/lib/super-admin.functions";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/super-admin/settings")({
  head: () => ({
    meta: [
      { title: t("Tizim sozlamalari — KetaOne Control Center") },
      { name: "description", content: t("Platforma nomi, qo‘llab-quvvatlash aloqasi, standart vaqt mintaqasi va texnik ishlar rejimi.") },
      { property: "og:title", content: t("Tizim sozlamalari — KetaOne Control Center") },
      { property: "og:description", content: t("Platforma darajasidagi asosiy sozlamalar.") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

interface FormState {
  platform_name: string;
  support_email: string;
  support_phone: string;
  default_timezone: string;
  default_currency: string;
  maintenance_mode: boolean;
  maintenance_message: string;
}

const EMPTY: FormState = {
  platform_name: "KetaOne",
  support_email: "keta.comp.dev@gmail.com",
  support_phone: "+998 77 763 02 16",
  default_timezone: "Asia/Tashkent",
  default_currency: "UZS",
  maintenance_mode: false,
  maintenance_message: "",
};

function SettingsPage() {
  const queryClient = useQueryClient();
  const load = useServerFn(getSystemSettings);
  const saveFn = useServerFn(saveSystemSettings);
  const [form, setForm] = useState<FormState>(EMPTY);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["super-admin-settings"],
    queryFn: () => load(),
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      platform_name: data.platform_name ?? EMPTY.platform_name,
      support_email: data.support_email ?? EMPTY.support_email,
      support_phone: data.support_phone ?? EMPTY.support_phone,
      default_timezone: data.default_timezone ?? EMPTY.default_timezone,
      default_currency: data.default_currency ?? EMPTY.default_currency,
      maintenance_mode: data.maintenance_mode ?? false,
      maintenance_message: data.maintenance_message ?? "",
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ...form,
          maintenance_message: form.maintenance_message.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("Sozlamalar saqlandi"));
      void queryClient.invalidateQueries({ queryKey: ["super-admin-settings"] });
    },
    onError: (e) => toast.error(friendlyError(e, t("Saqlanmadi"))),
  });

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6">
      <PageHeader title={t("Tizim sozlamalari")} description={t("Platforma darajasidagi asosiy sozlamalar.")} />

      <Panel title={t("Asosiy")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="platform_name">{t("Platforma nomi")}</Label>
            <Input id="platform_name" value={form.platform_name} onChange={(e) => set("platform_name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="support_email">{t("Qo‘llab-quvvatlash emaili")}</Label>
            <Input id="support_email" type="email" value={form.support_email} onChange={(e) => set("support_email", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="support_phone">{t("Qo‘llab-quvvatlash telefoni")}</Label>
            <Input id="support_phone" value={form.support_phone} onChange={(e) => set("support_phone", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="default_timezone">{t("Standart vaqt mintaqasi")}</Label>
            <Input id="default_timezone" value={form.default_timezone} onChange={(e) => set("default_timezone", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="default_currency">{t("Standart valyuta")}</Label>
            <Input id="default_currency" value={form.default_currency} onChange={(e) => set("default_currency", e.target.value)} />
          </div>
        </div>
      </Panel>

      <Panel title={t("Texnik ishlar rejimi")} description={t("Yoqilganda oddiy foydalanuvchilar CRMga kira olmaydi. Super Admin kirishi saqlanadi.")}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{form.maintenance_mode ? t("Yoqilgan") : t("O‘chirilgan")}</span>
            <Switch checked={form.maintenance_mode} onCheckedChange={(v) => set("maintenance_mode", v)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenance_message">{t("Foydalanuvchilarga xabar")}</Label>
            <Textarea
              id="maintenance_message"
              rows={3}
              value={form.maintenance_message}
              onChange={(e) => set("maintenance_message", e.target.value)}
              placeholder={t("Tizim texnik ishlar sababli vaqtincha mavjud emas.")}
            />
          </div>
        </div>
      </Panel>

      <div>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>{t("Saqlash")}</Button>
      </div>
    </div>
  );
}
