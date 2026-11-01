/**
 * Sidebar navigation assembled from the tenant's preset, the member's role and the
 * CRM modules that business configured for itself. Client-safe: icons stay strings
 * and the shell maps them, so this stays testable without React.
 */

import {
  isClubPreset,
  isModuleEnabled,
  isRouteAllowed,
  menuForPreset,
  resolvePresetId,
  type PresetMenuItem,
} from "./presets";
import { can } from "./roles";

interface NavCrmConfig {
  presetId?: string;
  modules: { key: string; label: string; icon?: string; link?: string }[];
}

export interface NavSource {
  industry: string | null;
  role: string | null;
  branchCount: number;
  config: NavCrmConfig | null;
}

/** Pastki panelning bitta tugmasi; `isMenu` — sahifa emas, menyuni ochadigan tugma. */
export interface MobileTab {
  to: string;
  label: string;
  icon: string;
  isMenu?: boolean;
}

const HOME: PresetMenuItem = {
  to: "/dashboard",
  label: "Umumiy ko‘rinish",
  icon: "dashboard",
  section: "core",
};

const BRANCHES: PresetMenuItem = {
  to: "/dashboard/branches",
  label: "Filiallar",
  icon: "building",
  section: "team",
};

export function buildNavItems(crm: NavSource | undefined): PresetMenuItem[] {
  if (!crm) return [HOME];
  const presetId = resolvePresetId(crm.industry, crm.config?.presetId);

  const items: PresetMenuItem[] = [];
  const seen = new Set<string>();
  const push = (item: PresetMenuItem) => {
    if (seen.has(item.to)) return;
    seen.add(item.to);
    items.push(item);
  };

  for (const entry of menuForPreset(presetId)) {
    if (entry.permission && !can(crm.role as never, entry.permission)) continue;
    push(entry);
  }

  // Modules this business added itself (AI builder output) join the industry section.
  for (const module of crm.config?.modules ?? []) {
    if (!isModuleEnabled(presetId, module.key)) continue;
    const to = module.link ?? `/dashboard/crm/${module.key}`;
    // A configured module never resurrects a section this preset dropped (Ombor, Buyurtmalar)
    // or a page a section-only preset (klublar) umuman ko'rsatmaydi.
    if (!isRouteAllowed(presetId, to)) continue;
    push({ to, label: module.label, icon: module.icon ?? "layers", section: "industry" });
  }

  // Multi-branch is a platform feature: a tenant that already has branches keeps the
  // entry even when its preset (a single-location barbershop) does not list it.
  if (crm.branchCount > 0 && isRouteAllowed(presetId, BRANCHES.to)) push(BRANCHES);

  // Two destinations, one name (built-in To‘lovlar vs a CRM "tolovlar" module).
  const labelCount = new Map<string, number>();
  for (const item of items) labelCount.set(item.label, (labelCount.get(item.label) ?? 0) + 1);
  return items.map((item) =>
    item.to.startsWith("/dashboard/crm/") && (labelCount.get(item.label) ?? 0) > 1
      ? { ...item, label: `${item.label} (CRM)` }
      : item,
  );
}

/** Bir joyni band qiladigan yo'nalishlar — rolni yoki presetni hisobga olgan holda. */
const MOBILE_SLOTS: string[][] = [
  ["/dashboard"],
  ["/dashboard/appointments", "/dashboard/customers", "/dashboard/orders"],
  ["/dashboard/payments", "/dashboard/orders", "/dashboard/products"],
];

const MOBILE_MENU_TAB: MobileTab = { to: "", label: "Menyu", icon: "menu", isMenu: true };

/**
 * Telefon pastidagi panel. Yadro sahifalari presetdan olinadi — shuning uchun
 * salon «Qabullar»ni, klub «Bron»ni, moliyasi bo'lmagan preset esa uchinchi
 * joyni o'z bo'limi bilan to'ldiradi; rolga ko'ra yopiq sahifa panelga chiqmaydi.
 */
export function mobileTabsForNav(crm: NavSource | undefined): MobileTab[] {
  const items = buildNavItems(crm);
  if (isClubPreset(resolvePresetId(crm?.industry, crm?.config?.presetId))) {
    // Klubda pastki barnda aynan 4 bo'lim turadi; ochirmagan bo'lsa "Menyu" qo'shiladi.
    const clubTabs: MobileTab[] = items.slice(0, 4);
    return clubTabs.length === 4 ? clubTabs : [...clubTabs, MOBILE_MENU_TAB];
  }
  const byRoute = new Map(items.map((item) => [item.to, item]));
  const slots = MOBILE_SLOTS.map((chain) =>
    chain.map((to) => byRoute.get(to)).find((item) => item !== undefined),
  ).filter((item): item is PresetMenuItem => item !== undefined);
  return [...slots, MOBILE_MENU_TAB];
}
