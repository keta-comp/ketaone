import { createFileRoute } from "@tanstack/react-router";

import { friendlyError } from "@/lib/friendly-error";

/**
 * Yuklash nuqtasi. Sessiyani talab qilmaydi: server funksiyasi bergan HMAC token
 * yo'l, content-type va umumiy hajmni o'zida qulflaydi, shuning uchun bu yerda
 * faqat imzo, muddat va ketma-ketlik tekshiriladi.
 *
 * Katta fayl 3 MB'lik bo'laklarda keladi (Vercel so'rov tanasi 4,5 MB). Har bir
 * bo'lak oldingisining davomi bo'lishi shart — aks holda 409 qaytamiz va
 * klijent boshidan yuklaydi.
 */
export const Route = createFileRoute("/api/storage/upload")({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const storage = await import("@/lib/storage.server");
        const url = new URL(request.url);
        const grant = storage.verifyToken(url.searchParams.get("token") ?? "");
        if (!grant || grant.a !== "put") return new Response("Unauthorized", { status: 401 });

        const offset = Number(url.searchParams.get("offset") ?? "0");
        if (!Number.isInteger(offset) || offset < 0) {
          return new Response("Bo'lak manzili noto'g'ri.", { status: 400 });
        }

        const contentType = request.headers.get("content-type") ?? "";
        if (grant.c && contentType && grant.c !== contentType) {
          return new Response("Fayl turi yuklash ruxsatidagi bilan bir xil emas.", { status: 400 });
        }

        let chunk: Buffer;
        try {
          chunk = Buffer.from(await request.arrayBuffer());
        } catch {
          return new Response("Bo'lak o'qilmadi.", { status: 400 });
        }
        if (!chunk.length) return new Response("Bo'lak bo'sh.", { status: 400 });

        try {
          const complete = await storage.writeChunk({
            bucket: grant.b,
            path: grant.p,
            contentType: grant.c || contentType || "application/octet-stream",
            offset,
            total: grant.s ?? 0,
            chunk,
          });
          return Response.json({ ok: true, complete });
        } catch (error) {
          const message = friendlyError(error, "Yuklash amalga oshmadi.");
          const status = error instanceof storage.StorageChunkError ? 409 : 400;
          return new Response(message, { status });
        }
      },
    },
  },
});
