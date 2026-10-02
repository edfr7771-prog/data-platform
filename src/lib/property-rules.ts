/** قواعد العقار النقية: تنظيف وتحقق وتصحيح الأحياء ومفتاح التكرار. بلا اعتماد على قاعدة البيانات أو Next. */
import { createHash } from 'node:crypto';
import { levenshtein, normalizeArabic, parseNumber } from './arabic';

export const TYPES = ['villa', 'apartment', 'land', 'building', 'commercial', 'floor', 'office', 'shop', 'warehouse', 'farm', 'other'] as const;
export type PType = (typeof TYPES)[number];
export type Deal = 'sale' | 'rent' | 'investment';
export type Usage = 'residential' | 'commercial';
export type PStatus = 'active' | 'sold' | 'rented' | 'withdrawn';
export type Issue = { code: string; field?: string; message: string };
export type Geo = {
  cities: { id: string; slug: string; name_ar: string; name_en: string }[];
  districts: { id: string; city_id: string; slug: string; name_ar: string; name_en: string | null }[];
};
export type CleanProperty = {
  type: PType; deal: Deal; usage: Usage; area_sqm: number; price: number; city_id: string | null; district_id: string | null;
  location: string | null; lat: number | null; lng: number | null; age_years: number | null; rooms: number | null;
  street_width_m: number | null; facades: number | null; status: PStatus; external_ref: string | null; notes: string | null;
};

const syn = <T extends string>(pairs: [T, string[]][]) => {
  const m = new Map<string, T>();
  for (const [k, list] of pairs) for (const s of list) m.set(normalizeArabic(s), k);
  return m;
};
const TYPE_MAP = syn<PType>([
  ['villa', ['فيلا', 'فله', 'villa', 'قصر', 'دوبلكس', 'duplex', 'تاون هاوس']], ['apartment', ['شقة', 'شقه', 'apartment', 'flat', 'استوديو']],
  ['land', ['ارض', 'land', 'قطعة ارض']], ['building', ['عمارة', 'عماره', 'building', 'برج']], ['commercial', ['تجاري', 'commercial', 'معرض']],
  ['floor', ['دور', 'floor', 'طابق']], ['office', ['مكتب', 'office']], ['shop', ['محل', 'shop', 'دكان']],
  ['warehouse', ['مستودع', 'warehouse', 'مخزن']], ['farm', ['مزرعة', 'مزرعه', 'farm', 'استراحة']], ['other', ['اخرى', 'other', 'غير ذلك']],
]);
const DEAL_MAP = syn<Deal>([['sale', ['بيع', 'للبيع', 'sale', 'sell', 'تمليك']], ['rent', ['ايجار', 'للايجار', 'rent', 'lease', 'تاجير', 'للتاجير']], ['investment', ['استثمار', 'للاستثمار', 'investment']]]);
const USAGE_MAP = syn<Usage>([['residential', ['سكني', 'سكنى', 'residential']], ['commercial', ['تجاري', 'تجارى', 'commercial']]]);
const STATUS_MAP = syn<PStatus>([['active', ['متاح', 'نشط', 'active', 'available']], ['sold', ['مباع', 'sold']], ['rented', ['مؤجر', 'rented']], ['withdrawn', ['مسحوب', 'withdrawn', 'ملغي']]]);

function lookup<T>(map: Map<string, T>, s: string, loose = false): T | null {
  const n = normalizeArabic(s);
  if (!n) return null;
  if (map.has(n)) return map.get(n)!;
  if (!loose) return null;
  let best: [string, T] | null = null;
  for (const [k, v] of map) if (n.includes(k) && (!best || k.length > best[0].length)) best = [k, v];
  return best ? best[1] : null;
}
export const parseType = (s: string) => lookup(TYPE_MAP, s, true);
export const parseDeal = (s: string) => lookup(DEAL_MAP, s, true);
export const parseUsage = (s: string) => lookup(USAGE_MAP, s);
export const parseStatus = (s: string) => lookup(STATUS_MAP, s);

export const pricePerSqm = (price: number, area: number): number | null => (area > 0 ? Math.round((price / area) * 100) / 100 : null);

