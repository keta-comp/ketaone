import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { resolveAiRuntime } from "./ai-gateway.server";
import {
  applyRelations,
  presetForIndustry,
  type CrmConfigData,
  type CrmField,
  type CrmModule,
  type CrmModuleLink,
  type CrmWidget,
} from "./crm-config";
import { invalidateCrmAgentContext } from "./crm-config.server";
import {
  backedTableOf,
  deleteBackedRecord,
  listBackedRecords,
  saveBackedRecord,
  backedWidgetValue,
  widgetTableOf,
} from "./crm-backed";
import {
  applyMissingParts,
  attachPresetId,
  crmConfigForPreset,
  droppedModulesForPreset,
  isMedicalModule,
  isModuleEnabled,
  medicalModuleKeys,
  presetForId,
  resolvePresetId,
  type IndustryPreset,
  type PresetDefaults,
} from "./presets";
import { can, type MemberRole } from "./roles";
import { logAiUsage, logAudit } from "./audit.server";
import { requireBusinessId } from "./tenant.server";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type SbClient = Parameters<typeof requireBusinessId>[0];

/** Tenant identity plus its own CRM config — the only module list writes are validated against. */
async function tenantCrm(supabase: SbClient) {
  const businessId = await requireBusinessId(supabase);
  const { data: row, error } = await supabase
    .from("crm_configs")
    .select("industry, config")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("CRM konfiguratsiyasi topilmadi");
  // Saqlangan JSON eskirganda ham yadro jadvaliga ulangan modullar shu yerda tiklanadi.
  const config = attachPresetId(row.industry, applyRelations(row.industry, row.config as unknown as CrmConfigData));
  return { businessId, config };
}

/** A record may only live in a module the tenant actually enabled. */
function requireEnabledModule(config: CrmConfigData, moduleKey: string): CrmModule {
  const module = config.modules.find((m) => m.key === moduleKey);
  if (!module) throw new Error(`Bunday modul sozlanmagan: ${moduleKey}`);
  if (!isModuleEnabled(resolvePresetId(null, config.presetId), moduleKey)) {
    throw new Error(`Modul o‘chirilgan: ${moduleKey}`);
  }
  return module;
}

/**
 * Patient-data modules need `medical.view` — both to read and to write them. The list of
 * medical modules lives in the preset registry, not in the tenant's stored config, so a
 * tenant cannot unlock them by editing its own CRM JSON.
 */
async function requireModuleAccess(
  supabase: SbClient,
  businessId: string,
  config: CrmConfigData,
  moduleKey: string,
  write = false,
): Promise<CrmModule> {
  const module = requireEnabledModule(config, moduleKey);
  if (!isMedicalModule(resolvePresetId(null, config.presetId), moduleKey)) return module;
  const { data: role, error } = await supabase.rpc("business_role", { _business_id: businessId });
  if (error) throw new Error(error.message);
  if (!can(role as MemberRole | null, "medical.view")) {
    void logAudit({
      action: write ? "medical.write_denied" : "medical.read_denied",
      businessId,
      targetType: "crm_module",
      targetId: moduleKey,
      targetLabel: module.label,
      status: "failure",
    });
    throw new Error("Bu tibbiy yozuvlarga faqat vakolatli xodimlar kira oladi.");
  }
  return module;
}

/** True when the caller's role may see patient data — presets without it always pass. */
async function memberMayViewMedical(supabase: SbClient, businessId: string, presetId: string): Promise<boolean> {
  if (medicalModuleKeys(presetId).length === 0) return true;
  const { data: role, error } = await supabase.rpc("business_role", { _business_id: businessId });
  if (error) throw new Error(error.message);
  return can(role as MemberRole | null, "medical.view");
}

/** Audit trail for every access to stored patient data; ordinary modules never log. */
function auditMedicalAccess(
  config: CrmConfigData,
  businessId: string,
  moduleKey: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  if (!isMedicalModule(resolvePresetId(null, config.presetId), moduleKey)) return;
  void logAudit({
    action,
    businessId,
    targetType: "crm_module",
    targetId: moduleKey,
    metadata,
  });
}

/** Rewriting CRM structure is an admin action — RLS alone does not limit who may call it. */
async function requireSettingsAdmin(supabase: SbClient): Promise<string> {
  const businessId = await requireBusinessId(supabase);
  const { data: role, error } = await supabase.rpc("business_role", { _business_id: businessId });
  if (error) throw new Error(error.message);
  if (!can(role as MemberRole | null, "settings.manage")) {
    throw new Error("CRM konfiguratsiyasini faqat ego yoki admin o‘zgartira oladi.");
  }
  return businessId;
}

function normalizeField(raw: unknown): CrmField | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["key"] !== "string" || !r["key"].trim()) return null;
  const types = [
    "text",
    "phone",
    "number",
    "money",
    "date",
    "time",
    "select",
    "textarea",
    "relation",
    "file",
  ] as const;
  const type = types.includes(r["type"] as (typeof types)[number]) ? (r["type"] as CrmField["type"]) : "text";
  return {
    key: r["key"].trim(),
    label: typeof r["label"] === "string" && r["label"].trim() ? r["label"] : r["key"],
    type,
    required: r["required"] === true,
    ...(Array.isArray(r["options"])
      ? { options: r["options"].filter((o) => typeof o === "string") as string[] }
      : {}),
    ...(typeof r["targetModule"] === "string" && r["targetModule"] ? { targetModule: r["targetModule"] } : {}),
  };
}

