/**
 * الطلبات العقارية المنظمة (Phase 2): شراء أو استئجار أو استثمار، بحقول مشتركة ثم شروط حسب النوع.
 * لكل شرط درجة أهمية: «شرط إلزامي» (يستبعد العرض المخالف أو المجهول) أو «مفضّل» (يرفع الدرجة) أو «لا يهم» (لا يُحفظ).
 * الوصف يُبنى من الحقول المنظمة وحدها بترتيب ثابت. الملاحظات الحرة منفصلة ولا تدخل الوصف ولا المطابقة.
 * دوال نقية: تُستعمل في الخادم والواجهة والاختبارات.
 */
import { normalizeArabic, parseNumber } from './arabic';
import { coerceField, empty, FIELDS, formatValue, getKind, parseKind, RENT_PERIODS, withUnit, type Deal, type FieldDef, type Issue } from './property-schema';

export type Purpose = 'buy' | 'rent' | 'investment';
export const PURPOSES: { value: Purpose; label: string; phrase: string; aliases: string[]; offerDeals: Deal[] }[] = [
  { value: 'buy', label: 'شراء', phrase: 'للشراء', aliases: ['buy', 'purchase', 'تملك'], offerDeals: ['sale'] },
  { value: 'rent', label: 'استئجار', phrase: 'للإيجار', aliases: ['rent', 'ايجار', 'إيجار'], offerDeals: ['rent'] },
  // المستثمر يطابق العروض الاستثمارية وعروض البيع معًا
  { value: 'investment', label: 'استثمار', phrase: 'للاستثمار', aliases: ['investment', 'استثماري'], offerDeals: ['investment', 'sale'] },
];
export const parsePurpose = (s: unknown): Purpose | null => {
  const n = normalizeArabic(String(s ?? ''));
  return n ? PURPOSES.find((p) => p.value === n || [p.label, p.phrase, ...p.aliases].some((x) => normalizeArabic(x) === n))?.value ?? null : null;
};

export type Importance = 'must' | 'preferred';
export const IMPORTANCE = [
  { value: 'must', label: 'شرط إلزامي' },
  { value: 'preferred', label: 'مفضّل' },
  { value: 'any', label: 'لا يهم' },
] as const;
/** يعيد الأهمية، أو null لـ«لا يهم» أو الفراغ، أو undefined لقيمة غير معروفة */
export function parseImportance(s: unknown): Importance | null | undefined {
  const n = normalizeArabic(String(s ?? ''));
  if (!n || n === 'any' || n === normalizeArabic('لا يهم')) return null;
  if (n === 'must' || n === normalizeArabic('شرط إلزامي') || n === normalizeArabic('إلزامي')) return 'must';
  if (n === 'preferred' || n === normalizeArabic('مفضّل') || n === normalizeArabic('مفضل')) return 'preferred';
  return undefined;
}

/** كيف يُطابَق الحقل في الطلب: حد أدنى، حد أقصى، أحد القيم، يحوي كل القيم، أو نعم/لا */
export type CritOp = 'min' | 'max' | 'in' | 'has' | 'is';
const MAX_FIELDS = new Set(['age_years']);
/** حقول وصفية لا معنى لها شرطًا في طلب (أبعاد دقيقة، رقم دور، أرقام نظامية) */
const NOT_MATCHABLE = new Set(['floor_number', 'length_m', 'width_m', 'street_widths']);
export function criterionOp(f: FieldDef): CritOp | null {
  if (NOT_MATCHABLE.has(f.key)) return null;
  if (f.kind === 'int' || f.kind === 'decimal') return MAX_FIELDS.has(f.key) ? 'max' : 'min';
  if (f.kind === 'enum') return 'in';
  if (f.kind === 'multi') return 'has';
  if (f.kind === 'bool') return 'is';
  return null;
}
/** الحقول القابلة للشرط لأنواع مختارة، بترتيب أول نوع ثم البقية، بلا تكرار */
export function criteriaFieldsFor(kinds: string[]): (FieldDef & { op: CritOp })[] {
  const seen = new Set<string>(), out: (FieldDef & { op: CritOp })[] = [];
  for (const k of kinds) for (const kf of getKind(k)?.fields ?? []) {
    const f = FIELDS[kf.key], op = criterionOp(f);
    if (op && !seen.has(f.key)) { seen.add(f.key); out.push({ ...f, op }); }
  }
  return out;
}