/** يطابق الحي والمدينة مع المرجع. تصحيح تهجئة الحي بمسافة تحرير صغيرة يُسجَّل «تصحيحًا» ولا يُخفى. */
export function resolveGeo(cityText: string, districtText: string, geo: Geo): { cityId: string | null; districtId: string | null; issues: Issue[]; fixes: Issue[] } {
  const issues: Issue[] = [], fixes: Issue[] = [];
  let cityId: string | null = null, districtId: string | null = null;
  const ct = normalizeArabic(cityText);
  if (ct) {
    const c = geo.cities.find((x) => normalizeArabic(x.name_ar) === ct || x.slug === ct || normalizeArabic(x.name_en) === ct);
    if (c) cityId = c.id; else issues.push({ code: 'city_unknown', field: 'city', message: `المدينة «${cityText}» غير مدرجة في المرجع` });
  }
  const dt = normalizeArabic(districtText).replace(/^حي /, '').replace(/^district /, '');
  if (dt) {
    const pool = cityId ? geo.districts.filter((d) => d.city_id === cityId) : geo.districts;
    const exact = pool.find((d) => normalizeArabic(d.name_ar) === dt || d.slug === dt || (d.name_en && normalizeArabic(d.name_en) === dt));
    if (exact) { districtId = exact.id; if (!cityId) cityId = exact.city_id; }
    else {
      const th = dt.length >= 8 ? 2 : dt.length >= 4 ? 1 : 0;
      const scored = pool.map((d) => ({ d, dist: levenshtein(dt, normalizeArabic(d.name_ar)) })).sort((a, b) => a.dist - b.dist);
      if (scored[0] && scored[0].dist <= th && (!scored[1] || scored[1].dist > scored[0].dist)) {
        districtId = scored[0].d.id; if (!cityId) cityId = scored[0].d.city_id;
        fixes.push({ code: 'district_corrected', field: 'district', message: `تم تصحيح الحي «${districtText}» إلى «${scored[0].d.name_ar}»` });
      } else issues.push({ code: 'district_unknown', field: 'district', message: `الحي «${districtText}» غير مطابق للمرجع، يحتاج مراجعة` });
    }
  }
  return { cityId, districtId, issues, fixes };
}

const TEXT_LIMIT = { location: 200, notes: 2000, external_ref: 80 } as const;
const COMMERCIAL_TYPES: PType[] = ['commercial', 'office', 'shop', 'warehouse'];
const formulaLike = (s: string) => /^[=+\-@]/.test(s) && parseNumber(s) === null;

