-- Phase 3: CRM وذكاء العملاء والأتمتة.
-- المبدأ: توسيع جداول Phase 1 الموجودة بدل ازدواجها:
--   customers = ملف العميل الموحد، customer_interactions = الخط الزمني، notifications = التنبيهات،
--   requests.customer_id (موجود) = ربط الطلب بالعميل، matches = المطابقات مع حالة متابعتها.

-- 1) ملف العميل: معرّفات موحدة لمنع التكرار، والمسؤول، والحالة، والمتابعة
ALTER TABLE customers
  ADD COLUMN phone_norm text CHECK (phone_norm IS NULL OR phone_norm ~ '^\+[0-9]{8,15}$'),
  ADD COLUMN email_norm text CHECK (email_norm IS NULL OR email_norm = lower(email_norm)),
  ADD COLUMN owner_id uuid REFERENCES users(id),
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','do_not_contact')),
  ADD COLUMN district_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN last_contact_at timestamptz,
  ADD COLUMN next_follow_up_at timestamptz,
  ADD COLUMN merged_into uuid REFERENCES customers(id);
-- منع التكرار على مستوى القاعدة: جوال واحد وبريد واحد لكل عميل نشط داخل المنشأة (يحمي من السباقات المتزامنة)
CREATE UNIQUE INDEX customers_org_phone_uq ON customers(org_id, phone_norm) WHERE deleted_at IS NULL AND phone_norm IS NOT NULL;
CREATE UNIQUE INDEX customers_org_email_uq ON customers(org_id, email_norm) WHERE deleted_at IS NULL AND email_norm IS NOT NULL;
CREATE INDEX customers_org_idx ON customers(org_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX customers_followup_idx ON customers(org_id, next_follow_up_at) WHERE deleted_at IS NULL AND next_follow_up_at IS NOT NULL;

-- مصدر كل معرّف وقناة وصوله (لا يضيع أصل المعلومة عند وصول العميل من أكثر من قناة)
CREATE TABLE customer_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('manual','web','whatsapp','email','call','import')),
  identifier text, first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_sources_uq ON customer_sources(customer_id, channel, coalesce(identifier, ''));

-- 2) الخط الزمني: كل حدث مع العميل صف واحد مرتب بوقت وقوعه
ALTER TABLE customer_interactions
  ADD COLUMN occurred_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN channel text,
  ADD COLUMN direction text CHECK (direction IN ('in','out')),
  ADD COLUMN request_id uuid REFERENCES requests(id) ON DELETE SET NULL,
  ADD COLUMN property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  ADD COLUMN meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object');
CREATE INDEX customer_interactions_tl_idx ON customer_interactions(org_id, customer_id, occurred_at DESC);
CREATE INDEX requests_customer_idx ON requests(org_id, customer_id) WHERE deleted_at IS NULL AND customer_id IS NOT NULL;

-- 3) الـPipeline: مراحل لكل منشأة قابلة للتعديل، وفرص، وتاريخ الانتقال
CREATE TABLE crm_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'), label text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  position int NOT NULL, kind text NOT NULL DEFAULT 'open' CHECK (kind IN ('open','won','lost')),
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_id, key)
);
CREATE TABLE opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  request_id uuid REFERENCES requests(id) ON DELETE SET NULL,
  title text NOT NULL, stage_id uuid NOT NULL REFERENCES crm_stages(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  value numeric(16,2) CHECK (value IS NULL OR value >= 0),
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz
);
CREATE INDEX opportunities_org_idx ON opportunities(org_id, status, stage_id);
CREATE INDEX opportunities_customer_idx ON opportunities(org_id, customer_id);
CREATE TABLE opportunity_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES crm_stages(id), to_stage_id uuid NOT NULL REFERENCES crm_stages(id),
  changed_by uuid REFERENCES users(id), changed_at timestamptz NOT NULL DEFAULT now(), note text
);
CREATE INDEX opp_history_idx ON opportunity_stage_history(opportunity_id, changed_at);

-- 4) المهام والمتابعات
CREATE TABLE crm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  request_id uuid REFERENCES requests(id) ON DELETE SET NULL,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  assignee_id uuid REFERENCES users(id),
  due_at timestamptz, priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  notes text, completed_at timestamptz,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_tasks_org_idx ON crm_tasks(org_id, status, due_at);
CREATE INDEX crm_tasks_customer_idx ON crm_tasks(org_id, customer_id);

-- 5) متابعة المطابقة داخل الـCRM (الخوارزمية نفسها من Phase 2؛ هنا حالة المتابعة فقط)
ALTER TABLE matches
  ADD COLUMN status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','sent','interested','not_interested','viewing','negotiation','closed','rejected')),
  ADD COLUMN status_updated_at timestamptz, ADD COLUMN status_by uuid REFERENCES users(id),
  ADD COLUMN eligible boolean NOT NULL DEFAULT true,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- 6) التنبيهات الداخلية: لكل مستخدم في منشأته، مع مفتاح منع التكرار لنفس الحدث
ALTER TABLE notifications
  ADD COLUMN org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN title text, ADD COLUMN entity text, ADD COLUMN entity_id uuid, ADD COLUMN link text, ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX notifications_dedupe_uq ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_user_idx ON notifications(user_id, org_id, created_at DESC);

-- 7) الرسائل والقنوات
CREATE TABLE crm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','web')),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  external_id text NOT NULL, sender text, subject text, body text,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, channel, external_id)
);
CREATE INDEX crm_messages_customer_idx ON crm_messages(org_id, customer_id, sent_at DESC);
-- حساب القناة لكل منشأة (ليس سرًا): رقم واتساب الرسمي (phone_number_id)، أو عنوان البريد الوارد، أو مفتاح نموذج الويب
CREATE TABLE channel_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','web')),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 3 AND 200),
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id), UNIQUE (org_id, channel)
);
-- سجل أحداث القنوات: منع المعالجة المكررة (idempotency) وتشخيص الحالة الصادقة للقناة
CREATE TABLE channel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','web')),
  external_id text, status text NOT NULL CHECK (status IN ('processed','rejected','ignored')), reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX channel_events_uq ON channel_events(channel, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX channel_events_org_idx ON channel_events(org_id, channel, created_at DESC);
-- حالة التحقق العام من webhook القناة (مصافحة Meta مثلًا)، بلا أسرار
CREATE TABLE channel_state (
  channel text PRIMARY KEY CHECK (channel IN ('whatsapp','email')),
  verified_at timestamptz, last_signature_failure_at timestamptz
);

-- 8) استيراد العملاء من CSV (معاينة ثم موافقة؛ منفصل عن استيراد العقارات)
CREATE TABLE crm_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  filename text NOT NULL, status text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','approved')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb, created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz
);
CREATE TABLE crm_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES crm_imports(id) ON DELETE CASCADE,
  row_number int NOT NULL, raw jsonb NOT NULL, normalized jsonb,
  status text NOT NULL CHECK (status IN ('new','update','duplicate','invalid','imported','updated','skipped')),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb, customer_id uuid
);
CREATE INDEX crm_import_rows_idx ON crm_import_rows(import_id, row_number);
