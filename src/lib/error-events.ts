// Browser-safe pieces of the error trail: bucketing and fingerprinting rules that
// the capture helper and the Control Center both need.

/** Repeat failures inside one bucket collapse into a single row. */
export const ERROR_BUCKET_MS = 600_000;

/** Server funksiyalari shu prefiks bilan keladi — identifikatorni alohida ishlaymiz. */
const SERVER_FN_PREFIX = "/_serverFn/";

export function errorBucket(now: Date = new Date()): string {
  return new Date(Math.floor(now.getTime() / ERROR_BUCKET_MS) * ERROR_BUCKET_MS).toISOString();
}

/** UUIDs and digit runs become placeholders so /customers/:id is one series, not thousands. */
export function normalizeRoute(route: string): string {
  const path = (route.split("?")[0] ?? "").split("#")[0] ?? "";
  if (path.startsWith(SERVER_FN_PREFIX)) return describeServerFn(path.slice(SERVER_FN_PREFIX.length));
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\d+/g, ":n")
    .slice(0, 300);
}

/**
 * Server funksiyasi manzilidagi identifikator raqamlidir: umumiy raqam-qoidasi uni
 * `:n` ga aylantirib, har xil funksiyalarni bitta «yo‘q» yo'lga urib qo'yardi.
 */
function describeServerFn(id: string): string {
  const readable = decodeServerFnId(id);
  if (readable) return `/fn/${readable}`.slice(0, 300);
  // Hesh identifikatori: bir xil build davomida bir funksiyaga to'g'ri keladi.
  return `${SERVER_FN_PREFIX}${id.slice(0, 12)}`;
}

function decodeServerFnId(id: string): string | null {
  if (!id.startsWith("eyJ")) return null;
  try {
    const json = JSON.parse(atob(id.replace(/-/g, "+").replace(/_/g, "/"))) as {
      file?: string;
      name?: string;
      longName?: string;
    };
    const file = (json.file ?? "").replace(/^.*\/src\//, "").replace(/\.[cm]?[jt]sx?$/, "");
    const name = json.longName || json.name || "";
    const label = [file, name].filter(Boolean).join("#");
    return label || null;
  } catch {
    return null;
  }
}

/**
 * A browser cancels in-flight serverFn calls every time the user navigates — the dashboard's
 * onboarding redirect does this constantly. A cancelled request is not a product failure, so it
 * must not crowd real errors out of the panel.
 */
export function isCancellationNoise(error: unknown, message: string): boolean {
  const name = error instanceof Error ? (error as { name?: string }).name : "";
  if (name === "AbortError") return true;
  return /^(this operation was aborted|aborted|request aborted|signal is aborted without reason|the user aborted a request\.?)$/i.test(
    message.trim(),
  );
}

export function errorFingerprint(input: {
  route: string;
  message: string;
  status?: number | null;
}): string {
  const firstLine = (input.message.split("\n")[0] ?? "").trim().slice(0, 240);
  return `${input.status ?? 0}|${normalizeRoute(input.route)}|${firstLine}`;
}
