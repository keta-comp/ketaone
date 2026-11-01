/**
 * Sidebar navigation assembled from the tenant's preset, the member's role and the
 * CRM modules that business configured for itself. Client-safe: icons stay strings
 * and the shell maps them, so this stays testable without React.
 */

import {
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