export type Criterion = { op: CritOp; value: number | string[] | boolean; importance: Importance };
export type RequestValue = {
  purpose: Purpose; kinds: string[]; district_ids: string[]; district_importance: Importance | null;
  budget_min: number | null; budget_max: number; area_min: number | null; area_max: number | null; area_importance: Importance | null;
  rent_period: string | null; criteria: Record<string, Criterion>;
};

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : empty(v) ? [] : String(v).split(/[،,]/).map((x) => x.trim()).filter(Boolean));
const MAX_KINDS = 6, MAX_DISTRICTS = 30;

export function validateRequest(input: Record<string, unknown>): { value: RequestValue | null; errors: Issue[]; ignored: string[] } {
  const errors: Issue[] = [], ignored: string[] = [];
  const err = (field: string, code: string, message: string) => errors.push({ field, code, message });

  const purpose = parsePurpose(input.purpose);
  if (!purpose) err('purpose', 'purpose_invalid', 'اختر الغرض (شراء أو استئجار أو استثمار)');

  const kinds: string[] = [];
  for (const k of list(input.kinds ?? input.kind)) {
    const def = parseKind(k);
    if (!def) { err('kinds', 'kind_invalid', `نوع العقار «${String(k)}» غير معروف`); continue; }
    if (!kinds.includes(def.key)) kinds.push(def.key);
  }
  if (!kinds.length && !errors.some((e) => e.field === 'kinds')) err('kinds', 'kinds_required', 'اختر نوع عقار واحدًا على الأقل');
  if (kinds.length > MAX_KINDS) err('kinds', 'kinds_too_many', `الحد الأقصى ${MAX_KINDS} أنواع في الطلب الواحد`);

  const district_ids = [...new Set(list(input.district_ids).map(String))];
  if (district_ids.length > MAX_DISTRICTS) err('district_ids', 'districts_too_many', `الحد الأقصى ${MAX_DISTRICTS} حيًا`);
  let district_importance: Importance | null = null;
  if (district_ids.length) {
    const imp = parseImportance(input.district_importance ?? 'must');
    if (imp === undefined) err('district_importance', 'importance_invalid', 'أهمية الحي غير معروفة');
    else district_importance = imp;
  }

  const money = (k: string) => (empty(input[k]) ? null : parseNumber(input[k]));
  const budget_max = money('budget_max'), budget_min = money('budget_min');
  if (budget_max === null || !(budget_max > 0) || budget_max > 1e11) err('budget_max', 'budget_invalid', 'الميزانية القصوى مطلوبة وتكون رقمًا موجبًا بالريال');
  if (!empty(input.budget_min) && (budget_min === null || budget_min < 0)) err('budget_min', 'budget_invalid', 'الحد الأدنى للميزانية غير صحيح');
  if (budget_min !== null && budget_max !== null && budget_min > budget_max) err('budget_min', 'budget_range', 'الحد الأدنى للميزانية أكبر من الحد الأقصى');

  const area_min = money('area_min'), area_max = money('area_max');
  if (!empty(input.area_min) && (area_min === null || area_min <= 0)) err('area_min', 'area_invalid', 'الحد الأدنى للمساحة غير صحيح');
  if (!empty(input.area_max) && (area_max === null || area_max <= 0)) err('area_max', 'area_invalid', 'الحد الأقصى للمساحة غير صحيح');
  if (area_min !== null && area_max !== null && area_min > area_max) err('area_min', 'area_range', 'الحد الأدنى للمساحة أكبر من الحد الأقصى');
  let area_importance: Importance | null = null;
  if (area_min !== null || area_max !== null) {
    const imp = parseImportance(input.area_importance ?? 'preferred');
    if (imp === undefined) err('area_importance', 'importance_invalid', 'أهمية المساحة غير معروفة'); else area_importance = imp;
  }

  let rent_period: string | null = null;
  if (purpose === 'rent') {
    const n = normalizeArabic(String(input.rent_period ?? ''));
    const o = RENT_PERIODS.find((x) => x.value === n || normalizeArabic(x.label) === n);
    if (!o) err('rent_period', 'rent_period_required', 'مدة الإيجار مطلوبة في طلب الاستئجار'); else rent_period = o.value;
  }

  const criteria: Record<string, Criterion> = {};
  const raw = input.criteria && typeof input.criteria === 'object' && !Array.isArray(input.criteria) ? (input.criteria as Record<string, unknown>) : {};
  const allowed = new Map(criteriaFieldsFor(kinds).map((f) => [f.key, f]));
  for (const [key, c] of Object.entries(raw)) {
    const entry = c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : { value: c };
    const imp = parseImportance(entry.importance ?? 'preferred');
    if (imp === null || empty(entry.value)) continue; // «لا يهم» أو بلا قيمة: لا يُحفظ
    const f = allowed.get(key);
    if (!f) { ignored.push(key); continue; }
    if (imp === undefined) { err(key, 'importance_invalid', `${f.label}: الأهمية غير معروفة`); continue; }
    let value: Criterion['value'] | undefined, e: string | undefined;
    if (f.op === 'min' || f.op === 'max' || f.op === 'is') { const r = coerceField(f, entry.value); value = r.value as Criterion['value']; e = r.error; }
    else if (f.op === 'in') {
      const vals: string[] = [];
      for (const item of list(entry.value)) { const r = coerceField(f, item); if (r.error) { e = r.error; break; } if (typeof r.value === 'string' && !vals.includes(r.value)) vals.push(r.value); }
      value = vals.length ? f.options!.map((o) => o.value).filter((v) => vals.includes(v)) : undefined;
    } else { const r = coerceField(f, list(entry.value)); value = r.value as string[] | undefined; e = r.error; }
    if (e) err(key, 'criterion_invalid', e);
    else if (value !== undefined) criteria[key] = { op: f.op, value, importance: imp };
  }

  if (errors.length || !purpose || budget_max === null) return { value: null, errors, ignored };
  return { value: { purpose, kinds, district_ids, district_importance, budget_min, budget_max, area_min, area_max, area_importance, rent_period, criteria }, errors, ignored };
}

