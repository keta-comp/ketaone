// Fayllar Neon'da saqlanadi: `public.storage_objects` jadvalidagi bytea.
//
// S3 presigned URL shakli ataylab saqlab qolindi — server qisqa muddatli HMAC
// token beradi, brauzer faylni o'sha manzilga PUT qiladi va o'sha manzildan
// oladi. Shuning uchun `/api/storage/*` yo'llari sessiyaga emas, faqat tokenga
// qaraydi: token kimga va qaysi faylga ruxat berishini o'zida ushlab yuradi
// (bucket + path + content-type + muddat). Ruxsatni beradigan joy esa server
// funksiyalari — ular RLS ostida tekshiriladi, yo'l esa `{businessId}/` bilan
// boshlanishini majburlaydi.
//
// Katta fayllar bo'laklab yuboriladi: Vercel'da so'rov tanasi 4,5 MB bilan
// cheklangan, shuning uchun klijent 3 MB'lik bo'laklar yuboradi va server
// `octet_length(data) = offset` sharti bilan ketma-ketlikni tekshiradi.
// `size_bytes = 0` — fayl hali to'liq tushmagan degani; bunday obyekt o'qilmaydi.
import { createHmac, timingSafeEqual } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { storageObjects } from "@/db/schema";
import { asService, asUser } from "./db";

export type StorageBucket = "branding" | "crm_attachments";

/** Har bir bucket uchun shift: logo kichik, tibbiy hujjat 15 MB gacha. */
export const BUCKET_LIMITS: Record<StorageBucket, number> = {
  branding: 2 * 1024 * 1024,
  crm_attachments: 15 * 1024 * 1024,
};

/** Vercel'ning 4,5 MB so'rov chegarasi ostida qoladigan bo'lak. */
export const MAX_CHUNK_BYTES = 3 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function urlSecret(): string {
  const explicit = process.env["STORAGE_URL_SECRET"]?.trim();
  if (explicit) return explicit;
  const connectionUrl = process.env["NEON_DATABASE_URL"];
  if (!connectionUrl) {
    throw new Error("Fayl saqlash sozlanmagan: NEON_DATABASE_URL muhit o'zgaruvchisi yo'q.");
  }
  // Baza manzili faqat serverda — uni kalit sifatida ishlatish yangi maxfiy
  // so'z sozlashni talab qilmaydi. STORAGE_URL_SECRET qo'yilsa, u ustun.
  return createHmac("sha256", connectionUrl).update("storage-url").digest("base64url");
}

type Grant = {
  /** "put" — yuklash, "get" — o'qish. */
  a: "put" | "get";
  b: StorageBucket;
  p: string;
  /** Yuklashda: kutilayotgan umumiy hajm; o'qishda: yo'q. */
  s?: number;
  /** Faqat "put": content-type qulfi. */
  c?: string;
  /** Eskitish vaqti (soniya). */
  e: number;
};

function sign(body: string): string {
  return createHmac("sha256", urlSecret()).update(body).digest("base64url");
}

