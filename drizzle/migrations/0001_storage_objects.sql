-- Neon'da fayl saqlash: S3-mos tashqi bucket o'rniga bytea.
--
-- Ilova qatlami (src/lib/storage.server.ts) eski S3 API shaklini saqlab qoladi:
-- bucket + path. `path` birinchi segmentida tenant id'si bor ({businessId}/logo.png),
-- business_id ustuni esa RLS uchun — chunki siyosat ustun bilan ishlaydi, matn bilan emas.
-- Fayl yozib/o'qib bo'lgandan keyin o'chirilmaydigan yagona joy: bu jadval.

CREATE TABLE IF NOT EXISTS public.storage_objects (
  bucket text NOT NULL CHECK (bucket IN ('branding', 'crm_attachments')),
  path text NOT NULL,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  data bytea NOT NULL DEFAULT ''::bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, path)
);

CREATE INDEX IF NOT EXISTS storage_objects_business_idx
  ON public.storage_objects(business_id, created_at DESC);

CREATE TRIGGER storage_objects_updated_at BEFORE UPDATE ON public.storage_objects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.storage_objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "storage_objects tenant" ON public.storage_objects FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_objects TO app_user;
GRANT ALL ON public.storage_objects TO app_service;
