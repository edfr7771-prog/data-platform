/**
 * الإدخال العقاري المنظم (Phase 2): سجل أنواع العقار وحقولها، والتحقق، وتوليد الوصف.
 * دوال نقية بلا اعتماد على قاعدة البيانات أو Next، فتُستعمل في الخلفية والواجهة والاختبارات معًا.
 *
 * المبدأ: البيانات الأساسية تُدخل في حقول منظمة لا في نص حر. الوصف يُبنى منها فقط، بترتيب ثابت،
 * ولا يذكر حقلًا لم يُدخل، ولا يضيف معلومة من عنده. «ملاحظات إضافية» نص حر منفصل لا يدخل الوصف.
 *
 * إضافة نوع عقار جديد: سطر في KINDS (أو registerPropertyKind) يذكر الحقول بمفاتيحها من FIELDS.
 * إضافة حقل جديد: سطر في FIELDS. لا يلزم تعديل النموذج ولا القاعدة (الحقول الخاصة تُحفظ في attributes).
 */
import { normalizeArabic, parseNumber } from './arabic';
import type { PType } from './property-rules';

export type Deal = 'sale' | 'rent' | 'investment';
export const DEALS: { value: Deal; label: string; phrase: string; aliases: string[] }[] = [
  { value: 'sale', label: 'بيع', phrase: 'للبيع', aliases: ['sale', 'تمليك'] },
  { value: 'rent', label: 'إيجار', phrase: 'للإيجار', aliases: ['rent', 'تاجير'] },
  { value: 'investment', label: 'عرض استثماري', phrase: 'للاستثمار', aliases: ['investment', 'استثمار', 'استثماري'] },
];
export type Issue = { code: string; field?: string; message: string };

export type FieldKind = 'int' | 'decimal' | 'enum' | 'multi' | 'bool' | 'text' | 'number_list';
/** مجموعات الوصف بترتيب ظهورها */
export const GROUPS = [
  { key: 'location', heading: 'الموقع' },
  { key: 'price', heading: 'المساحة والسعر' },
  { key: 'specs', heading: 'المواصفات' },
  { key: 'amenities', heading: 'المرافق والخدمات' },
  { key: 'operations', heading: 'البيانات التشغيلية' },
  { key: 'legal', heading: 'البيانات النظامية' },
] as const;
export type GroupKey = (typeof GROUPS)[number]['key'];
export type Option = { value: string; label: string };
export type FieldDef = {
  key: string; label: string; kind: FieldKind; group: GroupKey;
  unit?: string; min?: number; max?: number; maxLength?: number; maxItems?: number; options?: Option[]; hint?: string;
};
/** حقل داخل نوع: required = مطلوب دائمًا، أو مطلوب لعمليات محددة فقط */
export type KindField = { key: string; required?: true | Deal[] };
export type Category = 'residential' | 'commercial' | 'hospitality' | 'industrial' | 'land' | 'agricultural' | 'other';
export type KindDef = { key: string; label: string; category: Category; base: PType; usage: 'residential' | 'commercial'; fields: KindField[] };

const opts = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));
const DIRECTIONS = opts([['north', 'شمال'], ['south', 'جنوب'], ['east', 'شرق'], ['west', 'غرب']]);
const OPERATING = opts([['operating', 'قائم ومشغَّل'], ['not_operating', 'قائم غير مشغَّل'], ['under_construction', 'تحت الإنشاء']]);