const n2 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const IMP_AR: Record<Importance, string> = { must: 'شرط إلزامي', preferred: 'مفضّل' };

/** صيغة الشرط في الوصف: «4 على الأقل»، «10 سنوات كحد أقصى»، «مركزي أو سبليت»، «يوجد» */
export function formatCriterion(f: FieldDef, c: Criterion): string {
  if (c.op === 'min') return `${withUnit(c.value as number, f.unit)} على الأقل`;
  if (c.op === 'max') return `${withUnit(c.value as number, f.unit)} كحد أقصى`;
  if (c.op === 'is') return (c.value as boolean) ? 'يوجد' : 'لا يوجد';
  if (c.op === 'in') return (c.value as string[]).map((v) => f.options!.find((o) => o.value === v)?.label ?? v).join(' أو ');
  return formatValue(f, c.value as string[]);
}

export type RequestDescription = { title: string; sections: { key: string; heading: string; lines: string[] }[]; text: string };
/**
 * وصف الطلب من البيانات المنظمة وحدها: عنوان، ثم الموقع، ثم الميزانية والمساحة، ثم الشروط الإلزامية، ثم المفضّلات.
 * لا يظهر قسم فارغ، ولا شرط لم يُحدَّد، ولا رقم لم يُدخل. الملاحظات الحرة لا تدخل هنا.
 */