function normalizeModule(raw: unknown): CrmModule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["key"] !== "string" || !r["key"].trim()) return null;
  const module: CrmModule = {
    key: r["key"].trim(),
    label: typeof r["label"] === "string" && r["label"].trim() ? r["label"] : r["key"],
  };
  if (typeof r["icon"] === "string") module.icon = r["icon"];
  if (typeof r["link"] === "string" && r["link"].startsWith("/dashboard")) module.link = r["link"] as CrmModuleLink;
  if (r["pipeline"] === true) module.pipeline = true;
  if (r["table"] === "payments" || r["table"] === "appointments") module.table = r["table"];
  if (typeof r["titleField"] === "string" && r["titleField"].trim()) module.titleField = r["titleField"].trim();
  if (Array.isArray(r["fields"])) {
    const fields = r["fields"].map(normalizeField).filter((f): f is CrmField => f !== null);
    if (fields.length) module.fields = fields;
  }
  return module;
}

function normalizeWidget(raw: unknown, fallbackKey: string): CrmWidget | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kinds = [
    "module_count",
    "module_count_today",
    "field_sum",
    "legacy_today_revenue",
    "legacy_today_orders",
    "legacy_today_leads",
    "legacy_hot_leads",
    "legacy_handoffs",
  ] as const;
  if (typeof r["kind"] !== "string" || !kinds.includes(r["kind"] as (typeof kinds)[number])) return null;
  const widget: CrmWidget = {
    key: typeof r["key"] === "string" && r["key"].trim() ? r["key"] : fallbackKey,
    label: typeof r["label"] === "string" && r["label"].trim() ? r["label"] : fallbackKey,
    kind: r["kind"] as CrmWidget["kind"],
  };
  if (typeof r["moduleKey"] === "string") widget.moduleKey = r["moduleKey"];
  if (typeof r["fieldKey"] === "string") widget.fieldKey = r["fieldKey"];
  if (r["where"] && typeof r["where"] === "object") {
    const w = r["where"] as Record<string, unknown>;
    if (typeof w["field"] === "string" && typeof w["value"] === "string") {
      widget.where = { field: w["field"], value: w["value"] };
    }
  }
  return widget;
}

/** Merges AI output over the industry preset — invalid shapes fall back to preset values. */
export function normalizeConfig(raw: unknown, preset: CrmConfigData): CrmConfigData {
  if (!raw || typeof raw !== "object") return preset;
  const r = raw as Record<string, unknown>;

  const modules = Array.isArray(r["modules"])
    ? (r["modules"].map(normalizeModule).filter((m): m is CrmModule => m !== null))
    : [];
  const pipelineStages = Array.isArray(r["pipelineStages"])
    ? r["pipelineStages"].filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  const widgets = Array.isArray(r["dashboardWidgets"])
    ? (r["dashboardWidgets"]
        .map((w, i) => normalizeWidget(w, `widget_${i + 1}`))
        .filter((w): w is CrmWidget => w !== null))
    : [];
  const automations = Array.isArray(r["automations"])
    ? r["automations"].filter((a): a is string => typeof a === "string")
    : [];

  return {
    modules: modules.length ? modules : preset.modules,
    pipelineStages: pipelineStages.length ? pipelineStages : preset.pipelineStages,
    terminology:
      r["terminology"] && typeof r["terminology"] === "object"
        ? (Object.fromEntries(
            Object.entries(r["terminology"] as Record<string, unknown>).filter(
              ([, v]) => typeof v === "string",
            ),
          ) as Record<string, string>)
        : preset.terminology,
    dashboardWidgets: widgets.length ? widgets : preset.dashboardWidgets,
    automations: automations.length ? automations : preset.automations,
    // Preset identity is server-owned; AI output can never re-point a business at another preset.
    ...(preset.presetId ? { presetId: preset.presetId } : {}),
  };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? (fenced[1] ?? text) : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI javobida JSON topilmadi");
  return JSON.parse(candidate.slice(start, end + 1));
}

/* ------------------------------------------------------------------ */
/* Server functions                                                    */
/* ------------------------------------------------------------------ */

export const getMyCrmConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const businessId = await requireBusinessId(context.supabase);
    const [{ data: row }, { data: business }, { data: role }, branchCount] = await Promise.all([
      context.supabase
        .from("crm_configs")
        .select("industry, business_description, config")
        .eq("business_id", businessId)
        .maybeSingle(),
      context.supabase.from("businesses").select("name").eq("id", businessId).maybeSingle(),
      context.supabase.rpc("business_role", { _business_id: businessId }),
      context.supabase.from("branches").select("id", { count: "exact", head: true }).eq("business_id", businessId),
    ]);
    return {
      hasConfig: !!row,
      businessId,
      businessName: business?.name ?? null,
      industry: row?.industry ?? null,
      role: (role ?? null) as MemberRole | null,
      branchCount: branchCount.count ?? 0,
      businessDescription: row?.business_description ?? null,
      config: row ? attachPresetId(row.industry, applyRelations(row.industry, row.config as unknown as CrmConfigData)) : null,
    };
  });

