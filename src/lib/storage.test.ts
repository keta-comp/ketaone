// @ts-nocheck
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  BUCKET_LIMITS,
  MAX_CHUNK_BYTES,
  businessIdOfPath,
  deleteObjects,
  objectKey,
  readObject,
  signedDownloadUrl,
  signedUploadUrl,
  verifyToken,
  writeChunk,
} from "@/lib/storage.server";

const BUSINESS = "3f2b7c1a-9d4e-4a11-8c2b-5f6a7b8c9d01";
const SECRET = "test-url-secret";

beforeAll(() => {
  process.env["STORAGE_URL_SECRET"] = SECRET;
});

describe("yuklash/o'qish tokeni", () => {
  test("token o'z ichida bucket, yo'l, tur va hajmni ushlaydi", async () => {
    const url = await signedUploadUrl("crm_attachments", `${BUSINESS}/hujjat/rentgen.pdf`, "application/pdf", 300, 4_000_000);
    expect(url.startsWith("/api/storage/upload?token=")).toBe(true);
    const grant = verifyToken(decodeURIComponent(url.split("token=")[1]));
    expect(grant).toMatchObject({ a: "put", b: "crm_attachments", c: "application/pdf", s: 4_000_000 });
    expect(grant.p).toBe(`${BUSINESS}/hujjat/rentgen.pdf`);
  });

  test("imzo buzilgan token rad etiladi", async () => {
    const url = await signedDownloadUrl("branding", `${BUSINESS}/logo.png`, 120);
    const token = url.split("token=")[1];
    const [body, signature] = token.split(".");
    expect(verifyToken(`${body}.${signature.slice(0, -4)}AAAA`)).toBeNull();
    // Butunlay boshqa kalit bilan tuzilgan token ham ishlamaydi.
    process.env["STORAGE_URL_SECRET"] = "boshqa-kalit";
    expect(verifyToken(token)).toBeNull();
    process.env["STORAGE_URL_SECRET"] = SECRET;
  });

  test("muddati o'tgan token rad etiladi", async () => {
    const url = await signedDownloadUrl("branding", `${BUSINESS}/logo.png`, -10);
    expect(verifyToken(decodeURIComponent(url.split("token=")[1]))).toBeNull();
  });

  test("o'qish tokeni yuklash huquqini bermaydi", async () => {
    const url = await signedDownloadUrl("branding", `${BUSINESS}/logo.png`, 120);
    const grant = verifyToken(decodeURIComponent(url.split("token=")[1]));
    expect(grant.a).toBe("get");
  });
});

describe("fayl yo'li tenant chegarasi", () => {
  test("yo'l biznes id'si bilan boshlanishi shart", () => {
    expect(() => objectKey("branding", "logo.png")).toThrow();
    expect(() => objectKey("branding", `${"0".repeat(8)}-0000-0000-0000-000000000000/logo.png`)).not.toThrow();
    expect(businessIdOfPath(`${BUSINESS}/logo.png`)).toBe(BUSINESS);
    expect(businessIdOfPath("../etc/passwd")).toBeNull();
  });

  test(".. orqali boshqa yo'lga chiqib bo'lmaydi", async () => {
    await expect(signedDownloadUrl("branding", `${BUSINESS}/../../maxfiy.png`)).rejects.toThrow();
    await expect(signedUploadUrl("branding", `${BUSINESS}/../boshqa.png`, "image/png")).rejects.toThrow();
  });

  test("nomalum bucket qabul qilinmaydi", async () => {
    await expect(signedDownloadUrl("eviltt", `${BUSINESS}/logo.png`, 60)).rejects.toThrow();
  });
});

describe("hajm chegaralari", () => {
  test("logotip 2 MB, biriktirma 15 MB dan oshmaydi", () => {
    expect(BUCKET_LIMITS.branding).toBe(2 * 1024 * 1024);
    expect(BUCKET_LIMITS.crm_attachments).toBe(15 * 1024 * 1024);
    // Bo'lak Vercel'ning 4,5 MB so'rov chegarasidan kichik.
    expect(MAX_CHUNK_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });

  test("token hajmi chegaradan oshsa havola berilmaydi", async () => {
    await expect(signedUploadUrl("branding", `${BUSINESS}/logo.png`, "image/png", 300, 5_000_000)).rejects.toThrow();
    await expect(
      signedUploadUrl("crm_attachments", `${BUSINESS}/a.pdf`, "application/pdf", 300, 20 * 1024 * 1024),
    ).rejects.toThrow();
  });

  test("bo'lak umumiy hajmdan oshib keta olmaydi", async () => {
    await expect(
      writeChunk({
        bucket: "branding",
        path: `${BUSINESS}/logo.png`,
        contentType: "image/png",
        offset: 0,
        total: 10,
        chunk: Buffer.alloc(32),
      }),
    ).rejects.toThrow("Bo'lak fayl oxiridan oshib ketdi.");
  });
});

describe("saqlash qatlami xavfsizligi", () => {
  const source = readFileSync("src/lib/storage.server.ts", "utf8");

  test("S3 kalitlari va @aws-sdk kodga qaytmaydi", () => {
    expect(source).not.toContain("@aws-sdk");
    expect(source).not.toContain("S3_BUCKET");
    const files = ["src/lib/settings.functions.ts", "src/lib/crm-config.functions.ts", "src/lib/public-booking.functions.ts"];
    for (const file of files) expect(readFileSync(file, "utf8")).not.toContain("S3_");
  });

  test("o'qish faqat tugallangan faylni beradi", () => {
    expect(readObject.toString()).toContain("size_bytes > 0");
  });

  test("o'chirish RLS ostida (asUser), yozish token ostida (asService)", () => {
    expect(deleteObjects.toString()).toContain("asUser");
    expect(source).toMatch(/export async function writeChunk[\s\S]*?asService/);
    expect(source).toMatch(/export async function readObject[\s\S]*?asService/);
  });

  test("maxfiy so'z muhit o'zgaruvchisidan keladi, bazaga emas", () => {
    expect(source).toContain("STORAGE_URL_SECRET");
    expect(source).toContain('update("storage-url")');
  });
});
