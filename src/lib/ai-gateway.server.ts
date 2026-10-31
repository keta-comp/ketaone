import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
  });
}

/** Direct Google Gemini provider (self-hosted mode) via its OpenAI-compatible API. */
export function createGeminiProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

/** OpenRouter provider (self-hosted mode) — OpenAI-compatible, keeps "vendor/model" ids. */
export function createOpenRouterProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

export type AiRuntime = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: (id: string) => any;
  defaultModel: string;
  backend: "openrouter" | "gemini" | "lovable";
};

/**
 * AI runtime for the sales agent.
 * - OPENROUTER_API_KEY set → OpenRouter (self-hosted, independent mode).
 * - GEMINI_API_KEY set     → direct Google Gemini (self-hosted, independent mode).
 * - otherwise              → Lovable AI Gateway (LOVABLE_API_KEY).
 */
export function resolveAiRuntime(): AiRuntime | { error: string } {
  const openRouterKey = process.env["OPENROUTER_API_KEY"];
  if (openRouterKey) {
    const provider = createOpenRouterProvider(openRouterKey);
    return {
      backend: "openrouter",
      // OpenRouter uses "vendor/model" ids; override via OPENROUTER_MODEL.
      defaultModel: process.env["OPENROUTER_MODEL"] ?? "google/gemini-2.5-flash",
      model: (id: string) => provider(id.includes("/") ? id : `google/${id}`),
    };
  }
  const geminiKey = process.env["GEMINI_API_KEY"];
  if (geminiKey) {
    const provider = createGeminiProvider(geminiKey);
    return {
      backend: "gemini",
      // Direct Gemini ids have no "vendor/" prefix; map gateway-style ids.
      defaultModel: "gemini-2.5-flash",
      model: (id: string) => provider(stripVendorPrefix(id)),
    };
  }
  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (!lovableKey) {
    console.warn(
      "[ai-gateway] none of OPENROUTER_API_KEY, GEMINI_API_KEY, LOVABLE_API_KEY is configured",
    );
    return { error: "AI yordamchi hozircha sozlanmagan — administratorga murojaat qiling." };
  }
  const provider = createLovableAiGatewayProvider(lovableKey);
  return {
    backend: "lovable",
    defaultModel: "google/gemini-3.7-flash",
    model: (id: string) => provider(id),
  };
}

function stripVendorPrefix(id: string): string {
  return id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
}

export function gatewayErrorMessage(error: unknown): string {
  const status = (error as { statusCode?: number; status?: number } | null)?.statusCode ??
    (error as { status?: number } | null)?.status;
  if (status === 402) return "AI credits exhausted. Add credits in Lovable to resume the AI agent.";
  if (status === 403) return "AI access is blocked by workspace policy.";
  if (status === 401) return "AI kaliti yo'q yoki noto'g'ri — administratorga murojaat qiling.";
  if (status === 429) return "AI gateway is rate limited. Please retry shortly.";
  return error instanceof Error ? error.message : "Unknown AI gateway error";
}