/** مكتبة الحقول الخاصة. ترتيبها هنا لا يهم؛ الترتيب يأتي من قائمة حقول كل نوع. */
export const FIELDS: Record<string, FieldDef> = Object.fromEntries(([
  // مواصفات سكنية
  { key: 'bedrooms', label: 'غرف النوم', kind: 'int', group: 'specs', min: 0, max: 100 },
  { key: 'living_rooms', label: 'الصالات', kind: 'int', group: 'specs', min: 0, max: 50 },
  { key: 'majlis_count', label: 'المجالس', kind: 'int', group: 'specs', min: 0, max: 50 },
  { key: 'bathrooms', label: 'دورات المياه', kind: 'int', group: 'specs', min: 0, max: 100 },
  { key: 'kitchen', label: 'مطبخ', kind: 'bool', group: 'specs' },
  { key: 'floor_number', label: 'رقم الدور', kind: 'int', group: 'specs', min: -3, max: 200, hint: 'الأرضي 0، والقبو بالسالب' },
  { key: 'floors_count', label: 'عدد الأدوار', kind: 'int', group: 'specs', min: 1, max: 200 },
  { key: 'entrances', label: 'المداخل', kind: 'int', group: 'specs', min: 1, max: 20 },
  { key: 'age_years', label: 'عمر العقار', kind: 'int', group: 'specs', unit: 'سنة', min: 0, max: 200, hint: 'صفر للجديد' },
  { key: 'furnished', label: 'التأثيث', kind: 'enum', group: 'specs', options: opts([['furnished', 'مفروش'], ['semi', 'مفروش جزئيًا'], ['unfurnished', 'غير مفروش']]) },
  { key: 'facades', label: 'عدد الواجهات', kind: 'int', group: 'specs', min: 1, max: 4 },
  { key: 'facade_directions', label: 'اتجاه الواجهة', kind: 'multi', group: 'specs', options: DIRECTIONS },
  // أرض
  { key: 'land_use', label: 'الاستخدام', kind: 'enum', group: 'specs', options: opts([['residential', 'سكني'], ['commercial', 'تجاري'], ['mixed', 'سكني تجاري'], ['agricultural', 'زراعي'], ['industrial', 'صناعي'], ['investment', 'استثماري']]) },
  { key: 'streets_count', label: 'عدد الشوارع', kind: 'int', group: 'specs', min: 1, max: 4 },
  { key: 'street_widths', label: 'عروض الشوارع', kind: 'number_list', group: 'specs', unit: 'م', min: 1, max: 200, maxItems: 4, hint: 'عرض لكل شارع، مثل: 20، 15' },
  { key: 'length_m', label: 'الطول', kind: 'decimal', group: 'specs', unit: 'م', min: 1, max: 100_000 },
  { key: 'width_m', label: 'العرض', kind: 'decimal', group: 'specs', unit: 'م', min: 1, max: 100_000 },
  { key: 'main_road', label: 'على طريق رئيسي', kind: 'bool', group: 'specs' },
  // مبانٍ ووحدات
  { key: 'buildings_count', label: 'عدد المباني', kind: 'int', group: 'specs', min: 1, max: 10_000 },
  { key: 'units_count', label: 'عدد الوحدات', kind: 'int', group: 'specs', min: 0, max: 100_000 },
  { key: 'shops_count', label: 'عدد المحلات', kind: 'int', group: 'specs', min: 0, max: 10_000 },
  { key: 'offices_count', label: 'عدد المكاتب', kind: 'int', group: 'specs', min: 0, max: 10_000 },
  { key: 'rooms_count', label: 'عدد الغرف', kind: 'int', group: 'specs', min: 1, max: 100_000 },
  { key: 'suites_count', label: 'عدد الأجنحة', kind: 'int', group: 'specs', min: 0, max: 100_000 },
  { key: 'hotel_rating', label: 'التصنيف', kind: 'enum', group: 'specs', options: opts([['1', 'نجمة واحدة'], ['2', 'نجمتان'], ['3', 'ثلاث نجوم'], ['4', 'أربع نجوم'], ['5', 'خمس نجوم'], ['unrated', 'غير مصنَّف']]) },
  { key: 'frontage_m', label: 'عرض الواجهة', kind: 'decimal', group: 'specs', unit: 'م', min: 1, max: 1000 },
  { key: 'mezzanine', label: 'ميزانين', kind: 'bool', group: 'specs' },
  { key: 'covered_area_sqm', label: 'المساحة المغطاة', kind: 'decimal', group: 'specs', unit: 'م²', min: 1, max: 10_000_000 },
  { key: 'ceiling_height_m', label: 'ارتفاع السقف', kind: 'decimal', group: 'specs', unit: 'م', min: 2, max: 60 },
  { key: 'loading_docks', label: 'رصيف التحميل', kind: 'int', group: 'specs', min: 0, max: 500 },
  { key: 'power_kva', label: 'القدرة الكهربائية', kind: 'decimal', group: 'specs', unit: 'ك.ف.أ', min: 1, max: 1_000_000 },
  { key: 'pumps_count', label: 'عدد المضخات', kind: 'int', group: 'specs', min: 1, max: 200 },
  { key: 'wells_count', label: 'عدد الآبار', kind: 'int', group: 'specs', min: 0, max: 500 },
  { key: 'trees_count', label: 'عدد الأشجار والنخيل', kind: 'int', group: 'specs', min: 0, max: 10_000_000 },
  { key: 'ac_type', label: 'التكييف', kind: 'enum', group: 'specs', options: opts([['central', 'مركزي'], ['split', 'سبليت'], ['window', 'شباك'], ['desert', 'صحراوي'], ['none', 'بدون تكييف']]) },
  { key: 'finishing', label: 'التشطيب', kind: 'enum', group: 'specs', options: opts([['super_deluxe', 'سوبر ديلوكس'], ['deluxe', 'ديلوكس'], ['standard', 'عادي'], ['shell', 'عظم (بلا تشطيب)']]) },
  { key: 'facility_use', label: 'نوع المنشأة', kind: 'enum', group: 'specs', options: opts([['hospital', 'مستشفى'], ['clinic', 'مجمع طبي/مستوصف'], ['school', 'مدرسة'], ['kindergarten', 'روضة'], ['institute', 'معهد/مركز تدريب'], ['university', 'كلية/جامعة']]) },
  // مرافق
  { key: 'elevator', label: 'مصعد', kind: 'bool', group: 'amenities' },
  { key: 'parking_spaces', label: 'المواقف', kind: 'int', group: 'amenities', min: 0, max: 100_000 },
  { key: 'annex', label: 'ملحق', kind: 'bool', group: 'amenities' },
  { key: 'yard', label: 'حوش', kind: 'bool', group: 'amenities' },
  { key: 'pool', label: 'مسبح', kind: 'bool', group: 'amenities' },
  { key: 'maid_room', label: 'غرفة خادمة', kind: 'bool', group: 'amenities' },
  { key: 'driver_room', label: 'غرفة سائق', kind: 'bool', group: 'amenities' },
  { key: 'features', label: 'المزايا', kind: 'multi', group: 'amenities', options: opts([['smart_home', 'منزل ذكي'], ['security', 'حراسة أمنية'], ['cctv', 'كاميرات مراقبة'], ['garden', 'حديقة'], ['sea_view', 'إطلالة بحرية'], ['balcony', 'شرفة'], ['storage_room', 'غرفة تخزين'], ['private_entrance', 'مدخل خاص'], ['water_tank', 'خزان مياه'], ['solar', 'طاقة شمسية'], ['gym', 'نادٍ رياضي'], ['kids_area', 'منطقة ألعاب أطفال']]) },
  { key: 'station_services', label: 'الخدمات', kind: 'multi', group: 'amenities', options: opts([['market', 'بقالة'], ['car_wash', 'مغسلة'], ['oil_change', 'تغيير زيوت'], ['restaurant', 'مطعم'], ['atm', 'صراف آلي'], ['mosque', 'مصلى'], ['restrooms', 'دورات مياه']]) },
  // تشغيلية
  { key: 'operating_status', label: 'حالة التشغيل', kind: 'enum', group: 'operations', options: OPERATING },
  { key: 'annual_income', label: 'الدخل السنوي', kind: 'decimal', group: 'operations', unit: 'ريال', min: 0, max: 1e11 },
  { key: 'occupancy_pct', label: 'نسبة الإشغال', kind: 'decimal', group: 'operations', unit: '%', min: 0, max: 100 },
] as FieldDef[]).map((f) => [f.key, f]));

