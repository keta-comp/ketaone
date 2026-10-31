// @ts-nocheck
import { describe, expect, test } from "bun:test";

import { settingsSeedPatch } from "@/lib/crm-config.functions";
import type { PresetDefaults } from "@/lib/presets";

const BARBER: PresetDefaults = {
  currency: "UZS",
  timezone: "Asia/Tashkent",
  workStart: "10:00",
  workEnd: "20:00",
  slotMinutes: 60,
};

const UNTREATED = { business_description: "", currency: "UZS", working_hours: "09:00 - 20:00" };

describe("onboarding settings seed", () => {
  test("hours typed in the wizard are stored even though the column has a default", () => {
    const patch = settingsSeedPatch({ description: "", workingHours: "09:00–21:00" }, UNTREATED, BARBER);
    expect(patch["working_hours"]).toBe("09:00–21:00");
  });

  test("an untouched tenant gets the preset hours and currency", () => {
    const patch = settingsSeedPatch({ description: "Soxxonamiz" }, UNTREATED, BARBER);
    expect(patch["working_hours"]).toBe("10:00–20:00");
    expect(patch["currency"]).toBe("UZS");
    expect(patch["business_description"]).toBe("Soxxonamiz");
  });

  test("the preset never overwrites what the owner set in Settings", () => {
    const stored = { business_description: "", currency: "USD", working_hours: "08:00 - 17:00" };
    expect(settingsSeedPatch({ description: "" }, stored, BARBER)).toEqual({});
  });

  test("explicit wizard currency wins over a value already in Settings", () => {
    const stored = { business_description: "", currency: "UZS", working_hours: "08:00 - 17:00" };
    const patch = settingsSeedPatch({ description: "", currency: "EUR" }, stored, BARBER);
    expect(patch).toEqual({ currency: "EUR" });
  });

  test("an existing description is kept", () => {
    const stored = { business_description: "Tajribali ustalar", currency: "UZS", working_hours: "09:00 - 20:00" };
    const patch = settingsSeedPatch({ description: "Yangi tavsif" }, stored, BARBER);
    expect(patch["business_description"]).toBeUndefined();
  });

  test("without a preset there is nothing to default to", () => {
    expect(settingsSeedPatch({ description: "" }, UNTREATED, undefined)).toEqual({});
  });
});