export function describeRequest(v: RequestValue, place: { city?: string | null; districts?: string[] } = {}): RequestDescription {
  const p = PURPOSES.find((x) => x.value === v.purpose)!;
  const kindsLabel = v.kinds.map((k) => getKind(k)?.label ?? k).join(' أو ');
  const ds = place.districts ?? [];
  const where = ds.length ? `في ${ds.map((d) => `حي ${d}`).join(' أو ')}${place.city ? `، ${place.city}` : ''}` : place.city ? `في ${place.city}` : '';
  const title = `مطلوب ${kindsLabel} ${p.phrase}${where ? ` ${where}` : ''}`;
  const sections: RequestDescription['sections'] = [];
  const loc: string[] = [];
  if (place.city) loc.push(`المدينة: ${place.city}`);
  if (ds.length) loc.push(`الأحياء: ${ds.join('، ')}${v.district_importance ? ` (${IMP_AR[v.district_importance]})` : ''}`);
  if (loc.length) sections.push({ key: 'location', heading: 'الموقع', lines: loc });
  const period = v.rent_period ? ` ${RENT_PERIODS.find((o) => o.value === v.rent_period)?.label ?? ''}` : '';
  const budget = [`الميزانية: ${v.budget_min !== null ? `من ${n2(v.budget_min)} إلى ${n2(v.budget_max)}` : `حتى ${n2(v.budget_max)}`} ريال${period}`];
  if (v.area_min !== null || v.area_max !== null) {
    const a = v.area_min !== null && v.area_max !== null ? `من ${n2(v.area_min)} إلى ${n2(v.area_max)} م²` : v.area_min !== null ? `${n2(v.area_min)} م² على الأقل` : `حتى ${n2(v.area_max!)} م²`;
    budget.push(`المساحة: ${a}${v.area_importance ? ` (${IMP_AR[v.area_importance]})` : ''}`);
  }
  sections.push({ key: 'budget', heading: 'الميزانية والمساحة', lines: budget });
  const order = criteriaFieldsFor(v.kinds).map((f) => f.key);
  for (const imp of ['must', 'preferred'] as const) {
    const lines = order.filter((k) => v.criteria[k]?.importance === imp).map((k) => `${FIELDS[k].label}: ${formatCriterion(FIELDS[k], v.criteria[k])}`);
    if (lines.length) sections.push({ key: imp, heading: imp === 'must' ? 'الشروط الإلزامية' : 'المفضّلات', lines });
  }
  const text = [title, ...sections.map((s) => `${s.heading}\n${s.lines.map((l) => `• ${l}`).join('\n')}`)].join('\n\n');
  return { title, sections, text };
}

/** تنظيف مسودة/نموذج الطلب في الواجهة: الحمولة تحمل شروط الأنواع المختارة فقط، و«لا يهم» لا يُرسل */
export function requestPayload(form: Record<string, unknown>): Record<string, unknown> {
  const kinds = list(form.kinds).map(String);
  const allowed = new Set(criteriaFieldsFor(kinds).map((f) => f.key));
  const crit = form.criteria && typeof form.criteria === 'object' ? (form.criteria as Record<string, { value?: unknown; importance?: unknown }>) : {};
  const criteria = Object.fromEntries(Object.entries(crit).filter(([k, c]) => allowed.has(k) && c && !empty(c.value) && parseImportance(c.importance) !== null));
  const out: Record<string, unknown> = { ...form, kinds, criteria };
  if (parsePurpose(form.purpose) !== 'rent') delete out.rent_period;
  for (const k of Object.keys(out)) if (k !== 'criteria' && k !== 'kinds' && k !== 'district_ids' && empty(out[k])) delete out[k];
  return out;
}
