/** قراءة CSV وتخمين تطابق الأعمدة وتصنيف الصفوف: نقي وقابل للاختبار. */
import { parse } from 'csv-parse/sync';
import { normalizeArabic } from './arabic';
import { cleanProperty, dedupeKey, type CleanProperty, type Geo, type Issue } from './property-rules';

export const FIELDS = ['external_ref', 'type', 'deal', 'usage', 'city', 'district', 'location', 'lat', 'lng', 'area_sqm', 'price', 'age_years', 'rooms', 'street_width_m', 'facades', 'status', 'notes'] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Record<Field, number | null>;
export const MAX_ROWS = 20_000;

const SYN: Record<Field, string[]> = {
  external_ref: ['رقم العقار', 'الرقم المرجعي', 'id', 'ref', 'property id', 'code', 'كود', 'رقم'],
  type: ['النوع', 'نوع العقار', 'type', 'property type', 'نوع'], deal: ['الصفقة', 'نوع العرض', 'بيع ايجار', 'عرض', 'deal', 'sale rent', 'purpose', 'الغرض'],
  usage: ['الاستخدام', 'سكني تجاري', 'usage', 'use'], city: ['المدينة', 'مدينة', 'city'], district: ['الحي', 'حي', 'district', 'neighborhood', 'المنطقة'],
  location: ['الموقع', 'العنوان', 'location', 'address', 'وصف الموقع'], lat: ['خط العرض', 'lat', 'latitude'], lng: ['خط الطول', 'lng', 'lon', 'longitude'],
  area_sqm: ['المساحة', 'المساحه', 'area', 'area sqm', 'مساحة العقار', 'م2', 'المساحة م2'], price: ['السعر', 'price', 'المبلغ', 'سعر العقار', 'السعر الاجمالي', 'total price'],
  age_years: ['العمر', 'عمر العقار', 'age', 'age years', 'سنوات'], rooms: ['الغرف', 'عدد الغرف', 'rooms', 'bedrooms'], street_width_m: ['عرض الشارع', 'street width', 'street'],
  facades: ['الواجهات', 'عدد الواجهات', 'facades'], status: ['الحالة', 'حالة العقار', 'status'], notes: ['ملاحظات', 'notes', 'note', 'تعليق'],
};
const key = (s: string) => normalizeArabic(s).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

export function validateUpload(meta: { filename: string; size: number }, bytes: Uint8Array, maxBytes: number): { ok: true; text: string; encoding: 'utf-8' | 'windows-1256' } | { ok: false; error: string } {
  if (!/\.csv$/i.test(meta.filename)) return { ok: false, error: 'نوع الملف غير مدعوم: يُقبل CSV فقط حاليًا' };
  if (meta.size <= 0) return { ok: false, error: 'الملف فارغ' };
  if (meta.size > maxBytes || bytes.length > maxBytes) return { ok: false, error: `الملف أكبر من الحد المسموح (${Math.floor(maxBytes / 1048576)}MB)` };
  if (bytes.subarray(0, 4096).includes(0)) return { ok: false, error: 'الملف ثنائي وليس CSV نصيًا' };
  try { return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''), encoding: 'utf-8' }; } catch { /* جرّب ترميز إكسل العربي */ }
  try { return { ok: true, text: new TextDecoder('windows-1256', { fatal: true }).decode(bytes), encoding: 'windows-1256' }; } catch { return { ok: false, error: 'تعذّر قراءة ترميز الملف (يُقبل UTF-8 أو Windows-1256)' }; }
}

export function parseCsvText(text: string): { header: string[]; rows: string[][] } | { error: string } {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  let recs: string[][];
  try { recs = parse(text, { delimiter, skip_empty_lines: true, relax_column_count: true, relax_quotes: false, bom: true }) as string[][]; }
  catch (e) { return { error: `ملف CSV غير صالح: ${(e as Error).message.slice(0, 120)}` }; }
  if (recs.length < 2) return { error: 'الملف لا يحوي صفوف بيانات' };
  if (recs.length - 1 > MAX_ROWS) return { error: `عدد الصفوف يتجاوز الحد (${MAX_ROWS.toLocaleString('en-US')})` };
  return { header: recs[0].map((h) => h.trim()), rows: recs.slice(1) };
}

export function suggestMapping(header: string[]): Mapping {
  const out = Object.fromEntries(FIELDS.map((f) => [f, null])) as Mapping;
  const used = new Set<number>();
  const hk = header.map(key);
  const cands: { f: Field; i: number; score: number }[] = [];
  for (const f of FIELDS) hk.forEach((h, i) => { for (const s of SYN[f]) { const k = key(s); if (h === k) cands.push({ f, i, score: 2 }); else if (k.length > 2 && h.includes(k)) cands.push({ f, i, score: 1 }); } });
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands) if (out[c.f] === null && !used.has(c.i)) { out[c.f] = c.i; used.add(c.i); }
  return out;
}

export type RowStatus = 'ok' | 'fixed' | 'review' | 'duplicate' | 'invalid';
export type ProcessedRow = { row_number: number; raw: string[]; normalized: CleanProperty | null; status: RowStatus; issues: (Issue & { level: 'error' | 'warning' | 'fix' })[] };

export function processRows(rows: string[][], mapping: Mapping, geo: Geo, existingKeys: Set<string>): ProcessedRow[] {
  const seen = new Set<string>();
  return rows.map((cells, idx) => {
    const raw: Record<string, unknown> = {};
    for (const f of FIELDS) { const i = mapping[f]; if (i !== null && i !== undefined) raw[f] = cells[i] ?? ''; }
    const r = cleanProperty(raw, geo);
    const issues = [...r.errors.map((x) => ({ ...x, level: 'error' as const })), ...r.warnings.map((x) => ({ ...x, level: 'warning' as const })), ...r.fixes.map((x) => ({ ...x, level: 'fix' as const }))];
    let status: RowStatus;
    if (!r.value) status = 'invalid';
    else {
      const k = dedupeKey(r.value);
      if (existingKeys.has(k)) { status = 'duplicate'; issues.push({ code: 'duplicate_existing', message: 'يطابق عقارًا موجودًا في بياناتك', level: 'warning' }); }
      else if (seen.has(k)) { status = 'duplicate'; issues.push({ code: 'duplicate_in_file', message: 'مكرر داخل الملف نفسه', level: 'warning' }); }
      else { seen.add(k); status = r.warnings.length ? 'review' : r.fixes.length ? 'fixed' : 'ok'; }
    }
    return { row_number: idx + 2, raw: cells, normalized: r.value, status, issues };
  });
}

export const summarize = (rows: { status: string }[]) => {
  const s = { total: rows.length, ok: 0, fixed: 0, review: 0, duplicate: 0, invalid: 0 };
  for (const r of rows) if (r.status in s) (s as Record<string, number>)[r.status]++;
  return s;
};
