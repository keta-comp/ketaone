import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const emailSchema = z.string().trim().email().max(200);
const passwordSchema = z.string().min(8).max(200);

export const signUp = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        email: emailSchema,
        password: passwordSchema,
        fullName: z.string().trim().min(1).max(120),
        businessName: z.string().trim().max(160).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { signUpWithPassword } = await import("./auth.server");
    const { userId } = await signUpWithPassword({
      email: data.email,
      password: data.password,
      name: data.fullName,
    });

    // Signup trigger biznesni foydalanuvchi ismi bilan yaratadi; shakldagi biznes
    // nomi ko'rsatilgan bo'lsa, uni egasining o'z huquqi bilan yangilaymiz.
    const businessName = data.businessName?.trim();
    if (userId && businessName) {
      const { userClient } = await import("./pg-rest.server");
      const db = userClient(userId);
      const { data: business } = await db
        .from("businesses")
        .select("id")
        .eq("owner_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (business?.id) {
        await db.from("businesses").update({ name: businessName }).eq("id", business.id);
        await db
          .from("business_settings")
          .update({ business_name: businessName })
          .eq("business_id", business.id);
      }
    }

    return { userId };
  });

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ email: emailSchema, password: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { signInWithPassword } = await import("./auth.server");
    const { userId } = await signInWithPassword({ email: data.email, password: data.password });
    return { userId };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { signOut: endSession } = await import("./auth.server");
  await endSession();
  return { ok: true };
});

export const getAuthSession = createServerFn({ method: "GET" }).handler(async () => {
  const { currentSession } = await import("./auth.server");
  return (await currentSession()) ?? null;
});

export const applyPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().min(10).max(500), password: passwordSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const { resetPassword } = await import("./auth.server");
    await resetPassword(data.token, data.password);
    return { ok: true };
  });
