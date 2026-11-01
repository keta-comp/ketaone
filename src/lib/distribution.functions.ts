/**
 * Dastur tarqatishi — PlayStation va Bilyard klublarining «Dasturni yuklab olish» va
 * «Mobil dastur» bo'limlari.
 *
 * Vaqt hisoblagichi tashqi dasturda qoladi (brief §16): KetaOne sessiyani sanamaydi va
 * o'rnatuvchi faylni o'zida saqlamaydi — Neon'da fayllar `storage_objects` bytea ichida,
 * chegarasi 15 MB. Shuning uchun bu yerda faqat sayt egasi yozgan HTTPS havolasi, versiya
 * va o'rnatish yo'riqnomasi turadi. Bo'sh havola — «hali tayyor emas» holati; sahifa
 * mavjud bo'lmagan dastur uchun tugma chizmaydi.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/lib/auth-middleware";
import { requirePermission } from "./guards.server";
import type { DbClient } from "./pg-rest.server";
import { requireBusinessId } from "./tenant.server";

export const RELEASE_PLATFORMS = ["windows", "macos", "android", "ios"] as const;
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];

export interface ProgramRelease {
  platform: ReleasePlatform;
  url: string;
  version: string;
  instructions: string;
  updated_at: string | null;
}

/** Bo'sh qatorga ruxsat: platforma hali chiqmagan — havola yo'q, tugma ham yo'q. */
const urlField = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === "" || value.startsWith("https://"), {
    message: "Havola https:// bilan boshlansin.",
  });

/**
 * Klub dasturi hozircha Android APK'si (`ketaclub.apk`) sifatida tarqatiladi va sessiya
 * hisobi shu tashqi dasturda qoladi (brief §16). Yangi klub hisobi bo'limlarni bo'sh
 * ko'rmasin: sayt egasi o'z havolasini yozguncha shu standart ishlatiladi.
 * Windows/macOS uchun fayl yo'q — ularni ataylab bo'sh qoldiramiz, chunki APK'ni
 * «Windows» tugmasi ostida berish o'rnatib bo'lmaydigan faylni yuklash degani.
 */
export const KLUB_PROGRAM_URL =
  "https://drive.google.com/file/d/14ud7FYMtr66CNq7ybUq9EQkDJT5f67ks/view?usp=sharing";

export const PLATFORM_DEFAULT_URLS: Partial<Record<ReleasePlatform, string>> = {
  android: KLUB_PROGRAM_URL,
};

/**
 * Sahifaga ko'rinadigan qator: tenant o'zi yozgan bo'lsa (bo'sh havola ham — ya'ni
 * «bu platforma yo'q») shu qoladi, yozilmagan bo'lsa platforma standarti qo'llaniladi.
 */
export function releaseRow(
  platform: ReleasePlatform,
  row?: { url: string | null; version: string | null; instructions: string | null; updated_at: string | null },
): ProgramRelease {
  return {
    platform,
    url: row?.url ?? PLATFORM_DEFAULT_URLS[platform] ?? "",
    version: row?.version ?? "",
    instructions: row?.instructions ?? "",
    updated_at: row?.updated_at ?? null,
  };
}

async function readReleases(supabase: DbClient, businessId: string): Promise<ProgramRelease[]> {
  const { data, error } = await supabase
    .from("program_releases")
    .select("*")
    .eq("business_id", businessId);
  if (error) throw new Error(error.message);
  const byPlatform = new Map(
    (data ?? []).map((row) => [row.platform as ReleasePlatform, row]),
  );
  return RELEASE_PLATFORMS.map((platform) => releaseRow(platform, byPlatform.get(platform)));
}

export const getProgramReleases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const businessId = await requireBusinessId(context.supabase);
    const { data: isAdmin } = await context.supabase.rpc("is_business_admin", {
      _business_id: businessId,
    });
    return { releases: await readReleases(context.supabase, businessId), isAdmin: isAdmin === true };
  });

/** Yozish — faqat egasi/admin (settings.manage); RLS ham shu rolni talab qiladi. */
export const saveProgramRelease = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        platform: z.enum(RELEASE_PLATFORMS),
        url: urlField,
        version: z.string().trim().max(40),
        instructions: z.string().trim().max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const businessId = await requirePermission(
      context.supabase,
      "settings.manage",
      "Faqat egasi yoki admin dastur havolasini o'zgartira oladi.",
    );
    const { error } = await context.supabase
      .from("program_releases")
      .upsert(
        {
          business_id: businessId,
          platform: data.platform,
          url: data.url,
          version: data.version,
          instructions: data.instructions,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_id,platform" },
      );
    if (error) throw new Error(error.message);
    return { releases: await readReleases(context.supabase, businessId) };
  });
