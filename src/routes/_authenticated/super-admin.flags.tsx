import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { NoData, Panel } from "@/components/app/super-admin-ui";
import { getFeatureFlags, saveFeatureFlag } from "@/lib/super-admin.functions";
import { PLAN_IDS } from "@/lib/billing";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/super-admin/flags")({
  head: () => ({
    meta: [
      { title: t("Funksiyalar — KetaOne Control Center") },
      { name: "description", content: t("KetaOne funksiyalarini plan yoki organization bo‘yicha yoqish va o‘chirish.") },
      { property: "og:title", content: t("Funksiyalar — KetaOne Control Center") },
      { property: "og:description", content: t("Funksiya boshqaruvi: AI yordamchi, Telegram hisobotlar va boshqalar.") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FlagsPage,
});

const PLANS = PLAN_IDS;

function FlagsPage() {
  const queryClient = useQueryClient();
  const load = useServerFn(getFeatureFlags);
  const saveFn = useServerFn(saveFeatureFlag);
  const [draft, setDraft] = useState({ key: "", label: "" });

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["super-admin-flags"],
    queryFn: () => load(),
  });

  const save = useMutation({
    mutationFn: (input: {
      key: string;
      label: string;
      enabled: boolean;
      target_plan: string | null;
      target_business_id: string | null;
    }) => saveFn({ data: input }),
    onSuccess: () => {
      toast.success(t("Saqlandi"));
      setDraft({ key: "", label: "" });
      void queryClient.invalidateQueries({ queryKey: ["super-admin-flags"] });
    },
    onError: (e) => toast.error(friendlyError(e, t("Saqlanmadi"))),
  });

  if (isPending) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const flags = data?.flags ?? [];
  const key = draft.key.trim();
  const label = draft.label.trim();
  // Bir so'zli kalit boshqa flag bilan to'qnashmasligi uchun faqat [a-z0-9_.-] qabul qilinadi.
  const keyIsValid = /^[a-z][a-z0-9_.-]{1,63}$/.test(key);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Funksiya boshqaruvi")}
        description={t("Har bir funksiyani umumiy, plan yoki bitta organization uchun yoqing.")}
      />
      <p className="-mt-4 text-xs text-muted-foreground">
        {t("Yoqilgan flag plan talabini yengadi, o‘chirilgan flag esa istalgan planda funksiyani o‘chiradi.")}
      </p>

      <Panel title={t("Yangi funksiya qo‘shish")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          <Input
            value={draft.key}
            onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
            placeholder={t("Funksiya kaliti")}
          />
          <Input
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder={t("Funksiya nomi")}
          />
          <Button
            disabled={!(keyIsValid && label) || save.isPending}
            onClick={() =>
              save.mutate({ key, label, enabled: false, target_plan: null, target_business_id: null })
            }
          >
            {t("Qo‘shish")}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("Kalit kichik harf, raqam, nuqta yoki tire bilan yoziladi (masalan: ai_assistant).")}
          {keyIsValid && flags.some((f) => f.key === key)
            ? ` ${t("Bu kalit allaqachon bor — nomi va sozlamalari yangilanadi.")}`
            : ""}
        </p>
      </Panel>

      {flags.length === 0 ? (
        <Panel><NoData label={t("Funksiyalar ro‘yxati bo‘sh")} /></Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {flags.map((flag) => (
            <Panel key={flag.key} title={t(flag.label)} description={flag.key}>
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">{flag.enabled ? t("Yoqilgan") : t("O‘chirilgan")}</span>
                  <Switch
                    checked={flag.enabled}
                    onCheckedChange={(checked) =>
                      save.mutate({
                        key: flag.key,
                        label: flag.label,
                        enabled: checked,
                        target_plan: flag.target_plan ?? null,
                        target_business_id: flag.target_business_id ?? null,
                      })
                    }
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {/* Changing one restriction keeps the other: a flag can be scoped to
                      a plan AND a business at once, and silently dropping the second
                      would widen the change far past what was clicked. */}
                  <Select
                    value={flag.target_plan ?? "none"}
                    onValueChange={(v) =>
                      save.mutate({
                        key: flag.key,
                        label: flag.label,
                        enabled: flag.enabled,
                        target_plan: v === "none" ? null : v,
                        target_business_id: flag.target_business_id ?? null,
                      })
                    }
                  >
                    <SelectTrigger><SelectValue placeholder={t("Plan")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("Plan cheklovi yo‘q")}</SelectItem>
                      {PLANS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>

                  <Select
                    value={flag.target_business_id ?? "none"}
                    onValueChange={(v) =>
                      save.mutate({
                        key: flag.key,
                        label: flag.label,
                        enabled: flag.enabled,
                        target_plan: flag.target_plan ?? null,
                        target_business_id: v === "none" ? null : v,
                      })
                    }
                  >
                    <SelectTrigger><SelectValue placeholder={t("Organization")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("Organization cheklovi yo‘q")}</SelectItem>
                      {(data?.businesses ?? []).map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  {flag.target_business_id
                    ? `${t("Faqat shu organization")}: ${(data?.businesses ?? []).find((b) => b.id === flag.target_business_id)?.name ?? flag.target_business_id}`
                    : flag.target_plan
                      ? `${t("Faqat shu plan")}: ${flag.target_plan}`
                      : t("Barcha organizationlarga ta’sir qiladi")}
                </p>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