/** Relation search inside the caller's own business (RLS + explicit business filter). */
export const searchRelatedRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ targetModule: z.string().min(1), search: z.string().max(100).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requireBusinessId(context.supabase);
    const term = (data.search ?? "").replace(/[%,()]/g, " ").trim();
    if (data.targetModule === "customers") {
      let q = context.supabase
        .from("customers")
        .select("id, full_name, phone, telegram_username")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (term) q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,telegram_username.ilike.%${term}%`);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      return (rows ?? []).map((r) => ({
        id: r.id,
        label: r.full_name || r.telegram_username || r.phone || "—",
        hint: r.phone ?? null,
      }));
    }
    if (data.targetModule === "employees") {
      // Shifokor/usta — yadro obyekti: CRM moduli emas, xodimlar jadvalidan olinadi.
      let q = context.supabase
        .from("employees")
        .select("id, full_name, position")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(20);
      if (term) q = q.or(`full_name.ilike.%${term}%,position.ilike.%${term}%`);
      const { data: staffRows, error: staffError } = await q;
      if (staffError) throw new Error(staffError.message);
      return (staffRows ?? []).map((r) => ({ id: r.id, label: r.full_name, hint: r.position || null }));
    }
    const crm = await tenantCrm(context.supabase);
    const module = await requireModuleAccess(context.supabase, businessId, crm.config, data.targetModule);
    const table = backedTableOf(module);
    if (table) {
      // Yadro jadvalidagi modul (to'lov/qabul) variantlari shu jadvaldan olinadi.
      const labelColumn = table === "payments" ? "note" : "service_name";
      const { data: rows, error } = await context.supabase
        .from(table)
        .select(`id, ${labelColumn}, customers:customer_id(full_name)`)
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return (rows ?? []).map((r: any) => ({
        id: r.id,
        label: r.customers?.full_name || r[labelColumn] || "—",
        hint: null as string | null,
      }));
    }
    let q = context.supabase
      .from("crm_records")
      .select("id, title")
      .eq("business_id", businessId)
      .eq("module_key", data.targetModule)
      .order("created_at", { ascending: false })
      .limit(20);
    if (term) q = q.ilike("title", `%${term}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({ id: r.id, label: r.title, hint: null as string | null }));
  });

function linkedValues(raw: unknown): Record<string, string | null> {
  const source = (raw ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value === null || value === undefined ? null : String(value)]),
  );
}

export interface CustomerLinkedRecord {
  id: string;
  title: string;
  stage: string | null;
  created_at: string;
  moduleKey: string;
  moduleLabel: string;
  data: Record<string, string | null>;
}

/** Dynamic-module records linked to a customer (via any relation field). */
export const listCustomerLinkedRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ customerId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CustomerLinkedRecord[]> => {
    const businessId = await requireBusinessId(context.supabase);
    const { data: cfgRow } = await context.supabase
      .from("crm_configs")
      .select("industry, config")
      .eq("business_id", businessId)
      .maybeSingle();
    if (!cfgRow) return [];
    const cfg = attachPresetId(cfgRow.industry, applyRelations(cfgRow.industry, cfgRow.config as unknown as CrmConfigData));
    const presetId = resolvePresetId(null, cfg.presetId);
    // The linked-records panel would otherwise leak diagnoses to roles that cannot open
    // the medical modules themselves.
    const maySeeMedical = await memberMayViewMedical(context.supabase, businessId, presetId);
    const filters: { moduleKey: string; moduleLabel: string; idKey: string }[] = [];
    for (const m of cfg.modules) {
      if (m.link) continue;
      if (!maySeeMedical && isMedicalModule(presetId, m.key)) continue;
      for (const f of m.fields ?? []) {
        if (f.type === "relation" && f.targetModule === "customers") {
          filters.push({ moduleKey: m.key, moduleLabel: m.label, idKey: `${f.key}_id` });
        }
      }
    }
    if (filters.length === 0) return [];
    const results = await Promise.all(
      filters.map(async (f) => {
        const linkedModule = cfg.modules.find((m) => m.key === f.moduleKey);
        const table = backedTableOf(linkedModule);
        if (linkedModule && table) {
          // To'lov/qabul yozuvlari yadro jadvalida — bog'lash customer_id ustuni bo'yicha.
          const backed = await listBackedRecords(context.supabase, businessId, linkedModule);
          return backed
            .filter((r) => String(r.data?.[f.idKey] ?? "") === data.customerId)
            .slice(0, 50)
            .map((r) => ({
              id: r.id,
              title: r.title,
              stage: r.stage,
              created_at: r.created_at,
              moduleKey: f.moduleKey,
              moduleLabel: f.moduleLabel,
              data: linkedValues(r.data),
            }));
        }
        const { data: rows } = await context.supabase
          .from("crm_records")
          .select("id, title, stage, created_at, data")
          .eq("business_id", businessId)
          .eq("module_key", f.moduleKey)
          .contains("data", { [f.idKey]: data.customerId } as never)
          .order("created_at", { ascending: false })
          .limit(50);
        return (rows ?? []).map((r) => ({
          id: r.id,
          title: r.title,
          stage: r.stage,
          created_at: r.created_at,
          moduleKey: f.moduleKey,
          moduleLabel: f.moduleLabel,
          data: linkedValues(r.data),
        }));
      }),
    );
    const seen = new Set<string>();
    return results
      .flat()
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  });

/** Exported for tests: onboarding must not force a business description. */
export const generateInput = z.object({
  industryKey: z.string().min(1),
  industryOther: z.string().optional(),
  /** Sub-preset inside an industry (e.g. barbershop inside beauty). */
  presetId: z.string().min(1).optional(),
  /** Optional: onboarding can be finished later, the industry preset stands on its own. */
  businessDescription: z.string().max(4000).optional(),
  businessName: z.string().optional(),
  currency: z.string().min(1).max(8).optional(),
  workingHours: z.string().max(120).optional(),
});

