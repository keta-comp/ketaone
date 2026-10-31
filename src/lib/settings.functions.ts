import { createServerFn } from "@tanstack/react-start";
import type { DbClient } from "./pg-rest.server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { compact } from "./compact";

/** Settings writes are admin-only (enforced by RLS too — this gives a clear message). */
async function requireBusinessAdmin(supabase: DbClient): Promise<string> {
  const { requireBusinessId } = await import("./tenant.server");
  const businessId = await requireBusinessId(supabase);
  const { data, error } = await supabase.rpc("is_business_admin", { _business_id: businessId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Faqat egasi yoki admin sozlamalarni o'zgartira oladi.");
  return businessId;
}

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireBusinessId } = await import("./tenant.server");
    const businessId = await requireBusinessId(context.supabase);
    const [business, ai, adminFlag] = await Promise.all([
      context.supabase.from("business_settings").select("*").limit(1).maybeSingle(),
      context.supabase.from("ai_settings").select("*").limit(1).maybeSingle(),
      context.supabase.rpc("is_business_admin", { _business_id: businessId }),
    ]);
    if (business.error) throw new Error(business.error.message);
    if (ai.error) throw new Error(ai.error.message);
    return {
      businessId,
      business: business.data,
      ai: ai.data,
      aiKeyConfigured: Boolean(process.env["LOVABLE_API_KEY"]),
      isAdmin: adminFlag.data === true,
    };
  });

export const saveBusinessSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string(),
        business_name: z.string().min(1),
        business_description: z.string(),
        working_hours: z.string(),
        delivery_info: z.string(),
        payment_methods: z.string(),
        return_policy: z.string(),
        currency: z.string().min(1).max(8),
        staff_group_chat_id: z.string().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const businessId = await requireBusinessAdmin(context.supabase);
    const { error } = await context.supabase
      .from("business_settings")
      .update(compact(patch) as never)
      .eq("id", id);
    if (error) throw new Error(error.message);
    const { invalidateSettingsCache } = await import("./agent.server");
    invalidateSettingsCache(businessId);
    return { ok: true };
  });

/** Branding shown on the public booking page: contact phone and the stored logo path. */
export const saveBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        phone: z.string().max(40).optional(),
        logo_path: z.string().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requireBusinessAdmin(context.supabase);
    const { error } = await context.supabase
      .from("business_settings")
      .update(compact(data) as never)
      .eq("business_id", businessId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const LOGO_SUFFIX: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** The logo key always starts with the caller's business id, so an upload cannot target another tenant. */
export const issueLogoUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ contentType: z.string().min(1).max(80), size: z.number().int().positive() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ path: string; uploadUrl: string }> => {
    const businessId = await requireBusinessAdmin(context.supabase);
    const suffix = LOGO_SUFFIX[data.contentType];
    if (!suffix) throw new Error("Faqat PNG, JPG yoki WEBP rasm yuklang.");
    const path = `${businessId}/logo.${suffix}`;
    const { BUCKET_LIMITS, signedUploadUrl } = await import("./storage.server");
    if (data.size > BUCKET_LIMITS.branding) throw new Error("Logotip hajmi 2 MB dan kichik bo'lsin.");
    return { path, uploadUrl: await signedUploadUrl("branding", path, data.contentType, 300, data.size) };
  });

/** Ommaviy bron sahifasi logotipni ham shu qisqa muddatli havola orqali oladi. */
export const getBrandingLogoUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ path: z.string().min(1).max(300) }).parse(input))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { requireBusinessId } = await import("./tenant.server");
    const businessId = await requireBusinessId(context.supabase);
    if (!data.path.startsWith(`${businessId}/`)) throw new Error("Bu fayl sizning biznesingizga tegishli emas.");
    const { signedDownloadUrl } = await import("./storage.server");
    return { url: await signedDownloadUrl("branding", data.path, 600) };
  });

export const removeBrandingLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ path: z.string().min(1).max(300) }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const businessId = await requireBusinessAdmin(context.supabase);
    if (!data.path.startsWith(`${businessId}/`)) throw new Error("Bu fayl sizning biznesingizga tegishli emas.");
    const { deleteObjects } = await import("./storage.server");
    await deleteObjects("branding", [data.path], context.userId);
    return { ok: true };
  });

export const notifyLeadStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ leadId: z.string(), reason: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireBusinessId } = await import("./tenant.server");
    const { notifyStaffGroup } = await import("./agent.server");
    const businessId = await requireBusinessId(context.supabase);
    return notifyStaffGroup(businessId, data.leadId, data.reason);
  });