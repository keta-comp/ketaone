// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { INDUSTRY_PRESETS, isCoreRelationTarget } from "@/lib/crm-config";
import { quickActionLabels } from "@/lib/crm-core";
import en from "@/lib/i18n/en";
import kaa from "@/lib/i18n/kaa";
import ru from "@/lib/i18n/ru";
import {
  INDUSTRIES,
  PRESETS,
  SUB_PRESETS,
  applyMissingParts,
  attachPresetId,
  coreTerm,
  crmConfigForPreset,
  droppedModulesForPreset,
  enabledModuleKeys,
  hiddenRoutesForPreset,
  isModuleEnabled,
  isSectionVisible,
  menuForPreset,
  medicalModuleKeys,
  missingPresetParts,
  presetForId,
  resolvePresetId,
  termsForPreset,
  workflowForPreset,
} from "@/lib/presets";

const ROUTES_DIR = fileURLToPath(new URL("../routes/_authenticated/", import.meta.url));

function routeFile(to) {
  const parts = to.replace(/^\/dashboard/, "").split("/").filter(Boolean);
  if (!parts.length) return "dashboard.index.tsx";
  if (parts[0] === "crm") return "dashboard.crm.$moduleKey.tsx";
  return `dashboard.${parts.join(".")}.tsx`;
}

const PRESET_IDS = Object.keys(PRESETS);

