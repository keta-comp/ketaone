# KetaOne — mustaqil serverda ishga tushirish

Baza **Neon Postgres**da, autentifikatsiya **Neon Auth**da (hosted Better Auth).
Supabase ishtiroki yo'q: 33+ jadval, RLS siyosatlari, funksiyalar va triggerlar
`neon/0001_neon_schema.sql` orqali quriladi; tenant chegarasi — `app_anon` /
`app_user` / `app_service` rollari va `app.user_id()` GUC'i.

---

## 1. Neon loyihasi (brauzerdan, 3 daqiqa)

1. [neon.tech](https://neon.tech) da loyiha + branch yarating (Compute & Storage
   disconnected rejasi ham yetadi).
2. **Roles & Databases** da `neondb_owner` parolini oling — e'tibor: u
   `BYPASSRLS`, ilova uni faqat sessiya/metama'lumot uchun ishlatadi; ilova
   so'rovlari `app_user` roli ostida RLS orqali o'tadi.
3. **Authentication** bo'limida Neon Auth'ni yoqing (Better Auth). Beriladigan
   manzil `https://ep-xxx.neonauth.<region>.aws.neon.tech/neondb/auth` ko'rinishida
   bo'ladi — havoladagi `-pooler` qismini olib tashlang.
4. Sxemani qo'llang (2-bosqichdagagi skript orqali).

## 2. Muhit o'zgaruvchilari

`.env.example` dan `.env.local` yarating:

- `NEON_DATABASE_URL` — pooler manzili, `?sslmode=require` bilan
- `NEON_AUTH_ISSUER` — 1-bosqichdagi auth manzili
- `NEON_JWKS_URL` — ixtiyoriy (hozircha kod uni o'qimaydi)
- `STORAGE_URL_SECRET` — ixtiyoriy. Fayllar Neon bazasidagi
  `public.storage_objects` jadvalida (bytea) saqlanadi: tashqi S3/R2 hisobi,
  endpoint va kalitlar kerak emas. Bo'sh qolsa yuklab olish/yuklash URL'laridagi
  qisqa muddatli token `NEON_DATABASE_URL`'dan HMAC bilan hisoblanadi. Logo 2 MB,
  biriktirma 15 MB gacha; katta fayllar 3 MB'lik bo'laklar bilan yuklanadi,
  shuning uchun hosting'da so'rov tanasi chegarasi kamida 4 MB bo'lishi yetarli
- `OPENROUTER_API_KEY` yoki `GEMINI_API_KEY` — AI uchun
- `TELEGRAM_BOT_TOKEN`, `PUBLIC_APP_URL` — bot va webhook. `PUBLIC_APP_URL` o'z
  domeningizni ko'rsatishi shart (sozlanmasa u production `https://www.nexora-crm.uz`
  deb olinadi, webhook shu manzilga ketadi). Maxfiy sarlavha ixtiyoriy:
  `TELEGRAM_WEBHOOK_SECRET` bo'lsa u, bo'lmasa token'dan HMAC hisoblanadi
- `LOVABLE_CRON_SECRET` — kunlik hisobot va eslatma cron himoyasi (Vercel'da
  `CRON_SECRET` ham yaroqli: birinchi kalit bo'lsa u, bo'lmasa ikkinchisi ishlatiladi)

## 3. Sxemani qo'llash

Barcha sxema o'zgarishlari `supabase/migrations/` da tarixiy manba bo'lib qoladi;
`scripts/neon-transform.mjs` ulardan `neon/0001_neon_schema.sql` ni yig'adi
(anon/authenticated/service_role rollari app_anon/app_user/app_service ga
almashadi), `scripts/neon-apply.mjs` uni Neon'ga tushiradi:

```bash
node scripts/neon-sync.mjs            # toza bazaga: reset + qurish + introspect + tekshiruv
node scripts/neon-sync.mjs --no-reset # mavjud ma'lumotni saqlab qayta qurish
node scripts/neon-apply.mjs           # faqat sxema faylini qo'llash
node scripts/neon-apply.mjs --file=supabase/migrations/<so'nggi_fayl>.sql
                                      # mavjud bazaga faqat bitta migratsiyani tushirish
node scripts/neon-drift.mjs           # sxema/migratsiya drift solishtiruvi
```

