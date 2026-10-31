import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { ErrorState, LoadingState, PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getMyBookingLink, setMyBookingEnabled } from "@/lib/public-booking.functions";
import { getMyCrmConfig, listMedicalAuditEvents, switchCrmPreset, syncPresetModules } from "@/lib/crm-config.functions";
import {
  droppedModulesForPreset,
  INDUSTRIES,
  medicalModuleKeys,
  missingPresetParts,
  presetForId,
  resolvePresetId,
  SUB_PRESETS,
} from "@/lib/presets";
import { medicalAuditLabel } from "@/lib/medical-audit";
import { fmtDate } from "@/components/app/super-admin-ui";
import {
  getBrandingLogoUrl,
  getSettings,
  issueLogoUploadUrl,
  removeBrandingLogo,
  saveBranding,
  saveBusinessSettings,
} from "@/lib/settings.functions";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { uploadToStorage } from "@/lib/storage-upload";

export const Route = createFileRoute("/_authenticated/dashboard/settings")({
  head: () => ({
    meta: [
      { title: t("Sozlamalar — KetaOne") },
      { name: "description", content: t("Telegram botni, biznes bilimlarini va AI savdo xatti-harakatini sozlang.") },
      { property: "og:title", content: t("Sozlamalar — KetaOne") },
      { property: "og:description", content: t("Telegram, biznes va AI agent sozlamalari.") },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const fetchSettings = useServerFn(getSettings);
  const saveBusiness = useServerFn(saveBusinessSettings);

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => fetchSettings() });

  const businessMutation = useMutation({
    mutationFn: (input: Parameters<typeof saveBusiness>[0] extends { data: infer D } ? D : never) =>
      saveBusiness({ data: input }),
    onSuccess: () => {
      toast.success(t("Biznes sozlamalari saqlandi"));
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : t("Saqlash amalga oshmadi")),
  });

  if (settings.isPending) return <LoadingState />;
  if (settings.error) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  const business = settings.data.business;

  return (
    <>
      <PageHeader title={t("Sozlamalar")} description={t("Biznes bilimlari, brend va bron havolasi sozlamalari.")} />

      <PresetCard isAdmin={settings.data.isAdmin} />

      {settings.data.isAdmin ? <MedicalAuditCard /> : null}

      {business ? (
        <BusinessForm
          key={business.id}
          initial={business}
          onSave={(values) => businessMutation.mutate(values as never)}
          saving={businessMutation.isPending}
        />
      ) : null}

      <BookingLinkCard />

      {business ? (
        <BrandingCard
          key={`${settings.data.businessId}-${business.logo_path}`}
          initialPhone={business.phone}
          initialLogoPath={business.logo_path}
        />
      ) : null}
    </>
  );
}

function PresetCard({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const fetchConfig = useServerFn(getMyCrmConfig);
  const switchPreset = useServerFn(switchCrmPreset);
  const syncPreset = useServerFn(syncPresetModules);
  const [choice, setChoice] = useState<string | null>(null);

  const crm = useQuery({ queryKey: ["crm-config"], queryFn: () => fetchConfig(), enabled: isAdmin });
  const config = crm.data?.config ?? null;
  const currentId = config?.presetId ?? null;
  const current = presetForId(currentId);
  const target = presetForId(choice);
  const dropped = config && choice ? droppedModulesForPreset(config, choice) : [];
  const missing =
    config && current
      ? missingPresetParts(config, current.id)
      : { modules: [], widgets: [], fields: [] };
  /** Field sync only ever touches modules the tenant already has, so their labels are stored. */
  const fieldGroups = missing.fields
    .map((entry) => ({
      moduleKey: entry.moduleKey,
      label: config?.modules.find((m) => m.key === entry.moduleKey)?.label ?? entry.moduleKey,
      fields: entry.fields.map((f) => f.label),
    }))
    .filter((group) => group.fields.length > 0);
  const canSync = missing.modules.length > 0 || missing.fields.length > 0;

  const mutation = useMutation({
    mutationFn: (presetId: string) => switchPreset({ data: { presetId } }),
    onSuccess: (result) => {
      setChoice(null);
      for (const key of [["crm-config"], ["crm-records"], ["crm-widgets"], ["kpis"], ["settings"]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(t("Biznes turi o‘zgartirildi"));
      for (const orphan of result.orphans) {
        toast.warning(
          `${orphan.label}: ${orphan.recordCount} ${t("ta yozuv saqlanadi, modul yangi turda mavjud emas")}`,
        );
      }
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : t("Saqlash amalga oshmadi")),
  });

  const invalidateCrm = () => {
    for (const key of [["crm-config"], ["crm-records"], ["crm-widgets"], ["kpis"], ["settings"]]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const syncMutation = useMutation({
    mutationFn: () => syncPreset({ data: {} }),
    onSuccess: (result) => {
      invalidateCrm();
      const added = [
        ...result.addedModules,
        ...result.addedFields,
        ...result.addedWidgets,
      ];
      if (added.length === 0) {
        toast.info(t("Konfiguratsiya allaqachon sohdagi oxirgi sablonga mos"));
        return;
      }
      toast.success(t("Yangiliklar qo‘shildi: {v0}", { v0: added.join(", ") }));
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : t("Saqlash amalga oshmadi")),
  });

  if (!isAdmin) return null;
  if (crm.isPending) return null;
  if (!config || !current) return null;

  return (
    <section className="clay-panel space-y-4 p-5">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-semibold">{t("Biznes turi")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Menyu, modullar va atamalar shu sablondan olinadi. O‘zgartirish ma’lumotlarni o‘chirmaydi.")}
        </p>
        <p className="text-sm">
          {t("Joriy tur")}: <span className="font-medium">{current.emoji} {t(current.name)}</span>
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {INDUSTRIES.map((option) => {
          const parent = presetForId(resolvePresetId(option.key));
          if (!parent) return null;
          const children = SUB_PRESETS[parent.id] ?? [];
          const active = currentId === parent.id;
          return (
            <div key={option.key} className="space-y-1.5">
              <button
                type="button"
                onClick={() => setChoice(parent.id === currentId ? null : parent.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm font-medium transition-all",
                  active
                    ? "clay-raised border border-primary/40 ring-2 ring-primary/30"
                    : "border border-transparent bg-card hover:shadow-clay",
                )}
              >
                <span className="text-lg">{parent.emoji}</span>
                {t(parent.name)}
              </button>
              {children.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-2">
                  {children.map((child) => {
                    const childActive = currentId === child.id;
                    return (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => setChoice(childActive ? null : child.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all",
                          childActive
                            ? "clay-raised border border-primary/40 ring-2 ring-primary/30"
                            : "border border-transparent bg-card hover:shadow-clay",
                        )}
                      >
                        <span>{child.emoji}</span>
                        {t(child.shortName ?? child.name)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {target && target.id !== currentId ? (
        <div className="space-y-3 rounded-2xl border border-border/60 bg-card/60 p-4">
          <p className="text-sm font-medium">
            {t("Yangi tur")}: {target.emoji} {t(target.name)}
          </p>
          {dropped.length > 0 ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>{t("Bu turda mavjud bo‘lmagan modullar (yozuvlar o‘chirilmaydi):")}</p>
              <ul className="list-inside list-disc">
                {dropped.map((module) => (
                  <li key={module.key}>{t(module.label)}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("Barcha modullar yangi turda ham mavjud.")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setChoice(null)} disabled={mutation.isPending}>
              {t("Bekor qilish")}
            </Button>
            <Button onClick={() => mutation.mutate(target.id)} disabled={mutation.isPending}>
              {mutation.isPending ? t("Saqlanmoqda…") : t("Tasdiqlab, turni o‘zgartirish")}
            </Button>
          </div>
        </div>
      ) : null}

      {canSync ? (
        <div className="space-y-3 rounded-2xl border border-border/60 bg-card/60 p-4">
          <p className="text-sm font-medium">{t("Sablondagi yangi qismlar")}</p>
          {missing.modules.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("Bu turning yangi modullari")}
              </p>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {missing.modules.map((module) => (
                  <li key={module.key}>{t(module.label)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {fieldGroups.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("Mavjud modullarga yangi maydonlar")}
              </p>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {fieldGroups.map((group) => (
                  <li key={group.moduleKey}>
                    {t(group.label)}: {group.fields.map((label) => t(label)).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {t("Mavjud modullar, maydonlar va yozuvlar o‘zgartirilmaydi.")}
          </p>
          <Button size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? t("Saqlanmoqda…") : t("Yangiliklarni qo‘shish")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Patient-data access journal (brief: «Tibbiy kartalarni faqat vakolatli foydalanuvchilar ko‘ra olsin. Audit jurnali bo‘lsin.»). */
function MedicalAuditCard() {
  const fetchConfig = useServerFn(getMyCrmConfig);
  const fetchEvents = useServerFn(listMedicalAuditEvents);
  const crm = useQuery({ queryKey: ["crm-config"], queryFn: () => fetchConfig() });
  const presetId = crm.data?.config?.presetId ?? null;
  const usesMedical = medicalModuleKeys(presetId ?? "").length > 0;

  const events = useQuery({
    queryKey: ["medical-audit"],
    queryFn: () => fetchEvents(),
    enabled: !crm.isPending && usesMedical,
  });

  if (!usesMedical) return null;

  return (
    <section className="clay-panel space-y-3 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold">{t("Tibbiy yozuvlar jurnali")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Bemor kartalari, tahlillar va hujjatlarni kim ochgani, kimga ruxsat berilmagani shu yerda qoladi.")}
        </p>
      </div>
      {events.isPending ? (
        <LoadingState />
      ) : events.error ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : (events.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Hozircha yozuv yo‘q.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t("Vaqt")}</th>
                <th className="px-3 py-2 font-medium">{t("Xodim")}</th>
                <th className="px-3 py-2 font-medium">{t("Amal")}</th>
                <th className="px-3 py-2 font-medium">{t("Modul")}</th>
              </tr>
            </thead>
            <tbody>
              {(events.data ?? []).map((event) => (
                <tr key={event.id} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 text-xs">{fmtDate(event.created_at)}</td>
                  <td className="px-3 py-2">{event.actor_email ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={event.status === "failure" ? "text-destructive" : undefined}>
                      {t(medicalAuditLabel(event.action))}
                    </span>
                  </td>
                  <td className="px-3 py-2">{event.module_label ? t(event.module_label) : (event.module_key ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BookingLinkCard() {
  const queryClient = useQueryClient();
  const fetchLink = useServerFn(getMyBookingLink);
  const setEnabled = useServerFn(setMyBookingEnabled);

  const link = useQuery({ queryKey: ["booking-link"], queryFn: () => fetchLink() });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => setEnabled({ data: { enabled } }),
    onSuccess: () => {
      toast.success(t("Saqlandi"));
      void queryClient.invalidateQueries({ queryKey: ["booking-link"] });
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : t("Saqlash amalga oshmadi")),
  });

  if (link.isPending || !link.data) return null;

  const url = `${window.location.origin}/b/${link.data.slug}`;
  return (
    <section className="clay-panel space-y-3 p-5">
      <h2 className="font-display text-lg font-semibold">{t("Onlayn qabul havolasi")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("Mijozlaringiz ro'yxatdan o'tmasdan ushbu havola orqali yozilishi mumkin.")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input readOnly value={url} className="min-w-64 flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(url);
            toast.success(t("Havola nusxalandi"));
          }}
        >
          {t("Nusxalash")}
        </Button>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <Switch
          checked={link.data.enabled}
          onCheckedChange={(checked) => toggleMutation.mutate(checked)}
          disabled={toggleMutation.isPending}
        />
        <span>{t("Onlayn qabul yoqilgan")}</span>
      </label>
    </section>
  );
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function BrandingCard({
  initialPhone,
  initialLogoPath,
}: {
  initialPhone: string;
  initialLogoPath: string;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(saveBranding);
  const [phone, setPhone] = useState(initialPhone);
  const [logoPath, setLogoPath] = useState(initialLogoPath);
  const [previewKey, setPreviewKey] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const logoUrl = useQuery({
    queryKey: ["branding-logo", logoPath, previewKey],
    queryFn: () => getBrandingLogoUrl({ data: { path: logoPath } }),
    enabled: Boolean(logoPath),
  });

  const persist = async (patch: { phone?: string; logo_path?: string }) => {
    setBusy(true);
    try {
      await save({ data: patch });
      toast.success(t("Saqlandi"));
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Saqlash amalga oshmadi"));
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (file: File) => {
    if (!LOGO_TYPES[file.type]) {
      toast.error(t("Faqat PNG, JPG yoki WEBP rasm yuklang"));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error(t("Logotip hajmi 2 MB dan kichik bo‘lsin"));
      return;
    }
    setBusy(true);
    const previous = logoPath;
    try {
      const { path, uploadUrl } = await issueLogoUploadUrl({
        data: { contentType: file.type, size: file.size },
      });
      await uploadToStorage(uploadUrl, file, file.type);
      if (previous && previous !== path) {
        await removeBrandingLogo({ data: { path: previous } }).catch(() => undefined);
      }
      setLogoPath(path);
      setPreviewKey(Date.now());
      setBusy(false);
      void persist({ logo_path: path });
    } catch (error) {
      setBusy(false);
      toast.error(error instanceof Error ? error.message : t("Yuklash amalga oshmadi"));
    }
  };

  const removeLogo = async () => {
    setBusy(true);
    await removeBrandingLogo({ data: { path: logoPath } }).catch(() => undefined);
    setBusy(false);
    setLogoPath("");
    void persist({ logo_path: "" });
  };

  return (
    <section className="clay-panel space-y-3 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold">{t("Brend va aloqa")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Onlayn qabul sahifasida sizning logotip, biznes nomi va telefoningiz ko‘rinadi.")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-muted">
          {logoPath && logoUrl.data?.url ? (
            <img
              src={logoUrl.data.url}
              alt={t("Logotip")}
              className="size-full object-contain"
            />
          ) : (
            <span className="text-xs text-muted-foreground">{t("Logotip yo‘q")}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer">
            <input
              type="file"
              accept={Object.keys(LOGO_TYPES).join(",")}
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadLogo(file);
              }}
            />
            <span className="inline-flex h-9 items-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent">
              {logoPath ? t("Almashtirish") : t("Logotip yuklash")}
            </span>
          </label>
          {logoPath ? (
            <Button variant="outline" onClick={() => void removeLogo()} disabled={busy}>
              {t("Olib tashlash")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="max-w-sm">
        <Label htmlFor="b-phone">{t("Biznes telefoni")}</Label>
        <div className="mt-1 flex gap-2">
          <Input
            id="b-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+998 90 123 45 67"
          />
          <Button onClick={() => void persist({ phone })} disabled={busy}>
            {t("Saqlash")}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Mijozlar shu raqamni onlayn qabul sahifasida bosib bog‘lanadi.")}
        </p>
      </div>
    </section>
  );
}

type BusinessRow = {
  id: string;
  business_name: string;
  business_description: string;
  working_hours: string;
  delivery_info: string;
  payment_methods: string;
  return_policy: string;
  currency: string;
  staff_group_chat_id: string | null;
};

function BusinessForm({
  initial,
  onSave,
  saving,
}: {
  initial: BusinessRow;
  onSave: (values: BusinessRow) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<BusinessRow>(initial);
  const field = (key: keyof BusinessRow) => ({
    value: (form[key] ?? "") as string,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: event.target.value }),
  });

  return (
    <form
      className="clay-panel space-y-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ ...form, staff_group_chat_id: form.staff_group_chat_id || null });
      }}
    >
      <h2 className="font-display text-base font-semibold">{t("Biznes bilimlari")}</h2>
      <p className="text-sm text-muted-foreground">{t("AI agent mijozlarga shu ma'lumotlarni aytadi.")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="b-name">{t("Biznes nomi")}</Label>
          <Input id="b-name" {...field("business_name")} required />
        </div>
        <div>
          <Label htmlFor="b-currency">{t("Valyuta")}</Label>
          <Input id="b-currency" {...field("currency")} required />
        </div>
        <div>
          <Label htmlFor="b-hours">{t("Ish vaqti")}</Label>
          <Input id="b-hours" {...field("working_hours")} />
        </div>
        <div>
          <Label htmlFor="b-group">{t("Jamoa guruh chat ID")}</Label>
          <Input id="b-group" {...field("staff_group_chat_id")} placeholder="-1001234567890" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="b-desc">{t("Biznes nima sotadi")}</Label>
          <Textarea id="b-desc" rows={3} {...field("business_description")} />
        </div>
        <div>
          <Label htmlFor="b-delivery">{t("Yetkazib berish haqida")}</Label>
          <Textarea id="b-delivery" rows={3} {...field("delivery_info")} />
        </div>
        <div>
          <Label htmlFor="b-payment">{t("To'lov usullari")}</Label>
          <Textarea id="b-payment" rows={3} {...field("payment_methods")} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="b-return">{t("Qaytarish siyosati")}</Label>
          <Textarea id="b-return" rows={2} {...field("return_policy")} />
        </div>
      </div>
      <Button type="submit" disabled={saving}>
        {t("Biznes sozlamalarini saqlash")}
      </Button>
    </form>
  );
}
