// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { ERROR_BUCKET_MS, errorBucket, errorFingerprint, isCancellationNoise, normalizeRoute } from "./error-events";

describe("errorBucket", () => {
  test("floors to the ten-minute boundary", () => {
    expect(errorBucket(new Date("2026-10-27T12:07:33Z"))).toBe("2026-10-27T12:00:00.000Z");
    expect(errorBucket(new Date("2026-10-27T12:09:59Z"))).toBe("2026-10-27T12:00:00.000Z");
    expect(errorBucket(new Date("2026-10-27T12:10:00Z"))).toBe("2026-10-27T12:10:00.000Z");
  });
  test("bucket length is the configured window", () => {
    expect(ERROR_BUCKET_MS).toBe(600_000);
  });
});

describe("normalizeRoute", () => {
  test("collapses uuids, digits, queries and hashes", () => {
    const route = normalizeRoute(
      "/dashboard/customers/39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77?tab=2#top",
    );
    expect(route).toBe("/dashboard/customers/:id");
  });
  test("keeps plain paths readable", () => {
    expect(normalizeRoute("/api/public/payme")).toBe("/api/public/payme");
  });
  test("serverFn identifikatori raqam qoidasiga uchramaydi", () => {
    const a = normalizeRoute("/_serverFn/b28c72d5c19cb2360284b3c0a6709dcb8ad013f2");
    const b = normalizeRoute("/_serverFn/133837bf00663c00aeed9478eb2c708dea7cc4a1");
    expect(a).toBe("/_serverFn/b28c72d5c19c");
    expect(a).not.toBe(b);
  });
  test("eski base64 identifikator o'qiladigan nomga aylanadi", () => {
    const id = btoa(JSON.stringify({ file: "/src/lib/booking.functions.ts", name: "saveAppointment" }));
    expect(normalizeRoute(`/_serverFn/${id}`)).toBe("/fn/lib/booking.functions#saveAppointment");
  });
});

describe("isCancellationNoise", () => {
  test("brauzer bekor qilgan so'rov — mahsulot xatosi emas", () => {
    expect(isCancellationNoise(new Error("This operation was aborted"), "This operation was aborted")).toBe(true);
    const err = new Error("boom");
    err.name = "AbortError";
    expect(isCancellationNoise(err, "boom")).toBe(true);
  });

  test("haqiqiy xatolar panelga tushadi", () => {
    const schema = 'null value in column "industry" of relation "crm_configs" violates not-null constraint';
    expect(isCancellationNoise(new Error(schema), schema)).toBe(false);
    expect(isCancellationNoise(new Error("aborted task list"), "aborted task list")).toBe(false);
  });
});

describe("errorFingerprint", () => {
  test("uses status, route and the first message line", () => {
    const fingerprint = errorFingerprint({ route: "/api/health", message: "boom\nat stack", status: 503 });
    expect(fingerprint).toBe("503|/api/health|boom");
  });
  test("the same failure in the same bucket fingerprints identically", () => {
    const a = errorFingerprint({ route: "/x/1", message: "nope" });
    const b = errorFingerprint({ route: "/x/2", message: "nope" });
    expect(a).toBe(b);
  });
});