/** الحقول المشتركة لكل الأنواع (تُحفظ في أعمدة properties أو في attributes للنظامية ومدة الإيجار) */
export const RENT_PERIODS = opts([['yearly', 'سنويًا'], ['monthly', 'شهريًا'], ['daily', 'يوميًا']]);
export const COMMON_ATTRS: Record<string, FieldDef> = {
  rent_period: { key: 'rent_period', label: 'مدة الإيجار', kind: 'enum', group: 'price', options: RENT_PERIODS },
  ad_license_no: { key: 'ad_license_no', label: 'رقم ترخيص الإعلان', kind: 'text', group: 'legal', maxLength: 40 },
  deed_no: { key: 'deed_no', label: 'رقم الصك', kind: 'text', group: 'legal', maxLength: 40 },
};

const F = (key: string, required?: true | Deal[]): KindField => (required ? { key, required } : { key });
const RES_UNIT = [F('bedrooms', true), F('living_rooms'), F('bathrooms', true), F('kitchen'), F('age_years'), F('furnished', ['rent']), F('ac_type'), F('finishing')];
/** مواصفات التشطيب والتكييف والمزايا للوحدات غير السكنية */
const FINISH = [F('ac_type'), F('finishing')];
const INCOME = [F('operating_status'), F('annual_income', ['investment']), F('occupancy_pct')];
const kindsList: KindDef[] = [
  { key: 'land', label: 'أرض', category: 'land', base: 'land', usage: 'residential', fields: [F('land_use', true), F('facades'), F('facade_directions'), F('streets_count'), F('street_widths'), F('length_m'), F('width_m'), F('main_road')] },
  { key: 'apartment', label: 'شقة', category: 'residential', base: 'apartment', usage: 'residential', fields: [F('floor_number', true), ...RES_UNIT, F('elevator'), F('parking_spaces'), F('maid_room'), F('features')] },
  { key: 'villa', label: 'فيلا', category: 'residential', base: 'villa', usage: 'residential', fields: [F('floors_count'), ...RES_UNIT, F('majlis_count'), F('entrances'), F('facades'), F('facade_directions'), F('street_widths'), F('annex'), F('yard'), F('pool'), F('maid_room'), F('driver_room'), F('elevator'), F('parking_spaces'), F('features')] },
  { key: 'duplex', label: 'دوبلكس', category: 'residential', base: 'villa', usage: 'residential', fields: [F('floors_count'), ...RES_UNIT, F('majlis_count'), F('entrances'), F('facades'), F('annex'), F('yard'), F('pool'), F('maid_room'), F('parking_spaces'), F('features')] },
  { key: 'floor', label: 'دور', category: 'residential', base: 'floor', usage: 'residential', fields: [F('floor_number', true), ...RES_UNIT, F('majlis_count'), F('entrances'), F('elevator'), F('parking_spaces'), F('maid_room'), F('features')] },
  { key: 'building', label: 'عمارة', category: 'residential', base: 'building', usage: 'residential', fields: [F('floors_count', true), F('units_count', true), F('shops_count'), F('age_years'), F('facades'), F('street_widths'), F('elevator'), F('parking_spaces'), ...INCOME, ...FINISH] },
  { key: 'tower', label: 'برج', category: 'commercial', base: 'building', usage: 'commercial', fields: [F('floors_count', true), F('units_count'), F('offices_count'), F('shops_count'), F('age_years'), F('elevator'), F('parking_spaces'), ...INCOME, ...FINISH] },
  { key: 'residential_complex', label: 'مجمع سكني', category: 'residential', base: 'building', usage: 'residential', fields: [F('buildings_count'), F('units_count', true), F('age_years'), F('pool'), F('parking_spaces'), ...INCOME, ...FINISH] },
  { key: 'rest_house', label: 'استراحة', category: 'residential', base: 'farm', usage: 'residential', fields: [F('majlis_count'), F('bedrooms'), F('bathrooms'), F('kitchen'), F('pool'), F('yard'), F('age_years'), F('furnished'), F('features')] },
  { key: 'farm', label: 'مزرعة', category: 'agricultural', base: 'farm', usage: 'residential', fields: [F('wells_count'), F('trees_count'), F('buildings_count'), F('main_road'), ...INCOME] },
  { key: 'warehouse', label: 'مستودع', category: 'industrial', base: 'warehouse', usage: 'commercial', fields: [F('covered_area_sqm'), F('ceiling_height_m'), F('loading_docks'), F('power_kva'), F('street_widths'), F('age_years'), F('operating_status'), F('annual_income', ['investment'])] },
  { key: 'showroom', label: 'معرض', category: 'commercial', base: 'commercial', usage: 'commercial', fields: [F('floor_number'), F('frontage_m'), F('mezzanine'), F('bathrooms'), F('street_widths'), F('main_road'), F('parking_spaces'), F('age_years'), ...FINISH, F('features')] },
  { key: 'shop', label: 'محل', category: 'commercial', base: 'shop', usage: 'commercial', fields: [F('frontage_m'), F('mezzanine'), F('bathrooms'), F('main_road'), F('age_years'), ...FINISH, F('features')] },
  { key: 'office', label: 'مكتب', category: 'commercial', base: 'office', usage: 'commercial', fields: [F('floor_number'), F('rooms_count'), F('bathrooms'), F('furnished'), F('elevator'), F('parking_spaces'), F('age_years'), ...FINISH, F('features')] },
  { key: 'commercial_building', label: 'مبنى تجاري', category: 'commercial', base: 'commercial', usage: 'commercial', fields: [F('floors_count', true), F('shops_count'), F('offices_count'), F('age_years'), F('elevator'), F('parking_spaces'), F('street_widths'), ...INCOME, ...FINISH] },
  { key: 'commercial_complex', label: 'مجمع تجاري', category: 'commercial', base: 'commercial', usage: 'commercial', fields: [F('buildings_count'), F('shops_count', true), F('offices_count'), F('parking_spaces'), F('age_years'), ...INCOME] },
  { key: 'hotel', label: 'فندق', category: 'hospitality', base: 'commercial', usage: 'commercial', fields: [F('rooms_count', true), F('suites_count'), F('hotel_rating'), F('floors_count'), F('elevator'), F('parking_spaces'), F('age_years'), ...INCOME, ...FINISH] },
  { key: 'hotel_apartments', label: 'شقق فندقية', category: 'hospitality', base: 'commercial', usage: 'commercial', fields: [F('units_count', true), F('hotel_rating'), F('floors_count'), F('elevator'), F('parking_spaces'), F('age_years'), ...INCOME, ...FINISH] },
  { key: 'resort', label: 'منتجع', category: 'hospitality', base: 'commercial', usage: 'commercial', fields: [F('units_count'), F('rooms_count'), F('pool'), F('parking_spaces'), F('age_years'), ...INCOME, ...FINISH] },
  { key: 'gas_station', label: 'محطة وقود', category: 'commercial', base: 'commercial', usage: 'commercial', fields: [F('pumps_count'), F('station_services'), F('street_widths'), F('main_road'), F('age_years'), ...INCOME] },
  { key: 'factory', label: 'مصنع', category: 'industrial', base: 'other', usage: 'commercial', fields: [F('covered_area_sqm'), F('ceiling_height_m'), F('power_kva'), F('loading_docks'), F('age_years'), ...INCOME] },
  { key: 'industrial', label: 'عقار صناعي', category: 'industrial', base: 'other', usage: 'commercial', fields: [F('covered_area_sqm'), F('ceiling_height_m'), F('power_kva'), F('street_widths'), F('age_years'), ...INCOME] },
  { key: 'logistics', label: 'عقار لوجستي', category: 'industrial', base: 'warehouse', usage: 'commercial', fields: [F('covered_area_sqm'), F('ceiling_height_m'), F('loading_docks'), F('power_kva'), F('street_widths'), F('main_road'), F('age_years'), ...INCOME] },
  { key: 'health_education', label: 'عقار صحي أو تعليمي', category: 'other', base: 'other', usage: 'commercial', fields: [F('facility_use', true), F('floors_count'), F('rooms_count'), F('parking_spaces'), F('age_years'), ...INCOME] },
  { key: 'other', label: 'نوع آخر', category: 'other', base: 'other', usage: 'residential', fields: [F('floors_count'), F('age_years'), F('parking_spaces')] },
];

