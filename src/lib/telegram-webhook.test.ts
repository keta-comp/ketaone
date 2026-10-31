// @ts-nocheck — repo testlari shu usulda: `bun:test` uchun tur ta'rifi yo'q.
/**
 * Telegram webhook xavfsizlik qatlami.
 *
 * Nima uchun: webhook — ochiq URL. Uni yagona to'sadi — Telegram so'rovga
 * qo'shadigan `x-telegram-bot-api-secret-token` sarlavhasi. Bu testlar shu
 * sarlavha qayerdan kelishini, fail-closed tekshirilishini, bot tokeni hech
 * qayerga chiqmasligini va production webhook'ni faqat administrator skripti
 * o'zgartira olishini tekshiradi.
 */
import { expect, test, describe } from "bun:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFAULT_PUBLIC_URL, scrubTelegramToken, webhookBaseUrl } from "./telegram.server";
import { singleBotHeaderSecret, singleWebhookUrl, SINGLE_WEBHOOK_PATH } from "./single-bot.server";
import { matchesSecret } from "./secure-compare.server";

const TOKEN = "123456789:AAExampleTokenValue_not-real-0000000000";
const LIB = fileURLToPath(new URL("./", import.meta.url));
const SETUP_SCRIPT = readFileSync(fileURLToPath(new URL("../../scripts/telegram-setup.mjs", import.meta.url)), "utf8");

function withEnv(name: string, value: string | undefined, run: () => void) {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    run();
  } finally {
    if (had) process.env[name] = previous;
    else delete process.env[name];
  }
}

describe("webhook maxfiy so'zi", () => {
  test("TELEGRAM_WEBHOOK_SECRET berilsa shu ishlatiladi", () => {
    withEnv("TELEGRAM_WEBHOOK_SECRET", "  rotated-secret-value  ", () => {
      expect(singleBotHeaderSecret(TOKEN)).toBe("rotated-secret-value");
    });
  });

  test("secret bo'lmasa token'dan HMAC hisoblanadi va barqaror", () => {
    withEnv("TELEGRAM_WEBHOOK_SECRET", undefined, () => {
      const expected = createHmac("sha256", TOKEN).update("telegram-webhook").digest("base64url");
      expect(singleBotHeaderSecret(TOKEN)).toBe(expected);
      expect(singleBotHeaderSecret(TOKEN)).toBe(singleBotHeaderSecret(TOKEN));
      expect(singleBotHeaderSecret(TOKEN)).not.toBe(TOKEN);
    });
  });

  test("bo'sh TELEGRAM_WEBHOOK_SECRET HMAC'ga qaytadi", () => {
    withEnv("TELEGRAM_WEBHOOK_SECRET", "   ", () => {
      expect(singleBotHeaderSecret(TOKEN)).toBe(
        createHmac("sha256", TOKEN).update("telegram-webhook").digest("base64url"),
      );
    });
  });

  test("skript server bilan bir xil secret manbasidan foydalanadi", () => {
    expect(SETUP_SCRIPT).toContain('update(SECRET_SALT)');
    expect(SETUP_SCRIPT).toContain('const SECRET_SALT = "telegram-webhook"');
    expect(SETUP_SCRIPT).toContain("TELEGRAM_WEBHOOK_SECRET");
  });
});

describe("webhook sarlavhasini tekshirish", () => {
  const secret = singleBotHeaderSecret(TOKEN);

  test("to'g'ri sarlavha o'tadi, xato va bo'shi o'tmaydi", () => {
    expect(matchesSecret(secret, secret)).toBe(true);
    expect(matchesSecret("", secret)).toBe(false);
    expect(matchesSecret(null, secret)).toBe(false);
    expect(matchesSecret("x".repeat(secret.length), secret)).toBe(false);
    expect(matchesSecret(secret.slice(0, -1), secret)).toBe(false);
  });

  test("fail-closed: kutilgan secret bo'lmasa hech narsa o'tmaydi", () => {
    expect(matchesSecret("", "")).toBe(false);
    expect(matchesSecret("anything", undefined)).toBe(false);
  });
});

describe("webhook manzili", () => {
  test("o'tilgan holda production manzili ishlatiladi", () => {
    withEnv("PUBLIC_APP_URL", undefined, () => {
      expect(DEFAULT_PUBLIC_URL).toBe("https://www.nexora-crm.uz");
      expect(singleWebhookUrl()).toBe(`${DEFAULT_PUBLIC_URL}${SINGLE_WEBHOOK_PATH}`);
    });
  });

  test("PUBLIC_APP_URL ustun bo'ladi va oxiragi slash olib tashlanadi", () => {
    withEnv("PUBLIC_APP_URL", "https://crm.example.uz/", () => {
      expect(webhookBaseUrl()).toBe("https://crm.example.uz");
      expect(singleWebhookUrl()).toBe("https://crm.example.uz/api/public/telegram/webhook");
    });
  });

  test("skript ham shu production manzilidan boshlaydi", () => {
    expect(SETUP_SCRIPT).toContain(`const DEFAULT_PUBLIC_URL = "${DEFAULT_PUBLIC_URL}"`);
  });
});

describe("token hech qayerda ko'rinmaslin", () => {
  test("xatolik matnidan token o'chiriladi", () => {
    const leaked = `fetch failed for https://api.telegram.org/bot${TOKEN}/getMe`;
    const clean = scrubTelegramToken(leaked, TOKEN);
    expect(clean).not.toContain(TOKEN);
    expect(clean).toContain("[token]");
  });

  test("Telegram API xatolari logga token bilan chiqmaydi", () => {
    const source = readFileSync(`${LIB}telegram.server.ts`, "utf8");
    expect(source).toMatch(/const description = scrubTelegramToken\(/);
    expect(source).toMatch(/network failure`, scrubTelegramToken\(/);
  });

  test("sozlash skripti token yoki secret'ni chop etmaydi", () => {
    const offenders = SETUP_SCRIPT.split(/\r?\n/).filter(
      (line) => line.includes("console.") && (line.includes("${token}") || line.includes("${secretToken}")),
    );
    expect(offenders).toEqual([]);
  });

  test("webhook'ni faqat administrator skripti o'zgartiradi", () => {
    const setters = ["single-bot.server.ts", "telegram-link.functions.ts", "telegram-report.server.ts"].filter(
      (name) => readFileSync(`${LIB}${name}`, "utf8").includes('"setWebhook"'),
    );
    expect(setters).toEqual([]);
    expect(readFileSync(`${LIB}../routes/api/public/telegram/webhook.ts`, "utf8")).not.toContain("setWebhook");
  });
});
