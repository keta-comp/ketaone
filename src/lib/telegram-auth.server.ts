/**
 * Bot ichida sayt hisobiga kirish.
 *
 * Oqim: email → parol → biznes → telegram_links yozuvi. Parol Neon Auth'da
 * tekshiriladi, tekshiruvdan keyin parol yozilgan xabar chatdan o'chiriladi va
 * parolning o'zi hech qayerda saqlanmaydi (telegram_bot_state'da faqat bosqich,
 * tasdiqlangan email va userId turadi). Bosqich 15 daqiqada eskiradi, urinishlar
 * soni cheklangan.
 */
import { authenticateWithoutSession } from "./auth.server";
import { deleteMessage, escapeHtml } from "./telegram.server";
import {
  MAX_LOGIN_ATTEMPTS,
  clearBotState,
  getBotState,
  setBotState,
  type BotBusiness,
} from "./telegram-bot-state.server";
import { createLinkRequest, isMainMenuText, linkUrl, sendMenu, sendMessage } from "./telegram-report.server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const CANCEL_BUTTON = {
  inline_keyboard: [[{ text: "✖️ Bekor qilish", callback_data: "auth:cancel" }]],
};

const PASSWORD_WARNING =
  "⚠️ Parol faqat tekshirish uchun ishlatiladi: u saqlanmaydi va tekshirilgach bu chatdagi xabar o‘chiriladi.\n\n" +
  "Xavfsizroq usul kerak bo‘lsa — /cancel bosing va «Xavfsiz havola» tugmasidan foydalaning.";

/** Ulanmagan foydalanuvchiga ikki kirish usulini taklif qiladi. */
export async function sendAuthIntro(input: {
  token: string;
  chatId: string | number;
  telegramUserId: string;
  username: string | null;
  intro: string;
}) {
  const code = await createLinkRequest({
    telegramUserId: input.telegramUserId,
    telegramChatId: String(input.chatId),
    telegramUsername: input.username,
  });
  await sendMessage(input.token, input.chatId, `${input.intro}\n\n<b>Qaysi usulda kirasiz?</b>`, {
    inline_keyboard: [
      [{ text: "🔑 Email va parol bilan kirish", callback_data: "auth:login" }],
      [{ text: "🔗 Xavfsiz havola orqali", url: linkUrl(code) }],
    ],
  });
}

async function startCredentialsFlow(input: {
  token: string;
  chatId: string | number;
  telegramUserId: string;
}) {
  await setBotState({
    telegramUserId: input.telegramUserId,
    chatId: String(input.chatId),
    step: "awaiting_email",
  });
  await sendMessage(
    input.token,
    input.chatId,
    "🔑 <b>Kirish</b>\n\nSaytdagi <b>email</b> manzilingizni yuboring.\n\nMasalan: biznes@example.com",
    CANCEL_BUTTON,
  );
}

async function askPassword(token: string, chatId: string | number, email: string) {
  await sendMessage(
    token,
    chatId,
    `🔐 <b>${escapeHtml(email)}</b> uchun <b>parolni</b> yuboring.\n\n${PASSWORD_WARNING}`,
    CANCEL_BUTTON,
  );
}

async function businessNotFound(token: string, chatId: string | number, telegramUserId: string) {
  await clearBotState(telegramUserId);
  await sendMessage(
    token,
    chatId,
    "⚠️ Bu akkaunt hech bir biznesga a'zo emas. Saytda biznes yarating yoki jamoaga qo‘shilishingiz kerak.",
  );
}

