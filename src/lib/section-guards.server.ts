/**
 * Server-side half of the preset section switch. The menu, the dashboard tiles and the
 * pages all hide themselves, and a write to a section the tenant does not offer is
 * refused here — so the hiding is not only cosmetic.
 */

import type { DbClient } from "./pg-rest.server";
import { hiddenRoutesForPreset, isRouteAllowed, resolvePresetId } from "./presets";
import { requireBusinessId } from "./tenant.server";

/** Preset id'ni saqlangan konfiguratsiyadan o'qib, bo'lim ochiq-yopiqligini tekshiradi. */
async function presetIdForTenant(supabase: DbClient): Promise<string> {
  const businessId = await requireBusinessId(supabase);
  const { data } = await supabase
    .from("crm_configs")
    .select("industry, config")
    .eq("business_id", businessId)
    .maybeSingle();
  const config = data?.config as { presetId?: string } | null;
  return resolvePresetId(data?.industry ?? null, config?.presetId);
}

export async function hiddenRoutesForTenant(supabase: DbClient): Promise<Set<string>> {
  return hiddenRoutesForPreset(await presetIdForTenant(supabase));
}

/** Throws when this core section is switched off for the tenant's preset. */
export async function requireSection(supabase: DbClient, to: string): Promise<void> {
  if (!isRouteAllowed(await presetIdForTenant(supabase), to)) {
    throw new Error(`Bu soha uchun bo'lim o'chirilgan: ${to}`);
  }
}
