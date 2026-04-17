-- =========================================
-- ENUMS
-- =========================================
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'agent');
CREATE TYPE public.deal_type AS ENUM ('sale', 'rent');
CREATE TYPE public.property_status AS ENUM ('draft', 'active', 'sold', 'rented', 'offline');
CREATE TYPE public.inquiry_status AS ENUM ('new', 'contacted', 'viewing', 'negotiating', 'closed_won', 'closed_lost');
CREATE TYPE public.inquiry_source AS ENUM ('website', 'whatsapp', 'facebook', 'instagram');

-- =========================================
-- HELPER FUNCTION (timestamps)
-- =========================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================
-- PROFILES (agent/admin info)
-- =========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name_zh TEXT,
  name_en TEXT,
  licence_no TEXT,
  phone TEXT,
  whatsapp TEXT,
  avatar_url TEXT,
  branch TEXT,
  bio TEXT,
  slug TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- USER ROLES (separate table to avoid privilege escalation)
-- =========================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer to check role (prevents recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- =========================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- =========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name_zh, name_en)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name_zh', NEW.raw_user_meta_data ->> 'full_name'),
    COALESCE(NEW.raw_user_meta_data ->> 'name_en', NEW.raw_user_meta_data ->> 'full_name')
  );
  -- default role: agent
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'agent');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================
-- ESTATES
-- =========================================
CREATE TABLE public.estates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  district_slug TEXT NOT NULL,
  developer TEXT,
  year_completed INT,
  phases INT,
  total_units INT,
  area_min INT,
  area_max INT,
  avg_saleable_psf NUMERIC,
  description TEXT,
  hero_image TEXT,
  facilities TEXT[],
  lat NUMERIC,
  lng NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.estates ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_estates_updated_at
BEFORE UPDATE ON public.estates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- PROPERTIES
-- =========================================
CREATE TABLE public.properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_no TEXT NOT NULL UNIQUE,
  title_zh TEXT NOT NULL,
  title_en TEXT,
  deal_type deal_type NOT NULL,
  estate_id UUID REFERENCES public.estates(id) ON DELETE SET NULL,
  district_slug TEXT NOT NULL,
  address TEXT,
  price NUMERIC,
  rent NUMERIC,
  saleable_area INT,
  gross_area INT,
  bedrooms INT,
  bathrooms INT,
  floor TEXT,
  orientation TEXT,
  management_fee NUMERIC,
  features TEXT[],
  description TEXT,
  images TEXT[],
  video_url TEXT,
  floorplan_url TEXT,
  agent_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status property_status NOT NULL DEFAULT 'draft',
  featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_properties_estate ON public.properties(estate_id);
CREATE INDEX idx_properties_status ON public.properties(status);
CREATE INDEX idx_properties_agent ON public.properties(agent_id);
CREATE INDEX idx_properties_district ON public.properties(district_slug);

CREATE TRIGGER trg_properties_updated_at
BEFORE UPDATE ON public.properties
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- INQUIRIES
-- =========================================
CREATE TABLE public.inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source inquiry_source NOT NULL DEFAULT 'website',
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  message TEXT,
  assigned_agent_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status inquiry_status NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_inquiries_updated_at
BEFORE UPDATE ON public.inquiries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- ARTICLES (blog)
-- =========================================
CREATE TABLE public.articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT,
  cover_image TEXT,
  category TEXT,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reading_minutes INT DEFAULT 5,
  published BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_articles_updated_at
BEFORE UPDATE ON public.articles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- TRANSACTIONS (recent sales / rentals)
-- =========================================
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estate_id UUID REFERENCES public.estates(id) ON DELETE CASCADE,
  unit TEXT,
  deal_type deal_type NOT NULL,
  price NUMERIC,
  saleable_area INT,
  saleable_psf NUMERIC,
  deal_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_transactions_estate ON public.transactions(estate_id);

-- =========================================
-- FAQS
-- =========================================
CREATE TABLE public.faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,            -- 'district:sham-tseng' | 'estate:belvedere-garden' | 'global'
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_faqs_scope ON public.faqs(scope);

-- =========================================
-- RLS POLICIES
-- =========================================

-- profiles: public read (agents shown on website), own update, admin all
CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can update any profile"
  ON public.profiles FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert profiles"
  ON public.profiles FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- user_roles: only admins manage; users can view own
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles"
  ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- estates: public read, admin write
CREATE POLICY "Estates are viewable by everyone"
  ON public.estates FOR SELECT USING (true);
CREATE POLICY "Admins manage estates"
  ON public.estates FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- properties: public sees only active; agents see own; admins see all
CREATE POLICY "Public can view active properties"
  ON public.properties FOR SELECT USING (status = 'active');
CREATE POLICY "Agents can view own properties"
  ON public.properties FOR SELECT USING (auth.uid() = agent_id);
CREATE POLICY "Admins can view all properties"
  ON public.properties FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Agents can insert own properties"
  ON public.properties FOR INSERT WITH CHECK (auth.uid() = agent_id);
CREATE POLICY "Agents can update own properties"
  ON public.properties FOR UPDATE USING (auth.uid() = agent_id);
CREATE POLICY "Admins can update any property"
  ON public.properties FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Agents can delete own properties"
  ON public.properties FOR DELETE USING (auth.uid() = agent_id);
CREATE POLICY "Admins can delete any property"
  ON public.properties FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- inquiries: anyone may insert; only assigned agent or admin sees
CREATE POLICY "Anyone can submit an inquiry"
  ON public.inquiries FOR INSERT WITH CHECK (true);
CREATE POLICY "Assigned agent can view inquiry"
  ON public.inquiries FOR SELECT USING (auth.uid() = assigned_agent_id);
CREATE POLICY "Admins can view all inquiries"
  ON public.inquiries FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Assigned agent can update inquiry"
  ON public.inquiries FOR UPDATE USING (auth.uid() = assigned_agent_id);
CREATE POLICY "Admins can update any inquiry"
  ON public.inquiries FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

-- articles: public read published; admin manage
CREATE POLICY "Published articles are public"
  ON public.articles FOR SELECT USING (published = true OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage articles"
  ON public.articles FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- transactions: public read, admin write
CREATE POLICY "Transactions are viewable by everyone"
  ON public.transactions FOR SELECT USING (true);
CREATE POLICY "Admins manage transactions"
  ON public.transactions FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- faqs: public read, admin write
CREATE POLICY "FAQs are viewable by everyone"
  ON public.faqs FOR SELECT USING (true);
CREATE POLICY "Admins manage faqs"
  ON public.faqs FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================
-- STORAGE BUCKET: property-images (public)
-- =========================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('property-images', 'property-images', true);

CREATE POLICY "Property images are publicly accessible"
  ON storage.objects FOR SELECT USING (bucket_id = 'property-images');
CREATE POLICY "Authenticated can upload property images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'property-images' AND auth.uid() IS NOT NULL);
CREATE POLICY "Owners can update own property images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'property-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owners can delete own property images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'property-images' AND auth.uid()::text = (storage.foldername(name))[1]);