const KIND_KEY = /^[a-z][a-z0-9_]{1,40}$/;
const BASES: PType[] = ['villa', 'apartment', 'land', 'building', 'commercial', 'floor', 'office', 'shop', 'warehouse', 'farm', 'other'];
const registry = new Map<string, KindDef>();

/** يتحقق من تعريف النوع قبل إضافته: مفتاح سليم وغير مكرر، وحقول معرّفة وغير مكررة، ونوع أساسي معروف. */
export function kindDefProblems(def: KindDef, existing: Map<string, KindDef> = registry): string[] {
  const p: string[] = [];
  if (!KIND_KEY.test(def.key)) p.push(`مفتاح النوع «${def.key}» غير صالح`);
  if (existing.has(def.key)) p.push(`النوع «${def.key}» مسجَّل مسبقًا`);
  if (!def.label?.trim()) p.push('اسم النوع مطلوب');
  if (!BASES.includes(def.base)) p.push(`النوع الأساسي «${def.base}» غير معروف`);
  const seen = new Set<string>();
  for (const f of def.fields) {
    if (!FIELDS[f.key]) p.push(`الحقل «${f.key}» غير معرّف في FIELDS`);
    if (seen.has(f.key)) p.push(`الحقل «${f.key}» مكرر`);
    seen.add(f.key);
    if (Array.isArray(f.required) && f.required.some((d) => !DEALS.some((x) => x.value === d))) p.push(`عملية غير معروفة في شرط «${f.key}»`);
  }
  return p;
}
export function registerPropertyKind(def: KindDef): void {
  const p = kindDefProblems(def);
  if (p.length) throw new Error(p.join('؛ '));
  registry.set(def.key, def);
}
for (const k of kindsList) registerPropertyKind(k);

