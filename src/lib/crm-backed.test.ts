// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { widgetTableOf } from "@/lib/crm-backed";

describe("widgetTableOf", () => {
  test("qabul moduli sahifaga bog'langan bo'lsa ham appointments jadvalidan sanaladi", () => {
    expect(
      widgetTableOf({ key: "qabul", label: "Qabul", table: "appointments", link: "/dashboard/appointments" }),
    ).toBe("appointments");
  });

  test("eski konfiguratsiyada table bo'lmasa link jadvalni belgilaydi", () => {
    expect(widgetTableOf({ key: "tolovlar", label: "To‘lovlar", link: "/dashboard/payments" })).toBe("payments");
  });

  test("yadro jadvaliga kirmagan modul vidjet sanoviga yaroqsiz", () => {
    expect(widgetTableOf({ key: "mijozlar", label: "Mijozlar", link: "/dashboard/customers" })).toBeNull();
    expect(widgetTableOf({ key: "xizmatlar", label: "Xizmatlar" })).toBeNull();
    expect(widgetTableOf(undefined)).toBeNull();
  });
});
