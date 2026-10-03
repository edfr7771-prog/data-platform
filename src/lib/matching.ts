/**
 * المطابقة الذكية بين طلب منظم وعروض (عقارات) منظمة. دالة نقية: تقرأ الحقول المنظمة فقط
 * (النوع، العملية، المدينة، الحي، السعر، المساحة، attributes) ولا تقرأ الملاحظات الحرة ولا الوصف النصي إطلاقًا.
 *
 * القواعد:
 * - استبعاد صريح: نوع غير مطلوب، عملية لا تناسب الغرض، مدينة أخرى، سعر فوق الميزانية القصوى،
 *   أو أي «شرط إلزامي» غير متحقق أو مجهول (العرض لا يذكر الحقل).
 * - الدرجة (0..100) = نسبة ما تحقق من: الميزانية (30) + كل «مفضّل» (10 لكل واحد). المجهول لا يُحتسب متحققًا.
 * - كل نتيجة مع أسبابها (متحقق / غير متحقق / غير مذكور في العرض)، فالدرجة قابلة للتفسير.
 */
import { FIELDS, formatValue, getKind } from './property-schema';
import { formatCriterion, PURPOSES, type Criterion, type Importance, type RequestValue } from './request-schema';

export type Offer = {
  id: string; kind: string | null; type: string; deal: string; city_id: string | null; district_id: string | null;
  price: number; area_sqm: number; attributes: Record<string, unknown>;
  /** أعمدة Phase 1 للعروض القديمة بلا attributes */
  rooms?: number | null; age_years?: number | null;
};
export type Reason = { key: string; label: string; importance: Importance | 'budget'; status: 'met' | 'unmet' | 'unknown'; detail: string };
export type MatchResult = { eligible: boolean; score: number; reasons: Reason[]; excluded_by: string | null };
export type MatchRequest = RequestValue & { city_id: string | null };

const PERIOD_YEAR: Record<string, number> = { yearly: 1, monthly: 12, daily: 365 };
const n2 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** قيمة حقل في العرض: من attributes، أو من عمود Phase 1 المقابل للعروض القديمة */
function offerValue(o: Offer, key: string): unknown {
  const v = o.attributes?.[key];
  if (v !== undefined && v !== null && v !== '') return v;
  if (key === 'bedrooms' && typeof o.rooms === 'number') return o.rooms;
  if (key === 'age_years' && typeof o.age_years === 'number') return o.age_years;
  return undefined;
}

export function evaluateCriterion(c: Criterion, v: unknown): 'met' | 'unmet' | 'unknown' {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length && c.op !== 'has')) return 'unknown';
  switch (c.op) {
    case 'min': return typeof v === 'number' && v >= (c.value as number) ? 'met' : 'unmet';
    case 'max': return typeof v === 'number' && v <= (c.value as number) ? 'met' : 'unmet';
    case 'in': return (c.value as string[]).includes(String(v)) ? 'met' : 'unmet';
    case 'has': return Array.isArray(v) && (c.value as string[]).every((x) => v.includes(x)) ? 'met' : 'unmet';
    case 'is': return v === c.value ? 'met' : 'unmet';
  }
}

