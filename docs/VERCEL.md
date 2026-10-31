# KetaOne — Vercel'ga joylash

Loyiha Vercel uchun sozlangan: `vercel.json` mavjud va qurish jarayoni
Vercel'da avtomatik ravishda `vercel` preseti bilan ishlaydi
(Cloudflare varianti ham buzilmadi — o'sha holida qoladi).

---

## 1. Loyihani Vercel'ga ulash

1. Kodni GitHub repozitoriyaga yuklang.
2. https://vercel.com/new → repozitoriyani tanlang.
3. Framework Preset: **Other** (`vercel.json` qolganini o'zi hal qiladi).
4. Build Command: `npm run build` · Output Directory: `.vercel/output`
   (bular `vercel.json` da yozilgan, o'zgartirish shart emas).

## 2. Environment Variables (Project Settings → Environment Variables)

Production va Preview uchun quyidagilarni qo'shing:

| Nom | Qiymat |
| --- | --- |
| `NEON_DATABASE_URL` | `postgresql://neondb_owner:...@ep-...-pooler...aws.neon.tech/neondb?sslmode=require` (maxfiy) |
| `NEON_AUTH_ISSUER` | `https://ep-....neonauth...aws.neon.tech/neondb/auth` |
| `STORAGE_URL_SECRET` | ixtiyoriy — fayl URL tokenlari uchun maxfiy so'z. Bo'lmasa u `NEON_DATABASE_URL`'dan HMAC bilan hisoblanadi, shuning uchun qo'shimcha sozlash shart emas. |
| `OPENROUTER_API_KEY` | `sk-or-...` (AI uchun) |
| `OPENROUTER_MODEL` | `google/gemini-2.5-flash` (ixtiyoriy) |
| `GEMINI_API_KEY` | ixtiyoriy zaxira |
| `TELEGRAM_BOT_TOKEN` | BotFather tokeni |
| `TELEGRAM_WEBHOOK_SECRET` | ixtiyoriy — webhook maxfiy so'zi. Bo'lmasa u token'dan HMAC bilan hisoblanadi (qo'shimcha sozlash shart emas). |
| `PUBLIC_APP_URL` | saytning haqiqiy manzili, masalan `https://www.nexora-crm.uz` (sozlanmasa shu production manzili ishlatiladi) |
| `LOVABLE_CRON_SECRET` | kunlik hisobot va eslatma cron chaqiruvi uchun maxfiy so'z (Vercel'da `CRON_SECRET` ham yaroqli) |
| `INSTAGRAM_PAGE_ACCESS_TOKEN`, `META_APP_SECRET` | Instagram uchun, ixtiyoriy |

Autentifikatsiya va baza to'liq server tomonda — `VITE_` bilan boshlanadigan
Supabase kalitlari kerak emas. Muhit o'zgaruvchilarini qo'shgandan keyin
qayta **Redeploy** qiling.

Fayl saqlash (logotip va CRM biriktirmalari) Neon bazasidagi
`public.storage_objects` jadvalida joylashadi — tashqi S3/R2 hisobi, endpoint
yoki kalit talab qilinmaydi. Jadval `scripts/neon-apply.mjs` orqali qo'llanadi
(`drizzle/migrations/0001_storage_objects.sql`). Vercel so'rov hajmi cheklovidan
oshmasligi uchun fayllar 3 MB'lik bo'laklar bilan yuklanadi: logo 2 MB,
biriktirma 15 MB gacha.

Ro'yxatdan o'tishda Neon Auth email yuborishi uchun Neon dashboard →
Authentication → Email'da SMTP sozlanadi (yoki default yetkazib beruvchi).
Parolni tiklash havolasi `{PUBLIC_APP_URL}/auth?mode=recover` manziliga
qaytadi — `PUBLIC_APP_URL` to'g'ri bo'lishi shart.

## 3. Domen

Project Settings → **Domains** → `ketaone.uz` (va `www`) qo'shib,
registrarda Vercel ko'rsatgan DNS yozuvlarini kiritasiz.

## 4. Telegram webhook'ni sozlash

Webhook'ni faqat administrator qo'ldan o'rnatadi — ilova hech qachon o'zi
`setWebhook` chaqirmaydi:

```bash
node scripts/telegram-setup.mjs              # getMe + getWebhookInfo, hech narsa o'zgarmaydi
node scripts/telegram-setup.mjs --apply      # setWebhook + /buyruqlar ro'yxati
node scripts/telegram-setup.mjs --url=https://sayt.uz --apply   # manzilni qo'ldan berish
```

Skript `TELEGRAM_BOT_TOKEN`, `PUBLIC_APP_URL` va `TELEGRAM_WEBHOOK_SECRET` ni
`.env.local` (yoki muhit o'zgaruvchilaridan) oladi; token o'zi chop etilmaydi.
`vercel env pull .env.vercel --environment=production` deb tortiolib, skriptni
`--envfile=.env.vercel` bilan ishga tushirish mumkin — `.env.local` ustiga
yozmang, lokal baza va autentifikatsiya kalitlaringiz buziladi.
**Ogoh bo'ling:** Vercel'ga *Sensitive* turdagi maxfiy so'z sifatida qo'shilgan
token `env pull` faylida bo'sh qator bo'lib chiqadi (`TELEGRAM_BOT_TOKEN=""`).
Bunday holda token qiymatini BotFather'dan (`/token`) olib, `.env.local` ga yozing
skript ishlashi uchun — production'dagi token shu qoldi, uni almashtirmang.
Webhook maxfiy so'zi `TELEGRAM_WEBHOOK_SECRET` bo'lsa o'sha, bo'lmasa token'dan
HMAC bilan hisoblanadi — server ham aynan shu formulani ishlatadi, shuning uchun
Telegram `secret_token` sarlavhasisiz so'rov yuborsa webhook 401 qaytadi.

Tekshirish: sayt → **Telegram** bo'limi (`/dashboard/telegram`) bot holatini jonli
ko'rsatadi (`getMe` + `getWebhookInfo`). Webhook o'rnatilmagan bo'lsa sahifa buni
yashirmaydi.

## 5. Kunlik hisobot va eslatmalar jadvali

`vercel.json` da `crons` bloki allaqachon bor — u har 15 daqiqada bu ikki
manzilni **GET** qiladi:

- `/api/public/telegram/daily-report`
- `/api/public/reminders`

Vercel so'rovni `Authorization: Bearer <CRON_SECRET>` bilan imzolaydi, shuning
uchun **`CRON_SECRET` ni `LOVABLE_CRON_SECRET` bilan bir xil qo'ying** (yoki
`LOVABLE_CRON_SECRET` bo'lmasa, `CRON_SECRET` o'zi ishlatiladi). Vercel Hobby
tarifida bittadan ko'p cron bo'lmaydi: shunda `vercel.json` dagi `crons` blokini
butunlay o'chirib, ikkala ishni ham `.github/workflows/scheduler.yml` orqali
yuriting (u ham har 15 daqiqada ishlaydi).

---

Eslatma: Lovable ichidagi ko'rish oynasi avvalgidek ishlaydi — bu sozlamalar
faqat Vercel'dagi qurishga ta'sir qiladi.