async function bind(input: {
  token: string;
  chatId: string | number;
  telegramUserId: string;
  username: string | null;
  userId: string;
  email: string;
  business: BotBusiness;
}) {
  const { supabaseAdmin } = await import("@/lib/platform.server");
  const { userClient } = await import("./pg-rest.server");

  try {
    const { assertFeature } = await import("./billing.server");
    await assertFeature(userClient(input.userId), "telegram_reports");
  } catch (error) {
    await clearBotState(input.telegramUserId);
    await sendMessage(
      input.token,
      input.chatId,
      `⛔️ ${escapeHtml(error instanceof Error ? error.message : "Bot orqali kirish bu tarifda mavjud emas.")}`,
    );
    return;
  }

  const { error: linkError } = await supabaseAdmin
    .from("telegram_links")
    .upsert(
      {
        telegram_user_id: input.telegramUserId,
        telegram_chat_id: String(input.chatId),
        telegram_username: input.username,
        user_id: input.userId,
        business_id: input.business.id,
        status: "active",
        notify_booking: true,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "telegram_user_id" },
    );
  if (linkError) {
    await sendMessage(input.token, input.chatId, "⚠️ Ulanishni saqlab bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.");
    return;
  }

  const { logAudit } = await import("./audit.server");
  await logAudit({
    actorUserId: input.userId,
    actorEmail: input.email,
    actorKind: "user",
    action: "telegram.bot_login",
    targetType: "telegram_link",
    targetLabel: input.telegramUserId,
    businessId: input.business.id,
    status: "success",
    ip: null,
    metadata: { channel: "telegram_bot" },
  });

  await clearBotState(input.telegramUserId);
  await sendMenu(
    input.token,
    input.chatId,
    `✅ <b>${escapeHtml(input.business.name)}</b> bilan ulang.\n\nHisobot, bugungi qabullar va yangi qabul — hammasi shu yerda.`,
  );
}

async function afterCredentialsVerified(input: {
  token: string;
  chatId: string | number;
  telegramUserId: string;
  username: string | null;
  userId: string;
  email: string;
}) {
  const businesses = await businessesOf(input.userId);
  const primary = businesses[0];
  if (!primary) {
    await businessNotFound(input.token, input.chatId, input.telegramUserId);
    return;
  }
  if (businesses.length === 1) {
    await bind({ ...input, business: primary });
    return;
  }
  await setBotState({
    telegramUserId: input.telegramUserId,
    chatId: String(input.chatId),
    step: "awaiting_business",
    data: { email: input.email, userId: input.userId, businesses },
  });
  await sendMessage(input.token, input.chatId, "🏢 <b>Qaysi biznesni</b> ulang?", {
    inline_keyboard: businesses.slice(0, 8).map((item) => [{ text: item.name, callback_data: `auth:biz:${item.id}` }]),
  });
}

/** Tasdiqlangan foydalanuvchining faol bizneslari — RLS ostida, a'zo emaslar ko'rinmaydi. */
async function businessesOf(userId: string): Promise<BotBusiness[]> {
  const { userClient } = await import("./pg-rest.server");
  const client = userClient(userId);
  const { data: members, error } = await client
    .from("business_members")
    .select("business_id")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const ids = Array.from(new Set((members ?? []).map((row: { business_id: string }) => row.business_id)));
  if (!ids.length) return [];
  const { data: rows } = await client
    .from("businesses")
    .select("id, name")
    .in("id", ids)
    .neq("status", "suspended");
  const nameById = new Map<string, string>();
  for (const row of (rows ?? []) as Array<{ id: string; name: string }>) nameById.set(row.id, row.name);
  // Tartib business_members ketma-ketligida qoladi: birinchisi — asosiy biznes.
  return ids.filter((id) => nameById.has(id)).map((id) => ({ id, name: nameById.get(id) ?? "" }));
}

async function handleFailedAttempt(input: {
  token: string;
  chatId: string | number;
  telegramUserId: string;
  email: string;
  attempts: number;
}) {
  if (input.attempts >= MAX_LOGIN_ATTEMPTS) {
    await clearBotState(input.telegramUserId);
    await sendMessage(
      input.token,
      input.chatId,
      `🚫 Juda ko‘p urinish. 15 daqiqadan so‘ng qayta urinib ko‘ring\nyoki «🔗 Xavfsiz havola orqali» tugmasidan foydalaning.`,
    );
    return;
  }
  // Email tasdiqlangan holatda qoladi — foydalanuvchi faqat parolni qayta yozadi.
  await setBotState({
    telegramUserId: input.telegramUserId,
    chatId: String(input.chatId),
    step: "awaiting_password",
    data: { email: input.email },
    attempts: input.attempts,
  });
  await sendMessage(
    input.token,
    input.chatId,
    `⛔️ Email yoki parol xato. Qolgan urinishlar: <b>${MAX_LOGIN_ATTEMPTS - input.attempts}</b>.\n\n` +
      "Parolni unutdingizmi? «🔗 Xavfsiz havola orqali» tugmasi parol talab qilmaydi.",
    CANCEL_BUTTON,
  );
}