// business_settings is inserted with these non-empty column defaults, so "empty" alone cannot
// tell an untouched tenant from one that kept the shipped value. Mirrors src/db/schema.ts.
const SHIPPED_CURRENCY = "UZS";
const SHIPPED_WORKING_HOURS = "09:00 - 20:00";

/**
 * Settings the onboarding wizard should seed. What the owner typed is a real edit and always wins;
 * preset defaults only replace values nobody has touched, so re-running onboarding never overwrites
 * hours or currency chosen in Settings.
 */
export function settingsSeedPatch(
  typed: { description: string; currency?: string | undefined; workingHours?: string | undefined },
  stored: {
    business_description?: string | null;
    currency?: string | null;
    working_hours?: string | null;
  },
  defaults: PresetDefaults | undefined,
): Record<string, string> {
  const untouched = (value: string | null | undefined, shipped: string) => {
    const trimmed = value?.trim();
    return !trimmed || trimmed === shipped;
  };
  const patch: Record<string, string> = {};
  const currency = typed.currency?.trim();
  const hours = typed.workingHours?.trim();
  if (typed.description && !stored.business_description?.trim()) patch["business_description"] = typed.description;
  if (currency) patch["currency"] = currency;
  else if (defaults && untouched(stored.currency, SHIPPED_CURRENCY)) patch["currency"] = defaults.currency;
  if (hours) patch["working_hours"] = hours;
  else if (defaults && untouched(stored.working_hours, SHIPPED_WORKING_HOURS)) {
    patch["working_hours"] = `${defaults.workStart}–${defaults.workEnd}`;
  }
  return patch;
}

export const generateCrmConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => generateInput.parse(input))
  .handler(async ({ data, context }) => {
    const businessId = await requireSettingsAdmin(context.supabase);
    const preset = presetForIndustry(data.industryKey);
    const presetId = resolvePresetId(data.industryKey, data.presetId);
    const registryPreset = presetForId(presetId);
    const defaults = registryPreset?.defaults;
    const industryLabel =
      data.industryKey === "boshqa"
        ? (data.industryOther?.trim() || "Boshqa soha")
        : data.industryKey;
    const description = data.businessDescription?.trim() ?? "";

    let config = preset;
    let aiError: string | null = null;
    try {
      const runtime = resolveAiRuntime();
      if ("error" in runtime) throw new Error(runtime.error);
      const prompt = [
        "Siz CRM konfiguratsiya dizaynerisiz. Foydalanuvchi biznesini tavsifladi.",
        `Soha: ${industryLabel}`,
        `Biznes tavsifi: ${description || "Tavsif berilmagan — soha bo‘yicha standart konfiguratsiyani saqlang."}`,
        "",
        "Quyidagi boshlang'ich konfiguratsiyani ushbu biznesga moslab, FAQAT JSON qaytaring.",
        "Qoidalar:",
        "- modules: har bir obyektda key (lotin-harflar, chiziqcha), label (o'zbekcha), ixtiyoriy icon, link (faqat mavjud sahifalar uchun: /dashboard/customers, /dashboard/orders, /dashboard/inventory, /dashboard/products), pipeline (true — pipeline bosqichlari qo'llaniladigan modul), fields (universal modullar uchun maydonlar: key, label, type: text|phone|number|money|date|time|select|textarea, ixtiyoriy required, select uchun options).",
        "- pipelineStages: savdo/qiziqish oqimi bosqichlari nomlari o'zbekcha.",
        "- terminology: customer/lead/order uchun ushbu biznesdagi atamalar.",
        "- dashboardWidgets: widgetlar (key, label, kind: module_count|module_count_today|field_sum|legacy_today_revenue|legacy_today_orders|legacy_handoffs, universal widgetlar uchun moduleKey, field_sum uchun fieldKey, ixtiyoriy where: {field, value}).",
        "- 5-8 ta widget yetarli. 6-10 ta modul yetarli.",
        "Boshlang'ich konfiguratsiya:",
        JSON.stringify(preset),
      ].join("\n");
      const result = await generateText({
        model: runtime.model(runtime.defaultModel),
        prompt,
        maxOutputTokens: 3000,
      });
      void logAiUsage({
        businessId,
        userId: context.userId,
        feature: "crm_builder",
        model: runtime.defaultModel,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
      });
      config = normalizeConfig(extractJson(result.text), preset);
    } catch (error) {
      // AI unavailable → the industry preset is already a complete, working CRM.
      aiError = error instanceof Error ? error.message : "AI sozlash xatosi";
    }

    const finalConfig = attachPresetId(industryLabel, { ...config, presetId });

    const upsert = {
      business_id: businessId,
      industry: industryLabel,
      business_description: description,
      config: finalConfig as never,
    };
    const { error } = await context.supabase
      .from("crm_configs")
      .upsert(upsert, { onConflict: "business_id" });
    if (error) throw new Error(error.message);

    // Preset defaults only fill settings the tenant has not set yet — never overwrite real edits.
    const { data: currentSettings } = await context.supabase
      .from("business_settings")
      .select("business_description, currency, working_hours")
      .eq("business_id", businessId)
      .maybeSingle();
    const patch = settingsSeedPatch(
      { description, currency: data.currency, workingHours: data.workingHours },
      currentSettings ?? {},
      defaults,
    );
    if (Object.keys(patch).length) {
      await context.supabase.from("business_settings").update(patch as never).eq("business_id", businessId);
    }

    if (data.businessName?.trim()) {
      const name = data.businessName.trim();
      await context.supabase.from("businesses").update({ name }).eq("id", businessId);
      await context.supabase
        .from("business_settings")
        .update({ business_name: name })
        .eq("business_id", businessId);
    }

    invalidateCrmAgentContext(businessId);
    return { config: finalConfig, aiError };
  });

