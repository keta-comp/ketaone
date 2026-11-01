import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";

import logoUrl from "@/assets/ketaone-logo.webp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { generateCrmConfig } from "@/lib/crm-config.functions";
import { INDUSTRIES, presetForId, resolvePresetId, SUB_PRESETS } from "@/lib/presets";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [{ title: t("CRMni sozlash — KetaOne") }],
  }),
  component: Onboarding,
});

const AI_STEPS = [
  "AI biznesingiz uchun CRMni tayyorlamoqda...",
  "Pipeline yaratilmoqda...",
  "Maydonlar sozlanmoqda...",
  "Dashboard tayyorlanmoqda...",
];

/** Klubda pipeline va Dashboard yo'q — tayyorlanayotgan narsa shu 4 bo'limning o'zi. */
const CLUB_AI_STEPS = [
  "AI biznesingiz uchun CRMni tayyorlamoqda...",
  "Dastur va mobil ilova bo'limlari qurilmoqda...",
  "Telegram bildirishnomalari sozlanmoqda...",
  "Bron va qabul sozlamalari tayyorlanmoqda...",
];

const STEPS = ["Biznes", "Soha", "Sozlash", "Yaratilmoqda", "Tayyor"];

/** Where the wizard stopped — used to resume after a closed tab or a slow connection. */
const DRAFT_KEY = "ketaone.onboarding.draft.v1";

interface Draft {
  step: number;
  businessName: string;
  description: string;
  industry: string | null;
  presetId: string | null;
  otherLabel: string;
  currency: string;
  workingHours: string;
}

const EMPTY_DRAFT: Draft = {
  step: 1,
  businessName: "",
  description: "",
  industry: null,
  presetId: null,
  otherLabel: "",
  currency: "",
  workingHours: "",
};

function readDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    const industry = typeof parsed.industry === "string" ? parsed.industry : null;
    // The generating/done screens are transient — resume on a form step instead.
    const step = Math.min(Math.max(Number(parsed.step) || 1, 1), 3);
    return {
      ...EMPTY_DRAFT,
      ...parsed,
      step: step === 3 && !industry ? 2 : step,
      industry,
      presetId: typeof parsed.presetId === "string" ? parsed.presetId : null,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [restored, setRestored] = useState(false);
  const [aiStep, setAiStep] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const generate = useServerFn(generateCrmConfig);
  const [generating, setGenerating] = useState(false);

  // Draft lives in localStorage only, so the first render is always the blank wizard.
  useEffect(() => {
    setDraft(readDraft());
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored || draft.step > 3) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // A blocked storage area only costs us the resume, not the wizard.
    }
  }, [draft, restored]);

  const step = draft.step;
  const industry = draft.industry;
  const selectedType = draft.presetId ?? resolvePresetId(industry);
  const chosenPreset = presetForId(selectedType);
  // Klub presetlarida Dashboard, filial va crm-builder yo'q — menyuda faqat 4 bo'lim qoladi.
  const isClub = Boolean(chosenPreset?.allowedRoutes);

  useEffect(() => {
    if (step !== 4) return;
    const timer = setInterval(() => setAiStep((s) => (s + 1) % AI_STEPS.length), 1400);
    return () => clearInterval(timer);
  }, [step]);

  const startGeneration = async () => {
    if (!industry) return;
    setError(null);
    setGenerating(true);
    setField("step", 4);
    try {
      const result = await generate({
        data: {
          industryKey: industry,
          industryOther: industry === "boshqa" ? draft.otherLabel : undefined,
          presetId: chosenPreset?.id,
          businessDescription: draft.description.trim() || undefined,
          businessName: draft.businessName.trim() || undefined,
          currency: draft.currency.trim() || undefined,
          workingHours: draft.workingHours.trim() || undefined,
        },
      });
      void queryClient.invalidateQueries({ queryKey: ["crm-config"] });
      if (result.aiError) console.warn("CRM preset fallback:", result.aiError);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      setField("step", 5);
      setDone(true);
    } catch (e) {
      setError(friendlyError(e, "Xatolik yuz berdi. Qayta urinib ko‘ring."));
      setField("step", 3);
    } finally {
      setGenerating(false);
    }
  };

  const industryEmoji = useMemo(
    () => INDUSTRIES.find((i) => i.key === industry)?.emoji ?? "⚙️",
    [industry],
  );

  /** Sub-presets of the chosen industry (Sartaroshxona inside Beauty salon). */
  const typeOptions = useMemo(() => {
    const children = SUB_PRESETS[industry ?? ""] ?? [];
    if (!children.length) return [];
    const parent = presetForId(industry ?? "");
    return parent ? [parent, ...children] : children;
  }, [industry]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10">
        <div className="flex items-center gap-3">
          <span className="clay-raised grid size-12 place-items-center overflow-hidden rounded-2xl bg-card">
            <img src={logoUrl} alt={t("KetaOne logotipi")} className="size-9 object-contain" />
          </span>
          <div>
            <p className="font-display text-lg font-semibold">KetaOne</p>
            <p className="text-sm text-muted-foreground">{t("O‘z CRMingizni sozlang")}</p>
          </div>
        </div>

        <ol className="flex items-center gap-2 text-xs font-medium">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const active = step === n;
            const passed = step > n;
            return (
              <li key={label} className="flex flex-1 items-center gap-2">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full text-xs",
                    active && "clay-raised bg-primary text-primary-foreground",
                    passed && "clay-raised bg-primary/15 text-primary",
                    !active && !passed && "bg-muted text-muted-foreground",
                  )}
                >
                  {passed ? "✓" : n}
                </span>
                <span className={cn("hidden lg:inline", !active && "text-muted-foreground")}>
                  {t(label)}
                </span>
                {n < STEPS.length && <span className="h-px flex-1 bg-border" />}
              </li>
            );
          })}
        </ol>

        {step === 1 && (
          <section className="clay-panel flex flex-col gap-5 p-6">
            <div>
              <h1 className="font-display text-xl font-semibold">
                {t("Biznesingiz haqida ma'lumot bering")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Ixtiyoriy maydonlar — hozir tashlab, keyinroq to‘ldirishingiz mumkin.")}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="biznes-nomi">{t("Biznes nomi")}</Label>
              <Input
                id="biznes-nomi"
                placeholder={t("Masalan: KetaOne stomatologiya klinikasi")}
                value={draft.businessName}
                onChange={(e) => setField("businessName", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="biznes-tavsif">
                {t("Biznesingiz haqida qisqacha ma'lumot bering")}
              </Label>
              <Textarea
                id="biznes-tavsif"
                rows={5}
                placeholder={t(
                  "Masalan: Biz stomatologiya klinikasimiz. 3 ta shifokorimiz bor va mijozlar asosan Telegram orqali murojaat qiladi.",
                )}
                value={draft.description}
                onChange={(e) => setField("description", e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setField("step", 2)}>
                {t("Keyinroq")}
              </Button>
              <Button onClick={() => setField("step", 2)}>{t("Davom etish")}</Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="clay-panel flex flex-col gap-5 p-6">
            <div>
              <h1 className="font-display text-xl font-semibold">
                {t("Biznesingiz qaysi sohada?")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Shunga qarab modullar, pipeline va maydonlar tayyorlanadi.")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {INDUSTRIES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    setField("industry", option.key);
                    setField("presetId", null);
                  }}
                  className={cn(
                    "flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border border-transparent bg-card px-3 py-4 text-center text-sm font-medium transition-all hover:shadow-clay",
                    industry === option.key &&
                      "clay-raised border-primary/40 ring-2 ring-primary/30",
                  )}
                >
                  <span className="text-2xl">{option.emoji}</span>
                  {t(option.label)}
                </button>
              ))}
            </div>
            {typeOptions.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-muted-foreground">{t("Biznes turi")}</p>
                <div className="flex flex-wrap gap-2">
                  {typeOptions.map((option) => {
                    const active = selectedType === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setField("presetId", option.id)}
                        className={cn(
                          "flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium transition-all",
                          active
                            ? "clay-raised border border-primary/40 text-sidebar-accent-foreground ring-2 ring-primary/30"
                            : "border border-transparent bg-card hover:shadow-clay",
                        )}
                      >
                        <span className="text-lg">{option.emoji}</span>
                        {t(option.shortName ?? option.name)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {industry === "boshqa" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="soha-boshqa">{t("Sohangizni yozing")}</Label>
                <Input
                  id="soha-boshqa"
                  placeholder={t("Masalan: Veterinariya klinika")}
                  value={draft.otherLabel}
                  onChange={(e) => setField("otherLabel", e.target.value)}
                />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setField("step", 1)}>
                {t("Orqaga")}
              </Button>
              <Button
                disabled={
                  !industry || (industry === "boshqa" && draft.otherLabel.trim().length < 3)
                }
                onClick={() => setField("step", 3)}
              >
                {t("Davom etish")}
              </Button>
            </div>
          </section>
        )}

        {step === 3 && industry && chosenPreset && (
          <section className="clay-panel flex flex-col gap-5 p-6">
            <div>
              <h1 className="font-display text-xl font-semibold">{t("Qo‘shimcha sozlash")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Bo‘sh qoldirsangiz, tanlangan tur uchun standart qiymatlar qo‘llaniladi.")}
              </p>
              <p className="mt-2 text-sm font-medium">
                {chosenPreset.emoji} {t(chosenPreset.name)}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="valyuta">{t("Valyuta")}</Label>
                <Input
                  id="valyuta"
                  maxLength={8}
                  placeholder={chosenPreset.defaults.currency}
                  value={draft.currency}
                  onChange={(e) => setField("currency", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ish-vaqti">{t("Ish vaqti")}</Label>
                <Input
                  id="ish-vaqti"
                  maxLength={120}
                  placeholder={`${chosenPreset.defaults.workStart}–${chosenPreset.defaults.workEnd}`}
                  value={draft.workingHours}
                  onChange={(e) => setField("workingHours", e.target.value)}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {isClub
                ? t(
                    "Dastur havolalari, Telegram va bron sozlamalarini CRM tayyor bo‘lgach ham o‘zgartirish mumkin.",
                  )
                : t(
                    "Filiallar, xizmatlar va onlayn qabulni CRM tayyor bo‘lgach ham sozlash mumkin.",
                  )}
            </p>
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setField("step", 2)}>
                {t("Orqaga")}
              </Button>
              <Button onClick={() => void startGeneration()} disabled={generating}>
                {t("CRM yaratish")}
              </Button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="clay-panel flex flex-col items-center gap-6 p-10 text-center">
            <div className="relative grid size-20 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/10" />
              <span className="clay-raised grid size-16 place-items-center rounded-full bg-card text-3xl">
                {industryEmoji}
              </span>
            </div>
            <p className="font-display text-lg font-semibold">
              {(isClub ? CLUB_AI_STEPS : AI_STEPS)[aiStep]}
            </p>
            <div className="h-2 w-64 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-700"
                style={{ width: `${((aiStep + 1) / AI_STEPS.length) * 100}%` }}
              />
            </div>
          </section>
        )}

        {done && step === 5 && (
          <section className="clay-panel flex flex-col items-center gap-6 p-10 text-center">
            <span className="clay-raised grid size-16 place-items-center rounded-full bg-card text-3xl">
              🚀
            </span>
            <div>
              <h1 className="font-display text-xl font-semibold">{t("CRM tayyor!")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {isClub
                  ? t("Klubingiz uchun 4 bo‘lim tayyor: dastur, mobil ilova, Telegram va bron.")
                  : t("Dashboard, modullar va pipeline biznesingizga moslab tayyorlandi.")}
              </p>
            </div>
            <div className="flex flex-col items-center gap-2 text-sm">
              <p className="text-muted-foreground">{t("Keyingi qadamlar:")}</p>
              <div className="flex flex-wrap justify-center gap-3">
                {isClub ? (
                  <>
                    <Link to="/dashboard/program" className="text-primary hover:underline">
                      {t("Dasturni yuklab olish")}
                    </Link>
                    <Link to="/dashboard/mobile" className="text-primary hover:underline">
                      {t("Mobil dastur")}
                    </Link>
                    <Link to="/dashboard/booking" className="text-primary hover:underline">
                      {t("Bron va qabul sozlamalari")}
                    </Link>
                  </>
                ) : (
                  <>
                    <Link to="/dashboard/branches" className="text-primary hover:underline">
                      {t("Filial qo‘shish")}
                    </Link>
                    <Link to="/dashboard/appointments" className="text-primary hover:underline">
                      {t("Xizmatlar va qabul")}
                    </Link>
                    <Link to="/dashboard/settings" className="text-primary hover:underline">
                      {t("Sozlamalar")}
                    </Link>
                  </>
                )}
              </div>
            </div>
            <Button size="lg" onClick={() => navigate({ to: "/dashboard" })}>
              {t("CRMga kirish")}
            </Button>
            {!isClub && (
              <Link to="/dashboard/crm-builder" className="text-xs text-primary hover:underline">
                {t("Keyinroq AI bilan CRMni moslash")}
              </Link>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
