/**
 * الذكاء السعري وتحليلات الأحياء وحسابات الخريطة (Phase 2). دوال نقية على صفوف قاعدة البيانات الفعلية.
 * مبدأ: لا رقم بلا عينة كافية. أي ملخص بعينة أقل من MIN_SAMPLE يُعاد بلا وسيط ويُعلَّم «عينة غير كافية».
 */
import { getKind } from './property-schema';

export const MIN_SAMPLE = 3;
export type MarketRow = {
  id: string; kind: string | null; type: string; deal: string; city_id: string | null; district_id: string | null; district_name: string | null;
  price: number; area_sqm: number; rent_period: string | null; lat: number | null; lng: number | null; created_at: string;
};
const PERIOD_YEAR: Record<string, number> = { yearly: 1, monthly: 12, daily: 365 };

/** سعر المتر للمقارنة: البيع والاستثمار سعر/مساحة، والإيجار إيجار سنوي/مساحة */
export function unitPrice(r: Pick<MarketRow, 'deal' | 'price' | 'area_sqm' | 'rent_period'>): number | null {
  if (!(r.area_sqm > 0)) return null;
  const p = r.deal === 'rent' ? r.price * (PERIOD_YEAR[r.rent_period ?? 'yearly'] ?? 1) : r.price;
  return Math.round((p / r.area_sqm) * 100) / 100;
}
/** فئة السوق: الإيجار منفصل عن البيع والاستثمار */
export const market = (deal: string) => (deal === 'rent' ? 'rent' : 'sale');

/** كمّية بالاستيفاء الخطي (مطابقة لـ percentile_cont في PostgreSQL) */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export type Summary = { n: number; sufficient: boolean; median: number | null; p25: number | null; p75: number | null; min: number | null; max: number | null };
const r2 = (n: number) => Math.round(n * 100) / 100;
export function summarize(values: number[]): Summary {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const ok = s.length >= MIN_SAMPLE;
  return {
    n: s.length, sufficient: ok,
    median: ok ? r2(quantile(s, 0.5)) : null, p25: ok ? r2(quantile(s, 0.25)) : null, p75: ok ? r2(quantile(s, 0.75)) : null,
    min: s.length ? s[0] : null, max: s.length ? s[s.length - 1] : null,
  };
}

export const sameKind = (a: Pick<MarketRow, 'kind' | 'type'>, b: Pick<MarketRow, 'kind' | 'type'>) => (a.kind && b.kind ? a.kind === b.kind : (a.kind ? getKind(a.kind)?.base : a.type) === (b.kind ? getKind(b.kind)?.base : b.type));

export type Estimate =
  | { ok: true; level: 'district' | 'city'; n: number; ppm: Summary; estimate: number; low: number; high: number; comparables: string[] }
  | { ok: false; reason: 'insufficient_data'; n_district: number; n_city: number };
/**
 * تقدير القيمة من المقارنات الفعلية: نفس السوق (بيع/إيجار) ونفس النوع، في الحي أولًا ثم المدينة.
 * يعيد الوسيط × المساحة ونطاق الربعين، أو يرفض بوضوح إن قلّت العينة عن MIN_SAMPLE.
 */
export function estimate(subject: MarketRow, pool: MarketRow[]): Estimate {
  const comps = pool.filter((r) => r.id !== subject.id && market(r.deal) === market(subject.deal) && sameKind(r, subject) && unitPrice(r) !== null);
  const inDistrict = subject.district_id ? comps.filter((r) => r.district_id === subject.district_id) : [];
  const inCity = subject.city_id ? comps.filter((r) => r.city_id === subject.city_id) : [];
  for (const [level, set] of [['district', inDistrict], ['city', inCity]] as const) {
    if (set.length >= MIN_SAMPLE) {
      const ppm = summarize(set.map((r) => unitPrice(r)!));
      return { ok: true, level, n: set.length, ppm, estimate: Math.round(ppm.median! * subject.area_sqm), low: Math.round(ppm.p25! * subject.area_sqm), high: Math.round(ppm.p75! * subject.area_sqm), comparables: set.map((r) => r.id) };
    }
  }
  return { ok: false, reason: 'insufficient_data', n_district: inDistrict.length, n_city: inCity.length };
}

/** الوسيط الشهري لسعر المتر حسب تاريخ الإدخال */
export function monthlyTrend(rows: MarketRow[]): { month: string; summary: Summary }[] {
  const by = new Map<string, number[]>();
  for (const r of rows) { const u = unitPrice(r); if (u === null) continue; const m = String(r.created_at).slice(0, 7); by.set(m, [...(by.get(m) ?? []), u]); }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, summary: summarize(v) }));
}

// ——— الخريطة ———
export type Bounds = { south: number; west: number; north: number; east: number };
/** نافذة البداية: جدة (تقريبية للعرض فقط، لا بيانات). تتسع تلقائيًا لتشمل النقاط الفعلية. */
export const JEDDAH_BOUNDS: Bounds = { south: 21.35, west: 39.08, north: 21.85, east: 39.32 };
export function boundsOf(points: { lat: number; lng: number }[], fallback: Bounds = JEDDAH_BOUNDS, pad = 0.01): Bounds {
  if (!points.length) return fallback;
  const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
  return { south: Math.min(...lats) - pad, north: Math.max(...lats) + pad, west: Math.min(...lngs) - pad, east: Math.max(...lngs) + pad };
}
/** إسقاط خطي (كافٍ لمدينة واحدة): خط الطول أفقي، والعرض رأسي مع تصحيح جيب التمام */
export function project(lat: number, lng: number, b: Bounds, width: number, height: number): { x: number; y: number } {
  const k = Math.cos(((b.north + b.south) / 2) * Math.PI / 180);
  const spanX = (b.east - b.west) * k, spanY = b.north - b.south;
  const scale = Math.min(width / spanX, height / spanY);
  const ox = (width - spanX * scale) / 2, oy = (height - spanY * scale) / 2;
  return { x: ox + (lng - b.west) * k * scale, y: oy + (b.north - lat) * scale };
}
export function centroid(points: { lat: number; lng: number }[]): { lat: number; lng: number } | null {
  if (!points.length) return null;
  return { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lng: points.reduce((s, p) => s + p.lng, 0) / points.length };
}
/** خريطة كثافة: شبكة cols×rows، لكل خلية مجموع نواة غاوسية للنقاط ضمن نصف قطر (بالخلايا)، مطبّعة إلى 0..1 */
export function heatGrid(points: { lat: number; lng: number; w?: number }[], b: Bounds, cols = 24, rows = 24, radius = 1.5): number[][] {
  const g = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (const p of points) {
    const cx = ((p.lng - b.west) / (b.east - b.west)) * cols - 0.5, cy = ((b.north - p.lat) / (b.north - b.south)) * rows - 0.5;
    for (let y = Math.max(0, Math.floor(cy - 3 * radius)); y <= Math.min(rows - 1, Math.ceil(cy + 3 * radius)); y++)
      for (let x = Math.max(0, Math.floor(cx - 3 * radius)); x <= Math.min(cols - 1, Math.ceil(cx + 3 * radius)); x++)
        g[y][x] += (p.w ?? 1) * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * radius * radius));
  }
  const max = Math.max(0, ...g.flat());
  return max > 0 ? g.map((r) => r.map((v) => Math.round((v / max) * 1000) / 1000)) : g;
}