export function matchOffer(req: MatchRequest, o: Offer): MatchResult {
  const reasons: Reason[] = [];
  const out = (code: string): MatchResult => ({ eligible: false, score: 0, reasons, excluded_by: code });

  // النوع: التفصيلي، أو الأساسي للعروض القديمة بلا kind
  const kindOk = o.kind ? req.kinds.includes(o.kind) : req.kinds.some((k) => getKind(k)?.base === o.type);
  if (!kindOk) return out('kind');
  const purpose = PURPOSES.find((p) => p.value === req.purpose)!;
  if (!(purpose.offerDeals as string[]).includes(o.deal)) return out('deal');
  if (req.city_id && o.city_id !== req.city_id) return out('city');

  let possible = 0, earned = 0;
  // الحي
  if (req.district_ids.length && req.district_importance) {
    const st = o.district_id && req.district_ids.includes(o.district_id) ? 'met' : 'unmet';
    reasons.push({ key: 'district', label: 'الحي', importance: req.district_importance, status: st, detail: st === 'met' ? 'ضمن الأحياء المطلوبة' : 'خارج الأحياء المطلوبة' });
    if (req.district_importance === 'must' && st !== 'met') return out('district');
    if (req.district_importance === 'preferred') { possible += 10; if (st === 'met') earned += 10; }
  }
  // الميزانية: الإيجار يُوحَّد سنويًا قبل المقارنة
  const offerPeriod = typeof o.attributes?.rent_period === 'string' ? (o.attributes.rent_period as string) : null;
  const yearly = (price: number, period: string | null) => price * (PERIOD_YEAR[period ?? 'yearly'] ?? 1);
  const isRent = req.purpose === 'rent';
  const price = isRent ? yearly(o.price, offerPeriod ?? req.rent_period) : o.price;
  const max = isRent ? yearly(req.budget_max, req.rent_period) : req.budget_max;
  const min = req.budget_min === null ? null : isRent ? yearly(req.budget_min, req.rent_period) : req.budget_min;
  const periodNote = isRent && !offerPeriod ? ' (مدة الإيجار غير مذكورة في العرض؛ اعتُبرت مثل الطلب)' : '';
  if (price > max) { reasons.push({ key: 'budget', label: 'الميزانية', importance: 'budget', status: 'unmet', detail: `السعر ${n2(o.price)} فوق الميزانية${periodNote}` }); return out('budget'); }
  possible += 30;
  if (min !== null && price < min) { earned += 15; reasons.push({ key: 'budget', label: 'الميزانية', importance: 'budget', status: 'unmet', detail: `السعر ${n2(o.price)} أقل من الحد الأدنى للميزانية${periodNote}` }); }
  else { earned += 30; reasons.push({ key: 'budget', label: 'الميزانية', importance: 'budget', status: 'met', detail: `السعر ${n2(o.price)} ضمن الميزانية${periodNote}` }); }
  // المساحة
  if (req.area_importance && (req.area_min !== null || req.area_max !== null)) {
    const st = (req.area_min === null || o.area_sqm >= req.area_min) && (req.area_max === null || o.area_sqm <= req.area_max) ? 'met' : 'unmet';
    reasons.push({ key: 'area', label: 'المساحة', importance: req.area_importance, status: st, detail: `${n2(o.area_sqm)} م²` });
    if (req.area_importance === 'must' && st !== 'met') return out('area');
    if (req.area_importance === 'preferred') { possible += 10; if (st === 'met') earned += 10; }
  }
  // الشروط المنظمة حسب النوع
  for (const [key, c] of Object.entries(req.criteria)) {
    const f = FIELDS[key]; if (!f) continue;
    const v = offerValue(o, key), st = evaluateCriterion(c, v);
    const have = st === 'unknown' ? 'غير مذكور في العرض' : `في العرض: ${formatValue(f, v as never)}`;
    reasons.push({ key, label: f.label, importance: c.importance, status: st, detail: `المطلوب ${formatCriterion(f, c)}؛ ${have}` });
    if (c.importance === 'must' && st !== 'met') return out(`criterion:${key}`);
    if (c.importance === 'preferred') { possible += 10; if (st === 'met') earned += 10; }
  }
  return { eligible: true, score: possible ? Math.round((earned / possible) * 100) : 100, reasons, excluded_by: null };
}

/** يرتب العروض المؤهلة بالدرجة ثم بالسعر الأقل، ويعدّ المستبعد حسب السبب الأول (شفافية) */
export function rankMatches(req: MatchRequest, offers: Offer[], limit = 50) {
  const excluded: Record<string, number> = {};
  const eligible: (MatchResult & { offer: Offer })[] = [];
  for (const o of offers) {
    const r = matchOffer(req, o);
    if (r.eligible) eligible.push({ ...r, offer: o });
    else { const k = r.excluded_by!.split(':')[0]; excluded[k] = (excluded[k] ?? 0) + 1; }
  }
  eligible.sort((a, b) => b.score - a.score || a.offer.price - b.offer.price || a.offer.id.localeCompare(b.offer.id));
  return { matches: eligible.slice(0, limit), total_eligible: eligible.length, excluded };
}