export const kinds = (): KindDef[] => [...registry.values()];
export const getKind = (key: unknown): KindDef | null => (typeof key === 'string' ? registry.get(key) ?? null : null);
const isRequired = (f: KindField, deal: Deal | null) => f.required === true || (Array.isArray(f.required) && !!deal && f.required.includes(deal));
/** الحقول الخاصة بنوع وعملية، بترتيبها، مع علامة الإلزام */
export function fieldsFor(kind: string, deal: Deal | null): (FieldDef & { required: boolean })[] {
  const k = getKind(kind);
  return k ? k.fields.map((f) => ({ ...FIELDS[f.key], required: isRequired(f, deal) })) : [];
}

/** يطابق نوع عقار من نص حر (عربي أو مفتاح)؛ للاستيراد والواجهات */
export function parseKind(s: unknown): KindDef | null {
  const direct = getKind(s);
  if (direct) return direct;
  const n = normalizeArabic(String(s ?? ''));
  return n ? kinds().find((k) => normalizeArabic(k.label) === n) ?? null : null;
}
export const parseDealValue = (s: unknown): Deal | null => {
  const n = normalizeArabic(String(s ?? ''));
  return (DEALS.find((d) => d.value === n || [d.label, d.phrase, ...d.aliases].some((x) => normalizeArabic(x) === n))?.value) ?? null;
};

export type ListingValue = {
  deal: Deal; kind: string; area_sqm: number; price: number;
  /** الحقول الخاصة بالنوع والحقول المشتركة غير الأعمدة (مدة الإيجار، البيانات النظامية). قيم موحدة فقط. */
  attributes: Record<string, number | string | boolean | string[] | number[]>;
};

export const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** يحوّل قيمة حقل إلى صيغتها الموحدة، أو يعيد رسالة خطأ */
export function coerceField(f: FieldDef, raw: unknown): { value?: ListingValue['attributes'][string]; error?: string } {
  const range = (n: number) => (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max);
  const rangeMsg = `${f.label}: القيمة خارج النطاق المسموح${f.min !== undefined ? ` (${f.min}` : ''}${f.max !== undefined ? ` إلى ${f.max.toLocaleString('en-US')})` : ')'}`;
  switch (f.kind) {
    case 'int': case 'decimal': {
      const n = parseNumber(raw);
      if (n === null) return { error: `${f.label}: يجب أن يكون رقمًا` };
      if (f.kind === 'int' && !Number.isInteger(n)) return { error: `${f.label}: يجب أن يكون عددًا صحيحًا` };
      if (range(n)) return { error: rangeMsg };
      return { value: f.kind === 'decimal' ? Math.round(n * 100) / 100 : n };
    }
    case 'bool': {
      if (raw === true || raw === false) return { value: raw };
      const n = normalizeArabic(String(raw));
      if (['true', 'نعم', 'يوجد', '1', 'yes'].includes(n)) return { value: true };
      if (['false', 'لا', 'لا يوجد', '0', 'no'].includes(n)) return { value: false };
      return { error: `${f.label}: اختر «يوجد» أو «لا يوجد»` };
    }
    case 'enum': {
      const n = normalizeArabic(String(raw));
      const o = f.options!.find((x) => x.value === n || normalizeArabic(x.label) === n);
      return o ? { value: o.value } : { error: `${f.label}: اختر من القائمة` };
    }
    case 'multi': {
      const list = Array.isArray(raw) ? raw : String(raw).split(/[،,]/);
      const out: string[] = [];
      for (const item of list) {
        const n = normalizeArabic(String(item));
        if (!n) continue;
        const o = f.options!.find((x) => x.value === n || normalizeArabic(x.label) === n);
        if (!o) return { error: `${f.label}: «${String(item)}» ليس من القائمة` };
        if (!out.includes(o.value)) out.push(o.value);
      }
      return out.length ? { value: f.options!.map((o) => o.value).filter((v) => out.includes(v)) } : {};
    }
    case 'number_list': {
      const list = Array.isArray(raw) ? raw : String(raw).split(/[،,\s]+/);
      const nums: number[] = [];
      for (const item of list) {
        if (empty(item)) continue;
        const n = parseNumber(item);
        if (n === null) return { error: `${f.label}: «${String(item)}» ليس رقمًا` };
        if (range(n)) return { error: rangeMsg };
        nums.push(n);
      }
      if (f.maxItems && nums.length > f.maxItems) return { error: `${f.label}: الحد الأقصى ${f.maxItems} قيم` };
      return nums.length ? { value: nums } : {};
    }
    case 'text': {
      const s = String(raw).replace(/\s+/g, ' ').trim();
      if (f.maxLength && s.length > f.maxLength) return { error: `${f.label}: أطول من ${f.maxLength} حرفًا` };
      if (/^[=+\-@]/.test(s)) return { error: `${f.label}: لا يبدأ برمز صيغة (= + - @)` };
      return s ? { value: s } : {};
    }
  }
}

