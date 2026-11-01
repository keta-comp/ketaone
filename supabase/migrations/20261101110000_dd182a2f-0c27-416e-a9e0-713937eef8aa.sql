-- PlayStation va Bilyard klublari uchun dastur tarqatish jadvali.
--
-- Vaqt hisoblagichi — tashqi dastur: KetaOne sessiyani sanamaydi va faylni o'zida
-- saqlamaydi (Neon'da `storage_objects` bytea'da, hajm chegarasi 15 MB — o'rnatuvchi
-- fayl sig'maydi). Shuning uchun bu yerda faqat sayt egasi yozgan HTTPS havolalar,
-- versiya va o'rnatish yo'riqnomasi turadi.
--
-- Bir platforma uchun bitta qator: admin "Dasturni yuklab olish" va "Mobil dastur"
-- sahifalarida ko'rgan narsa aynan shu yozuv bo'ladi. `url` bo'sh qator bo'lsa
-- sahifa "hali tayyor emas" holatini ko'rsatadi — soxta tugma chizilmaydi.

CREATE TABLE IF NOT EXISTS public.program_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform TEXT NOT NULL
    CHECK (platform IN ('windows', 'macos', 'android', 'ios')),
  -- Bo'sh = bu platforma uchun dastur hali yo'q. HTTPS havolasi qabul qilinadi.
  url TEXT NOT NULL DEFAULT '' CHECK (url = '' OR url ~ '^https://[^[:space:]]+$'),
  version TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT program_releases_one_row_per_platform UNIQUE (business_id, platform)
);

CREATE INDEX IF NOT EXISTS program_releases_business_idx
  ON public.program_releases (business_id, platform);

ALTER TABLE public.program_releases ENABLE ROW LEVEL SECURITY;

-- Xodimlar yuklab olish havolalarini o'qiydi, yozuv esa faqat egasi/adminiki
-- (server tomonida `settings.manage`, bu siyosatda esa is_business_admin tekshiriladi).
CREATE POLICY "program_releases member read" ON public.program_releases
  FOR SELECT TO app_user
  USING (public.is_business_member(business_id));

CREATE POLICY "program_releases admin write" ON public.program_releases
  FOR ALL TO app_user
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_releases TO app_user;
GRANT ALL ON public.program_releases TO app_service;