export function cleanProperty(raw: Record<string, unknown>, geo: Geo): { value: CleanProperty | null; errors: Issue[]; warnings: Issue[]; fixes: Issue[] } {
  const errors: Issue[] = [], warnings: Issue[] = [], fixes: Issue[] = [];
  const s = (k: string) => (raw[k] === undefined || raw[k] === null ? '' : String(raw[k]).trim());
  const err = (code: string, field: string, message: string) => errors.push({ code, field, message });

  const type = parseType(s('type')); if (!type) err('type_invalid', 'type', 'نوع العقار غير معروف');
  const deal = parseDeal(s('deal')); if (!deal) err('deal_invalid', 'deal', 'نوع العرض (بيع/إيجار/استثمار) غير معروف');

  const num = (k: string): number | null => {
    const v = parseNumber(raw[k]);
    if (v !== null && typeof raw[k] === 'string' && /[^\d.]/.test(String(raw[k]).trim())) fixes.push({ code: 'number_normalized', field: k, message: `تم تنظيف الرقم «${raw[k]}»` });
    return v;
  };
  const area = num('area_sqm');
  if (area === null || area <= 0 || area > 10_000_000) err('area_invalid', 'area_sqm', 'المساحة غير صحيحة');
  const price = num('price');
  if (price === null || price < 0 || price > 1e11) err('price_invalid', 'price', 'السعر غير صحيح');
  else if ((deal === 'sale' || deal === 'investment') && price === 0) err('price_invalid', 'price', 'سعر البيع أو الاستثمار لا يكون صفرًا');

  const intField = (k: string, min: number, max: number, label: string): number | null => {
    if (!s(k)) return null;
    const v = parseNumber(raw[k]);
    if (v === null || !Number.isInteger(v) || v < min || v > max) { err(`${k}_invalid`, k, `${label} غير صحيح`); return null; }
    return v;
  };
  const age = intField('age_years', 0, 200, 'العمر'), rooms = intField('rooms', 0, 100, 'عدد الغرف'), facades = intField('facades', 0, 4, 'عدد الواجهات');
  let street: number | null = null;
  if (s('street_width_m')) { street = parseNumber(raw.street_width_m); if (street === null || street < 0 || street > 200) { err('street_width_m_invalid', 'street_width_m', 'عرض الشارع غير صحيح'); street = null; } }
  let lat: number | null = null, lng: number | null = null;
  if (s('lat') || s('lng')) {
    lat = parseNumber(raw.lat); lng = parseNumber(raw.lng);
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) { err('coords_invalid', 'lat', 'الإحداثيات غير صحيحة'); lat = lng = null; }
  }
  for (const k of ['location', 'notes', 'external_ref'] as const) {
    if (s(k).length > TEXT_LIMIT[k]) err(`${k}_too_long`, k, `الحقل أطول من ${TEXT_LIMIT[k]} حرفًا`);
    if (s(k) && formulaLike(s(k))) warnings.push({ code: 'formula_like', field: k, message: 'يبدأ النص برمز صيغة (= + - @)؛ سيُحصَّن عند التصدير' });
  }

  const geoRes = resolveGeo(s('city'), s('district'), geo);
  warnings.push(...geoRes.issues); fixes.push(...geoRes.fixes);

  const sRaw = s('usage'); const usage = parseUsage(sRaw);
  if (sRaw && !usage) warnings.push({ code: 'usage_unknown', field: 'usage', message: 'الاستخدام غير معروف، اعتُمد الافتراضي' });
  const stRaw = s('status'); const status = parseStatus(stRaw);
  if (stRaw && !status) warnings.push({ code: 'status_unknown', field: 'status', message: 'الحالة غير معروفة، اعتُمد «متاح»' });

  if (errors.length || !type || !deal || area === null || price === null) return { value: null, errors, warnings, fixes };

  const ppm = pricePerSqm(price, area)!;
  if (deal !== 'rent' && (ppm < 100 || ppm > 150_000)) warnings.push({ code: 'ppm_out_of_range', field: 'price', message: `سعر المتر ${Math.round(ppm).toLocaleString('en-US')} خارج النطاق المعقول، يحتاج مراجعة` });
  if (deal === 'rent' && (ppm < 1 || ppm > 20_000)) warnings.push({ code: 'ppm_out_of_range', field: 'price', message: `سعر المتر للإيجار ${Math.round(ppm).toLocaleString('en-US')} خارج النطاق المعقول، يحتاج مراجعة` });

  return {
    value: {
      type, deal, usage: usage ?? (COMMERCIAL_TYPES.includes(type) ? 'commercial' : 'residential'), area_sqm: area, price,
      city_id: geoRes.cityId, district_id: geoRes.districtId, location: s('location') || null, lat, lng, age_years: age, rooms,
      street_width_m: street, facades, status: status ?? 'active', external_ref: s('external_ref') || null, notes: s('notes') || null,
    },
    errors, warnings, fixes,
  };
}

/** مفتاح التكرار: نوع + صفقة + حي (أو الموقع نصًا) + المساحة مقرّبة للمتر + السعر مقرّبًا للألف. تكرار تقريبي مقصود. */
export function dedupeKey(p: Pick<CleanProperty, 'type' | 'deal' | 'district_id' | 'location' | 'area_sqm' | 'price'>): string {
  const where = p.district_id ?? normalizeArabic(p.location ?? '');
  return createHash('sha256').update([p.type, p.deal, where, Math.round(p.area_sqm), Math.round(p.price / 1000)].join('|')).digest('hex').slice(0, 32);
}
