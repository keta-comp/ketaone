-- ============================================================
-- KetaOne — Neon uchun sxema. scripts/neon-transform.mjs generatsiyasi.
-- Manba: supabase/migrations (Supabase Auth/Storage/rollari almashtirilgan).
-- Qoidalar:
--   auth.uid()      -> app.user_id()  (so'rovda SET LOCAL app.user_id bilan beriladi)
--   auth.users      -> neon_auth."user" (Neon Auth = host qilingan Better Auth)
--   anon/authenticated/service_role -> app_anon / app_user / app_service(BYPASSRLS)
--   storage.buckets / storage.objects -> tashlandi (S3/Neon Object Storage, presigned URL)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA IF NOT EXISTS app;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_anon') THEN CREATE ROLE app_anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN CREATE ROLE app_service NOLOGIN BYPASSRLS; END IF;
END $$;

GRANT app_anon, app_user, app_service TO neondb_owner;
GRANT USAGE ON SCHEMA public TO app_anon, app_user, app_service;
GRANT USAGE ON SCHEMA neon_auth TO app_user, app_service;
GRANT REFERENCES ON neon_auth."user" TO app_user, app_service;

-- Har bir so'rov tranzakciyasida: SET LOCAL ROLE app_user; SET LOCAL app.user_id = '<uuid>';
CREATE OR REPLACE FUNCTION app.user_id() RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$fn$;
GRANT EXECUTE ON FUNCTION app.user_id() TO app_anon, app_user, app_service;

-- Supabase public sxemidagi default privileges'ni takrorlaymiz: IDs generatsiyasi
-- (gen_random_uuid, sequence) tenant rollari uchun ham ishlashi kerak.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TYPE public.app_role AS ENUM ('admin','operator');

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TYPE public.lead_status AS ENUM ('new','needs_operator','assigned','contacted','negotiating','won','lost');

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TYPE public.lead_score AS ENUM ('hot','warm','cold');

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TYPE public.order_status AS ENUM ('new','confirming','confirmed','preparing','delivered','cancelled');

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TYPE public.payment_status AS ENUM ('unpaid','partial','paid','refunded');

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TYPE public.message_role AS ENUM ('customer','ai','operator','system');

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TYPE public.conversation_mode AS ENUM ('ai','human');

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES neon_auth."user" ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, UPDATE ON public.profiles TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.profiles TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "profiles readable by staff" ON public.profiles FOR SELECT TO app_user USING (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO app_user USING (id = app.user_id());

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES neon_auth."user" ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT ON public.user_roles TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.user_roles TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "roles readable by staff" ON public.user_roles FOR SELECT TO app_user USING (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NULLIF(NEW.name, ''), NEW.email))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TRIGGER on_auth_user_created AFTER INSERT ON neon_auth."user"
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.business_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL DEFAULT 'My Store',
  business_description TEXT NOT NULL DEFAULT '',
  working_hours TEXT NOT NULL DEFAULT '09:00 - 20:00',
  delivery_info TEXT NOT NULL DEFAULT '',
  payment_methods TEXT NOT NULL DEFAULT '',
  return_policy TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'UZS',
  operator_group_chat_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, UPDATE ON public.business_settings TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.business_settings TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "settings staff read" ON public.business_settings FOR SELECT TO app_user USING (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "settings staff write" ON public.business_settings FOR UPDATE TO app_user USING (true) WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "settings staff insert" ON public.business_settings FOR INSERT TO app_user WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TRIGGER business_settings_updated_at BEFORE UPDATE ON public.business_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.ai_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model TEXT NOT NULL DEFAULT 'google/gemini-3.7-flash',
  tone_of_voice TEXT NOT NULL DEFAULT 'friendly, professional, concise',
  sales_strategy TEXT NOT NULL DEFAULT 'Consultative selling: qualify need, recommend in-stock products, handle objections, close politely.',
  language_instruction TEXT NOT NULL DEFAULT 'Reply in the same language the customer writes in (Uzbek, Russian or English).',
  escalation_rules TEXT NOT NULL DEFAULT 'Escalate on discount requests, complaints, payment or delivery problems, or when the customer asks for a human.',
  max_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  custom_instructions TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, UPDATE ON public.ai_settings TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.ai_settings TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "ai settings staff read" ON public.ai_settings FOR SELECT TO app_user USING (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "ai settings staff write" ON public.ai_settings FOR UPDATE TO app_user USING (true) WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "ai settings staff insert" ON public.ai_settings FOR INSERT TO app_user WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TRIGGER ai_settings_updated_at BEFORE UPDATE ON public.ai_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
INSERT INTO public.business_settings (business_name, business_description, delivery_info, payment_methods, return_policy)
VALUES ('My Store', 'Electronics and accessories retailer.', 'Delivery within the city in 1-2 days.', 'Cash, card, bank transfer.', '14-day return on unused items.');

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
INSERT INTO public.ai_settings DEFAULT VALUES;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.categories TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "categories staff all" ON public.categories FOR ALL TO app_user USING (true) WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  price NUMERIC(14,2) NOT NULL DEFAULT 0,
  compare_at_price NUMERIC(14,2),
  cost_price NUMERIC(14,2),
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  reserved_quantity INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX products_category_idx ON public.products(category_id);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX products_name_idx ON public.products USING gin (to_tsvector('simple', name || ' ' || description));

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX products_active_idx ON public.products(is_active, is_archived);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.products TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "products staff all" ON public.products FOR ALL TO app_user USING (true) WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  change INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX inventory_movements_product_idx ON public.inventory_movements(product_id, created_at DESC);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT ON public.inventory_movements TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.inventory_movements TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "movements staff read" ON public.inventory_movements FOR SELECT TO app_user USING (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "movements staff insert" ON public.inventory_movements FOR INSERT TO app_user WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES neon_auth."user" ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  telegram_username TEXT,
  telegram_user_id TEXT,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operators TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.operators TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "operators staff all" ON public.operators FOR ALL TO app_user USING (true) WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TRIGGER operators_updated_at BEFORE UPDATE ON public.operators FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id TEXT UNIQUE,
  telegram_username TEXT,
  full_name TEXT,
  phone TEXT,
  location TEXT,
  notes TEXT,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC(14,2) NOT NULL DEFAULT 0,
  last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX customers_last_interaction_idx ON public.customers(last_interaction_at DESC);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.customers TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "customers staff all" ON public.customers FOR ALL TO app_user USING (true) WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'telegram',
  telegram_chat_id TEXT,
  mode public.conversation_mode NOT NULL DEFAULT 'ai',
  assigned_operator_id UUID REFERENCES public.operators(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_preview TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX conversations_customer_idx ON public.conversations(customer_id);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX conversations_last_message_idx ON public.conversations(last_message_at DESC);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.conversations TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "conversations staff all" ON public.conversations FOR ALL TO app_user USING (true) WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role public.message_role NOT NULL,
  content TEXT NOT NULL,
  telegram_message_id BIGINT,
  operator_id UUID REFERENCES public.operators(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX messages_conversation_idx ON public.messages(conversation_id, created_at);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.messages TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "messages staff all" ON public.messages FOR ALL TO app_user USING (true) WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.telegram_updates (
  update_id BIGINT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT ON public.telegram_updates TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.telegram_updates TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.telegram_updates ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "telegram updates staff read" ON public.telegram_updates FOR SELECT TO app_user USING (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'telegram',
  requested_product TEXT,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  budget TEXT,
  location TEXT,
  phone TEXT,
  score public.lead_score NOT NULL DEFAULT 'cold',
  status public.lead_status NOT NULL DEFAULT 'new',
  assigned_operator_id UUID REFERENCES public.operators(id) ON DELETE SET NULL,
  ai_summary TEXT,
  handoff_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX leads_status_idx ON public.leads(status);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX leads_created_idx ON public.leads(created_at DESC);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX leads_customer_idx ON public.leads(customer_id);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.leads TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "leads staff all" ON public.leads FOR ALL TO app_user USING (true) WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  detail TEXT,
  actor TEXT NOT NULL DEFAULT 'ai',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX lead_events_lead_idx ON public.lead_events(lead_id, created_at DESC);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT ON public.lead_events TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.lead_events TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "lead events staff read" ON public.lead_events FOR SELECT TO app_user USING (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "lead events staff insert" ON public.lead_events FOR INSERT TO app_user WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.operator_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  assigned_by UUID,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, operator_id)
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, DELETE ON public.operator_assignments TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.operator_assignments TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.operator_assignments ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "assignments staff all" ON public.operator_assignments FOR ALL TO app_user USING (true) WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE SEQUENCE public.order_number_seq START 1000;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT USAGE ON SEQUENCE public.order_number_seq TO app_user, app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE DEFAULT ('ORD-' || nextval('public.order_number_seq')::text),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  status public.order_status NOT NULL DEFAULT 'new',
  payment_status public.payment_status NOT NULL DEFAULT 'unpaid',
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  delivery_address TEXT,
  phone TEXT,
  notes TEXT,
  assigned_operator_id UUID REFERENCES public.operators(id) ON DELETE SET NULL,
  stock_applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX orders_status_idx ON public.orders(status);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX orders_created_idx ON public.orders(created_at DESC);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX orders_customer_idx ON public.orders(customer_id);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.orders TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "orders staff all" ON public.orders FOR ALL TO app_user USING (true) WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE INDEX order_items_order_idx ON public.order_items(order_id);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO app_user;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT ALL ON public.order_items TO app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE POLICY "order items staff all" ON public.order_items FOR ALL TO app_user USING (true) WITH CHECK (true);

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE OR REPLACE FUNCTION public.apply_order_stock(_order_id UUID, _actor UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it RECORD; applied BOOLEAN;
BEGIN
  SELECT stock_applied INTO applied FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF applied IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF applied THEN RETURN; END IF;
  FOR it IN SELECT * FROM public.order_items WHERE order_id = _order_id AND product_id IS NOT NULL LOOP
    UPDATE public.products SET stock_quantity = stock_quantity - it.quantity
    WHERE id = it.product_id AND stock_quantity >= it.quantity;
    IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient stock for product %', it.product_name; END IF;
    INSERT INTO public.inventory_movements (product_id, change, reason, reference_id, created_by)
    VALUES (it.product_id, -it.quantity, 'order_confirmed', _order_id, _actor);
  END LOOP;
  UPDATE public.orders SET stock_applied = true WHERE id = _order_id;
END; $$;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE OR REPLACE FUNCTION public.revert_order_stock(_order_id UUID, _actor UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it RECORD; applied BOOLEAN;
BEGIN
  SELECT stock_applied INTO applied FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF applied IS NOT TRUE THEN RETURN; END IF;
  FOR it IN SELECT * FROM public.order_items WHERE order_id = _order_id AND product_id IS NOT NULL LOOP
    UPDATE public.products SET stock_quantity = stock_quantity + it.quantity WHERE id = it.product_id;
    INSERT INTO public.inventory_movements (product_id, change, reason, reference_id, created_by)
    VALUES (it.product_id, it.quantity, 'order_cancelled', _order_id, _actor);
  END LOOP;
  UPDATE public.orders SET stock_applied = false WHERE id = _order_id;
END; $$;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT EXECUTE ON FUNCTION public.apply_order_stock(UUID, UUID) TO app_user, app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
GRANT EXECUTE ON FUNCTION public.revert_order_stock(UUID, UUID) TO app_user, app_service;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE OR REPLACE FUNCTION public.sync_customer_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.customers c SET
    total_orders = (SELECT count(*) FROM public.orders o WHERE o.customer_id = c.id AND o.status <> 'cancelled'),
    total_spent = COALESCE((SELECT sum(o.total) FROM public.orders o WHERE o.customer_id = c.id AND o.status <> 'cancelled'), 0)
  WHERE c.id = COALESCE(NEW.customer_id, OLD.customer_id);
  RETURN NULL;
END; $$;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
CREATE TRIGGER orders_sync_customer_totals AFTER INSERT OR UPDATE OR DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.sync_customer_totals();

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.leads REPLICA IDENTITY FULL;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.messages REPLICA IDENTITY FULL;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.conversations REPLICA IDENTITY FULL;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.orders REPLICA IDENTITY FULL;

-- 20260819112900_94d59b14-4644-4077-b9f1-177d19d89b44.sql
ALTER TABLE public.products REPLICA IDENTITY FULL;

-- 20260819112928_b3c2b7a9-c987-4235-b5de-c0d0d140ef6d.sql
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, app_anon, app_user;

-- 20260819112928_b3c2b7a9-c987-4235-b5de-c0d0d140ef6d.sql
REVOKE ALL ON FUNCTION public.sync_customer_totals() FROM PUBLIC, app_anon, app_user;

-- 20260819112928_b3c2b7a9-c987-4235-b5de-c0d0d140ef6d.sql
REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, app_anon;

-- 20260819112928_b3c2b7a9-c987-4235-b5de-c0d0d140ef6d.sql
REVOKE ALL ON FUNCTION public.apply_order_stock(UUID, UUID) FROM PUBLIC, app_anon;

-- 20260819112928_b3c2b7a9-c987-4235-b5de-c0d0d140ef6d.sql
REVOKE ALL ON FUNCTION public.revert_order_stock(UUID, UUID) FROM PUBLIC, app_anon;

-- 20260819112928_b3c2b7a9-c987-4235-b5de-c0d0d140ef6d.sql
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO app_user, app_service;

-- 20260819112928_b3c2b7a9-c987-4235-b5de-c0d0d140ef6d.sql
GRANT EXECUTE ON FUNCTION public.apply_order_stock(UUID, UUID) TO app_user, app_service;

-- 20260819112928_b3c2b7a9-c987-4235-b5de-c0d0d140ef6d.sql
GRANT EXECUTE ON FUNCTION public.revert_order_stock(UUID, UUID) TO app_user, app_service;

-- 20260819112928_b3c2b7a9-c987-4235-b5de-c0d0d140ef6d.sql
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, app_anon, app_user;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE TABLE public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES neon_auth."user" ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'My Business',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
GRANT SELECT, INSERT, UPDATE ON public.businesses TO app_user;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
GRANT ALL ON public.businesses TO app_service;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE TABLE public.business_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES neon_auth."user" ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id)
);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE INDEX idx_business_members_user ON public.business_members(user_id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
GRANT SELECT ON public.business_members TO app_user;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
GRANT ALL ON public.business_members TO app_service;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE OR REPLACE FUNCTION public.is_business_member(_business_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_members
    WHERE business_id = _business_id AND user_id = app.user_id()
  );
$$;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT business_id FROM public.business_members
  WHERE user_id = app.user_id()
  ORDER BY created_at ASC
  LIMIT 1;
$$;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
REVOKE ALL ON FUNCTION public.is_business_member(UUID) FROM PUBLIC, app_anon;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
REVOKE ALL ON FUNCTION public.current_business_id() FROM PUBLIC, app_anon;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
GRANT EXECUTE ON FUNCTION public.is_business_member(UUID) TO app_user, app_service;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
GRANT EXECUTE ON FUNCTION public.current_business_id() TO app_user, app_service;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "businesses member read" ON public.businesses
  FOR SELECT TO app_user USING (public.is_business_member(id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "businesses owner update" ON public.businesses
  FOR UPDATE TO app_user USING (owner_id = app.user_id()) WITH CHECK (owner_id = app.user_id());

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "members read own business" ON public.business_members
  FOR SELECT TO app_user USING (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE TABLE public.telegram_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  bot_token_encrypted TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  bot_username TEXT,
  bot_first_name TEXT,
  telegram_bot_id BIGINT,
  webhook_url TEXT,
  webhook_status TEXT NOT NULL DEFAULT 'pending',
  is_active BOOLEAN NOT NULL DEFAULT false,
  last_error TEXT,
  last_checked_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE UNIQUE INDEX idx_telegram_bots_business_active
  ON public.telegram_bots(business_id) WHERE is_active;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE UNIQUE INDEX idx_telegram_bots_telegram_id_active
  ON public.telegram_bots(telegram_bot_id) WHERE is_active;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
GRANT ALL ON public.telegram_bots TO app_service;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.telegram_bots ENABLE ROW LEVEL SECURITY;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE TRIGGER telegram_bots_updated_at BEFORE UPDATE ON public.telegram_bots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.business_settings ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.ai_settings ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.categories ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.products ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.inventory_movements ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.operators ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.customers ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.conversations ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.messages ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.leads ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.lead_events ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.operator_assignments ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.orders ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.order_items ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.telegram_updates ADD COLUMN business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
INSERT INTO public.businesses (owner_id, name)
SELECT p.id, COALESCE(p.full_name, p.email, 'My Business')
FROM public.profiles p;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
INSERT INTO public.business_members (business_id, user_id, role)
SELECT b.id, b.owner_id, 'admin' FROM public.businesses b
ON CONFLICT DO NOTHING;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DO $$
DECLARE first_business UUID;
BEGIN
  SELECT id INTO first_business FROM public.businesses ORDER BY created_at ASC LIMIT 1;
  IF first_business IS NULL THEN
    DELETE FROM public.order_items; DELETE FROM public.orders;
    DELETE FROM public.lead_events; DELETE FROM public.operator_assignments;
    DELETE FROM public.leads; DELETE FROM public.messages;
    DELETE FROM public.conversations; DELETE FROM public.customers;
    DELETE FROM public.inventory_movements; DELETE FROM public.products;
    DELETE FROM public.categories; DELETE FROM public.operators;
    DELETE FROM public.telegram_updates;
    DELETE FROM public.business_settings; DELETE FROM public.ai_settings;
  ELSE
    UPDATE public.business_settings SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.ai_settings SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.categories SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.products SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.inventory_movements SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.operators SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.customers SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.conversations SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.messages SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.leads SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.lead_events SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.operator_assignments SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.orders SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.order_items SET business_id = first_business WHERE business_id IS NULL;
    UPDATE public.telegram_updates SET business_id = first_business WHERE business_id IS NULL;
  END IF;
END $$;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
INSERT INTO public.business_settings (business_id, business_name)
SELECT b.id, b.name FROM public.businesses b
WHERE NOT EXISTS (SELECT 1 FROM public.business_settings s WHERE s.business_id = b.id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
INSERT INTO public.ai_settings (business_id)
SELECT b.id FROM public.businesses b
WHERE NOT EXISTS (SELECT 1 FROM public.ai_settings a WHERE a.business_id = b.id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.business_settings ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.ai_settings ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.categories ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.products ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.inventory_movements ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.operators ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.customers ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.conversations ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.messages ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.leads ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.lead_events ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.operator_assignments ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.orders ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.order_items ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.telegram_updates ALTER COLUMN business_id SET NOT NULL;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.business_settings ADD CONSTRAINT business_settings_business_unique UNIQUE (business_id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.ai_settings ADD CONSTRAINT ai_settings_business_unique UNIQUE (business_id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_name_key;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_slug_key;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.categories ADD CONSTRAINT categories_business_name_unique UNIQUE (business_id, name);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.categories ADD CONSTRAINT categories_business_slug_unique UNIQUE (business_id, slug);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_sku_key;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.products ADD CONSTRAINT products_business_sku_unique UNIQUE (business_id, sku);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_telegram_user_id_key;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.customers ADD CONSTRAINT customers_business_telegram_unique UNIQUE (business_id, telegram_user_id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.telegram_updates DROP CONSTRAINT IF EXISTS telegram_updates_pkey;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
ALTER TABLE public.telegram_updates ADD CONSTRAINT telegram_updates_pkey PRIMARY KEY (business_id, update_id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE INDEX idx_products_business ON public.products(business_id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE INDEX idx_customers_business ON public.customers(business_id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE INDEX idx_conversations_business ON public.conversations(business_id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE INDEX idx_messages_business ON public.messages(business_id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE INDEX idx_leads_business ON public.leads(business_id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE INDEX idx_orders_business ON public.orders(business_id);

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "settings staff read" ON public.business_settings;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "settings staff write" ON public.business_settings;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "settings staff insert" ON public.business_settings;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "ai settings staff read" ON public.ai_settings;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "ai settings staff write" ON public.ai_settings;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "ai settings staff insert" ON public.ai_settings;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "categories staff all" ON public.categories;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "products staff all" ON public.products;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "movements staff read" ON public.inventory_movements;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "movements staff insert" ON public.inventory_movements;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "operators staff all" ON public.operators;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "customers staff all" ON public.customers;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "conversations staff all" ON public.conversations;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "messages staff all" ON public.messages;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "leads staff all" ON public.leads;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "lead events staff read" ON public.lead_events;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "lead events staff insert" ON public.lead_events;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "assignments staff all" ON public.operator_assignments;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "orders staff all" ON public.orders;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "order items staff all" ON public.order_items;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "telegram updates staff read" ON public.telegram_updates;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "profiles readable by staff" ON public.profiles;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
DROP POLICY IF EXISTS "roles readable by staff" ON public.user_roles;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "business_settings tenant" ON public.business_settings FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "ai_settings tenant" ON public.ai_settings FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "categories tenant" ON public.categories FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "products tenant" ON public.products FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "inventory_movements tenant read" ON public.inventory_movements FOR SELECT TO app_user
  USING (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "inventory_movements tenant insert" ON public.inventory_movements FOR INSERT TO app_user
  WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "operators tenant" ON public.operators FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "customers tenant" ON public.customers FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "conversations tenant" ON public.conversations FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "messages tenant" ON public.messages FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "leads tenant" ON public.leads FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "lead_events tenant read" ON public.lead_events FOR SELECT TO app_user
  USING (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "lead_events tenant insert" ON public.lead_events FOR INSERT TO app_user
  WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "operator_assignments tenant" ON public.operator_assignments FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "orders tenant" ON public.orders FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "order_items tenant" ON public.order_items FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "telegram_updates tenant read" ON public.telegram_updates FOR SELECT TO app_user
  USING (public.is_business_member(business_id));

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT TO app_user USING (id = app.user_id());

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE POLICY "user_roles self read" ON public.user_roles FOR SELECT TO app_user USING (user_id = app.user_id());

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE OR REPLACE FUNCTION public.get_my_telegram_bot()
RETURNS TABLE (
  id UUID, business_id UUID, bot_username TEXT, bot_first_name TEXT,
  telegram_bot_id BIGINT, webhook_url TEXT, webhook_status TEXT,
  is_active BOOLEAN, last_error TEXT, last_checked_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.business_id, t.bot_username, t.bot_first_name, t.telegram_bot_id,
         t.webhook_url, t.webhook_status, t.is_active, t.last_error, t.last_checked_at,
         t.connected_at, t.created_at
  FROM public.telegram_bots t
  WHERE public.is_business_member(t.business_id)
  ORDER BY t.is_active DESC, t.created_at DESC;
$$;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
REVOKE ALL ON FUNCTION public.get_my_telegram_bot() FROM PUBLIC, app_anon;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
GRANT EXECUTE ON FUNCTION public.get_my_telegram_bot() TO app_user, app_service;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_business UUID;
  display_name TEXT;
  business_name TEXT;
BEGIN
  display_name := COALESCE(NULLIF(NEW.name, ''), split_part(NEW.email, '@', 1));
  business_name := COALESCE(NULLIF(NULLIF(NEW.name, ''), ''), display_name);

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, display_name)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;

  INSERT INTO public.businesses (owner_id, name) VALUES (NEW.id, business_name)
  RETURNING id INTO new_business;

  INSERT INTO public.business_members (business_id, user_id, role)
  VALUES (new_business, NEW.id, 'admin') ON CONFLICT DO NOTHING;

  INSERT INTO public.business_settings (business_id, business_name)
  VALUES (new_business, business_name);

  INSERT INTO public.ai_settings (business_id) VALUES (new_business);

  INSERT INTO public.operators (business_id, user_id, full_name)
  VALUES (new_business, NEW.id, display_name);

  RETURN NEW;
END; $$;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE OR REPLACE FUNCTION public.apply_order_stock(_order_id UUID, _actor UUID DEFAULT NULL::UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it RECORD; applied BOOLEAN; biz UUID;
BEGIN
  SELECT stock_applied, business_id INTO applied, biz FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF applied IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF applied THEN RETURN; END IF;
  FOR it IN SELECT * FROM public.order_items WHERE order_id = _order_id AND product_id IS NOT NULL LOOP
    UPDATE public.products SET stock_quantity = stock_quantity - it.quantity
    WHERE id = it.product_id AND business_id = biz AND stock_quantity >= it.quantity;
    IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient stock for product %', it.product_name; END IF;
    INSERT INTO public.inventory_movements (business_id, product_id, change, reason, reference_id, created_by)
    VALUES (biz, it.product_id, -it.quantity, 'order_confirmed', _order_id, _actor);
  END LOOP;
  UPDATE public.orders SET stock_applied = true WHERE id = _order_id;
END; $$;

-- 20260819120008_03b15293-146b-4137-b252-bfdb4c688546.sql
CREATE OR REPLACE FUNCTION public.revert_order_stock(_order_id UUID, _actor UUID DEFAULT NULL::UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it RECORD; applied BOOLEAN; biz UUID;
BEGIN
  SELECT stock_applied, business_id INTO applied, biz FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF applied IS NOT TRUE THEN RETURN; END IF;
  FOR it IN SELECT * FROM public.order_items WHERE order_id = _order_id AND product_id IS NOT NULL LOOP
    UPDATE public.products SET stock_quantity = stock_quantity + it.quantity
    WHERE id = it.product_id AND business_id = biz;
    INSERT INTO public.inventory_movements (business_id, product_id, change, reason, reference_id, created_by)
    VALUES (biz, it.product_id, it.quantity, 'order_cancelled', _order_id, _actor);
  END LOOP;
  UPDATE public.orders SET stock_applied = false WHERE id = _order_id;
END; $$;

-- 20260819121359_95253e5b-723e-4a90-bad8-0dad17bd720d.sql
CREATE UNIQUE INDEX IF NOT EXISTS customers_business_tg_user_idx ON public.customers (business_id, telegram_user_id) WHERE telegram_user_id IS NOT NULL;

-- 20260819121359_95253e5b-723e-4a90-bad8-0dad17bd720d.sql
CREATE INDEX IF NOT EXISTS conversations_business_chat_idx ON public.conversations (business_id, telegram_chat_id);

-- 20260819121359_95253e5b-723e-4a90-bad8-0dad17bd720d.sql
CREATE INDEX IF NOT EXISTS conversations_customer_idx ON public.conversations (business_id, customer_id);

-- 20260819121359_95253e5b-723e-4a90-bad8-0dad17bd720d.sql
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON public.messages (conversation_id, created_at DESC);

-- 20260819121359_95253e5b-723e-4a90-bad8-0dad17bd720d.sql
CREATE INDEX IF NOT EXISTS leads_business_customer_status_idx ON public.leads (business_id, customer_id, status, created_at DESC);

-- 20260819121359_95253e5b-723e-4a90-bad8-0dad17bd720d.sql
CREATE INDEX IF NOT EXISTS products_business_active_idx ON public.products (business_id, is_active, is_archived);

-- 20260819121359_95253e5b-723e-4a90-bad8-0dad17bd720d.sql
CREATE INDEX IF NOT EXISTS telegram_bots_business_active_idx ON public.telegram_bots (business_id, is_active);

-- 20260819121359_95253e5b-723e-4a90-bad8-0dad17bd720d.sql
CREATE INDEX IF NOT EXISTS orders_business_created_idx ON public.orders (business_id, created_at DESC);

-- 20260819195124_cc90bd7e-65cd-476e-b545-00ca077c5326.sql
update public.conversations set mode = 'ai' where mode = 'human' and (last_message_at is null or last_message_at < now() - interval '30 minutes');

-- 20260819195124_cc90bd7e-65cd-476e-b545-00ca077c5326.sql
update public.telegram_bots set last_error = null where last_error = 'Bad Request: chat not found';

-- 20260921161954_9863da83-b759-4cca-84b6-64a4d3264e2c.sql
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS instagram_user_id TEXT;

-- 20260921161954_9863da83-b759-4cca-84b6-64a4d3264e2c.sql
CREATE UNIQUE INDEX IF NOT EXISTS customers_instagram_user_uidx ON public.customers(instagram_user_id) WHERE instagram_user_id IS NOT NULL;

-- 20260921161954_9863da83-b759-4cca-84b6-64a4d3264e2c.sql
CREATE INDEX IF NOT EXISTS conversations_channel_idx ON public.conversations(channel);

-- 20260921161954_9863da83-b759-4cca-84b6-64a4d3264e2c.sql
CREATE TABLE public.instagram_events (
  mid TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260921161954_9863da83-b759-4cca-84b6-64a4d3264e2c.sql
GRANT SELECT ON public.instagram_events TO app_user;

-- 20260921161954_9863da83-b759-4cca-84b6-64a4d3264e2c.sql
GRANT ALL ON public.instagram_events TO app_service;

-- 20260921161954_9863da83-b759-4cca-84b6-64a4d3264e2c.sql
ALTER TABLE public.instagram_events ENABLE ROW LEVEL SECURITY;

-- 20260921161954_9863da83-b759-4cca-84b6-64a4d3264e2c.sql
CREATE POLICY "instagram_events staff read" ON public.instagram_events FOR SELECT TO app_user USING (true);

-- 20260921162303_aaa04be1-4bc7-4558-802c-df6061d14c72.sql
DROP TABLE IF EXISTS public.telegram_bots;

-- 20260921162303_aaa04be1-4bc7-4558-802c-df6061d14c72.sql
DROP FUNCTION IF EXISTS public.get_my_telegram_bot();

-- 20260921162303_aaa04be1-4bc7-4558-802c-df6061d14c72.sql
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM app_user, app_anon;

-- 20260921162303_aaa04be1-4bc7-4558-802c-df6061d14c72.sql
REVOKE EXECUTE ON FUNCTION public.sync_customer_totals() FROM app_user, app_anon;

-- 20260921162303_aaa04be1-4bc7-4558-802c-df6061d14c72.sql
REVOKE EXECUTE ON FUNCTION public.apply_order_stock(uuid, uuid) FROM app_user, app_anon;

-- 20260921162303_aaa04be1-4bc7-4558-802c-df6061d14c72.sql
REVOKE EXECUTE ON FUNCTION public.revert_order_stock(uuid, uuid) FROM app_user, app_anon;

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
CREATE TABLE public.crm_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  industry TEXT NOT NULL,
  business_description TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
CREATE TABLE public.crm_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  title TEXT NOT NULL,
  stage TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
CREATE INDEX crm_records_module_idx ON public.crm_records (business_id, module_key);

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
CREATE INDEX crm_records_stage_idx ON public.crm_records (business_id, stage);

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_configs TO app_user;

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_records TO app_user;

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
GRANT ALL ON public.crm_configs TO app_service;

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
GRANT ALL ON public.crm_records TO app_service;

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
ALTER TABLE public.crm_configs ENABLE ROW LEVEL SECURITY;

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
ALTER TABLE public.crm_records ENABLE ROW LEVEL SECURITY;

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
CREATE POLICY "crm_configs_staff_all" ON public.crm_configs
  FOR ALL TO app_user USING (true) WITH CHECK (true);

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
CREATE POLICY "crm_records_staff_all" ON public.crm_records
  FOR ALL TO app_user USING (true) WITH CHECK (true);

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
CREATE TRIGGER crm_configs_updated_at BEFORE UPDATE ON public.crm_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260922025434_c4bd7751-eca9-473f-a466-25480b12e3ea.sql
CREATE TRIGGER crm_records_updated_at BEFORE UPDATE ON public.crm_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260922171510_14613c1d-9885-4845-94e6-068543f55870.sql
CREATE OR REPLACE FUNCTION public.platform_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'users', (SELECT count(*) FROM public.profiles),
    'businesses', (SELECT count(*) FROM public.businesses),
    'crms', (SELECT count(*) FROM public.crm_configs)
  )
$$;

-- 20260922171510_14613c1d-9885-4845-94e6-068543f55870.sql
GRANT EXECUTE ON FUNCTION public.platform_stats() TO app_anon, app_user, app_service;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'owner';

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS assigned_operator_id UUID REFERENCES public.operators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS value NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_action TEXT,
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS discount NUMERIC NOT NULL DEFAULT 0;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  due_date DATE,
  note TEXT,
  created_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO app_user;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
GRANT ALL ON public.payments TO app_service;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE POLICY "Business members manage payments" ON public.payments
  FOR ALL TO app_user
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assigned_operator_id UUID REFERENCES public.operators(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  due_date DATE,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  created_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO app_user;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
GRANT ALL ON public.tasks TO app_service;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE POLICY "Business members manage tasks" ON public.tasks
  FOR ALL TO app_user
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE TABLE IF NOT EXISTS public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail TEXT,
  actor TEXT NOT NULL DEFAULT 'operator',
  actor_user_id UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
GRANT SELECT, INSERT ON public.activities TO app_user;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
GRANT ALL ON public.activities TO app_service;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE POLICY "Business members read activities" ON public.activities
  FOR SELECT TO app_user USING (public.is_business_member(business_id));

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE POLICY "Business members write activities" ON public.activities
  FOR INSERT TO app_user WITH CHECK (public.is_business_member(business_id));

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE INDEX IF NOT EXISTS payments_business_status_idx ON public.payments (business_id, status);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE INDEX IF NOT EXISTS payments_business_paid_idx ON public.payments (business_id, paid_at DESC);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE INDEX IF NOT EXISTS payments_customer_idx ON public.payments (customer_id);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE INDEX IF NOT EXISTS payments_order_idx ON public.payments (order_id);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE INDEX IF NOT EXISTS tasks_business_status_idx ON public.tasks (business_id, status, due_date);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE INDEX IF NOT EXISTS tasks_customer_idx ON public.tasks (customer_id);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE INDEX IF NOT EXISTS activities_business_created_idx ON public.activities (business_id, created_at DESC);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE INDEX IF NOT EXISTS activities_customer_idx ON public.activities (customer_id, created_at DESC);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE INDEX IF NOT EXISTS customers_business_status_idx ON public.customers (business_id, status);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE INDEX IF NOT EXISTS customers_business_source_idx ON public.customers (business_id, source);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE INDEX IF NOT EXISTS leads_business_stage_idx ON public.leads (business_id, stage);

-- 20260922172413_06d2fab1-22ef-441e-acd5-43984fa4ed3d.sql
CREATE INDEX IF NOT EXISTS orders_business_created_idx ON public.orders (business_id, created_at DESC);

-- 20260922172504_5e5a49e5-7e8a-4232-937c-291054e0233f.sql
ALTER TABLE public.payments ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260922172504_5e5a49e5-7e8a-4232-937c-291054e0233f.sql
ALTER TABLE public.tasks ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260922172504_5e5a49e5-7e8a-4232-937c-291054e0233f.sql
ALTER TABLE public.activities ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20260922174349_af2d9ef3-ca30-4b38-84c8-54d9c36eac80.sql
CREATE TABLE public.telegram_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_user_id TEXT NOT NULL UNIQUE,
  telegram_chat_id TEXT NOT NULL,
  telegram_username TEXT,
  user_id UUID NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  daily_reports BOOLEAN NOT NULL DEFAULT true,
  report_time TEXT NOT NULL DEFAULT '21:00',
  timezone TEXT NOT NULL DEFAULT 'Asia/Tashkent',
  last_report_date DATE,
  notify_new_order BOOLEAN NOT NULL DEFAULT true,
  notify_payment BOOLEAN NOT NULL DEFAULT true,
  notify_lead BOOLEAN NOT NULL DEFAULT true,
  notify_low_stock BOOLEAN NOT NULL DEFAULT false,
  linked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 20260922174349_af2d9ef3-ca30-4b38-84c8-54d9c36eac80.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_links TO app_user;

-- 20260922174349_af2d9ef3-ca30-4b38-84c8-54d9c36eac80.sql
GRANT ALL ON public.telegram_links TO app_service;

-- 20260922174349_af2d9ef3-ca30-4b38-84c8-54d9c36eac80.sql
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;

-- 20260922174349_af2d9ef3-ca30-4b38-84c8-54d9c36eac80.sql
CREATE POLICY "Members manage their business telegram links"
ON public.telegram_links FOR ALL TO app_user
USING (public.is_business_member(business_id))
WITH CHECK (public.is_business_member(business_id));

-- 20260922174349_af2d9ef3-ca30-4b38-84c8-54d9c36eac80.sql
CREATE INDEX telegram_links_business_idx ON public.telegram_links (business_id);

-- 20260922174349_af2d9ef3-ca30-4b38-84c8-54d9c36eac80.sql
CREATE INDEX telegram_links_daily_idx ON public.telegram_links (daily_reports, report_time);

-- 20260922174349_af2d9ef3-ca30-4b38-84c8-54d9c36eac80.sql
CREATE TRIGGER telegram_links_updated_at
BEFORE UPDATE ON public.telegram_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260922174349_af2d9ef3-ca30-4b38-84c8-54d9c36eac80.sql
CREATE TABLE public.telegram_link_requests (
  code TEXT NOT NULL PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  telegram_username TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '30 minutes'),
  consumed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 20260922174349_af2d9ef3-ca30-4b38-84c8-54d9c36eac80.sql
GRANT ALL ON public.telegram_link_requests TO app_service;

-- 20260922174349_af2d9ef3-ca30-4b38-84c8-54d9c36eac80.sql
ALTER TABLE public.telegram_link_requests ENABLE ROW LEVEL SECURITY;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE TABLE public.platform_admins (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
GRANT SELECT ON public.platform_admins TO app_user;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
GRANT ALL ON public.platform_admins TO app_service;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = app.user_id());
$$;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE POLICY "Super admins read platform admins"
ON public.platform_admins FOR SELECT TO app_user
USING (public.is_super_admin());

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS suspend_reason TEXT;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP WITH TIME ZONE;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE POLICY "Super admins read all businesses"
ON public.businesses FOR SELECT TO app_user
USING (public.is_super_admin());

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE POLICY "Super admins read all profiles"
ON public.profiles FOR SELECT TO app_user
USING (public.is_super_admin());

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE OR REPLACE FUNCTION public.is_business_member(_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members m
    JOIN public.businesses b ON b.id = m.business_id
    WHERE m.business_id = _business_id
      AND m.user_id = app.user_id()
      AND b.status <> 'suspended'
  );
$$;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_user_id UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_kind TEXT NOT NULL DEFAULT 'user',
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  target_label TEXT,
  business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'success',
  ip TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
GRANT SELECT ON public.audit_logs TO app_user;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
GRANT ALL ON public.audit_logs TO app_service;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE POLICY "Super admins read audit logs"
ON public.audit_logs FOR SELECT TO app_user
USING (public.is_super_admin());

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE INDEX audit_logs_created_idx ON public.audit_logs (created_at DESC);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE INDEX audit_logs_action_idx ON public.audit_logs (action);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE INDEX audit_logs_business_idx ON public.audit_logs (business_id);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE TABLE public.ai_usage_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  feature TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
GRANT SELECT ON public.ai_usage_events TO app_user;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
GRANT ALL ON public.ai_usage_events TO app_service;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE POLICY "Super admins read ai usage"
ON public.ai_usage_events FOR SELECT TO app_user
USING (public.is_super_admin());

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE POLICY "Members read their ai usage"
ON public.ai_usage_events FOR SELECT TO app_user
USING (business_id IS NOT NULL AND public.is_business_member(business_id));

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE INDEX ai_usage_created_idx ON public.ai_usage_events (created_at DESC);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE INDEX ai_usage_business_idx ON public.ai_usage_events (business_id);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE TABLE public.system_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform_name TEXT NOT NULL DEFAULT 'KETA CRM',
  support_email TEXT NOT NULL DEFAULT 'keta.comp.dev@gmail.com',
  support_phone TEXT NOT NULL DEFAULT '+998 77 763 02 16',
  default_timezone TEXT NOT NULL DEFAULT 'Asia/Tashkent',
  default_currency TEXT NOT NULL DEFAULT 'UZS',
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  maintenance_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
GRANT SELECT ON public.system_settings TO app_user;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
GRANT ALL ON public.system_settings TO app_service;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE POLICY "Everyone signed in reads system settings"
ON public.system_settings FOR SELECT TO app_user
USING (true);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE TRIGGER system_settings_updated_at
BEFORE UPDATE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
INSERT INTO public.system_settings (platform_name) VALUES ('KETA CRM');

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE TABLE public.feature_flags (
  key TEXT NOT NULL PRIMARY KEY,
  label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  target_plan TEXT,
  target_business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
GRANT SELECT ON public.feature_flags TO app_user;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
GRANT ALL ON public.feature_flags TO app_service;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE POLICY "Signed in users read feature flags"
ON public.feature_flags FOR SELECT TO app_user
USING (true);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE TRIGGER feature_flags_updated_at
BEFORE UPDATE ON public.feature_flags
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
INSERT INTO public.feature_flags (key, label, enabled) VALUES
  ('ai_assistant', 'AI yordamchi', true),
  ('telegram_reports', 'Telegram hisobotlar', true),
  ('advanced_analytics', 'Kengaytirilgan analitika', true),
  ('excel_export', 'Excel eksport', true);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE TABLE public.system_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'info',
  target_kind TEXT NOT NULL DEFAULT 'all',
  target_value TEXT,
  created_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
GRANT SELECT ON public.system_notifications TO app_user;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
GRANT ALL ON public.system_notifications TO app_service;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
ALTER TABLE public.system_notifications ENABLE ROW LEVEL SECURITY;

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE POLICY "Signed in users read system notifications"
ON public.system_notifications FOR SELECT TO app_user
USING (true);

-- 20260922175459_62c153c5-a7c5-4da0-bf1a-9f31c99f1593.sql
CREATE INDEX system_notifications_created_idx ON public.system_notifications (created_at DESC);

-- 20260922175533_7ed1c0ad-ea7a-42e6-b22f-1bb50a7f47c8.sql
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM app_anon;

-- 20260922175533_7ed1c0ad-ea7a-42e6-b22f-1bb50a7f47c8.sql
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC;

-- 20260922175533_7ed1c0ad-ea7a-42e6-b22f-1bb50a7f47c8.sql
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO app_user, app_service;

-- 20260922175657_86ffda5a-0399-4674-9580-ec98d5f9efdf.sql
CREATE OR REPLACE FUNCTION public.my_workspace_status()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.status
  FROM public.business_members m
  JOIN public.businesses b ON b.id = m.business_id
  WHERE m.user_id = app.user_id()
  ORDER BY m.created_at ASC
  LIMIT 1;
$$;

-- 20260922175657_86ffda5a-0399-4674-9580-ec98d5f9efdf.sql
REVOKE EXECUTE ON FUNCTION public.my_workspace_status() FROM app_anon;

-- 20260922175657_86ffda5a-0399-4674-9580-ec98d5f9efdf.sql
REVOKE EXECUTE ON FUNCTION public.my_workspace_status() FROM PUBLIC;

-- 20260922175657_86ffda5a-0399-4674-9580-ec98d5f9efdf.sql
GRANT EXECUTE ON FUNCTION public.my_workspace_status() TO app_user, app_service;

-- 20260922175759_df0078e0-ab5c-4637-915a-cf77648f9989.sql
CREATE OR REPLACE FUNCTION public.is_business_member(_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members m
    JOIN public.businesses b ON b.id = m.business_id
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.business_id = _business_id
      AND m.user_id = app.user_id()
      AND b.status <> 'suspended'
      AND p.status <> 'suspended'
  );
$$;

-- 20260922175759_df0078e0-ab5c-4637-915a-cf77648f9989.sql
CREATE OR REPLACE FUNCTION public.my_access_state()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'user_status', COALESCE((SELECT p.status FROM public.profiles p WHERE p.id = app.user_id()), 'active'),
    'workspace_status', (
      SELECT b.status FROM public.business_members m
      JOIN public.businesses b ON b.id = m.business_id
      WHERE m.user_id = app.user_id()
      ORDER BY m.created_at ASC LIMIT 1
    ),
    'is_super_admin', public.is_super_admin(),
    'maintenance_mode', COALESCE((SELECT s.maintenance_mode FROM public.system_settings s LIMIT 1), false),
    'maintenance_message', (SELECT s.maintenance_message FROM public.system_settings s LIMIT 1)
  );
$$;

-- 20260922175759_df0078e0-ab5c-4637-915a-cf77648f9989.sql
REVOKE EXECUTE ON FUNCTION public.my_access_state() FROM app_anon;

-- 20260922175759_df0078e0-ab5c-4637-915a-cf77648f9989.sql
REVOKE EXECUTE ON FUNCTION public.my_access_state() FROM PUBLIC;

-- 20260922175759_df0078e0-ab5c-4637-915a-cf77648f9989.sql
GRANT EXECUTE ON FUNCTION public.my_access_state() TO app_user, app_service;

-- 20260922190348_a74a6a08-086a-4c6d-8d23-a24767889471.sql
DROP POLICY IF EXISTS "crm_configs_staff_all" ON public.crm_configs;

-- 20260922190348_a74a6a08-086a-4c6d-8d23-a24767889471.sql
CREATE POLICY "crm_configs tenant" ON public.crm_configs FOR ALL TO app_user
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- 20260922190348_a74a6a08-086a-4c6d-8d23-a24767889471.sql
DROP POLICY IF EXISTS "crm_records_staff_all" ON public.crm_records;

-- 20260922190348_a74a6a08-086a-4c6d-8d23-a24767889471.sql
CREATE POLICY "crm_records tenant" ON public.crm_records FOR ALL TO app_user
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- 20260922190348_a74a6a08-086a-4c6d-8d23-a24767889471.sql
DROP POLICY IF EXISTS "instagram_events staff read" ON public.instagram_events;

-- 20260922190348_a74a6a08-086a-4c6d-8d23-a24767889471.sql
CREATE POLICY "instagram_events admin read" ON public.instagram_events FOR SELECT TO app_user
  USING (public.is_super_admin());

-- 20260922190525_54d3c6ae-b7f1-4742-8ff8-546881cdcd9c.sql
DROP POLICY IF EXISTS "Signed in users read system notifications" ON public.system_notifications;

-- 20260922190525_54d3c6ae-b7f1-4742-8ff8-546881cdcd9c.sql
CREATE POLICY "Targeted users read system notifications" ON public.system_notifications FOR SELECT TO app_user
USING (
  public.is_super_admin()
  OR target_kind = 'all'
  OR (
    target_kind = 'organization'
    AND target_value ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_business_member(target_value::uuid)
  )
  OR (
    target_kind = 'plan'
    AND EXISTS (
      SELECT 1 FROM public.business_members m
      JOIN public.businesses b ON b.id = m.business_id
      WHERE m.user_id = app.user_id() AND b.plan = target_value
    )
  )
  OR (
    target_kind = 'industry'
    AND EXISTS (
      SELECT 1 FROM public.business_members m
      JOIN public.crm_configs c ON c.business_id = m.business_id
      WHERE m.user_id = app.user_id() AND c.industry = target_value
    )
  )
);

-- 20261026120000_a1f4c07e-5b2d-4e8a-9c31-7d6f0e2b8a44.sql
DELETE FROM public.leads l
USING public.leads keep
WHERE l.status NOT IN ('won', 'lost')
  AND keep.status NOT IN ('won', 'lost')
  AND l.business_id = keep.business_id
  AND l.customer_id = keep.customer_id
  AND l.product_id IS NOT DISTINCT FROM keep.product_id
  AND (keep.created_at, keep.id) < (l.created_at, l.id);

-- 20261026120000_a1f4c07e-5b2d-4e8a-9c31-7d6f0e2b8a44.sql
CREATE UNIQUE INDEX IF NOT EXISTS leads_open_dedup_uidx
  ON public.leads (business_id, customer_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status NOT IN ('won', 'lost');

-- 20261026120000_a1f4c07e-5b2d-4e8a-9c31-7d6f0e2b8a44.sql
DROP INDEX IF EXISTS public.customers_instagram_user_uidx;

-- 20261026120000_a1f4c07e-5b2d-4e8a-9c31-7d6f0e2b8a44.sql
CREATE UNIQUE INDEX IF NOT EXISTS customers_instagram_user_uidx
  ON public.customers (business_id, instagram_user_id)
  WHERE instagram_user_id IS NOT NULL;

-- 20261026120000_a1f4c07e-5b2d-4e8a-9c31-7d6f0e2b8a44.sql
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0) NOT VALID,
  ADD CONSTRAINT order_items_unit_price_non_negative CHECK (unit_price >= 0) NOT VALID,
  ADD CONSTRAINT order_items_line_total_non_negative CHECK (line_total >= 0) NOT VALID;

-- 20261026120000_a1f4c07e-5b2d-4e8a-9c31-7d6f0e2b8a44.sql
ALTER TABLE public.products
  ADD CONSTRAINT products_price_non_negative CHECK (price >= 0) NOT VALID,
  ADD CONSTRAINT products_stock_non_negative CHECK (stock_quantity >= 0) NOT VALID,
  ADD CONSTRAINT products_reserved_non_negative CHECK (reserved_quantity >= 0) NOT VALID;

-- 20261026120000_a1f4c07e-5b2d-4e8a-9c31-7d6f0e2b8a44.sql
ALTER TABLE public.orders
  ADD CONSTRAINT orders_total_non_negative CHECK (total >= 0) NOT VALID;

-- 20261026120000_a1f4c07e-5b2d-4e8a-9c31-7d6f0e2b8a44.sql
ALTER TABLE public.payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount > 0) NOT VALID;

-- 20261026120000_a1f4c07e-5b2d-4e8a-9c31-7d6f0e2b8a44.sql
CREATE INDEX IF NOT EXISTS audit_logs_login_failed_idx
  ON public.audit_logs (action, created_at DESC)
  WHERE action = 'login_failed';

-- 20261026121000_b2e5d18c-6f3a-4b9c-8d21-3e7f5a0c9b12.sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'owner';

-- 20261026121000_b2e5d18c-6f3a-4b9c-8d21-3e7f5a0c9b12.sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';

-- 20261026121000_b2e5d18c-6f3a-4b9c-8d21-3e7f5a0c9b12.sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cashier';

-- 20261026121000_b2e5d18c-6f3a-4b9c-8d21-3e7f5a0c9b12.sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'receptionist';

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
CREATE OR REPLACE FUNCTION public.business_role(_business_id uuid)
RETURNS public.app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.role
  FROM public.business_members m
  JOIN public.businesses b ON b.id = m.business_id
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.business_id = _business_id
    AND m.user_id = app.user_id()
    AND b.status <> 'suspended'
    AND p.status <> 'suspended'
  LIMIT 1;
$$;

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
CREATE OR REPLACE FUNCTION public.is_business_admin(_business_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.business_role(_business_id) IN ('owner', 'admin');
$$;

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
REVOKE ALL ON FUNCTION public.business_role(uuid) FROM PUBLIC, app_anon;

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
REVOKE ALL ON FUNCTION public.is_business_admin(uuid) FROM PUBLIC, app_anon;

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
GRANT EXECUTE ON FUNCTION public.business_role(uuid) TO app_user, app_service;

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
GRANT EXECUTE ON FUNCTION public.is_business_admin(uuid) TO app_user, app_service;

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
UPDATE public.business_members m SET role = 'owner'
FROM (
  SELECT DISTINCT ON (business_id) id
  FROM public.business_members
  WHERE role = 'admin'
  ORDER BY business_id, created_at ASC, id ASC
) founding
WHERE m.id = founding.id;

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
GRANT UPDATE, DELETE ON public.business_members TO app_user;

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
CREATE POLICY "members admin update" ON public.business_members
  FOR UPDATE TO app_user
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
CREATE POLICY "members admin delete" ON public.business_members
  FOR DELETE TO app_user
  USING (public.is_business_admin(business_id));

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
DROP POLICY IF EXISTS "business_settings tenant" ON public.business_settings;

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
CREATE POLICY "business_settings member read" ON public.business_settings
  FOR SELECT TO app_user USING (public.is_business_member(business_id));

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
CREATE POLICY "business_settings admin write" ON public.business_settings
  FOR ALL TO app_user
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
DROP POLICY IF EXISTS "ai_settings tenant" ON public.ai_settings;

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
CREATE POLICY "ai_settings member read" ON public.ai_settings
  FOR SELECT TO app_user USING (public.is_business_member(business_id));

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
CREATE POLICY "ai_settings admin write" ON public.ai_settings
  FOR ALL TO app_user
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_business UUID;
  display_name TEXT;
  business_name TEXT;
BEGIN
  display_name := COALESCE(NULLIF(NEW.name, ''), split_part(NEW.email, '@', 1));
  business_name := COALESCE(NULLIF(NULLIF(NEW.name, ''), ''), display_name);

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, display_name)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;

  INSERT INTO public.businesses (owner_id, name) VALUES (NEW.id, business_name)
  RETURNING id INTO new_business;

  INSERT INTO public.business_members (business_id, user_id, role)
  VALUES (new_business, NEW.id, 'owner') ON CONFLICT DO NOTHING;

  INSERT INTO public.business_settings (business_id, business_name)
  VALUES (new_business, business_name);

  INSERT INTO public.ai_settings (business_id) VALUES (new_business);

  INSERT INTO public.operators (business_id, user_id, full_name)
  VALUES (new_business, NEW.id, display_name);

  RETURN NEW;
END; $$;

-- 20261026121100_c3f6e29d-7a4b-4c8d-9e32-4f8a6b1d0c23.sql
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, app_anon, app_user;

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  note TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON public.expenses (business_id, expense_date DESC);

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
CREATE INDEX IF NOT EXISTS idx_expenses_business_category ON public.expenses (business_id, category);

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO app_user;

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
GRANT ALL ON public.expenses TO app_service;

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
CREATE POLICY "expenses tenant" ON public.expenses FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
CREATE TRIGGER expenses_updated_at BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  closed_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
  cash_income NUMERIC(14,2),
  cash_expense NUMERIC(14,2),
  expected_cash NUMERIC(14,2),
  counted_amount NUMERIC(14,2),
  difference NUMERIC(14,2),
  note TEXT NOT NULL DEFAULT ''
);

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open ON public.cash_sessions (business_id) WHERE status = 'open';

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
CREATE INDEX IF NOT EXISTS idx_cash_sessions_business_opened ON public.cash_sessions (business_id, opened_at DESC);

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
GRANT SELECT, INSERT, UPDATE ON public.cash_sessions TO app_user;

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
GRANT ALL ON public.cash_sessions TO app_service;

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

-- 20261026122000_d4a7f31e-8b5c-4d9e-af43-5a9b7c2e1d34.sql
CREATE POLICY "cash_sessions tenant" ON public.cash_sessions FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE TABLE IF NOT EXISTS public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) > 0),
  position TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  hired_on DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE UNIQUE INDEX IF NOT EXISTS employees_business_user ON public.employees (business_id, user_id) WHERE user_id IS NOT NULL;

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE INDEX IF NOT EXISTS idx_employees_business_active ON public.employees (business_id, is_active);

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO app_user;

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
GRANT ALL ON public.employees TO app_service;

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE POLICY "employees tenant" ON public.employees FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE TABLE IF NOT EXISTS public.work_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_start TIME,
  break_end TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE UNIQUE INDEX IF NOT EXISTS work_schedules_employee_weekday ON public.work_schedules (employee_id, weekday);

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE INDEX IF NOT EXISTS idx_work_schedules_business ON public.work_schedules (business_id);

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_schedules TO app_user;

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
GRANT ALL ON public.work_schedules TO app_service;

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
ALTER TABLE public.work_schedules ENABLE ROW LEVEL SECURITY;

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE POLICY "work_schedules tenant" ON public.work_schedules FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE TABLE IF NOT EXISTS public.time_off (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE INDEX IF NOT EXISTS idx_time_off_employee_range ON public.time_off (employee_id, starts_at);

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE INDEX IF NOT EXISTS idx_time_off_business ON public.time_off (business_id);

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_off TO app_user;

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
GRANT ALL ON public.time_off TO app_service;

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
ALTER TABLE public.time_off ENABLE ROW LEVEL SECURITY;

-- 20261026122800_a7d0c14b-3e6f-4c2d-8b94-1f5a7c3e6d28.sql
CREATE POLICY "time_off tenant" ON public.time_off FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE TABLE IF NOT EXISTS public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE INDEX IF NOT EXISTS idx_services_business_active ON public.services (business_id, is_active);

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services TO app_user;

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
GRANT ALL ON public.services TO app_service;

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE POLICY "services tenant" ON public.services FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE TRIGGER services_updated_at BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  note TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE INDEX IF NOT EXISTS idx_appointments_business_start ON public.appointments (business_id, starts_at);

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE INDEX IF NOT EXISTS idx_appointments_business_status ON public.appointments (business_id, status);

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE INDEX IF NOT EXISTS idx_appointments_employee ON public.appointments (employee_id, starts_at);

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_no_double_booking'
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_no_double_booking
      EXCLUDE USING gist (
        employee_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
      ) WHERE (status = 'scheduled' AND employee_id IS NOT NULL);
  END IF;
END $$;

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO app_user;

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
GRANT ALL ON public.appointments TO app_service;

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE POLICY "appointments tenant" ON public.appointments FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE TABLE IF NOT EXISTS public.employee_services (
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, service_id)
);

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE INDEX IF NOT EXISTS idx_employee_services_business ON public.employee_services (business_id);

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_services TO app_user;

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
GRANT ALL ON public.employee_services TO app_service;

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
ALTER TABLE public.employee_services ENABLE ROW LEVEL SECURITY;

-- 20261026123000_e5b8a42f-9c4d-4a7e-b6f5-8c2d1e0a9b73.sql
CREATE POLICY "employee_services tenant" ON public.employee_services FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
CREATE TABLE IF NOT EXISTS public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
CREATE UNIQUE INDEX IF NOT EXISTS branches_business_name ON public.branches (business_id, lower(name));

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
CREATE INDEX IF NOT EXISTS idx_branches_business ON public.branches (business_id, is_active);

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO app_user;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
GRANT ALL ON public.branches TO app_service;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
CREATE POLICY "branches tenant" ON public.branches FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
CREATE TRIGGER branches_updated_at BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
ALTER TABLE public.business_members
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
CREATE INDEX IF NOT EXISTS idx_appointments_business_branch ON public.appointments (business_id, branch_id, starts_at);

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
CREATE INDEX IF NOT EXISTS idx_expenses_business_branch ON public.expenses (business_id, branch_id);

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
CREATE INDEX IF NOT EXISTS idx_employees_business_branch ON public.employees (business_id, branch_id);

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
CREATE OR REPLACE FUNCTION public.branch_access_ok(_business_id UUID, _branch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH caller AS (
    SELECT bm.branch_id AS member_branch
    FROM public.business_members bm
    WHERE bm.business_id = _business_id AND bm.user_id = app.user_id()
    LIMIT 1
  )
  SELECT CASE
    WHEN public.is_business_admin(_business_id) THEN true
    WHEN (SELECT member_branch FROM caller) IS NULL THEN true
    WHEN _branch_id IS NULL THEN true
    ELSE (SELECT member_branch FROM caller) = _branch_id
  END
$$;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
REVOKE ALL ON FUNCTION public.branch_access_ok(UUID, UUID) FROM PUBLIC, app_anon;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
GRANT EXECUTE ON FUNCTION public.branch_access_ok(UUID, UUID) TO app_user, app_service;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
DROP POLICY IF EXISTS "appointments tenant" ON public.appointments;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
CREATE POLICY "appointments tenant" ON public.appointments FOR ALL TO app_user
  USING (
    public.is_business_member(business_id)
    AND public.branch_access_ok(business_id, branch_id)
  )
  WITH CHECK (
    public.is_business_member(business_id)
    AND public.branch_access_ok(business_id, branch_id)
  );

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
DROP POLICY IF EXISTS "expenses tenant" ON public.expenses;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
CREATE POLICY "expenses tenant" ON public.expenses FOR ALL TO app_user
  USING (
    public.is_business_member(business_id)
    AND public.branch_access_ok(business_id, branch_id)
  )
  WITH CHECK (
    public.is_business_member(business_id)
    AND public.branch_access_ok(business_id, branch_id)
  );

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
DROP POLICY IF EXISTS "cash_sessions tenant" ON public.cash_sessions;

-- 20261026124000_f6c9b53a-0d5e-4b8f-9a16-2b7d8e4f3c21.sql
CREATE POLICY "cash_sessions tenant" ON public.cash_sessions FOR ALL TO app_user
  USING (
    public.is_business_member(business_id)
    AND public.branch_access_ok(business_id, branch_id)
  )
  WITH CHECK (
    public.is_business_member(business_id)
    AND public.branch_access_ok(business_id, branch_id)
  );

-- 20261026125000_17b3d9e4-2a58-4c6d-9e70-3b8c1d2e4f55.sql
ALTER TABLE public.appointments ALTER COLUMN status SET DEFAULT 'new';

-- 20261026125000_17b3d9e4-2a58-4c6d-9e70-3b8c1d2e4f55.sql
UPDATE public.appointments SET status = 'confirmed' WHERE status = 'scheduled';

-- 20261026125000_17b3d9e4-2a58-4c6d-9e70-3b8c1d2e4f55.sql
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;

-- 20261026125000_17b3d9e4-2a58-4c6d-9e70-3b8c1d2e4f55.sql
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('new', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'));

-- 20261026125000_17b3d9e4-2a58-4c6d-9e70-3b8c1d2e4f55.sql
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_no_double_booking;

-- 20261026125000_17b3d9e4-2a58-4c6d-9e70-3b8c1d2e4f55.sql
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_no_double_booking
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('new', 'confirmed', 'arrived') AND employee_id IS NOT NULL);

-- 20261026125000_17b3d9e4-2a58-4c6d-9e70-3b8c1d2e4f55.sql
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS service_name TEXT,
  ADD COLUMN IF NOT EXISTS price NUMERIC(14,2) CHECK (price >= 0),
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER CHECK (duration_minutes > 0 AND duration_minutes <= 1440);

-- 20261026125000_17b3d9e4-2a58-4c6d-9e70-3b8c1d2e4f55.sql
UPDATE public.appointments a
SET service_name = s.name,
    price = s.price,
    duration_minutes = EXTRACT(EPOCH FROM (a.ends_at - a.starts_at))::int / 60
FROM public.services s
WHERE a.service_id = s.id
  AND (a.service_name IS NULL OR a.price IS NULL OR a.duration_minutes IS NULL);

-- 20261026126000_28c4e0f5-3b69-4d7e-8f81-4c9d2e3f5a66.sql
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS booking_slug TEXT UNIQUE CHECK (booking_slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN NOT NULL DEFAULT true;

-- 20261026126000_28c4e0f5-3b69-4d7e-8f81-4c9d2e3f5a66.sql
UPDATE public.businesses
SET booking_slug = left(md5(id::text), 10)
WHERE booking_slug IS NULL;

-- 20261026126000_28c4e0f5-3b69-4d7e-8f81-4c9d2e3f5a66.sql
CREATE TABLE IF NOT EXISTS public.booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20261026126000_28c4e0f5-3b69-4d7e-8f81-4c9d2e3f5a66.sql
CREATE INDEX IF NOT EXISTS idx_booking_requests_business_phone_time
  ON public.booking_requests (business_id, phone, created_at DESC);

-- 20261026126000_28c4e0f5-3b69-4d7e-8f81-4c9d2e3f5a66.sql
GRANT ALL ON public.booking_requests TO app_service;

-- 20261026126000_28c4e0f5-3b69-4d7e-8f81-4c9d2e3f5a66.sql
ALTER TABLE public.booking_requests ENABLE ROW LEVEL SECURITY;

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
ALTER TABLE public.employee_services
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) CHECK (commission_percent >= 0 AND commission_percent <= 100);

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
CREATE TABLE IF NOT EXISTS public.payroll_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  base_salary NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_percent >= 0 AND commission_percent <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id)
);

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
CREATE INDEX IF NOT EXISTS idx_payroll_rules_business ON public.payroll_rules (business_id);

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_rules TO app_user;

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
GRANT ALL ON public.payroll_rules TO app_service;

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
ALTER TABLE public.payroll_rules ENABLE ROW LEVEL SECURITY;

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
CREATE POLICY "payroll_rules tenant" ON public.payroll_rules FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
CREATE TRIGGER payroll_rules_updated_at BEFORE UPDATE ON public.payroll_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
CREATE TABLE IF NOT EXISTS public.payroll_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  service_revenue NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (service_revenue >= 0),
  base_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (base_amount >= 0),
  commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
  bonus_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  advance_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (advance_amount >= 0),
  deduction_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  total_computed NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_paid NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_paid >= 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'paid')),
  approved_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CONSTRAINT payroll_statement_period UNIQUE (business_id, employee_id, period_start)
);

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
CREATE INDEX IF NOT EXISTS idx_payroll_statements_business_period
  ON public.payroll_statements (business_id, period_start);

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_statements TO app_user;

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
GRANT ALL ON public.payroll_statements TO app_service;

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
ALTER TABLE public.payroll_statements ENABLE ROW LEVEL SECURITY;

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
CREATE POLICY "payroll_statements tenant" ON public.payroll_statements FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20261026127000_39d5f1a6-4c78-4e8f-9a92-5d0e3f4a6b77.sql
CREATE TRIGGER payroll_statements_updated_at BEFORE UPDATE ON public.payroll_statements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20261026128000_4ae6a2b7-5d89-4f03-9b1c-6e1f2a3b4c5d.sql
ALTER TABLE public.telegram_links
  ADD COLUMN IF NOT EXISTS notify_booking BOOLEAN NOT NULL DEFAULT false;

-- 20261027129000_b1c7d2e4-5a86-4f03-9d21-7e4b8c1a3f60.sql
ALTER TABLE public.payroll_statements
  ADD COLUMN IF NOT EXISTS expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_method TEXT NOT NULL DEFAULT 'cash';

-- 20261027129000_b1c7d2e4-5a86-4f03-9d21-7e4b8c1a3f60.sql
CREATE INDEX IF NOT EXISTS idx_payroll_statements_expense ON public.payroll_statements (expense_id);

-- 20261027129000_b1c7d2e4-5a86-4f03-9d21-7e4b8c1a3f60.sql
ALTER TABLE public.expenses ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20261027129000_b1c7d2e4-5a86-4f03-9d21-7e4b8c1a3f60.sql
ALTER TABLE public.cash_sessions ALTER COLUMN business_id SET DEFAULT public.current_business_id();

-- 20261027130000_c2d8e3f5-6b97-4a14-8e32-1f5c9d2b4a71.sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS erased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS erased_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL;

-- 20261027130000_c2d8e3f5-6b97-4a14-8e32-1f5c9d2b4a71.sql
CREATE INDEX IF NOT EXISTS idx_customers_business_erased ON public.customers (business_id, erased_at);

-- 20261027130000_c2d8e3f5-6b97-4a14-8e32-1f5c9d2b4a71.sql
CREATE OR REPLACE FUNCTION public.enforce_customer_privacy()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.erased_at IS DISTINCT FROM OLD.erased_at THEN
    IF NOT public.is_business_admin(NEW.business_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'Mijoz ma''lumotlarini o''chirish faqat ego yoki admin uchun.';
    END IF;
  END IF;
  IF OLD.erased_at IS NOT NULL
     AND (NEW.full_name IS DISTINCT FROM OLD.full_name
          OR NEW.phone IS DISTINCT FROM OLD.phone
          OR NEW.email IS DISTINCT FROM OLD.email) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'O''chirilgan mijozning aloqa ma''lumotlari tiklanmaydi.';
  END IF;
  RETURN NEW;
END $$;

-- 20261027130000_c2d8e3f5-6b97-4a14-8e32-1f5c9d2b4a71.sql
DROP TRIGGER IF EXISTS customers_privacy_enforce ON public.customers;

-- 20261027130000_c2d8e3f5-6b97-4a14-8e32-1f5c9d2b4a71.sql
CREATE TRIGGER customers_privacy_enforce BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_privacy();

-- 20261027131000_d3e9f4a6-7c08-4b25-9f43-2a6d0e3c5b82.sql
CREATE TABLE IF NOT EXISTS public.error_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  level TEXT NOT NULL DEFAULT 'error' CHECK (level IN ('error', 'warning')),
  route TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  status_code INTEGER,
  business_id UUID,
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fingerprint, bucket)
);

-- 20261027131000_d3e9f4a6-7c08-4b25-9f43-2a6d0e3c5b82.sql
CREATE INDEX IF NOT EXISTS idx_error_events_created ON public.error_events (created_at DESC);

-- 20261027131000_d3e9f4a6-7c08-4b25-9f43-2a6d0e3c5b82.sql
CREATE INDEX IF NOT EXISTS idx_error_events_route ON public.error_events (route);

-- 20261027131000_d3e9f4a6-7c08-4b25-9f43-2a6d0e3c5b82.sql
ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;

-- 20261027131000_d3e9f4a6-7c08-4b25-9f43-2a6d0e3c5b82.sql
REVOKE ALL ON public.error_events FROM app_anon, app_user;

-- 20261027131000_d3e9f4a6-7c08-4b25-9f43-2a6d0e3c5b82.sql
GRANT ALL ON public.error_events TO app_service;

-- 20261027132000_e4f0a5b7-8d19-4c36-a054-3b7e1f4d6c93.sql
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS logo_path TEXT NOT NULL DEFAULT '';

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
BEGIN;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TYPE public.lead_status RENAME VALUE 'needs_operator' TO 'needs_attention';

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TYPE public.message_role RENAME VALUE 'operator' TO 'staff';

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
DELETE FROM public.user_roles ur
WHERE ur.role::text = 'operator'
  AND EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id AND x.role::text <> 'operator');

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.user_roles SET role = 'receptionist' WHERE role::text = 'operator';

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.business_members SET role = 'receptionist' WHERE role::text = 'operator';

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
CREATE TEMP TABLE operator_to_member ON COMMIT DROP AS
SELECT o.id AS operator_id, m.id AS member_id
FROM public.operators o
JOIN public.business_members m ON m.business_id = o.business_id AND m.user_id = o.user_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.leads RENAME COLUMN assigned_operator_id TO assigned_member_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_assigned_operator_id_fkey;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.leads l SET assigned_member_id = map.member_id
FROM operator_to_member map WHERE l.assigned_member_id = map.operator_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.leads SET assigned_member_id = NULL WHERE assigned_member_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.business_members m WHERE m.id = assigned_member_id);

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.leads
  ADD CONSTRAINT leads_assigned_member_id_fkey FOREIGN KEY (assigned_member_id)
  REFERENCES public.business_members(id) ON DELETE SET NULL;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.orders RENAME COLUMN assigned_operator_id TO assigned_member_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_assigned_operator_id_fkey;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.orders o SET assigned_member_id = map.member_id
FROM operator_to_member map WHERE o.assigned_member_id = map.operator_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.orders SET assigned_member_id = NULL WHERE assigned_member_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.business_members m WHERE m.id = assigned_member_id);

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.orders
  ADD CONSTRAINT orders_assigned_member_id_fkey FOREIGN KEY (assigned_member_id)
  REFERENCES public.business_members(id) ON DELETE SET NULL;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.customers RENAME COLUMN assigned_operator_id TO assigned_member_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_assigned_operator_id_fkey;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.customers c SET assigned_member_id = map.member_id
FROM operator_to_member map WHERE c.assigned_member_id = map.operator_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.customers SET assigned_member_id = NULL WHERE assigned_member_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.business_members m WHERE m.id = assigned_member_id);

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.customers
  ADD CONSTRAINT customers_assigned_member_id_fkey FOREIGN KEY (assigned_member_id)
  REFERENCES public.business_members(id) ON DELETE SET NULL;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.conversations RENAME COLUMN assigned_operator_id TO assigned_member_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_assigned_operator_id_fkey;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.conversations cv SET assigned_member_id = map.member_id
FROM operator_to_member map WHERE cv.assigned_member_id = map.operator_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.conversations SET assigned_member_id = NULL WHERE assigned_member_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.business_members m WHERE m.id = assigned_member_id);

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_assigned_member_id_fkey FOREIGN KEY (assigned_member_id)
  REFERENCES public.business_members(id) ON DELETE SET NULL;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.tasks RENAME COLUMN assigned_operator_id TO assigned_member_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_assigned_operator_id_fkey;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.tasks tk SET assigned_member_id = map.member_id
FROM operator_to_member map WHERE tk.assigned_member_id = map.operator_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.tasks SET assigned_member_id = NULL WHERE assigned_member_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.business_members m WHERE m.id = assigned_member_id);

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_assigned_member_id_fkey FOREIGN KEY (assigned_member_id)
  REFERENCES public.business_members(id) ON DELETE SET NULL;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.messages RENAME COLUMN operator_id TO member_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_operator_id_fkey;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.messages ms SET member_id = map.member_id
FROM operator_to_member map WHERE ms.member_id = map.operator_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.messages SET member_id = NULL WHERE member_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.business_members m WHERE m.id = member_id);

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.messages
  ADD CONSTRAINT messages_member_id_fkey FOREIGN KEY (member_id)
  REFERENCES public.business_members(id) ON DELETE SET NULL;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.operator_assignments RENAME TO lead_assignments;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.lead_assignments RENAME COLUMN operator_id TO member_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.lead_assignments DROP CONSTRAINT IF EXISTS operator_assignments_operator_id_fkey;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.lead_assignments la SET member_id = map.member_id
FROM operator_to_member map WHERE la.member_id = map.operator_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
DELETE FROM public.lead_assignments WHERE member_id IS NULL OR member_id NOT IN
  (SELECT id FROM public.business_members);

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.lead_assignments
  ADD CONSTRAINT lead_assignments_member_id_fkey FOREIGN KEY (member_id)
  REFERENCES public.business_members(id) ON DELETE CASCADE;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.business_settings RENAME COLUMN operator_group_chat_id TO staff_group_chat_id;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.activities SET actor = 'staff' WHERE actor = 'operator';

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
ALTER TABLE public.activities ALTER COLUMN actor SET DEFAULT 'staff';

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.lead_events SET actor = 'staff' WHERE actor = 'operator';

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
UPDATE public.lead_events SET event_type = 'staff_notified' WHERE event_type = 'operator_notified';

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_business UUID;
  display_name TEXT;
  business_name TEXT;
BEGIN
  display_name := COALESCE(NULLIF(NEW.name, ''), split_part(NEW.email, '@', 1));
  business_name := COALESCE(NULLIF(NULLIF(NEW.name, ''), ''), display_name);

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, display_name)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;

  INSERT INTO public.businesses (owner_id, name) VALUES (NEW.id, business_name)
  RETURNING id INTO new_business;

  INSERT INTO public.business_members (business_id, user_id, role)
  VALUES (new_business, NEW.id, 'owner') ON CONFLICT DO NOTHING;

  INSERT INTO public.business_settings (business_id, business_name)
  VALUES (new_business, business_name);

  INSERT INTO public.ai_settings (business_id) VALUES (new_business);

  RETURN NEW;
END; $$;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
DROP TABLE public.operators;

-- 20261028133000_f5a1b6c8-9e20-4d47-b165-4c8f2a5e7d04.sql
COMMIT;

-- 20261028134000_ee1a3d93-b729-4942-9bf6-702f2d60cf68.sql
BEGIN;

-- 20261028134000_ee1a3d93-b729-4942-9bf6-702f2d60cf68.sql
DROP POLICY IF EXISTS "crm_configs tenant" ON public.crm_configs;

-- 20261028134000_ee1a3d93-b729-4942-9bf6-702f2d60cf68.sql
CREATE POLICY "crm_configs member read" ON public.crm_configs
FOR SELECT TO app_user
  USING (public.is_business_member(business_id));

-- 20261028134000_ee1a3d93-b729-4942-9bf6-702f2d60cf68.sql
CREATE POLICY "crm_configs admin insert" ON public.crm_configs
FOR INSERT TO app_user
  WITH CHECK (public.is_business_admin(business_id));

-- 20261028134000_ee1a3d93-b729-4942-9bf6-702f2d60cf68.sql
CREATE POLICY "crm_configs admin update" ON public.crm_configs
FOR UPDATE TO app_user
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

-- 20261028134000_ee1a3d93-b729-4942-9bf6-702f2d60cf68.sql
CREATE POLICY "crm_configs admin delete" ON public.crm_configs
FOR DELETE TO app_user
  USING (public.is_business_admin(business_id));

-- 20261028134000_ee1a3d93-b729-4942-9bf6-702f2d60cf68.sql
COMMIT;

-- 20261028136000_7c4d2e91-5a08-4b6f-a317-9d5e2c4b7a10.sql
DROP POLICY IF EXISTS "business admins read own medical audit logs" ON public.audit_logs;

-- 20261028136000_7c4d2e91-5a08-4b6f-a317-9d5e2c4b7a10.sql
CREATE POLICY "business admins read own medical audit logs"
  ON public.audit_logs FOR SELECT TO app_user
  USING (
    business_id IS NOT NULL
    AND left(action, 8) = 'medical.'
    AND public.is_business_admin(business_id)
  );

-- 20261028140000_a1179d32-f1d5-4063-abb4-dd1c8a33661a.sql
CREATE TABLE public.notification_reads (
  user_id UUID NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES public.system_notifications(id) ON DELETE CASCADE,
  read_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

-- 20261028140000_a1179d32-f1d5-4063-abb4-dd1c8a33661a.sql
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

-- 20261028140000_a1179d32-f1d5-4063-abb4-dd1c8a33661a.sql
CREATE POLICY "own notification reads select"
ON public.notification_reads FOR SELECT TO app_user
USING (user_id = app.user_id());

-- 20261028140000_a1179d32-f1d5-4063-abb4-dd1c8a33661a.sql
CREATE POLICY "own notification reads insert"
ON public.notification_reads FOR INSERT TO app_user
WITH CHECK (user_id = app.user_id());

-- 20261028140000_a1179d32-f1d5-4063-abb4-dd1c8a33661a.sql
CREATE POLICY "own notification reads delete"
ON public.notification_reads FOR DELETE TO app_user
USING (user_id = app.user_id());

-- 20261028140000_a1179d32-f1d5-4063-abb4-dd1c8a33661a.sql
REVOKE ALL ON public.notification_reads FROM PUBLIC, app_anon;

-- 20261028140000_a1179d32-f1d5-4063-abb4-dd1c8a33661a.sql
GRANT SELECT, INSERT, DELETE ON public.notification_reads TO app_user;

-- 20261028140000_a1179d32-f1d5-4063-abb4-dd1c8a33661a.sql
GRANT ALL ON public.notification_reads TO app_service;

-- 20261028140000_a1179d32-f1d5-4063-abb4-dd1c8a33661a.sql
CREATE INDEX notification_reads_notification_idx ON public.notification_reads (notification_id);

-- 20261028140500_a7d3c1e9-2b48-4f6a-9c17-8e5b2d0a4f71.sql
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;

-- 20261028140500_a7d3c1e9-2b48-4f6a-9c17-8e5b2d0a4f71.sql
CREATE INDEX IF NOT EXISTS idx_businesses_trial_ends_at ON public.businesses (trial_ends_at);

-- 20261028141000_566fc2f5-4f08-40f7-a9e8-6be0480bffa1.sql
UPDATE public.businesses
SET plan = CASE plan
  WHEN 'starter' THEN 'start'
  WHEN 'business' THEN 'pro'
  WHEN 'enterprise' THEN 'max'
  ELSE 'free'
END
WHERE plan NOT IN ('free', 'start', 'pro', 'max');

-- 20261028141000_566fc2f5-4f08-40f7-a9e8-6be0480bffa1.sql
ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_plan_check;

-- 20261028141000_566fc2f5-4f08-40f7-a9e8-6be0480bffa1.sql
ALTER TABLE public.businesses ADD CONSTRAINT businesses_plan_check
  CHECK (plan IN ('free', 'start', 'pro', 'max'));

-- 20261028141000_566fc2f5-4f08-40f7-a9e8-6be0480bffa1.sql
CREATE OR REPLACE FUNCTION public.my_access_state()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH biz AS (
    SELECT b.id, b.plan, b.status, b.trial_ends_at, b.subscription_ends_at
    FROM public.business_members m
    JOIN public.businesses b ON b.id = m.business_id
    WHERE m.user_id = app.user_id()
    ORDER BY m.created_at ASC
    LIMIT 1
  ),
  -- Only flags that actually address this workspace are reported; the rest stay
  -- absent so the caller falls back to the plan rules instead of a false "off".
  flags AS (
    SELECT jsonb_object_agg(f.key, f.enabled) AS features
    FROM public.feature_flags f, biz
    WHERE (f.target_business_id IS NULL OR f.target_business_id = biz.id)
      AND (f.target_plan IS NULL OR f.target_plan = biz.plan)
  )
  SELECT jsonb_build_object(
    'user_status', COALESCE((SELECT p.status FROM public.profiles p WHERE p.id = app.user_id()), 'active'),
    'business_id', (SELECT id FROM biz),
    'workspace_status', (SELECT status FROM biz),
    'plan', (SELECT plan FROM biz),
    'trial_ends_at', (SELECT trial_ends_at FROM biz),
    'subscription_ends_at', (SELECT subscription_ends_at FROM biz),
    'is_super_admin', public.is_super_admin(),
    'maintenance_mode', COALESCE((SELECT s.maintenance_mode FROM public.system_settings s LIMIT 1), false),
    'maintenance_message', (SELECT s.maintenance_message FROM public.system_settings s LIMIT 1),
    'features', COALESCE((SELECT features FROM flags), '{}'::jsonb)
  );
$$;

-- 20261028141000_566fc2f5-4f08-40f7-a9e8-6be0480bffa1.sql
REVOKE EXECUTE ON FUNCTION public.my_access_state() FROM app_anon;

-- 20261028141000_566fc2f5-4f08-40f7-a9e8-6be0480bffa1.sql
REVOKE EXECUTE ON FUNCTION public.my_access_state() FROM PUBLIC;

-- 20261028141000_566fc2f5-4f08-40f7-a9e8-6be0480bffa1.sql
GRANT EXECUTE ON FUNCTION public.my_access_state() TO app_user, app_service;

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
CREATE SEQUENCE IF NOT EXISTS public.billing_invoices_invoice_no_seq;

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_no BIGINT NOT NULL DEFAULT nextval('public.billing_invoices_invoice_no_seq'::regclass),
  plan TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  provider_txn_id TEXT,
  provider_state INTEGER,
  provider_time BIGINT,
  perform_time TIMESTAMPTZ,
  cancel_time TIMESTAMPTZ,
  cancel_reason INTEGER,
  created_by UUID REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
ALTER SEQUENCE public.billing_invoices_invoice_no_seq
  OWNED BY public.billing_invoices.invoice_no;

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_invoice_no_key ON public.billing_invoices (invoice_no);

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_provider_txn_key
  ON public.billing_invoices (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL;

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
CREATE INDEX IF NOT EXISTS idx_billing_invoices_business ON public.billing_invoices (business_id, created_at DESC);

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
GRANT SELECT, INSERT, UPDATE ON public.billing_invoices TO app_user;

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
GRANT USAGE, SELECT ON SEQUENCE public.billing_invoices_invoice_no_seq TO app_user;

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
GRANT USAGE, SELECT ON SEQUENCE public.billing_invoices_invoice_no_seq TO app_service;

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
GRANT ALL ON public.billing_invoices TO app_service;

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
CREATE POLICY "billing_invoices tenant read" ON public.billing_invoices
  FOR SELECT TO app_user USING (public.is_business_member(business_id));

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
CREATE POLICY "billing_invoices owner insert" ON public.billing_invoices
  FOR INSERT TO app_user WITH CHECK (public.is_business_member(business_id));

-- 20261028142000_c9f4b276-3d8a-4e51-b0c6-1a7e9d3f5b28.sql
CREATE TRIGGER billing_invoices_updated_at BEFORE UPDATE ON public.billing_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20261029090000_3e8b5c47-06a1-4d9f-bb2e-57c4ad9e1f33.sql
update crm_configs
   set config = (config #>> '{}')::jsonb
 where config is not null
   and jsonb_typeof(config) = 'string'
   and left(ltrim(config #>> '{}'), 1) in ('{', '[');

-- 20261029090000_3e8b5c47-06a1-4d9f-bb2e-57c4ad9e1f33.sql
update audit_logs
   set metadata = (metadata #>> '{}')::jsonb
 where metadata is not null
   and jsonb_typeof(metadata) = 'string'
   and left(ltrim(metadata #>> '{}'), 1) in ('{', '[');

-- 20261030150000_b7f2c41d-9e35-4a68-b0c7-2d41ea8f6b19.sql
CREATE TABLE IF NOT EXISTS public.telegram_bot_state (
  telegram_user_id TEXT NOT NULL PRIMARY KEY,
  chat_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  secret_message_id TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '15 minutes')
);

-- 20261030150000_b7f2c41d-9e35-4a68-b0c7-2d41ea8f6b19.sql
CREATE INDEX IF NOT EXISTS telegram_bot_state_expiry_idx
  ON public.telegram_bot_state (expires_at);

-- 20261030150000_b7f2c41d-9e35-4a68-b0c7-2d41ea8f6b19.sql
ALTER TABLE public.telegram_bot_state ENABLE ROW LEVEL SECURITY;

-- 20261030150000_b7f2c41d-9e35-4a68-b0c7-2d41ea8f6b19.sql
GRANT ALL ON public.telegram_bot_state TO app_service;

-- 20261030150000_b7f2c41d-9e35-4a68-b0c7-2d41ea8f6b19.sql
ALTER TABLE public.telegram_links ALTER COLUMN notify_booking SET DEFAULT true;

-- 20261030150000_b7f2c41d-9e35-4a68-b0c7-2d41ea8f6b19.sql
UPDATE public.telegram_links
   SET notify_booking = true
 WHERE status = 'active'
   AND notify_booking = false;

-- 20261030180000_bfca69cd-a519-4a90-a272-2a61fcec4060.sql
CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  lesson_date DATE NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'present'
    CHECK (status IN ('present', 'absent', 'excused', 'late')),
  note TEXT NOT NULL DEFAULT '',
  marked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT attendance_one_mark_per_day UNIQUE (business_id, student_id, lesson_date, group_name)
);

-- 20261030180000_bfca69cd-a519-4a90-a272-2a61fcec4060.sql
CREATE INDEX IF NOT EXISTS attendance_business_date_idx
  ON public.attendance (business_id, lesson_date);

-- 20261030180000_bfca69cd-a519-4a90-a272-2a61fcec4060.sql
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

-- 20261030180000_bfca69cd-a519-4a90-a272-2a61fcec4060.sql
CREATE POLICY "attendance tenant" ON public.attendance FOR ALL TO app_user
  USING (
    public.is_business_member(business_id)
    AND public.branch_access_ok(business_id, NULL)
  )
  WITH CHECK (
    public.is_business_member(business_id)
    AND public.branch_access_ok(business_id, NULL)
  );

-- 20261030180000_bfca69cd-a519-4a90-a272-2a61fcec4060.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO app_user;

-- 20261030180000_bfca69cd-a519-4a90-a272-2a61fcec4060.sql
GRANT ALL ON public.attendance TO app_service;

-- 20261031170000_8632fcf7-7bbf-44fc-939a-6c9c5d025363.sql
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS deposit_type TEXT NOT NULL DEFAULT 'none'
    CHECK (deposit_type IN ('none', 'fixed', 'percent')),
  ADD COLUMN IF NOT EXISTS deposit_value NUMERIC(14,2) NOT NULL DEFAULT 0
    CHECK (deposit_value >= 0);

-- 20261031170000_8632fcf7-7bbf-44fc-939a-6c9c5d025363.sql
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(14,2)
    CHECK (deposit_amount IS NULL OR deposit_amount >= 0),
  ADD COLUMN IF NOT EXISTS deposit_paid_amount NUMERIC(14,2)
    CHECK (deposit_paid_amount IS NULL OR deposit_paid_amount >= 0),
  ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_method TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS deposit_refunded_at TIMESTAMPTZ;

-- 20261031170000_8632fcf7-7bbf-44fc-939a-6c9c5d025363.sql
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_deposit_state;

-- 20261031170000_8632fcf7-7bbf-44fc-939a-6c9c5d025363.sql
ALTER TABLE public.appointments ADD CONSTRAINT appointments_deposit_state CHECK (
  (deposit_refunded_at IS NULL AND deposit_paid_at IS NULL AND deposit_paid_amount IS NULL)
  OR (deposit_refunded_at IS NULL AND deposit_paid_at IS NOT NULL AND deposit_paid_amount IS NOT NULL)
  OR (deposit_refunded_at IS NOT NULL)
);

-- 20261031170000_8632fcf7-7bbf-44fc-939a-6c9c5d025363.sql
CREATE INDEX IF NOT EXISTS idx_appointments_deposit_pending
  ON public.appointments (business_id, starts_at)
  WHERE deposit_amount > 0 AND deposit_paid_at IS NULL;

-- 20261031170000_8632fcf7-7bbf-44fc-939a-6c9c5d025363.sql
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL;

-- 20261031170000_8632fcf7-7bbf-44fc-939a-6c9c5d025363.sql
CREATE INDEX IF NOT EXISTS payments_appointment_idx ON public.payments (appointment_id);

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
CREATE TABLE IF NOT EXISTS public.study_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  teacher_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  -- 0 = guruh narxi kursning `services.price` qiymatidan olinadi.
  monthly_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  -- 0 = sig'im cheklanmagan.
  capacity INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  -- Dars kunlari: 1=Dushanba ... 7=Yakshanba, vergul bilan ("1,3,5").
  lesson_days TEXT NOT NULL DEFAULT '',
  starts_on DATE,
  ends_on DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('collecting', 'active', 'finished', 'archived')),
  note TEXT NOT NULL DEFAULT '',
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT study_groups_one_name_per_business UNIQUE (business_id, name)
);

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
CREATE INDEX IF NOT EXISTS study_groups_business_idx
  ON public.study_groups (business_id, status);

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
CREATE INDEX IF NOT EXISTS study_groups_course_idx
  ON public.study_groups (course_id);

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
ALTER TABLE public.study_groups ENABLE ROW LEVEL SECURITY;

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
CREATE POLICY "study_groups tenant" ON public.study_groups FOR ALL TO app_user
  USING (
    public.is_business_member(business_id)
    AND public.branch_access_ok(business_id, NULL)
  )
  WITH CHECK (
    public.is_business_member(business_id)
    AND public.branch_access_ok(business_id, NULL)
  );

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_groups TO app_user;

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
GRANT ALL ON public.study_groups TO app_service;

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
CREATE TABLE IF NOT EXISTS public.group_members (
  group_id UUID NOT NULL REFERENCES public.study_groups(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  -- Shaxsiy narx (chegirma yoki grant). NULL bo‘lsa guruh, u ham 0 bo‘lsa kurs narxi.
  monthly_price NUMERIC(14,2) CHECK (monthly_price IS NULL OR monthly_price >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, student_id)
);

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
CREATE INDEX IF NOT EXISTS group_members_business_idx
  ON public.group_members (business_id);

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
CREATE INDEX IF NOT EXISTS group_members_student_idx
  ON public.group_members (student_id, status);

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
CREATE POLICY "group_members tenant" ON public.group_members FOR ALL TO app_user
  USING (
    public.is_business_member(business_id)
    AND public.branch_access_ok(business_id, NULL)
  )
  WITH CHECK (
    public.is_business_member(business_id)
    AND public.branch_access_ok(business_id, NULL)
  );

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_members TO app_user;

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
GRANT ALL ON public.group_members TO app_service;

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.study_groups(id) ON DELETE SET NULL;

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
CREATE INDEX IF NOT EXISTS attendance_group_date_idx
  ON public.attendance (business_id, group_id, lesson_date);

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.study_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS period_month TEXT
    CHECK (period_month IS NULL OR period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
CREATE INDEX IF NOT EXISTS payments_group_period_idx
  ON public.payments (business_id, group_id, period_month);

-- 20261031190000_4c1f7d2a-9b83-42e6-8a51-6d0c7b34e9f2.sql
CREATE UNIQUE INDEX IF NOT EXISTS payments_group_tuition_uniq
  ON public.payments (business_id, group_id, customer_id, period_month)
  WHERE group_id IS NOT NULL AND period_month IS NOT NULL AND status = 'pending';

-- 20261101120000_storage_objects.sql
-- Fayl saqlash Neon'da: S3 o'rniga bytea (src/lib/storage.server.ts).
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

-- 20261101120000_storage_objects.sql
CREATE INDEX IF NOT EXISTS storage_objects_business_idx
  ON public.storage_objects(business_id, created_at DESC);

-- 20261101120000_storage_objects.sql
CREATE TRIGGER storage_objects_updated_at BEFORE UPDATE ON public.storage_objects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20261101120000_storage_objects.sql
ALTER TABLE public.storage_objects ENABLE ROW LEVEL SECURITY;

-- 20261101120000_storage_objects.sql
CREATE POLICY "storage_objects tenant" ON public.storage_objects FOR ALL TO app_user
  USING (public.is_business_member(business_id)) WITH CHECK (public.is_business_member(business_id));

-- 20261101120000_storage_objects.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_objects TO app_user;

-- 20261101120000_storage_objects.sql
GRANT ALL ON public.storage_objects TO app_service;

-- ============ epilogue ============
-- Migratsiyalar yaratgan barcha ketma-ketliklarga huquq (default privileges
-- faqat keyingi obyektlarga ta'sir qiladi). Jadval huquqlari har migratsiyada
-- alohida yozilgan — bu yerda ularni kengaytirmaymiz.
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_service;