/**
 * يتحقق من الإدخال المنظم ويوحّده. يُرجع الحقول التي لا تخص النوع المختار في ignored (لا تُحفظ)،
 * فتغيير النوع في الواجهة لا يُدخل بيانات نوع سابق في العقار.
 */
export function validateListing(input: Record<string, unknown>): { value: ListingValue | null; errors: Issue[]; warnings: Issue[]; ignored: string[] } {
  const errors: Issue[] = [], warnings: Issue[] = [], ignored: string[] = [];
  const err = (field: string, code: string, message: string) => errors.push({ field, code, message });

  const deal = parseDealValue(input.deal);
  if (!deal) err('deal', 'deal_invalid', 'اختر نوع العملية (بيع أو إيجار أو استثمار)');
  const kind = parseKind(input.kind);
  if (!kind) err('kind', 'kind_invalid', 'اختر نوع العقار من القائمة');

  const area = parseNumber(input.area_sqm);
  if (area === null || area <= 0 || area > 10_000_000) err('area_sqm', 'area_invalid', 'المساحة مطلوبة وتكون رقمًا موجبًا بالمتر المربع');
  const price = parseNumber(input.price);
  if (price === null || price < 0 || price > 1e11) err('price', 'price_invalid', 'السعر مطلوب ويكون رقمًا بالريال');
  else if (deal !== 'rent' && price === 0) err('price', 'price_invalid', 'السعر لا يكون صفرًا في البيع أو الاستثمار');

  const rawAttrs = input.attributes && typeof input.attributes === 'object' && !Array.isArray(input.attributes) ? (input.attributes as Record<string, unknown>) : {};
  const attributes: ListingValue['attributes'] = {};

  // الحقول المشتركة غير الأعمدة: مدة الإيجار مطلوبة في الإيجار فقط، والنظامية اختيارية
  const common = (key: string, required: boolean) => {
    const f = COMMON_ATTRS[key], raw = input[key] ?? rawAttrs[key];
    if (empty(raw)) { if (required) err(key, `${key}_required`, `${f.label} مطلوب`); return; }
    const r = coerceField(f, raw);
    if (r.error) err(key, `${key}_invalid`, r.error); else if (r.value !== undefined) attributes[key] = r.value;
  };
  if (deal === 'rent') common('rent_period', true); else if (!empty(input.rent_period ?? rawAttrs.rent_period)) ignored.push('rent_period');
  common('ad_license_no', false); common('deed_no', false);

  if (kind) {
    const allowed = new Set(kind.fields.map((f) => f.key));
    for (const k of Object.keys(rawAttrs)) if (!allowed.has(k) && !(k in COMMON_ATTRS) && !empty(rawAttrs[k])) ignored.push(k);
    for (const kf of kind.fields) {
      const f = FIELDS[kf.key], raw = rawAttrs[kf.key];
      if (empty(raw)) { if (isRequired(kf, deal)) err(kf.key, 'required', `${f.label} مطلوب لهذا النوع`); continue; }
      const r = coerceField(f, raw);
      if (r.error) err(kf.key, 'field_invalid', r.error);
      else if (r.value !== undefined) attributes[kf.key] = r.value;
      else if (isRequired(kf, deal)) err(kf.key, 'required', `${f.label} مطلوب لهذا النوع`);
    }
    // قواعد بين الحقول
    const a = attributes as Record<string, any>;
    if (a.streets_count !== undefined && a.street_widths !== undefined && a.street_widths.length !== a.streets_count)
      err('street_widths', 'street_widths_mismatch', `عدد عروض الشوارع (${a.street_widths.length}) لا يطابق عدد الشوارع (${a.streets_count})`);
    if (a.facades !== undefined && a.facade_directions !== undefined && a.facade_directions.length > a.facades)
      err('facade_directions', 'facade_directions_mismatch', `اتجاهات الواجهة (${a.facade_directions.length}) أكثر من عدد الواجهات (${a.facades})`);
    if (a.floor_number !== undefined && a.floors_count !== undefined && a.floor_number > a.floors_count)
      err('floor_number', 'floor_above_count', 'رقم الدور أكبر من عدد الأدوار');
    if (a.covered_area_sqm !== undefined && area !== null && a.covered_area_sqm > area * 10)
      err('covered_area_sqm', 'covered_area_too_large', 'المساحة المغطاة أكبر بكثير من مساحة الأرض');
    if (a.length_m !== undefined && a.width_m !== undefined && area !== null && area > 0) {
      const ratio = (a.length_m * a.width_m) / area;
      if (ratio < 0.8 || ratio > 1.25) warnings.push({ field: 'length_m', code: 'dimensions_mismatch', message: `الطول × العرض (${(a.length_m * a.width_m).toLocaleString('en-US')} م²) لا يقارب المساحة المدخلة؛ راجع الأبعاد` });
    }
    if (a.suites_count !== undefined && a.rooms_count !== undefined && a.suites_count > a.rooms_count)
      err('suites_count', 'suites_above_rooms', 'عدد الأجنحة أكبر من عدد الغرف');
  }

  if (errors.length || !deal || !kind || area === null || price === null) return { value: null, errors, warnings, ignored };
  return { value: { deal, kind: kind.key, area_sqm: Math.round(area * 100) / 100, price: Math.round(price * 100) / 100, attributes }, errors, warnings, ignored };
}