export const updateCrmConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ config: z.unknown() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requireSettingsAdmin(context.supabase);
    const { data: row } = await context.supabase
      .from("crm_configs")
      .select("industry, config")
      .eq("business_id", businessId)
      .maybeSingle();
    if (!row) throw new Error("CRM konfiguratsiyasi topilmadi");
    const normalized = attachPresetId(
      row.industry,
      normalizeConfig(data.config, row.config as unknown as CrmConfigData),
    );
    const { error } = await context.supabase
      .from("crm_configs")
      .update({ config: normalized as never })
      .eq("business_id", businessId);
    if (error) throw new Error(error.message);
    invalidateCrmAgentContext(businessId);
    return { config: normalized };
  });

export interface OrphanedModule {
  moduleKey: string;
  label: string;
  recordCount: number;
}

const switchPresetInput = z.object({ presetId: z.string().min(1) });

/**
 * Re-point the tenant at another preset (brief §7.1). Structure changes; data never does:
 * crm_records/customers/appointments stay, modules the new preset drops are counted and
 * reported so the admin knows where the old rows live.
 */
export const switchCrmPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => switchPresetInput.parse(input))
  .handler(async ({ data, context }): Promise<{ config: CrmConfigData; orphans: OrphanedModule[] }> => {
    const businessId = await requireSettingsAdmin(context.supabase);
    const target: IndustryPreset | undefined = presetForId(data.presetId);
    if (!target) throw new Error("Bunday biznes turi mavjud emas.");

    const { data: row, error: loadError } = await context.supabase
      .from("crm_configs")
      .select("industry, config")
      .eq("business_id", businessId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!row) throw new Error("CRM konfiguratsiyasi topilmadi");

    const previous = attachPresetId(row.industry, applyRelations(row.industry, row.config as unknown as CrmConfigData));
    const next = attachPresetId(target.industryKey, {
      ...crmConfigForPreset(target.id),
      presetId: target.id,
    });

    const dropped = droppedModulesForPreset(previous, target.id);
    const orphans: OrphanedModule[] = [];
    if (dropped.length) {
      const counts = await Promise.all(
        dropped.map(async (module) => {
          const { count } = await context.supabase
            .from("crm_records")
            .select("id", { count: "exact", head: true })
            .eq("business_id", businessId)
            .eq("module_key", module.key);
          return { moduleKey: module.key, label: module.label, recordCount: count ?? 0 };
        }),
      );
      orphans.push(...counts.filter((c) => c.recordCount > 0));
    }

    // A custom industry label only survives while the tenant stays on the universal preset.
    const industry = target.industryKey === "boshqa" ? row.industry : target.industryKey;
    const { error } = await context.supabase
      .from("crm_configs")
      .update({ industry, config: next as never })
      .eq("business_id", businessId);
    if (error) throw new Error(error.message);

    invalidateCrmAgentContext(businessId);
    return { config: next, orphans };
  });

const syncInput = z.object({ presetId: z.string().min(1).optional() });

/**
 * Append registry modules, widgets and module fields a stored config predates. Additive
 * only: existing modules, field order and every crm_records row stay untouched, so an
 * admin who deleted a module keeps it deleted until they ask for the sync.
 */
export const syncPresetModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => syncInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<{
    config: CrmConfigData;
    addedModules: string[];
    addedWidgets: string[];
    addedFields: string[];
  }> => {
    const businessId = await requireSettingsAdmin(context.supabase);
    const { data: row, error: loadError } = await context.supabase
      .from("crm_configs")
      .select("industry, config")
      .eq("business_id", businessId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!row) throw new Error("CRM konfiguratsiyasi topilmadi");

    const current = attachPresetId(row.industry, applyRelations(row.industry, row.config as unknown as CrmConfigData));
    const presetId = data.presetId ?? current.presetId ?? resolvePresetId(row.industry);
    const { config: next, missing } = applyMissingParts(current, presetId);
    if (
      missing.modules.length === 0 &&
      missing.widgets.length === 0 &&
      missing.fields.length === 0
    ) {
      return { config: current, addedModules: [], addedWidgets: [], addedFields: [] };
    }

    const { error } = await context.supabase
      .from("crm_configs")
      .update({ config: next as never })
      .eq("business_id", businessId);
    if (error) throw new Error(error.message);

    invalidateCrmAgentContext(businessId);
    return {
      config: next,
      addedModules: missing.modules.map((m) => m.label),
      addedWidgets: missing.widgets.map((w) => w.label),
      addedFields: missing.fields.flatMap((entry) => entry.fields.map((f) => f.label)),
    };
  });

const builderInput = z.object({ message: z.string().min(1) });

