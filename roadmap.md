
## 2026-09-22
- [x] Lidlar: Kanban/jadval, bosqich almashtirish.
- [x] amoCRM reja 1-qadam: interaktiv lid kartochkasi (bosqich chizig‘i, aloqa, maydonlar, tarix).
- [x] amoCRM reja 2-qadam: lid ichida keyingi qadam vazifalari + Kanbanda «Muddati o‘tgan / Bugungi / Vazifa yo‘q» belgilari.
- [x] CRM qulayligi: sahifa xatosi tuzatildi; muloqotlar, mahsulotlar va tarif/to‘lov menyuga qo‘shildi; haqiqiy hisobda sahifalar, to‘rtta tildagi havolalar va qisqa ekranda menyu tekshirildi.
- [ ] Instagram DM integratsiyasi: kodi tayyor, META kalitlari (page token, app secret, verify token) foydalanuvchidan kutilmoqda
- [ ] SalesPilot onboarding wizard + dinamik CRM engine (user-uploads://SalesPilot_AI_ning_onboarding_va_CRM_tizimini_pasted.md) — soha tanlash, AI CRM konfiguratsiyasi, sohaga mos pipeline/modullar/terminologiya

## 2026-09-22 — CRM engine qurish (tasdiqlandi: ko'p foydalanuvchili, legacy saqlanadi, nom Keta Sales)
- [x] Migratsiya: crm_configs, crm_records + RLS + realtime
- [x] Registratsiyani yoqish + signup UI
- [x] Onboarding wizard (/onboarding) — soha → tavsif → AI config
- [x] Dinamik CRM sahifalari + sidebar + dashboard widgetlar
- [x] AI CRM Builder
- [x] Telegram agent terminologiyasi
- [x] CRM sozlanmagan user gate
- [ ] Publish qilish (yangi CRM tizimi production'da ishlashi uchun)

## 2026-10-30 — Telegram bot = biznes egasining ish joyi
- [x] Bot ichida kirish: email+parol (parol tekshiriladi va xabar o'chiriladi) yoki bir martalik havola
- [x] Botdan barcha hisobotlar + 🗓 bugungi qabullar (✅ Tasdiq / ❌ Bekor / 👤 Mijoz)
- [x] Botdan tez qabul ochish: mijoz qidirish → tanlash yoki shu joyda yangi mijoz, vaqt, xodim/xizmat avtomatik
- [x] 🆕 Yangi qabul bildirishnomasi (sayt va bot orqali ochilgan qabullar uchun)
- [x] Suhbat holati uchun `telegram_bot_state` jadvali (migratsiya + sxema mirror)
- [x] Cron uchun ikkala manzil GET/POST + `Authorization: Bearer` ni qabul qiladi, `vercel.json` da `crons` qo'shildi, `.github/workflows/scheduler.yml` yozildi
- [x] `scripts/telegram-setup.mjs` — setWebhook + setMyCommands; `neon-apply.mjs` ga `--file=` qo'shildi
- [x] **Migratsiyani jonli Neon'ga qo'llash** — `.env.local` da `NEON_DATABASE_URL` bor, sxema jonli bazada
- [x] `TELEGRAM_BOT_TOKEN` + `PUBLIC_APP_URL` va `node scripts/telegram-setup.mjs --apply` — webhook `https://www.nexora-crm.uz/api/public/telegram/webhook` da
- [x] Fayl saqlash — `S3_*` o'rniga Neon `public.storage_objects` (bytea + bo'laklab yuklash); kod va lokal sinov tayyor, production'da deploy bilan ochiladi
- [ ] Hostingga mos cron yoqish (Vercel `crons` yoki GitHub Actions workflow)
- [ ] Tarif cheklovi (`VITE_BILLING_ENFORCED="true"`) — hozir hamma feature ochiq
