import type { DbClient } from "./pg-rest.server";


type Client = DbClient;

type AccessState = {
  user_status?: string | null;
  workspace_status?: string | null;
  is_super_admin?: boolean | null;
  maintenance_mode?: boolean | null;
  maintenance_message?: string | null;
};

/** The Control Center's maintenance switch and account blocks have to stop tenant
 *  data access, not only hide buttons. my_access_state() is answered by the database,
 *  and every CRM server function resolves its workspace through requireBusinessId(),
 *  so this is the shared boundary. */
async function assertWorkspaceUsable(supabase: Client): Promise<void> {
  const { data, error } = await supabase.rpc("my_access_state");
  if (error) throw new Error(error.message);
  const state = (data ?? {}) as AccessState;
  if (state.is_super_admin) return;
  if (state.user_status === "suspended") {
    throw new Error("Hisobingiz bloklangan. Qo‘llab-quvvatlash bilan bog‘laning.");
  }
  if (state.workspace_status === "suspended") {
    throw new Error("Bu workspace vaqtincha bloklangan. Qo‘llab-quvvatlash bilan bog‘laning.");
  }
  if (state.maintenance_mode) {
    throw new Error(state.maintenance_message?.trim() || "KetaOne texnik ishlar sababli vaqtincha ishlamaydi.");
  }
}

/** Resolves the business the signed-in user belongs to. Throws when the account has no workspace. */
export async function requireBusinessId(supabase: Client): Promise<string> {
  await assertWorkspaceUsable(supabase);
  const { data, error } = await supabase.rpc("current_business_id");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No business workspace found for this account.");
  const { stampRequestContext } = await import("./request-context.server");
  stampRequestContext({ businessId: String(data) });
  return data as string;
}

/** Read-only platform notice for the CRM shell: tells users why the workspace is closed. */
export async function platformNotice(supabase: Client): Promise<
  { kind: "maintenance" | "suspended" | "workspace_suspended"; message: string } | null
> {
  const { data } = await supabase.rpc("my_access_state");
  const state = (data ?? {}) as AccessState;
  if (state.is_super_admin) return null;
  if (state.user_status === "suspended") {
    return { kind: "suspended", message: "Hisobingiz bloklangan. Qo‘llab-quvvatlash bilan bog‘laning." };
  }
  if (state.workspace_status === "suspended") {
    return {
      kind: "workspace_suspended",
      message: "Bu workspace vaqtincha bloklangan. Qo‘llab-quvvatlash bilan bog‘laning.",
    };
  }
  if (state.maintenance_mode) {
    return {
      kind: "maintenance",
      message: state.maintenance_message?.trim() || "KetaOne texnik ishlar sababli vaqtincha ishlamaydi.",
    };
  }
  return null;
}