describe("preset registry", () => {
  test("every industry option maps to a preset with data", () => {
    expect(INDUSTRIES.length).toBe(11);
    for (const option of INDUSTRIES) {
      const preset = presetForId(resolvePresetId(option.key));
      expect(preset?.industryKey).toBe(option.key);
      expect(preset?.name).toBe(option.label);
      expect(preset?.emoji).toBe(option.emoji);
      expect(crmConfigForPreset(preset.id).modules.length).toBeGreaterThan(0);
    }
  });

  test("sub-presets reuse their parent module payload", () => {
    const barbershop = presetForId("barbershop");
    expect(barbershop?.industryKey).toBe("beauty");
    expect(barbershop?.parentId).toBe("beauty");
    expect(SUB_PRESETS["beauty"]?.map((p) => p.id)).toEqual(["barbershop"]);
    expect(INDUSTRIES.some((i) => i.key === "barbershop")).toBe(false);
  });

  test("presetId resolves explicitly first, then by industry", () => {
    expect(resolvePresetId("beauty", "barbershop")).toBe("barbershop");
    expect(resolvePresetId("beauty", "nomalum")).toBe("beauty");
    expect(resolvePresetId("beauty")).toBe("beauty");
    expect(resolvePresetId("Boshqa soha")).toBe("universal");
    expect(resolvePresetId(null)).toBe("universal");
  });

  test("attachPresetId fills legacy configs and is idempotent", () => {
    const legacy = { modules: [], pipelineStages: [], terminology: {}, dashboardWidgets: [], automations: [] };
    const attached = attachPresetId("stomatologiya", legacy);
    expect(attached.presetId).toBe("stomatologiya");
    expect(attachPresetId("stomatologiya", attached)).toBe(attached);
    expect(attachPresetId("beauty", { ...attached, presetId: "barbershop" }).presetId).toBe("barbershop");
  });

  test("menu routes exist and never duplicate", () => {
    for (const id of PRESET_IDS) {
      const menu = menuForPreset(id);
      const seen = new Set();
      for (const item of menu) {
        expect(item.to.startsWith("/dashboard")).toBe(true);
        expect(seen.has(item.to)).toBe(false);
        seen.add(item.to);
        expect(existsSync(`${ROUTES_DIR}${routeFile(item.to)}`)).toBe(true);
      }
    }
  });

  test("core entry points stay in the menu unless the preset switches them off", () => {
    const required = [
      "/dashboard/customers",
      "/dashboard/orders",
      "/dashboard/products",
    ];
    for (const id of PRESET_IDS) {
      const menu = menuForPreset(id);
      const hidden = hiddenRoutesForPreset(id);
      expect(menu[0].to).toBe("/dashboard");
      for (const to of required) {
        expect(menu.some((item) => item.to === to)).toBe(!hidden.has(to));
      }
    }
  });

  // Murojaatlar bo'limi mahsulotdan butunlay olib tashlandi: hech bir preset ocholmaydi,
  // sahifa fayli mavjud emas, konfiguratsiyadagi link esa menyuga chiqmaydi.
  test("Murojaatlar hech qanday presetda qaytib ochilmaydi", () => {
    for (const id of PRESET_IDS) expect(hiddenRoutesForPreset(id).has("/dashboard/leads")).toBe(true);
    expect(existsSync(`${ROUTES_DIR}${routeFile("/dashboard/leads")}`)).toBe(false);
  });

  test("the industries the owner switched off really lost those sections", () => {
    for (const id of ["stomatologiya", "klinika", "oquv", "beauty", "barbershop"]) {
      expect(isSectionVisible(id, "/dashboard/orders")).toBe(false);
    }
    expect(isSectionVisible("oquv", "/dashboard/inventory")).toBe(false);
    expect(isSectionVisible("oquv", "/dashboard/customers")).toBe(true);
    expect(isSectionVisible("oquv", "/dashboard/leads")).toBe(false);
    expect(isSectionVisible("beauty", "/dashboard/leads")).toBe(false);
    expect(isSectionVisible("ecommerce", "/dashboard/orders")).toBe(true);
    expect(isSectionVisible("ecommerce", "/dashboard/inventory")).toBe(true);
    expect(isSectionVisible("universal", "/dashboard/inventory")).toBe(true);
  });

  test("every enabled module has a menu entry", () => {
    for (const id of PRESET_IDS) {
      const menu = menuForPreset(id);
      const targets = new Set(menu.map((item) => item.to));
      for (const module of crmConfigForPreset(id).modules) {
        if (!isModuleEnabled(id, module.key)) continue;
        expect(module.link ?? `/dashboard/crm/${module.key}`).toBeTruthy();
        expect(targets.has(module.link ?? `/dashboard/crm/${module.key}`)).toBe(true);
      }
      expect(enabledModuleKeys(id).length).toBe(
        crmConfigForPreset(id).modules.filter((m) => isModuleEnabled(id, m.key)).length,
      );
    }
  });

  test("workflow exposes the industry pipeline", () => {
    for (const id of PRESET_IDS) {
      const workflow = workflowForPreset(id);
      expect(workflow.pipelineStages.length).toBeGreaterThan(0);
      expect(workflow.appointmentStatuses).toContain("confirmed");
      expect(workflow.bookingLabel.length).toBeGreaterThan(0);
      expect(crmConfigForPreset(id).pipelineStages).toEqual(workflow.pipelineStages);
    }
  });

  test("menu labels are translated in every language", () => {
    for (const id of PRESET_IDS) {
      for (const item of menuForPreset(id)) {
        for (const table of [en, ru, kaa]) {
          expect(Object.prototype.hasOwnProperty.call(table, item.label)).toBe(true);
        }
      }
    }
  });

  test("module, field and widget labels are translated in every language", () => {
    const missing = [];
    for (const id of PRESET_IDS) {
      const config = crmConfigForPreset(id);
      const labels = new Set();
      for (const module of config.modules) {
        labels.add(module.label);
        for (const field of module.fields ?? []) {
          labels.add(field.label);
          // Select values are shown as-is in tables, boards and filters, so they need translations too.
          for (const option of field.options ?? []) labels.add(option);
        }
      }
      for (const widget of config.dashboardWidgets) labels.add(widget.label);
      for (const stage of config.pipelineStages) labels.add(stage);
      for (const label of labels) {
        for (const [name, table] of [["en", en], ["ru", ru], ["kaa", kaa]]) {
          if (!Object.prototype.hasOwnProperty.call(table, label)) missing.push(`${id}/${name}: ${label}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("patient-data modules are registry-known, menu-hidden and role-gated", () => {
    for (const id of PRESET_IDS) {
      const keys = medicalModuleKeys(id);
      const registryKeys = new Set(crmConfigForPreset(id).modules.map((m) => m.key));
      for (const key of keys) {
        expect(registryKeys.has(key)).toBe(true);
        const item = menuForPreset(id).find((entry) => entry.to === `/dashboard/crm/${key}`);
        expect(item?.permission).toBe("medical.view");
      }
      // Nothing else in the menu claims the medical permission.
      for (const item of menuForPreset(id)) {
        if (item.permission !== "medical.view") continue;
        expect(keys).toContain(item.to.replace("/dashboard/crm/", ""));
      }
    }
    expect(medicalModuleKeys("klinika").length).toBeGreaterThan(0);
    expect(medicalModuleKeys("universal")).toEqual([]);
  });

  test("sync proposes only registry parts a stored config predates", () => {
    for (const id of PRESET_IDS) {
      const fresh = attachPresetId(presetForId(id).industryKey, { ...crmConfigForPreset(id), presetId: id });
      expect(missingPresetParts(fresh, id)).toEqual({ modules: [], widgets: [], fields: [] });
    }

    // A config saved before the dental modules existed gets exactly the missing ones.
    const dental = crmConfigForPreset("stomatologiya");
    const stale = {
      ...dental,
      modules: dental.modules.filter((m) => m.key !== "odontogramma" && m.key !== "bemor_kartasi"),
      dashboardWidgets: dental.dashboardWidgets.filter(
        (w) => w.key !== "davolash_rejada" && w.key !== "davolash_davom",
      ),
    };
    const missing = missingPresetParts(stale, "stomatologiya");
    expect(missing.modules.map((m) => m.key)).toEqual(["odontogramma", "bemor_kartasi"]);
    expect(missing.widgets.map((w) => w.key)).toEqual(["davolash_rejada", "davolash_davom"]);
    expect(missingPresetParts(dental, "nomalum")).toEqual({ modules: [], widgets: [], fields: [] });
  });

  test("sync appends new fields to modules a tenant already has", () => {
    const dental = crmConfigForPreset("stomatologiya");
    const treatment = dental.modules.find((m) => m.key === "davolash");
    const shippedLater = ["tish", "muddat", "shifokor", "tolangan"];
    const before = {
      ...dental,
      presetId: "stomatologiya",
      modules: dental.modules.map((m) =>
        m.key === "davolash"
          ? { ...m, fields: (m.fields ?? []).filter((f) => !shippedLater.includes(f.key)) }
          : m,
      ),
    };
    const missing = missingPresetParts(before, "stomatologiya");
    expect(missing.fields.map((entry) => entry.moduleKey)).toEqual(["davolash"]);
    expect(missing.fields[0].fields.map((f) => f.key)).toEqual(shippedLater);

    // Applying keeps the module in place, preserves its own field order and only appends.
    const { config } = applyMissingParts(before, "stomatologiya");
    const after = config.modules.find((m) => m.key === "davolash");
    expect(after?.fields?.slice(0, -shippedLater.length).map((f) => f.key)).toEqual(
      (before.modules.find((m) => m.key === "davolash")?.fields ?? []).map((f) => f.key),
    );
    expect(after?.fields?.slice(-shippedLater.length).map((f) => f.key)).toEqual(shippedLater);
    expect(
      after?.fields?.filter((f) => shippedLater.includes(f.key)).map((f) => f.label),
    ).toEqual(treatment?.fields?.filter((f) => shippedLater.includes(f.key)).map((f) => f.label));
    expect(after?.link).toBe(treatment?.link);
    expect(config.modules.map((m) => m.key)).toEqual(dental.modules.map((m) => m.key));
  });

  test("switching presets only reports modules the target does not offer", () => {
    for (const from of PRESET_IDS) {
      const previous = attachPresetId(presetForId(from).industryKey, {
        ...crmConfigForPreset(from),
        presetId: from,
      });
      for (const to of PRESET_IDS) {
        const dropped = droppedModulesForPreset(previous, to);
        const offered = new Set(enabledModuleKeys(to));
        for (const module of dropped) expect(offered.has(module.key)).toBe(false);
        for (const module of previous.modules) {
          if (offered.has(module.key)) expect(dropped.some((d) => d.key === module.key)).toBe(false);
        }
        if (from === to) expect(dropped).toEqual([]);
      }
    }
  });

  test("a section page is named exactly like its menu entry", () => {
    for (const id of PRESET_IDS) {
      const menu = new Map(menuForPreset(id).map((item) => [item.to, item.label]));
      const terms = termsForPreset(id);
      for (const [key, term] of Object.entries(terms)) {
        const label = menu.get(`/dashboard/${key}`);
        // Bo'lim menyu yoki sahifasi bo'lmasa nom solishtirilmaydi (leads, yashirin modullar).
        if (!label) continue;
        expect(term.many).toBe(label);
        expect(term.one.length).toBeGreaterThan(0);
      }
    }
  });

  test("an o‘quvchi is not a client and a kurs is not a product", () => {
    expect(coreTerm("oquv", "products")).toEqual({ one: "Kurs", many: "Kurslar" });
    expect(coreTerm("oquv", "customers")).toEqual({ one: "O‘quvchi", many: "O‘quvchilar" });
    expect(coreTerm("oquv", "appointments").one).toBe("Sinov darsi");
    expect(coreTerm("stomatologiya", "customers")).toEqual({ one: "Bemor", many: "Bemorlar" });
    // Tibbiy sohalarda xizmatlar katalogi — /dashboard/services, products esa SKU'liqicha.
    expect(coreTerm("stomatologiya", "products")).toEqual({ one: "Mahsulot", many: "Mahsulotlar" });
    expect(coreTerm("stomatologiya", "employees")).toEqual({ one: "Shifokor", many: "Shifokorlar" });
    expect(coreTerm("klinika", "customers").one).toBe("Bemor");
    expect(coreTerm("klinika", "employees").one).toBe("Shifokor");
    expect(coreTerm("ecommerce", "products").one).toBe("Mahsulot");
    // Salon: katalog — xizmatlar (services), jamoa — ustalar; mahsulot sahifasi SKU'liqicha qoladi.
    expect(coreTerm("beauty", "employees")).toEqual({ one: "Usta", many: "Ustalar" });
    expect(coreTerm("barbershop", "employees").one).toBe("Sartarosh");
    expect(coreTerm("beauty", "products").one).toBe("Mahsulot");
    // Sohasiz/universal bizneslar umumiy shaklda qoladi, nomlashuvi yo‘q preset ham.
    expect(coreTerm("universal", "products").one).toBe("Xizmat yoki mahsulot");
    expect(coreTerm("nomalum", "customers")).toEqual({ one: "Mijoz", many: "Mijozlar" });
    expect(coreTerm(null, "customers").many).toBe("Mijozlar");
  });

  test("salon va sartaroshxona menyusi faqat haqiqiy sahifalardan quriladi", () => {
    for (const id of ["beauty", "barbershop"]) {
      const menu = menuForPreset(id);
      const targets = menu.map((item) => item.to);
      // Erkin matn modullari (qabul/xizmatlar/ustalar/tolovlar) yadroning o'z sahifasiga almashtirildi.
      expect(targets.filter((to) => to.startsWith("/dashboard/crm/"))).toEqual([]);
      for (const to of [
        "/dashboard/services",
        "/dashboard/employees",
        "/dashboard/appointments",
        "/dashboard/payments",
        "/dashboard/finance",
      ]) {
        expect(targets).toContain(to);
      }
      // Bir bo'lim ikki nomda ko'rinmasligi uchun nomlar ham noyob.
      expect(new Set(menu.map((item) => item.label)).size).toBe(menu.length);
      expect(isModuleEnabled(id, "xizmatlar")).toBe(false);
      expect(hiddenRoutesForPreset(id).has("/dashboard/orders")).toBe(true);
    }
    // Modul sahifasiga to'g'ridan-to'g'ri kirgan yanga biznes haqiqiy sahifaga tushadi.
    const modules = crmConfigForPreset("beauty").modules;
    expect(modules.find((m) => m.key === "xizmatlar")?.link).toBe("/dashboard/services");
    expect(modules.find((m) => m.key === "ustalar")?.link).toBe("/dashboard/employees");
    expect(modules.find((m) => m.key === "qabul")?.link).toBe("/dashboard/appointments");
    expect(modules.find((m) => m.key === "tolovlar")?.link).toBe("/dashboard/payments");
  });

  test("stomatologiya va klinika menyusi ham haqiqiy sahifalardan quriladi", () => {
    for (const id of ["stomatologiya", "klinika"]) {
      const menu = menuForPreset(id);
      const targets = menu.map((item) => item.to);
      for (const to of [
        "/dashboard/services",
        "/dashboard/employees",
        "/dashboard/appointments",
        "/dashboard/payments",
        "/dashboard/finance",
      ]) {
        expect(targets).toContain(to);
      }
      // Qabul, shifokor va to'lov — yadro sahifalari; erkin matn modullari takrorlanmaydi.
      for (const key of ["qabul", "shifokorlar", "tolovlar"]) {
        expect(targets).not.toContain(`/dashboard/crm/${key}`);
        expect(isModuleEnabled(id, key)).toBe(false);
      }
      expect(new Set(menu.map((item) => item.label)).size).toBe(menu.length);
    }
    // Tibbiy yozuvlar o'z ornida qoladi va vakolat talab qiladi.
    const dental = menuForPreset("stomatologiya");
    expect(dental.some((i) => i.to === "/dashboard/crm/odontogramma" && i.permission === "medical.view")).toBe(true);
    expect(dental.some((i) => i.to === "/dashboard/crm/davolash")).toBe(true);
    expect(menuForPreset("klinika").some((i) => i.to === "/dashboard/crm/bolimlar")).toBe(true);
    // To'g'ridan-to'g'ri kirgan URL ham haqiqiy sahifaga chiqadi.
    const modules = crmConfigForPreset("stomatologiya").modules;
    expect(modules.find((m) => m.key === "qabul")?.link).toBe("/dashboard/appointments");
    expect(modules.find((m) => m.key === "shifokorlar")?.link).toBe("/dashboard/employees");
    expect(modules.find((m) => m.key === "tolovlar")?.link).toBe("/dashboard/payments");
  });

  test("avtoservis va xizmat ko‘rsatishda bitta obyekt ikki joyda ko'rinmaydi", () => {
    const garage = menuForPreset("avtoservis").map((item) => item.to);
    for (const to of [
      "/dashboard/services",
      "/dashboard/employees",
      "/dashboard/payments",
      "/dashboard/crm/servis",
      "/dashboard/crm/avtomobillar",
    ]) {
      expect(garage).toContain(to);
    }
    // Usta — xodimlar jadvalida, "Servis buyurtmalari" esa faqat CRM modulida qoladi.
    expect(garage).not.toContain("/dashboard/crm/ustalar");
    expect(garage).not.toContain("/dashboard/orders");
    expect(coreTerm("avtoservis", "products")).toEqual({ one: "Ehtiyot qism", many: "Ehtiyot qismlar" });
    expect(coreTerm("avtoservis", "employees").one).toBe("Usta");

    const outbound = menuForPreset("xizmat").map((item) => item.to);
    expect(outbound).toContain("/dashboard/services");
    expect(outbound).toContain("/dashboard/orders");
    expect(outbound).not.toContain("/dashboard/crm/xizmatlar");
    expect(coreTerm("xizmat", "products")).toEqual({ one: "Mahsulot", many: "Mahsulotlar" });

    for (const [id, key, link] of [
      ["avtoservis", "ustalar", "/dashboard/employees"],
      ["avtoservis", "tolovlar", "/dashboard/payments"],
      ["xizmat", "xizmatlar", "/dashboard/services"],
      ["xizmat", "tolovlar", "/dashboard/payments"],
    ]) {
      expect(crmConfigForPreset(id).modules.find((m) => m.key === key)?.link).toBe(link);
      expect(isModuleEnabled(id, key)).toBe(false);
    }
  });

  test("sahifasi bo'lmagan (yashirin) modulga bog'lanish qolmaydi", () => {
    // Bog'lanish yashirin modulga qolsa, forma eski yozuvni ko'rsatadi-yu, tezkor
    // "yangi qo'shish" "Modul o'chirilgan" xatosi bilan qaytadi.
    const broken = [];
    for (const id of PRESET_IDS) {
      for (const module of crmConfigForPreset(id).modules) {
        // Link bilan ochiladigan modul o'z formasini ko'rsatmaydi — bog'lami yashirin.
        if (module.link || !isModuleEnabled(id, module.key)) continue;
        for (const field of module.fields ?? []) {
          if (field.type !== "relation" || !field.targetModule) continue;
          const reachable =
            isCoreRelationTarget(field.targetModule) || isModuleEnabled(id, field.targetModule);
          if (!reachable) broken.push(`${id}.${module.key}.${field.key} → ${field.targetModule}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test("quick actions use the industry wording of the resolved preset", () => {
    expect(quickActionLabels("oquv").customer).toBe("O‘quvchi");
    expect(quickActionLabels("stomatologiya").customer).toBe("Bemor");
    expect(quickActionLabels("ecommerce").order).toBe("Buyurtma");
    expect(quickActionLabels("beauty").customer).toBe("Mijoz");
    expect(quickActionLabels(null).customer).toBe("Mijoz");
    // Saqlangan soha nomi soha kaliti emas — universal shaklga qaytadi.
    expect(quickActionLabels("O‘quv markazi").customer).toBe("Mijoz");
  });
});
