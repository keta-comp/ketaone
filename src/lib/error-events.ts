// Browser-safe pieces of the error trail: bucketing and fingerprinting rules that
// the capture helper and the Control Center both need.

/** Repeat failures inside one bucket collapse into a single row. */
export const ERROR_BUCKET_MS = 600_000;

export function errorBucket(now: Date = new Date()): string {
  return new Date(Math.floor(now.getTime() / ERROR_BUCKET_MS) * ERROR_BUCKET_MS).toISOString();
}

/** UUIDs and digit runs become placeholders so /customers/:id is one series, not thousands. */
export function normalizeRoute(route: string): string {
  const path = (route.split("?")[0] ?? "").split("#")[0] ?? "";
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\d+/g, ":n")
    .slice(0, 300);
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
