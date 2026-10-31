import { supabaseAdmin } from "@/lib/platform.server";
import { requestIp } from "./request.server";

export interface AuditEntry {
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorKind?: "user" | "super_admin" | "system";
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  businessId?: string | null;
  status?: "success" | "failure";
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

/** Platform audit trail. Never throws — logging must not break the action it records. */
export async function logAudit(entry: AuditEntry) {
  try {
    await supabaseAdmin.from("audit_logs").insert({
      actor_user_id: entry.actorUserId ?? null,
      actor_email: entry.actorEmail ?? null,
      actor_kind: entry.actorKind ?? "user",
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      target_label: entry.targetLabel ?? null,
      business_id: entry.businessId ?? null,
      status: entry.status ?? "success",
      // Every write happens inside a request, so the caller's address is always
      // available — the journal's IP column must not depend on callers remembering it.
      ip: entry.ip ?? requestIp(),
      metadata: (entry.metadata ?? {}) as never,
    });
  } catch (error) {
    console.error("[audit] failed to write log", error);
    // Buzilgan audit yozuvi konsolda qolib ketmasligi kerak: xato jurnali
    // `/super-admin/errors` da ko'rinishi uchun u yerga ham yozamiz.
    const { captureError } = await import("./error-events.server");
    await captureError({
      error,
      route: "audit-log-write",
      level: "warning",
      businessId: entry.businessId ?? null,
      userId: entry.actorUserId ?? null,
    });
  }
}

/** Records one AI call for platform usage accounting. Never throws. */
export async function logAiUsage(entry: {
  businessId?: string | null;
  userId?: string | null;
  feature: string;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}) {
  try {
    await supabaseAdmin.from("ai_usage_events").insert({
      business_id: entry.businessId ?? null,
      user_id: entry.userId ?? null,
      feature: entry.feature,
      model: entry.model ?? null,
      input_tokens: Math.max(0, Math.round(entry.inputTokens ?? 0)),
      output_tokens: Math.max(0, Math.round(entry.outputTokens ?? 0)),
    });
  } catch (error) {
    console.error("[ai-usage] failed to write event", error);
  }
}
