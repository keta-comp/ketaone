// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { getRequestContext, runInRequestContext, stampRequestContext } from "./request-context.server";

describe("so'rov konteksti — xatoni biznesga bog'lash", () => {
  test("kontekst so'rov davomida saqlanadi va tashqarida bo'sh", () => {
    stampRequestContext({ businessId: "tashqarida" }); // kontekst yo'q — yozilmaydi
    expect(getRequestContext()).toEqual({});

    runInRequestContext(() => {
      stampRequestContext({ userId: "u1" });
      stampRequestContext({ businessId: "b1" });
      expect(getRequestContext()).toEqual({ businessId: "b1", userId: "u1" });
    });

    expect(getRequestContext()).toEqual({});
  });

  test("bir vaqtning o'zidagi ikki so'rov bir-birining biznesini ko'rmaydi", async () => {
    const seen = await Promise.all([
      runInRequestContext(async () => {
        stampRequestContext({ businessId: "b1" });
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getRequestContext().businessId;
      }),
      runInRequestContext(async () => {
        stampRequestContext({ businessId: "b2" });
        return getRequestContext().businessId;
      }),
    ]);
    expect(seen).toEqual(["b1", "b2"]);
  });
});