/** أعمدة التوافق في properties تُملأ من الحقول المنظمة (للتصفية والاستيراد والتصدير الحالية) */
export function legacyColumns(v: ListingValue): { type: PType; usage: 'residential' | 'commercial'; rooms: number | null; age_years: number | null; facades: number | null; street_width_m: number | null } {
  const k = getKind(v.kind)!, a = v.attributes as Record<string, any>;
  const landUse = a.land_use as string | undefined;
  const usage = landUse ? (['commercial', 'mixed', 'industrial', 'investment'].includes(landUse) ? 'commercial' : 'residential') : k.usage;
  return {
    type: k.base, usage,
    // عمود rooms القديم يعني غرف السكن (0..100)؛ غرف الفنادق والمكاتب تبقى في attributes فقط
    rooms: typeof a.bedrooms === 'number' ? a.bedrooms : null,
    age_years: typeof a.age_years === 'number' ? a.age_years : null,
    facades: typeof a.facades === 'number' ? a.facades : null,
    street_width_m: Array.isArray(a.street_widths) && a.street_widths.length ? Math.max(...(a.street_widths as number[])) : null,
  };
}

// ——— توليد الوصف ———
const n2 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
/** الرقم مع وحدته: «%» ملتصقة، و«سنة» بصيغة العدد العربية (سنة واحدة، سنتان، 3 سنوات، 11 سنة) */
export function withUnit(n: number, unit?: string): string {
  if (!unit) return n2(n);
  if (unit === '%') return `${n2(n)}%`;
  if (unit === 'سنة' && Number.isInteger(n)) return n === 1 ? 'سنة واحدة' : n === 2 ? 'سنتان' : n >= 3 && n <= 10 ? `${n} سنوات` : `${n2(n)} سنة`;
  return `${n2(n)} ${unit}`;
}
export function formatValue(f: FieldDef, v: ListingValue['attributes'][string]): string {
  if (typeof v === 'boolean') return v ? 'يوجد' : 'لا يوجد';
  if (f.kind === 'enum') return f.options!.find((o) => o.value === v)?.label ?? String(v);
  if (f.kind === 'multi') return (v as string[]).map((x) => f.options!.find((o) => o.value === x)?.label ?? x).join('، ');
  if (f.kind === 'number_list') return (v as number[]).map((x) => withUnit(x, f.unit)).join('، ');
  if (typeof v === 'number') return withUnit(v, f.unit);
  return String(v);
}

export type Description = { title: string; sections: { key: GroupKey; heading: string; lines: string[] }[]; text: string };
export type DescribePlace = { city?: string | null; district?: string | null; location?: string | null };

/**
 * يبني الوصف من البيانات المنظمة وحدها: عنوان، ثم أقسام بترتيب GROUPS، وداخل كل قسم بترتيب حقول النوع.
 * لا يظهر قسم بلا بيانات، ولا حقل بلا قيمة، ولا تُضاف صفة أو رقم لم يُدخل. «ملاحظات إضافية» لا تدخل هنا.
 */
