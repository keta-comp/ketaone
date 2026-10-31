import { createFileRoute } from "@tanstack/react-router";

/**
 * O'qish nuqtasi — qisqa muddatli HMAC token bilan. Sessiya kerak emas, shuning
 * uchun `<img>`, yangi oynada ochish va tashqi sahifa bir xil ishlaydi.
 * Fayl nomlari tenant id'si bilan boshlanadi, token esa aynan shu yo'lni
 * qulflaydi: boshqa biznesning fayliga havola yasab bo'lmaydi.
 */
export const Route = createFileRoute("/api/storage/object")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const storage = await import("@/lib/storage.server");
        const url = new URL(request.url);
        const grant = storage.verifyToken(url.searchParams.get("token") ?? "");
        if (!grant || grant.a !== "get") return new Response("Unauthorized", { status: 401 });

        const object = await storage.readObject(grant.b, grant.p);
        if (!object) return new Response("Fayl topilmadi yoki hali to'liq tushmagan.", { status: 404 });

        const name = grant.p.split("/").pop() ?? "fayl";
        return new Response(new Uint8Array(object.data), {
          headers: {
            "content-type": object.contentType || "application/octet-stream",
            "content-length": String(object.data.length),
            "content-disposition": `inline; filename="fayl"; filename*=UTF-8''${encodeURIComponent(name)}`,
            "cache-control": "private, max-age=60",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
