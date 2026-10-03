-- Phase 2: الإدخال العقاري المنظم والوصف التلقائي.
-- kind: مفتاح النوع التفصيلي من سجل الأنواع في src/lib/property-schema.ts (يُتحقق منه في التطبيق لأن السجل قابل للتوسعة).
--       type يبقى النوع الأساسي للتوافق مع الاستيراد والتصفية والتصدير.
-- attributes: الحقول الخاصة بالنوع بقيم موحدة (أرقام وقيم قوائم)، منفصلة عن النص لتستعملها المطابقة والبحث والخريطة والمؤشرات.
-- description: الوصف المولَّد من الحقول المنظمة وحدها (يُعاد توليده عند كل تعديل). notes تبقى «ملاحظات إضافية» نصًا حرًا منفصلًا.
ALTER TABLE properties DROP CONSTRAINT properties_deal_check;
ALTER TABLE properties ADD CONSTRAINT properties_deal_check CHECK (deal IN ('sale','rent','investment'));
ALTER TABLE properties
  ADD COLUMN kind text CHECK (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  ADD COLUMN description text;
CREATE INDEX properties_kind_idx ON properties(org_id, kind) WHERE deleted_at IS NULL;
CREATE INDEX properties_attributes_idx ON properties USING gin (attributes jsonb_path_ops);

-- المسودات: لكل مستخدم داخل مؤسسته، وقد تكون ناقصة (لا تحقق إلزامي قبل النشر)
CREATE TABLE property_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX property_drafts_owner_idx ON property_drafts(org_id, created_by, updated_at DESC);