export const aiCrmBuilder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => builderInput.parse(input))
  .handler(async ({ data, context }) => {
    const businessId = await requireSettingsAdmin(context.supabase);
    const { data: row } = await context.supabase
      .from("crm_configs")
      .select("industry, config")
      .eq("business_id", businessId)
      .maybeSingle();
    if (!row) throw new Error("Avval CRMni sozlang");

    const current = row.config as unknown as CrmConfigData;
    const runtime = resolveAiRuntime();
    if ("error" in runtime) throw new Error(runtime.error);

    const prompt = [
      "Siz CRM konfiguratsiya muharririsiz. Foydalanuvchi oddiy o'zbek tilida CRMni o'zgartirishni so'raydi.",
      `Soha: ${row.industry}`,
      "Joriy konfiguratsiya:",
      JSON.stringify(current),
      "",
      "Buyruqni bajaring va FAQAT JSON qaytaring:",
      "'{ \"reply\": \"nima qilinganini bitta-gapda o`zbekcha tushuntiring\", \"config\": { yangilangan to`liq konfiguratsiya } }'",
      "Konfiguratsiya strukturasi joriy bilan bir xil: modules (key, label, icon, link, pipeline, fields), pipelineStages, terminology, dashboardWidgets (key, label, kind: module_count|module_count_today|field_sum|legacy_today_revenue|legacy_today_orders|legacy_today_leads|legacy_hot_leads|legacy_handoffs, moduleKey, fieldKey, where), automations.",
      "Faqat so'ralgan o'zgarishni qiling, qolganini o'zgartirmang.",
    ].join("\n");

    const result = await generateText({
      model: runtime.model(runtime.defaultModel),
      prompt,
      maxOutputTokens: 3000,
    });
    void logAiUsage({
      businessId,
      userId: context.userId,
      feature: "crm_agent",
      model: runtime.defaultModel,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
    });
    const parsed = extractJson(result.text) as { reply?: unknown; config?: unknown };
    const reply = typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply : "CRM yangilandi.";
    const config = attachPresetId(row.industry, normalizeConfig(parsed.config, current));

    const { error } = await context.supabase
      .from("crm_configs")
      .update({ config: config as never })
      .eq("business_id", businessId);
    if (error) throw new Error(error.message);
    invalidateCrmAgentContext(businessId);
    return { reply, config };
  });

/* ------------------------- crm_records CRUD ------------------------ */

export const listCrmRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ moduleKey: z.string().min(1), search: z.string().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { businessId, config } = await tenantCrm(context.supabase);
    const module = await requireModuleAccess(context.supabase, businessId, config, data.moduleKey);
    auditMedicalAccess(config, businessId, data.moduleKey, "medical.records_listed");
    const table = backedTableOf(module);
    if (table) {
      // To'lov/qabul modullari yadro jadvalida yashaydi: ular Ish ekrani, Moliya va
      // kalendar bilan bir xil qatorlarni ko'rsin.
      const rows = await listBackedRecords(context.supabase, businessId, module);
      const term = (data.search ?? "").toLowerCase();
      return term ? rows.filter((row) => row.title.toLowerCase().includes(term)) : rows;
    }
    let query = context.supabase
      .from("crm_records")
      .select("*")
      .eq("business_id", businessId)
      .eq("module_key", data.moduleKey)
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.search) query = query.ilike("title", `%${data.search}%`);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows;
  });

const recordInput = z.object({
  id: z.string().optional(),
  moduleKey: z.string().min(1),
  title: z.string().min(1),
  stage: z.string().nullable().optional(),
  data: z.record(z.string(), z.unknown()),
});

export const saveCrmRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => recordInput.parse(input))
  .handler(async ({ data, context }) => {
    const { businessId, config } = await tenantCrm(context.supabase);
    const module = await requireModuleAccess(context.supabase, businessId, config, data.moduleKey, true);
    const table = backedTableOf(module);
    if (table) {
      const saved = await saveBackedRecord(context.supabase, {
        businessId,
        userId: context.userId,
        module,
        id: data.id,
        data: data.data,
      });
      auditMedicalAccess(config, businessId, data.moduleKey, "medical.record_saved", { recordId: saved.id });
      return saved;
    }
    const payload = {
      business_id: businessId,
      module_key: data.moduleKey,
      title: data.title,
      stage: data.stage ?? null,
      data: data.data as never,
    };
    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("crm_records")
        .update(payload)
        .eq("id", data.id)
        .eq("business_id", businessId)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!updated) throw new Error("Yozuv topilmadi yoki bu biznesga tegishli emas.");
      auditMedicalAccess(config, businessId, data.moduleKey, "medical.record_saved", { recordId: updated.id });
      return { id: updated.id };
    }
    const { data: row, error } = await context.supabase
      .from("crm_records")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    auditMedicalAccess(config, businessId, data.moduleKey, "medical.record_saved", { recordId: row.id });
    return { id: row.id };
  });

export const deleteCrmRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string(), moduleKey: z.string().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { businessId, config } = await tenantCrm(context.supabase);

    // Modul nomlanganda yozuv qayerda yashaganini o'sha joydan bilib olamiz.
    const module = data.moduleKey
      ? await requireModuleAccess(context.supabase, businessId, config, data.moduleKey, true)
      : null;
    const table = backedTableOf(module ?? undefined);
    if (module && table) {
      const removed = await deleteBackedRecord(context.supabase, businessId, table, data.id);
      if (!removed) throw new Error("Yozuv topilmadi yoki bu biznesga tegishli emas.");
      auditMedicalAccess(config, businessId, module.key, "medical.record_deleted", { recordId: data.id });
      return { ok: true };
    }

    // The caller only names an id, so the owning module must be read back before deleting.
    const { data: target, error: findError } = await context.supabase
      .from("crm_records")
      .select("module_key")
      .eq("id", data.id)
      .eq("business_id", businessId)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (!target) throw new Error("Yozuv topilmadi yoki bu biznesga tegishli emas.");
    await requireModuleAccess(context.supabase, businessId, config, target.module_key, true);
    const { data: deleted, error } = await context.supabase
      .from("crm_records")
      .delete()
      .eq("id", data.id)
      .eq("business_id", businessId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!deleted?.length) throw new Error("Yozuv topilmadi yoki bu biznesga tegishli emas.");
    auditMedicalAccess(config, businessId, target.module_key, "medical.record_deleted", { recordId: data.id });
    return { ok: true };
  });