export function describeListing(v: ListingValue, place: DescribePlace = {}): Description {
  const k = getKind(v.kind)!;
  const deal = DEALS.find((d) => d.value === v.deal)!;
  const where = [place.district ? `حي ${place.district}` : null, place.city || null].filter(Boolean).join('، ');
  const title = `${k.label} ${deal.phrase}${where ? ` في ${where}` : ''}`;
  const lines: Record<GroupKey, string[]> = { location: [], price: [], specs: [], amenities: [], operations: [], legal: [] };
  if (place.city) lines.location.push(`المدينة: ${place.city}`);
  if (place.district) lines.location.push(`الحي: ${place.district}`);
  if (place.location?.trim()) lines.location.push(`العنوان: ${place.location.trim()}`);
  lines.price.push(`المساحة: ${n2(v.area_sqm)} م²`);
  const period = v.deal === 'rent' && typeof v.attributes.rent_period === 'string' ? ` ${formatValue(COMMON_ATTRS.rent_period, v.attributes.rent_period)}` : '';
  lines.price.push(`${v.deal === 'rent' ? 'الإيجار' : 'السعر'}: ${n2(v.price)} ريال${period}`);
  for (const kf of k.fields) {
    const val = v.attributes[kf.key];
    if (empty(val)) continue;
    const f = FIELDS[kf.key];
    lines[f.group].push(`${f.label}: ${formatValue(f, val)}`);
  }
  for (const key of ['ad_license_no', 'deed_no'] as const) if (!empty(v.attributes[key])) lines.legal.push(`${COMMON_ATTRS[key].label}: ${v.attributes[key]}`);
  const sections = GROUPS.filter((g) => lines[g.key].length).map((g) => ({ key: g.key, heading: g.heading, lines: lines[g.key] }));
  const text = [title, ...sections.map((s) => `${s.heading}\n${s.lines.map((l) => `• ${l}`).join('\n')}`)].join('\n\n');
  return { title, sections, text };
}

// ——— المسودات ———
const DRAFT_TOP = ['deal', 'kind', 'city_id', 'district_id', 'city', 'district', 'location', 'lat', 'lng', 'area_sqm', 'price', 'rent_period', 'ad_license_no', 'deed_no', 'notes'];
/**
 * تنظيف المسودة قبل حفظها: مفاتيح معروفة فقط، ونصوص محدودة الطول، وبلا تحقق إلزامي (المسودة قد تكون ناقصة).
 * تُحفظ قيم كل الحقول المعروفة حتى لو تخص نوعًا آخر، فلا يفقد المستخدم ما كتبه إذا رجع للنوع السابق.
 */
export function sanitizeDraft(raw: unknown): Record<string, unknown> {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const clip = (v: unknown, max: number): unknown => {
    if (typeof v === 'string') return v.slice(0, max);
    if (typeof v === 'number' || typeof v === 'boolean') return Number.isFinite(v as number) || typeof v === 'boolean' ? v : undefined;
    if (Array.isArray(v)) return v.slice(0, 10).map((x) => clip(x, 60)).filter((x) => x !== undefined && typeof x !== 'object');
    return undefined;
  };
  const out: Record<string, unknown> = {};
  for (const k of DRAFT_TOP) { const v = clip(src[k], k === 'notes' ? 2000 : 200); if (v !== undefined && v !== '') out[k] = v; }
  const attrs = src.attributes && typeof src.attributes === 'object' && !Array.isArray(src.attributes) ? (src.attributes as Record<string, unknown>) : {};
  const a: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) if (FIELDS[k]) { const c = clip(v, 200); if (c !== undefined && c !== '') a[k] = c; }
  out.attributes = a;
  return out;
}

// ——— خطوات النموذج (تُستعمل في الواجهة وتُختبر هنا) ———
export type EntryForm = Record<string, unknown> & { attributes?: Record<string, unknown> };
/** الحمولة التي تُرسل للنشر أو المعاينة: حقول النوع المختار فقط، ومدة الإيجار في الإيجار فقط. ما كُتب لنوع آخر يبقى في المسودة ولا يُنشر. */
export function payloadFor(form: EntryForm): Record<string, unknown> {
  const k = getKind(form.kind);
  const allowed = new Set(k?.fields.map((f) => f.key) ?? []);
  const attributes = Object.fromEntries(Object.entries(form.attributes ?? {}).filter(([key, v]) => allowed.has(key) && !empty(v)));
  const out: Record<string, unknown> = { ...form, attributes };
  if (parseDealValue(form.deal) !== 'rent') delete out.rent_period;
  for (const key of Object.keys(out)) if (key !== 'attributes' && empty(out[key])) delete out[key];
  return out;
}
/** أخطاء خطوة واحدة: 1 = الحقول المشتركة، 2 = حقول النوع وقواعدها */
export function errorsForStep(form: EntryForm, step: 1 | 2): Issue[] {
  const k = getKind(form.kind);
  const own = new Set(k?.fields.map((f) => f.key) ?? []);
  const errs = validateListing(payloadFor(form)).errors.filter((e) => (step === 2 ? own.has(e.field ?? '') : !own.has(e.field ?? '')));
  if (step === 1) {
    if (empty(form.city_id) && empty(form.city)) errs.push({ code: 'city_required', field: 'city', message: 'المدينة مطلوبة' });
    if (empty(form.district_id) && empty(form.district)) errs.push({ code: 'district_required', field: 'district', message: 'الحي مطلوب' });
  }
  return errs;
}