Mavjud (jonli) bazaga yangi migratsiya kerak bo'lsa `--file=` dan foydalaning.
Butun `neon/0001_neon_schema.sql` ni qayta qo'llash ham ma'lumotni buzmaydi,
ammo allaqachon bor obyektlar xato deb qaytadi (masalan `CREATE POLICY` da
`IF NOT EXISTS` yo'q), shuning uchun jernal shovqinli bo'ladi.
`NEON_DATABASE_URL` `.env.local` da qo'shtirnoq ichida bo'lishi shart.

`node_modules/.bin` orqali `drizzle-kit introspect` `src/db/schema.ts` ni
yangilaydi — kod uning ustidan ishlaydigan PostgREST moslik qatlamini
(`src/lib/pg-rest.server.ts`) ishlatadi.

## 4. Super Admin hisobini yaratish

1. Saytga kirib odatdagidek ro'yxatdan o'ting.
2. Neon → **SQL Editor** da bir marta bajaring:

```sql
insert into public.platform_admins (user_id, email)
select id, email from neon_auth."user" where email = 'SIZNING@EMAIL.COM'
on conflict do nothing;
```

Shundan keyin `/super-admin` bo'limi shu hisobga ochiladi.

## 5. Telegram webhook va /buyruqlar

Bitta buyruq bilan — webhook manzili, maxfiy sarlavha so'zi va bot menyusi:

```bash
node scripts/telegram-setup.mjs              # getMe + getWebhookInfo (hech narsa o'zgarmaydi)
node scripts/telegram-setup.mjs --apply      # setWebhook + setMyCommands
```

`TELEGRAM_BOT_TOKEN` va `PUBLIC_APP_URL` `.env.local` dan (yoki muhit
o'zgaruvchilaridan) olinadi. Skriptni ishga tushirmasdan turing bo'lmaydi:
webhook o'rnatilmasa Telegram hech qachon botga xabar yetkazmaydi.

Qo'lda (maxfiy sarlavhasiz) qilingan `setWebhook` app'dagi tekshiruvni yiqitadi —
webhook so'rovlar `x-telegram-bot-api-secret-token` bilan kelishini kutadi.

## 6. Kunlik hisobot va eslatmalar jadvali

Ikkita manzil ham har 15 daqiqada chaqiriladi; kalit `x-cron-secret` yoki
`Authorization: Bearer` sarlavhasida keladi, GET va POST ikkalasi ham qabul
qilinadi (Vercel Cron GET yuboradi):

- `POST|GET /api/public/telegram/daily-report` — har bir ulanuvchiga o'z
  `report_time` + `timezone` bo'yicha kunlik hisobot
- `POST|GET /api/public/reminders` — qabul/to'lov eslatmalari

Vercel'da `vercel.json` dagi `crons` bloki buni bajaradi; Cloudflare Workers,
Lovable yoki VPS'da `.github/workflows/scheduler.yml` ni yoqing (cron trigger'lar
faqat `/` ga GET yuborgani uchun Cloudflare'ning o'z jadvali mos kelmaydi).
(Ilgari Supabase `pg_cron` + `net.http_post` ishlatilardi — Neon'da tashqi
scheduler ishonchliroq.)

---

## Tekshirish ro'yxati

- [ ] Sayt o'z domeningizda ochiladi, ro'yxatdan o'tish va kirish ishlaydi
- [ ] Yangi hisob uchun onboarding (soha tanlash) ishlaydi
- [ ] `/super-admin` faqat platform_admins ro'yxatidagi hisobga ochiladi
- [ ] `node scripts/telegram-setup.mjs` ishga tushirilgan va bot `/start` ga javob beradi
- [ ] Botda email+parol bilan kirish ishlaydi (`telegram_bot_state` migratsiyasi tushirilgan)
- [ ] Botdan 📊 hisobot, 🗓 bugungi qabullar va ➕ yangi qabul olinadi
- [ ] Saytdagi `/b/...` sahifasidan qabul ochilganda 🆕 bildirishnoma keladi

## Lovable'ga bog'liqlik qoldimi?

Yo'q. `OPENROUTER_API_KEY` (yoki `GEMINI_API_KEY`) berilgach AI mustaqil ishlaydi;
baza, login — hammasi sizning Neon hisobingizda, fayllar esa S3 mos
saqlagichingizda.

## 7. Backup / restore va monitoring (pilot)

**Zaxira.** Neon'da pull so'rovlari (Point-in-Time Restore) bor: dashboard →
Branches → "restore to" istalgan soniyagacha yangi branch ochadi. To'liq
dump uchun:

```bash
pg_dump "$NEON_DATABASE_URL" -f backups/full-$(date +%F).sql
```

Sxema dumpi uchun `node scripts/neon-apply.mjs` manzasi bo'lgan
`neon/0001_neon_schema.sql` git tarixida saqlanadi.

**Qaytarish.** Buzilgan bazani tiklash — Neon dashboard'dan PITR restore yoki
bo'sh branchga `psql "$NEON_DATABASE_URL" -f backups/full-YYYY-MM-DD.sql`.

**Monitoring.**
- `GET /api/health` — 200 = hammasi joyida, 503 = muhit o'zgaruvchisi yoki baza bilan muammo. Javobdagi `errors_last_24h` sohasi — oxirgi 24 soatda yig'ilgan xatolar soni.
- Server (SSR) tomonidagi qayta tiklangan og'ir xatolar avtomatik `error_events` jadvaliga yoziladi: bitta xato (fingerprint = holat kodi + yo'l + birinchi qator) 10 daqiqada ko'pi bilan bir marta. `/super-admin/errors` sahifasi shu jurnalni ko'rsatadi va eskilarini tozalaydi.
- Migratsiya hali tushirilmagan bo'lsa yoki ruxsat yetishmasa, yig'uvchi o'zini o'chiq holatga o'tkazadi. Majburan o'chirish: `ERROR_EVENTS_DISABLED=true`.
- Xatolar server konsolida `[telegram-webhook]`, `[instagram-webhook]` kabi belgilar bilan ham chiqadi.
- Kunlik hisobot va eslatmalar jadvali ishlayapti (6-bo'lim: ikkala manzil ham
  `LOVABLE_CRON_SECRET` bilan har 15 daqiqada chaqiriladi).

