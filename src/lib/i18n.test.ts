// @ts-nocheck
import { afterAll, describe, expect, test } from "bun:test";

import { getLang, intlLocale, setLang } from "@/lib/i18n";

describe("intl locale follows the app language", () => {
  const restore = getLang();

  afterAll(() => setLang(restore));

  test("dates format in Uzbek, not in the browser's language", () => {
    setLang("uz");
    expect(intlLocale()).toBe("uz-UZ");
    expect(new Date("2026-11-01T15:00:00+05:00").toLocaleString(intlLocale(), { month: "long" })).toBe("Noyabr");
  });

  test("Qaraqalpaqsha keeps the Latin Uzbek months because Intl has no kaa data", () => {
    setLang("kaa");
    expect(intlLocale()).toBe("uz-UZ");
    setLang("ru");
    expect(intlLocale()).toBe("ru-RU");
    setLang("en");
    expect(intlLocale()).toBe("en-GB");
  });
});