function issue(grant: Grant): string {
  const body = Buffer.from(JSON.stringify(grant), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Tokenni tekshiradi: imzo (doimiy vaqt), muddat va bucket yo'li. Xato bo'lsa null. */
export function verifyToken(token: string): Grant | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(signature, "base64url");
  const actual = Buffer.from(sign(body), "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let grant: Grant;
  try {
    grant = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Grant;
  } catch {
    return null;
  }
  if (grant.a !== "put" && grant.a !== "get") return null;
  if (!(grant.e > Math.floor(Date.now() / 1000))) return null;
  if (!isAllowedPath(grant.b, grant.p)) return null;
  return grant;
}

/** Yo'l bo'sh emas, `..` yo'q va birinchi segment — tenant id'si. */
function isAllowedPath(bucket: StorageBucket, path: string): boolean {
  if (!Object.hasOwn(BUCKET_LIMITS, bucket)) return false;
  const clean = path.replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.length > 600) return false;
  return businessIdOfPath(clean) !== null;
}

export function objectKey(bucket: StorageBucket, path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (!isAllowedPath(bucket, clean)) throw new Error("Fayl yo'li noto'g'ri.");
  return clean;
}

/** Yo'lning birinchi segmenti — tenant chegarasi. */
export function businessIdOfPath(path: string): string | null {
  const segment = path.split("/")[0]?.toLowerCase();
  return segment && UUID_RE.test(segment) ? segment : null;
}

function storageUrl(route: "upload" | "object", token: string): string {
  return `/api/storage/${route}?token=${encodeURIComponent(token)}`;
}

/**
 * Yuklash havolasi. `total` bilan bind qilinadi: token o'g'irlansa ham undan
 * ko'p yozib bo'lmaydi va bo'laklar shu hajmgacha davom etadi.
 */
export async function signedUploadUrl(
  bucket: StorageBucket,
  path: string,
  contentType: string,
  seconds = 300,
  totalBytes?: number,
): Promise<string> {
  const key = objectKey(bucket, path);
  const total = totalBytes ?? BUCKET_LIMITS[bucket];
  if (total <= 0 || total > BUCKET_LIMITS[bucket]) {
    throw new Error(
      bucket === "branding" ? "Logotip hajmi 2 MB dan kichik bo'lsin." : "Fayl hajmi 15 MB dan oshmasin.",
    );
  }
  return storageUrl(
    "upload",
    issue({ a: "put", b: bucket, p: key, c: contentType, s: total, e: Math.floor(Date.now() / 1000) + seconds }),
  );
}

/** O'qish havolasi — qisqa muddatli, sessiyasiz ishlaydi (<img>, window.open). */
export async function signedDownloadUrl(
  bucket: StorageBucket,
  path: string,
  seconds = 120,
): Promise<string> {
  const key = objectKey(bucket, path);
  return storageUrl("object", issue({ a: "get", b: bucket, p: key, e: Math.floor(Date.now() / 1000) + seconds }));
}

export type StorageObject = { contentType: string; data: Buffer };

/** Faylni o'qiydi; tugallanmagan (size_bytes = 0) yoki yo'q bo'lsa null. */
export async function readObject(bucket: StorageBucket, path: string): Promise<StorageObject | null> {
  const key = objectKey(bucket, path);
  const rows = (await asService((tx) =>
    tx.execute(
      sql`SELECT content_type, data FROM public.storage_objects
          WHERE bucket = ${bucket} AND path = ${key} AND size_bytes > 0 LIMIT 1`,
    ),
  )) as unknown as Array<{ content_type: string; data: Buffer }>;
  const row = rows[0];
  return row ? { contentType: row.content_type, data: row.data } : null;
}

/**
 * Bitta bo'lakni yozadi. `true` — fayl to'liq tushdi va ko'rinadigan holatga
 * o'tdi; `false` — davomi kutilmoqda. Ketma-ketlik buzilsa xato beradi.
 */
export async function writeChunk(input: {
  bucket: StorageBucket;
  path: string;
  contentType: string;
  offset: number;
  total: number;
  chunk: Buffer;
}): Promise<boolean> {
  const { bucket, contentType, offset, total, chunk } = input;
  const path = objectKey(bucket, input.path);
  const businessId = businessIdOfPath(path);
  if (!businessId) throw new Error("Fayl yo'li noto'g'ri.");
  if (!chunk.length) throw new Error("Bo'lak bo'sh.");
  if (chunk.length > MAX_CHUNK_BYTES) throw new Error("Bo'lak hajmi 3 MB dan oshmasin.");
  if (offset + chunk.length > total) throw new Error("Bo'lak fayl oxiridan oshib ketdi.");
  if (total > BUCKET_LIMITS[bucket]) throw new Error("Fayl hajmi ruxsat etilgan chegaradan oshdi.");
  const complete = offset + chunk.length === total;

  await asService(async (tx) => {
    if (offset === 0) {
      await tx.execute(sql`
        INSERT INTO public.storage_objects (bucket, path, business_id, content_type, size_bytes, data)
        VALUES (${bucket}, ${path}, ${businessId}::uuid, ${contentType}, 0, ${chunk})
        ON CONFLICT (bucket, path) DO UPDATE
          SET data = excluded.data, content_type = excluded.content_type, size_bytes = 0`);
      if (!complete) return;
    } else {
      const updated = (await tx.execute(sql`
        UPDATE public.storage_objects SET data = data || ${chunk}
        WHERE bucket = ${bucket} AND path = ${path} AND octet_length(data) = ${offset}
        RETURNING 1 AS ok`)) as unknown as Array<{ ok: number }>;
      if (!updated[0]) {
        throw new StorageChunkError("Bo'lak ketma-ketligi buzildi — qaytadan yuklab ko'ring.");
      }
      if (!complete) return;
    }
    await tx.execute(sql`
      UPDATE public.storage_objects SET size_bytes = octet_length(data)
      WHERE bucket = ${bucket} AND path = ${path}`);
  });

  return complete;
}

/** Ketma-ketlik buzilishi — route 409 qaytarishi uchun belgili xato turi. */
export class StorageChunkError extends Error {}

/** Fayllarni o'chirish RLS ostida: so'rovni yuborgan a'zo o'z biznesidagina kira oladi. */
export async function deleteObjects(bucket: StorageBucket, paths: string[], userId: string): Promise<number> {
  const keys = paths.map((path) => path.trim()).filter(Boolean).map((path) => objectKey(bucket, path));
  if (!keys.length) return 0;
  await asUser(userId, (tx) =>
    tx
      .delete(storageObjects)
      .where(and(eq(storageObjects.bucket, bucket), inArray(storageObjects.path, keys))),
  );
  return keys.length;
}