/**
 * Bog'langan modullarning yozuvlari `crm_records`da emas, yadro jadvalida yashaydi.
 * Vidget sanovi shu jadvaldan olinadi, aks holda "Bemorlar / Faol o'quvchilar"
 * hech qachon 0 dan chiqmaydi.
 */
const LINKED_COUNT_TABLE: Partial<Record<CrmModuleLink, string>> = {
  "/dashboard/customers": "customers",
  "/dashboard/orders": "orders",
  "/dashboard/leads": "leads",
  "/dashboard/products": "products",
  "/dashboard/attendance": "attendance",
  "/dashboard/services": "services",
  "/dashboard/employees": "employees",
};

export const getWidgetStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const businessId = await requireBusinessId(context.supabase);
    const { data: row } = await context.supabase
      .from("crm_configs")
      .select("industry, config")
      .eq("business_id", businessId)
      .maybeSingle();
    if (!row) return { widgets: {} as Record<string, number> };

    const cfg = applyRelations(row.industry, row.config as unknown as CrmConfigData);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const stats: Record<string, number> = {};
    const sb = context.supabase;

    await Promise.all(
      cfg.dashboardWidgets.map(async (widget) => {
        try {
          if (
            widget.kind === "module_count" ||
            widget.kind === "module_count_today" ||
            widget.kind === "field_sum"
          ) {
            if (!widget.moduleKey) return;
            const linkedModule = cfg.modules.find((m) => m.key === widget.moduleKey);
            if (linkedModule) {
              const table = widgetTableOf(linkedModule);
              if (table) {
                stats[widget.key] = await backedWidgetValue(sb, businessId, linkedModule, widget.kind, {
                  where: widget.where,
                  todayStart: todayStart.toISOString(),
                  todayEnd: todayEnd.toISOString(),
                });
                return;
              }
            }
            const linkedTable = linkedModule?.link ? LINKED_COUNT_TABLE[linkedModule.link] : undefined;
            if (linkedTable && widget.kind !== "field_sum") {
              let linkedQuery = sb.from(linkedTable).select("id").eq("business_id", businessId);
              if (widget.kind === "module_count_today") {
                linkedQuery = linkedQuery.gte("created_at", todayStart.toISOString());
              }
              const { data: linkedRows, error: linkedError } = await linkedQuery;
              if (linkedError) return;
              stats[widget.key] = linkedRows?.length ?? 0;
              return;
            }
            let query = sb.from("crm_records").select(widget.kind === "field_sum" ? "data" : "id");
            if (widget.kind === "field_sum") query = query.limit(1000);
            query = query.eq("business_id", businessId).eq("module_key", widget.moduleKey);
            if (widget.where) query = query.eq(`data->>${widget.where.field}`, widget.where.value);
            if (widget.kind === "module_count_today") query = query.gte("created_at", todayStart.toISOString());
            const { data: rows, error } = await query;
            if (error) return;
            if (widget.kind === "field_sum") {
              const sum = (rows as { data: Record<string, unknown> }[]).reduce((acc, r) => {
                const v = Number(r.data?.[widget.fieldKey ?? ""]);
                return Number.isFinite(v) ? acc + v : acc;
              }, 0);
              stats[widget.key] = Math.round(sum * 100) / 100;
            } else {
              stats[widget.key] = rows?.length ?? 0;
            }
            return;
          }
          if (widget.kind === "legacy_today_revenue") {
            // Tushum — `payments` jadvalidan (KPI kartasi bilan bitta manba).
            // `orders` faqat savdo moduli bor sohalarda to'ldiriladi.
            const { data: rows } = await sb
              .from("payments")
              .select("amount")
              .eq("business_id", businessId)
              .in("status", ["paid", "partial"])
              .gte("paid_at", todayStart.toISOString());
            stats[widget.key] = (rows ?? []).reduce((acc, r) => acc + Number(r.amount), 0);
            return;
          }
          if (widget.kind === "legacy_today_orders") {
            const { count } = await sb
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("business_id", businessId)
              .gte("created_at", todayStart.toISOString());
            stats[widget.key] = count ?? 0;
            return;
          }
          if (widget.kind === "legacy_today_leads") {
            const { count } = await sb
              .from("leads")
              .select("id", { count: "exact", head: true })
              .eq("business_id", businessId)
              .gte("created_at", todayStart.toISOString());
            stats[widget.key] = count ?? 0;
            return;
          }
          if (widget.kind === "legacy_hot_leads") {
            const { count } = await sb
              .from("leads")
              .select("id", { count: "exact", head: true })
              .eq("business_id", businessId)
              .eq("score", "hot");
            stats[widget.key] = count ?? 0;
            return;
          }
          if (widget.kind === "legacy_handoffs") {
            const { count } = await sb
              .from("leads")
              .select("id", { count: "exact", head: true })
              .eq("business_id", businessId)
              .eq("status", "needs_attention");
            stats[widget.key] = count ?? 0;
          }
        } catch {
          // Widget stats must never break the dashboard.
        }
      }),
    );
    return { widgets: stats };
  });

