-- Phase 2: الطلبات المنظمة والمطابقة الذكية.
-- الطلب يحفظ بياناته المنظمة في أعمدة (للتصفية والفهرسة) و criteria jsonb للشروط حسب النوع:
--   { "<field>": { "op": "min|max|in|has|is", "value": ..., "importance": "must|preferred" } } ، و«لا يهم» لا يُحفظ.
-- notes ملاحظات حرة منفصلة: لا تدخل الوصف ولا المطابقة.
ALTER TABLE requests
  ADD COLUMN purpose text CHECK (purpose IN ('buy','rent','investment')),
  ADD COLUMN kinds text[] NOT NULL DEFAULT '{}',
  ADD COLUMN city_id uuid REFERENCES cities(id),
  ADD COLUMN district_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN district_importance text CHECK (district_importance IN ('must','preferred')),
  ADD COLUMN budget_min numeric(16,2) CHECK (budget_min IS NULL OR budget_min >= 0),
  ADD COLUMN budget_max numeric(16,2) CHECK (budget_max IS NULL OR budget_max > 0),
  ADD COLUMN area_min numeric(12,2) CHECK (area_min IS NULL OR area_min > 0),
  ADD COLUMN area_max numeric(12,2) CHECK (area_max IS NULL OR area_max > 0),
  ADD COLUMN area_importance text CHECK (area_importance IN ('must','preferred')),
  ADD COLUMN rent_period text CHECK (rent_period IN ('yearly','monthly','daily')),
  ADD COLUMN criteria jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(criteria) = 'object'),
  ADD COLUMN description text,
  ADD COLUMN notes text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX requests_org_idx ON requests(org_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX requests_kinds_idx ON requests USING gin (kinds);

-- المطابقات تُحفظ لقطةً لكل طلب مقابل العقار مباشرة (offers يبقى للمراحل التالية)
ALTER TABLE matches ALTER COLUMN offer_id DROP NOT NULL;
ALTER TABLE matches ADD COLUMN property_id uuid REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE matches ADD CONSTRAINT matches_target_check CHECK (offer_id IS NOT NULL OR property_id IS NOT NULL);
CREATE UNIQUE INDEX matches_request_property_idx ON matches(request_id, property_id) WHERE property_id IS NOT NULL;
CREATE INDEX properties_market_idx ON properties(org_id, deal, district_id) WHERE deleted_at IS NULL;
