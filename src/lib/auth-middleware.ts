// Server funksiyalari uchun autentifikatsiya: Neon Auth sessiyasi + RLS klienti.
//
// Eksport nomi (`requireSupabaseAuth`) saqlangan — chaqiruv joylari o'zgarmagan,
// ammo ostida Supabase emas, Neon (`app_user` roli) ishlaydi.
import { createMiddleware } from "@tanstack/react-start";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { requireSession } = await import("@/lib/auth.server");
  const { userClient } = await import("@/lib/pg-rest.server");

  const session = await requireSession();
  // Xato qaysi biznesdan kelgani `error_events`da ko'rinishi uchun foydalanuvchini
  // so'rov kontekstiga yozamiz (node:async_hooks — faqat server, dinamik import).
  const { stampRequestContext } = await import("./request-context.server");
  stampRequestContext({ userId: session.userId });

  return next({
    context: {
      supabase: userClient(session.userId),
      userId: session.userId,
      claims: { sub: session.userId, email: session.email },
    },
  });
});