`error_events` jadvali faqat `app_service` roli uchun (RLS yoqilgan, `app_anon`
va `app_user`'dan `REVOKE`). Shu sababli uni Super Admin o'zi ham SQL orqali
o'qimaydi — panel server funksiyasi orqali o'tadi.

## 8. Pilot uchun tekshirish ro'yxati

- [ ] `node scripts/neon-sync.mjs` — sxema Neon'da, `neon-drift` toza
- [ ] `NEON_DATABASE_URL` va `NEON_AUTH_ISSUER` server muhitida (omma bron sahifasi shular bilan ishlaydi)
- [ ] To'lov webhook kalitlari (`PAYME_KEY`, `CLICK_SECRET_KEY`, `CLICK_SERVICE_ID`) o'rnatilgan — ulanmagan holda endpointlar fail-closed
- [ ] `/api/health` 200 qaytaryapti
- [ ] Bitta real biznes to'liq oqim: sozlamalar → xizmatlar → xodimlar → bron → kalendar → oylik hisob-kitob → CSV eksport
- [ ] Omma bron havolasi (`/b/<slug>`) telefonda ochiladi va bron `new` holatida tushadi
- [ ] Billing yoqilganda (`VITE_BILLING_ENFORCED=true` build) tarif darvozalari ishlaydi; pilot davomida bayrog' o'chiq
- [ ] Mijoz profilida marketing roziligi yoqiladi/bekor qilinadi va "Ma'lumotlarni yuklash" JSON fayl beradi
- [ ] `/super-admin/errors` sahifasi ochiladi (migratsiyadan keyin xato bo'lmasa "Xatolar yo'q" ko'rinadi)

## 9. Mijoz ma'lumotlari: rozilik, eksport, o'chirish

Rozilik (`customers.marketing_consent` + `consent_updated_at`) — `sales.manage`
huquqi bo'lgan a'zo yozadi; o'chirish faqat ego/admin. Server tekshiradi, frontend
yashirish bilan cheklanmaydi.

O'chirish — **anonymizatsiya**: ism "O'chirilgan mijoz"ga almashadi, telefon/email/
manzil/izohlar va ijtimoiy tarmoq bog'lanishlari tozalanadi, suhbatlar + ularning
xabarlari va faoliyat yozuvlari o'chiriladi, keyin `erased_at`/`erased_by` qo'yiladi.
Moliyaviy yozuvlar (to'lovlar, buyurtmalar) va uchrashuvlar qonun talabi bilan
**saqlanadi** — bu to'liq fizik o'chirish emas.

`customers_privacy_enforce` trigger'i bazada qo'shimcha qatlam: `erased_at` o'zgarsa
faqat biznes admin'i (sessiya orqali) ruxsat etadi va o'chirilgan mijozning aloqa
maydonlarini qayta to'ldirishga (`erased_at` tiklanmaydi) yo'l qo'ymaydi.
`app_service` (platforma xizmati) yozuvlari `app.user_id()` bo'sh bo'lgani uchun
trigger'dan o'tadi.

## 10. Realtime o'rniga polling

Supabase Realtime (WebSocket) olib tashlandi. Jonli holatlar (xabarnomalar,
navbatlar, kanban) React Query `refetchInterval` orqali yangilanadi —
`src/lib/polling.ts` da `LIVE_REFETCH_MS = 20_000` (20 soniya).

## 11. Onlayn qabul sahifasi (Instagram bio uchun)

Har biznesning o'z havolasi bor: `/b/<booking_slug>` (sozlamalar → "Onlayn qabul
havolasi" kartasida nusxalanadi, slug birinchi ochilganda avtomatik yaratiladi).
Sahifa mijozdan ro'yxatdan o'tish so'ramaydi: xizmat → xodim → sana → bo'sh vaqtni
tanlaydi, ism/telefon/izoh qoldiradi va bron `new` holatida tushadi.

Sahifa tashqi ko'rinishi biznes brendi bilan to'ldiriladi — Sozlamalar → "Brend va
aloqa": logotip (`branding` saqlagichiga `<businessId>/logo.<ext>`, 2 MB gacha,
PNG/JPG/WEBP) va telefon (`tel:` havola sifatida chiqadi). Logotip yo'q bo'lsa
standart belgi ko'rinadi. Fayllar Neon'dagi `public.storage_objects` jadvalida
(bytea) yotadi — tashqi bucket sozlamaydi; yuklash/ko'rish havolalari server
tomonida qisqa muddatli HMAC token bilan yig'iladi, shuning uchun fayllarni
boshqa joyga ko'chirishga hojat yo'q.

Barcha sohalar uchun bir xil ishlaydi — `booking_enabled` yoqilgan istalgan biznes
ochiq havolaga ega (soha tanlovi faqat ichki CRM modulini sozlaydi).
