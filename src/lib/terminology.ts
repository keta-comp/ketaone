/**
 * Client-side wording for the tenant's industry: page titles, "Yangi …" buttons, toasts.
 * `coreTerm` (presets.ts) is the single source, so a section can never be called one thing
 * in the menu and another on its own page.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getMyCrmConfig } from "./crm-config.functions";
import { t } from "./i18n";
import { type CoreKey, resolvePresetId, serviceTermsForPreset, termsForPreset } from "./presets";

export type Term = { one: string; many: string };

export type Terminology = {
  loading: boolean;
  presetId: string;
  term: (key: CoreKey) => Term;
  /** Qabulga nima band qilinadi — «Xizmat» yoki klubdagi «Qurilma yoki stol». */
  service: () => Term;
};

export function useTerminology(): Terminology {
  const fetchConfig = useServerFn(getMyCrmConfig);
  const config = useQuery({ queryKey: ["crm-config"], queryFn: () => fetchConfig() });
  const presetId = resolvePresetId(config.data?.industry, config.data?.config?.presetId);
  const terms = termsForPreset(presetId);
  const serviceTerms = serviceTermsForPreset(presetId);
  // Istalgan tilda soha nomlari ham tarjima bo'lishi uchun tarjimani shu bir joyda qilamiz.
  return {
    loading: config.isPending,
    presetId,
    term: (key) => ({ one: t(terms[key].one), many: t(terms[key].many) }),
    service: () => ({ one: t(serviceTerms.one), many: t(serviceTerms.many) }),
  };
}

/** Brauzer qivati menyu va sahifa sarlavhasi bilan bir xil bo'lim nomini ko'rsatishi uchun. */
export function useSectionTitle(many: string) {
  useEffect(() => {
    document.title = `${many} — KetaOne`;
  }, [many]);
}
