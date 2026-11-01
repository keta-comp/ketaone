import { supabaseAdmin } from "@/lib/platform.server";
import { describeError } from "./error-capture";
import { errorBucket, errorFingerprint, isCancellationNoise, normalizeRoute } from "./error-events";

export type CaptureInput = {
  error: unknown;
  route?: string;
  status?: number | null;
  level?: "error" | "warning";
  businessId?: string | null;
  userId?: string | null;
};

// Missing table (migrations not applied yet) or missing service key: stop trying
// for the rest of this process so one broken deploy cannot flood the logs.
let disabled = false;

/** Durable server-side error trail. Best-effort: never throws, never blocks the request. */
export async function captureError(input: CaptureInput) {
  if (disabled || process.env["ERROR_EVENTS_DISABLED"] === "true") return;
  try {
    const message =
      input.error instanceof Error
        ? input.error.message
        : typeof input.error === "string"
          ? input.error
          : "Unknown error";
    const route = normalizeRoute(input.route ?? "");
    if (isCancellationNoise(input.error, message)) return;
    const { error } = await supabaseAdmin.from("error_events").insert({
      fingerprint: errorFingerprint({ route, message, status: input.status ?? null }),
      bucket: errorBucket(),
      level: input.level ?? "error",
      route,
      message: message.slice(0, 500),
      detail: describeError(input.error).slice(0, 8_000),
      status_code: input.status ?? null,
      business_id: input.businessId ?? null,
      user_id: input.userId ?? null,
    });
    if (error?.code === "23505") return;
    if (error) {
      if (error.code === "42P01" || error.code === "42501" || error.code === "PGRST205") disabled = true;
      console.error("[error-events] insert failed", error.code, error.message);
    }
  } catch (error) {
    disabled = true;
    console.error("[error-events] unavailable", error instanceof Error ? error.message : error);
  }
}

/** Recent failure count for the readiness probe; degrades to null when unavailable. */
export async function countRecentErrors(hours = 24): Promise<number | null> {
  if (disabled) return null;
  try {
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    const { count, error } = await supabaseAdmin
      .from("error_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}