/* ------------------------- record attachments ---------------------- */

/** Private bucket — the object is only ever opened through a short-lived signed URL. */
export const ATTACHMENT_BUCKET = "crm_attachments";
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ATTACHMENT_SUFFIX: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/tiff": "tif",
  "application/pdf": "pdf",
};

const attachmentPathInput = z.object({
  moduleKey: z.string().min(1),
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(80),
  size: z.number().int().nonnegative(),
});

/**
 * `{business}/{module}/{id}/{name}` — the first segment is the tenant boundary storage RLS reads,
 * so it comes from the session, never from the upload. The extension follows the declared content
 * type instead of the name the browser sent.
 */
export function attachmentObjectPath(input: {
  businessId: string;
  moduleKey: string;
  filename: string;
  contentType: string;
  id: string;
}): string | null {
  const suffix = ATTACHMENT_SUFFIX[input.contentType];
  if (!suffix) return null;
  const name =
    input.filename
      .replace(/[^\p{L}\d ._-]/gu, "")
      .replace(/^\.+/, "")
      // The real extension is appended from the content type, so any claimed one goes first.
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .trim()
      .slice(0, 80) || "hujjat";
  return `${input.businessId}/${input.moduleKey}/${input.id}/${name}.${suffix}`;
}

/**
 * The server names the object path: a client cannot aim an upload at another tenant. Medical
 * modules keep the same gate as their records — an unauthorised member cannot store files either.
 */
export const issueCrmAttachmentPath = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => attachmentPathInput.parse(input))
  .handler(async ({ data, context }): Promise<{ path: string; name: string; uploadUrl: string }> => {
    const { businessId, config } = await tenantCrm(context.supabase);
    await requireModuleAccess(context.supabase, businessId, config, data.moduleKey, true);
    if (data.size > MAX_ATTACHMENT_BYTES) throw new Error("Fayl hajmi 15 MB dan oshmasin.");
    const path = attachmentObjectPath({
      businessId,
      moduleKey: data.moduleKey,
      filename: data.filename,
      contentType: data.contentType,
      id: crypto.randomUUID(),
    });
    if (!path) throw new Error("Faqat PDF, PNG, JPG, WEBP yoki TIFF fayl biriktirish mumkin.");
    const { signedUploadUrl } = await import("./storage.server");
    const uploadUrl = await signedUploadUrl(ATTACHMENT_BUCKET, path, data.contentType, 300, data.size);
    return { path, name: path.split("/").pop() ?? path, uploadUrl };
  });

const attachmentUrlInput = z.object({ moduleKey: z.string().min(1), path: z.string().min(1).max(600) });

/** Opens an attachment: tenant + role checked first, then a 2-minute signed link. */
export const getCrmAttachmentUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => attachmentUrlInput.parse(input))
  .handler(async ({ data, context }): Promise<{ url: string; name: string }> => {
    const { businessId, config } = await tenantCrm(context.supabase);
    await requireModuleAccess(context.supabase, businessId, config, data.moduleKey);
    if (!data.path.startsWith(`${businessId}/`)) throw new Error("Bu fayl sizning biznesingizga tegishli emas.");
    const { signedDownloadUrl } = await import("./storage.server");
    const url = await signedDownloadUrl(ATTACHMENT_BUCKET, data.path, 120);
    auditMedicalAccess(config, businessId, data.moduleKey, "medical.file_opened", { path: data.path });
    return { url, name: data.path.split("/").pop() ?? data.path };
  });

const attachmentRemoveInput = z.object({
  moduleKey: z.string().min(1),
  paths: z.array(z.string().min(1).max(600)).max(20),
});

/** Deletes replaced or orphaned attachments; the module gate and tenant prefix are re-checked. */
export const removeCrmAttachments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => attachmentRemoveInput.parse(input))
  .handler(async ({ data, context }): Promise<{ removed: number }> => {
    const { businessId, config } = await tenantCrm(context.supabase);
    await requireModuleAccess(context.supabase, businessId, config, data.moduleKey, true);
    const owned = data.paths.filter((path) => path.startsWith(`${businessId}/`));
    if (!owned.length) return { removed: 0 };
    const { deleteObjects } = await import("./storage.server");
    await deleteObjects(ATTACHMENT_BUCKET, owned, context.userId);
    return { removed: owned.length };
  });

export interface MedicalAuditEvent {
  id: string;
  created_at: string;
  action: string;
  actor_email: string | null;
  module_key: string | null;
  module_label: string | null;
  record_id: string | null;
  status: string;
}

/**
 * The patient-data journal the brief asks for: who read, wrote or opened which medical module.
 * RLS already limits an authenticated reader to their own business' `medical.*` rows and only for
 * its admins; this function repeats the check so a non-admin gets a clear refusal, not an empty list.
 */
export const listMedicalAuditEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MedicalAuditEvent[]> => {
    const businessId = await requireSettingsAdmin(context.supabase);
    const { data: rows, error } = await context.supabase
      .from("audit_logs")
      .select("id, created_at, action, actor_email, target_id, target_label, status, metadata")
      .eq("business_id", businessId)
      .like("action", "medical.%")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        created_at: row.created_at,
        action: row.action,
        actor_email: row.actor_email ?? null,
        module_key: row.target_id ?? null,
        module_label: row.target_label ?? null,
        record_id: typeof meta["recordId"] === "string" ? meta["recordId"] : null,
        status: row.status,
      };
    });
  });