export async function handleAuthCallback(input: {
  token: string;
  chatId: string | number;
  telegramUserId: string;
  username: string | null;
  data: string;
}): Promise<boolean> {
  const { token, chatId, telegramUserId, data } = input;

  if (data === "auth:login") {
    await startCredentialsFlow({ token, chatId, telegramUserId });
    return true;
  }
  if (data === "auth:link") {
    const code = await createLinkRequest({
      telegramUserId,
      telegramChatId: String(chatId),
      telegramUsername: input.username,
    });
    await sendMessage(token, chatId, "🔗 Havola bir martalik va 30 daqiqa amal qiladi.", {
      inline_keyboard: [[{ text: "🔗 KetaOne akkauntini ulash", url: linkUrl(code) }]],
    });
    return true;
  }
  if (data === "auth:cancel") {
    await clearBotState(telegramUserId);
    await sendMenu(token, chatId, "Bekor qilindi. Kerakli bo‘limni tanlang 👇");
    return true;
  }
  if (data.startsWith("auth:biz:")) {
    const state = await getBotState(telegramUserId);
    const business = (state?.data.businesses ?? []).find((item) => item.id === data.slice("auth:biz:".length));
    const userId = state?.data.userId;
    const email = state?.data.email ?? "";
    if (state?.state !== "awaiting_business" || !business || !userId) {
      await clearBotState(telegramUserId);
      await sendMessage(token, chatId, "⏱️ Bu so‘rov eskirgan — qaytadan <b>/start</b> bosing.");
      return true;
    }
    await bind({
      token,
      chatId,
      telegramUserId,
      username: input.username,
      userId,
      email,
      business,
    });
    return true;
  }
  return false;
}

export async function handleAuthText(input: {
  token: string;
  chatId: string | number;
  telegramUserId: string;
  username: string | null;
  text: string;
  messageId: number | string;
}): Promise<boolean> {
  const state = await getBotState(input.telegramUserId);
  if (!state || (state.state !== "awaiting_email" && state.state !== "awaiting_password")) return false;

  const { token, chatId, telegramUserId } = input;
  const text = input.text.trim();

  if (text === "/cancel" || /^\/start\b/.test(text)) {
    await clearBotState(telegramUserId);
    return false; // router /start menyuini o'zi ko'rsatadi
  }

  // Doimiy klaviatura tugmasi parol urinishi hisoblanmaydi: bosqich o'rnida
  // qoladi, xabarni router bajaradi.
  if (isMainMenuText(text)) return false;

  if (text.startsWith("/reset")) {
    await sendMessage(
      token,
      chatId,
      "🔑 Email orqali parol tiklash bu serverda yo‘q — Neon Auth email transporti sozlanmagan, hech qanday havola yuborilmaydi.\n\n" +
        "Parolsiz kirish: «🔗 Xavfsiz havola orqali» tugmasini bosing.\n" +
        "Yangi parol kerak bo‘lsa: keta.comp.dev@gmail.com ga yozing — administrator parolni qo‘lda belgilaydi.",
      CANCEL_BUTTON,
    );
    return true;
  }

  if (state.state === "awaiting_email") {
    if (!EMAIL_PATTERN.test(text)) {
      await sendMessage(token, chatId, "⛔️ Email formati noto‘g‘ri. Qayta yuboring yoki /cancel bosing.", CANCEL_BUTTON);
      return true;
    }
    await setBotState({
      telegramUserId,
      chatId: String(chatId),
      step: "awaiting_password",
      data: { email: text },
      attempts: state.attempts,
    });
    await askPassword(token, chatId, text);
    return true;
  }

  // awaiting_password — qatorni faqat tekshirishga olamiz: trim qilmaymiz, keyin o'chiramiz.
  const email = state.data.email ?? "";
  let verified: { userId: string } | null = null;
  try {
    if (email) verified = await authenticateWithoutSession({ email, password: input.text });
  } catch {
    verified = null; // Better Auth xabari parol/email mazmunini ochmasligi kerak
  } finally {
    if (input.messageId) await deleteMessage(token, chatId, input.messageId);
  }

  if (!verified) {
    await handleFailedAttempt({
      token,
      chatId,
      telegramUserId,
      email,
      attempts: state.attempts + 1,
    });
    return true;
  }

  await afterCredentialsVerified({
    token,
    chatId,
    telegramUserId,
    username: input.username,
    userId: verified.userId,
    email,
  });
  return true;
}
