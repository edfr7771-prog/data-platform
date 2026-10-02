-- TAMALAAN DATA: المخطط الكامل (Phase 1). كل الجداول المطلوبة في المواصفة موجودة؛
-- الجداول التي تستعملها المرحلة الأولى فعليًا: users, sessions, otp_challenges, roles, organizations,
-- organization_members, cities, districts, data_sources, properties, property_prices, imports, import_rows, audit_logs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text, email text UNIQUE, phone text UNIQUE,
  email_verified_at timestamptz, phone_verified_at timestamptz, phone_pending text,
  platform_role text CHECK (platform_role IN ('super_admin')),
  locale text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
  consent_version text, consent_at timestamptz, marketing_consent_at timestamptz,
  is_active boolean NOT NULL DEFAULT true, last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL, channel text NOT NULL CHECK (channel IN ('email','sms')),
  code_hash text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
  attempts int NOT NULL DEFAULT 0, ip_hash text, purpose text NOT NULL DEFAULT 'login' CHECK (purpose IN ('login','register','attach')),
  payload jsonb, user_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_identifier_idx ON otp_challenges(identifier, created_at);
CREATE INDEX otp_ip_idx ON otp_challenges(ip_hash, created_at) WHERE ip_hash IS NOT NULL;

CREATE TABLE roles (code text PRIMARY KEY, name_ar text NOT NULL, name_en text NOT NULL, rank int NOT NULL);
INSERT INTO roles (code, name_ar, name_en, rank) VALUES
  ('super_admin','مدير المنصة','Super Admin',100), ('org_admin','مدير المؤسسة','Organization Admin',80),
  ('data_analyst','محلل بيانات','Data Analyst',60), ('broker','وسيط','Broker',50), ('employee','موظف','Employee',40),
  ('investor','مستثمر/مستخدم','Investor/User',30), ('student','طالب','Student',20), ('viewer','مطّلع','Viewer',10);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, plan text NOT NULL DEFAULT 'free',
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE organization_members (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL REFERENCES roles(code) CHECK (role <> 'super_admin'),
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, PRIMARY KEY (org_id, user_id)
);
-- في المرحلة الأولى لكل مستخدم مؤسسة نشطة واحدة
CREATE UNIQUE INDEX org_members_one_active_idx ON organization_members(user_id) WHERE deleted_at IS NULL;

CREATE TABLE cities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name_ar text NOT NULL, name_en text NOT NULL, region text);
CREATE TABLE districts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), city_id uuid NOT NULL REFERENCES cities(id), slug text NOT NULL,
  name_ar text NOT NULL, name_en text, UNIQUE (city_id, slug)
);
INSERT INTO cities (slug, name_ar, name_en, region) VALUES ('jeddah','جدة','Jeddah','مكة المكرمة');
-- أحياء مرجعية أولية (أسماء فقط، بلا أي أرقام سوق)
INSERT INTO districts (city_id, slug, name_ar, name_en)
  SELECT c.id, v.slug, v.ar, v.en FROM cities c, (VALUES
    ('al-furusiyyah','الفروسية','Al Furusiyyah'), ('al-riyadh','الرياض','Al Riyadh'), ('al-rahmaniyyah','الرحمانية','Al Rahmaniyyah'),
    ('al-nuzhah','النزهة','Al Nuzhah'), ('al-safa','الصفا','Al Safa')) AS v(slug, ar, en) WHERE c.slug = 'jeddah';

CREATE TABLE data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('OFFICIAL','USER_UPLOADED','PLATFORM','PARTNER','DERIVED','DEMO')),
  name text NOT NULL, notes text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  filename text NOT NULL, status text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','approved','failed')),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb, summary jsonb NOT NULL DEFAULT '{}'::jsonb, source_id uuid REFERENCES data_sources(id),
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz
);
CREATE TABLE import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_id uuid NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_number int NOT NULL, raw jsonb NOT NULL, normalized jsonb, status text NOT NULL CHECK (status IN ('ok','fixed','review','duplicate','invalid','imported','skipped')),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb, property_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_rows_import_idx ON import_rows(import_id, row_number);

CREATE TABLE properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_ref text,
  type text NOT NULL CHECK (type IN ('villa','apartment','land','building','commercial','floor','office','shop','warehouse','farm','other')),
  city_id uuid REFERENCES cities(id), district_id uuid REFERENCES districts(id), location text, lat numeric(9,6), lng numeric(9,6),
  deal text NOT NULL CHECK (deal IN ('sale','rent')), usage text NOT NULL DEFAULT 'residential' CHECK (usage IN ('residential','commercial')),
  area_sqm numeric(12,2) NOT NULL CHECK (area_sqm > 0), price numeric(16,2) NOT NULL CHECK (price >= 0),
  price_per_sqm numeric(14,2) GENERATED ALWAYS AS (CASE WHEN area_sqm > 0 THEN round(price / area_sqm, 2) END) STORED,
  age_years int CHECK (age_years >= 0), rooms int CHECK (rooms >= 0), street_width_m numeric(6,2) CHECK (street_width_m >= 0), facades int CHECK (facades BETWEEN 0 AND 4),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','rented','withdrawn')),
  source_id uuid REFERENCES data_sources(id), import_id uuid REFERENCES imports(id), dedupe_key text, notes text,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX properties_org_idx ON properties(org_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX properties_district_idx ON properties(org_id, district_id) WHERE deleted_at IS NULL;
CREATE INDEX properties_dedupe_idx ON properties(org_id, dedupe_key) WHERE deleted_at IS NULL;
CREATE TABLE property_features (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE, key text NOT NULL, value text, UNIQUE (property_id, key));
CREATE TABLE property_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  price numeric(16,2) NOT NULL, area_sqm numeric(12,2) NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), source_id uuid REFERENCES data_sources(id), import_id uuid REFERENCES imports(id)
);
CREATE INDEX property_prices_idx ON property_prices(property_id, recorded_at DESC);

-- جداول المراحل التالية (المخطط جاهز، ولا تُستعمل وظيفيًا في Phase 1)
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name text NOT NULL, phone text, email text,
  type text CHECK (type IN ('buyer','seller','owner','tenant','investor','developer','broker')), city_id uuid REFERENCES cities(id), budget_min numeric(16,2), budget_max numeric(16,2), interests jsonb, source text, notes text,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz);
CREATE TABLE customer_interactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE, kind text NOT NULL, note text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, customer_id uuid REFERENCES customers(id), raw_text text, parsed jsonb, status text NOT NULL DEFAULT 'open', created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz);
CREATE TABLE offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE, owner_customer_id uuid REFERENCES customers(id), status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz);
CREATE TABLE matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE, offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE, score numeric(5,2) NOT NULL, explanation jsonb NOT NULL DEFAULT '[]'::jsonb, weights jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, kind text NOT NULL, params jsonb, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE analytics_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid REFERENCES organizations(id) ON DELETE CASCADE, kind text NOT NULL, params jsonb, data jsonb NOT NULL, source_id uuid REFERENCES data_sources(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE market_indicators (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope text NOT NULL, scope_ref text, key text NOT NULL, period text NOT NULL, value numeric, sample_size int, source_id uuid REFERENCES data_sources(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ai_conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ai_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE, role text NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL, meta jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind text NOT NULL, body text, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','individual','professional','business','enterprise')), status text NOT NULL DEFAULT 'active', limits jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid REFERENCES organizations(id) ON DELETE SET NULL, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL, entity text, entity_id text, meta jsonb, ip_hash text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_idx ON audit_logs(org_id, created_at DESC);
