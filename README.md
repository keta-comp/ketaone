# KetaOne — Keta Sales

Tarmoqqa o'zi moslashadigan CRM va Telegram ish joyi. Bitta platforma — stomatologiya,
klinika, o'quv markazi, salon, avtoservis, xizmat ko'rsatish va yana 7 soha uchun
turli bo'limlar, atamalar va jarayonlar bilan ishlaydi.

## Nima qiladi

- **Sohaga mos menyu** — 12 tayyor preset; har birida o'z modullari, terminologiyasi va yashirin bo'limlari
- **Mijozlar / o'quvchilar / bemorlar** — bitta katalog, so'nggi qabul va to'lov tarixi bilan
- **Qabul va bron** — xodim jadvali, band-vaqt tekshiruvi, onlayn bron sahifasi (`/b/<slug>`)
- **Moliya** — to'lovlar, xarajatlar, oylik, ombor va narxlar
- **Telegram bot** — parol bilan kirish, kunlik/haftalik/oylik hisobot, bugungi qabullar
  (✅ Tasdiq / ❌ Bekor), botdan yangi qabul ochish va 🆕 bildirishnomalar
- **AI yordamchi** — OpenRouter yoki Gemini orqali savol-javob va CRM konfiguratsiyasi
- **Jamoa** — rollar va ruxsatlar (`appointments.manage`, `finance.view`, `settings.manage`, …), filiallar
- **Super-admin paneli** — `/super-admin`: organizatsiyalar, xatolar jurnali, audit, limitlar

## Arxitektura

| Qatlam           | Yechim                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Ilova            | React 19 + TanStack Start (server functions) + file-based routing, Vite, Tailwind 4                 |
| Baza             | Neon Postgres. **Tenant chegarasi — RLS**: har so'rov `app.user_id` + `SET LOCAL ROLE` bilan o'tadi |
| Ma'lumot katlami | `src/lib/pg-rest.server.ts` — PostgREST-ga mos yozilgan qatlam (`supabaseAdmin` nomi shu yerda)     |
| Auth             | Neon Auth (Better Auth), sessiya `keta_session` cookie'sida                                         |
| Fayllar          | S3 mos saqlagich (Neon Storage / R2 / AWS), `branding/` va `crm_attachments/` prefikslari           |
| Telegram         | Bitta bot (`TELEGRAM_BOT_TOKEN`), webhook + `TELEGRAM_WEBHOOK_SECRET` (bo'lmasa token'dan HMAC)     |
| Qurish           | nitro — Cloudflare yoki Vercel preseti bilan                                                        |

## Ishga tushirish

```bash
npm install
cp .env.example .env.local     # NEON_DATABASE_URL, NEON_AUTH_ISSUER, TELEGRAM_BOT_TOKEN
npm run dev                    # http://localhost:5173
```

Sxema `supabase/migrations/` dan `scripts/neon-transform.mjs` orqali
`neon/0001_neon_schema.sql` ga yig'iladi va Neon'ga tushiriladi:

```bash
node scripts/neon-apply.mjs                                   # butun sxema
node scripts/neon-apply.mjs --file=supabase/migrations/<fayl>.sql  # faqat yangi migratsiya
node scripts/neon-sync.mjs                                    # toza bazaga qayta qurish + tekshiruvlar
```

Telegram botni ishga tushirish (webhook + `/buyruqlar` ro'yxati):

```bash
node scripts/telegram-setup.mjs
node scripts/telegram-setup.mjs --check
```

## Tekshirish

```bash
./node_modules/.bin/tsc --noEmit   # tiplar
npm run build                      # production qurish
npm test                           # bun test (bun kerak) — 148 test
npm run lint                       # eslint
```

## Deploy va cron

- Vercel: [`docs/VERCEL.md`](docs/VERCEL.md) — `vercel.json` dagi `crons` kunlik hisobot va
  eslatmalarni har 15 daqiqada chaqiradi
- Boshqa hosting (Cloudflare, Lovable, VPS): `.github/workflows/scheduler.yml`
- To'liq qo'llanma: [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md)
- Holatni tekshirish: `GET /api/health`

## Struktura

```
src/lib/          biznes logikasi, server funksiyalari, Telegram boti, presetlar
src/routes/       file-based routing (_authenticated = dashboard, api/public = webhook va cron)
src/components/   UI (shadcn primitivlari ui/ da)
supabase/migrations/  sxema manbasi  →  neon/0001_neon_schema.sql
scripts/          Neon pipelini, bot setup, tekshiruv skriptlari
docs/             self-hosting va Vercel qo'llanmalari
roadmap.md        qilingan va rejalangan ishlar
```

## Muhim qoidalar

- **Maxfiy kalitlar faqat `.env.local` yoki hosting muhitida.** `.env` fayli repoda turadi —
  unga hech narsa yozmang.
- **RLS aylanib o'tilmaydi:** tenant ma'lumotlari `userClient(user_id)` orqali o'qiladi;
  `supabaseAdmin` (BYPASSRLS) faqat platform vazifalari uchun.
- Repo **Lovable**ga ulangan: chop etilgan tarixni qayta yozmang (force push, rebase, amend).
- **Murojaatlar (leads)** bo'limi mahsulotdan olib tashlandi: sahifa, Kanban, tez yaratish va
  preset kaliti o'chirilgan, `/dashboard/leads` `ALWAYS_HIDDEN_ROUTES`da doimiy yashirin.
  `leads` jadvallari bilan Telegram/Instagram agentining kirish oqimi (`notify_lead`) qoladi.
- Sohani o'zgartirmaydigan kod izohi yozilmaydi; matnlar o'zbek tilida, `t()` orqali.
