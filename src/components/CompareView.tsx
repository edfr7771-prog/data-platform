'use client';
import { useEffect, useState } from 'react';
import { FIELDS, formatValue } from '@/lib/property-schema';
import { DEAL_AR, fmt, TYPE_AR } from './labels';

type Summary = { n: number; sufficient: boolean; median: number | null };
type Est = { ok: true; level: 'district' | 'city'; n: number; estimate: number; low: number; high: number } | { ok: false; n_district: number; n_city: number };
type Item = { id: string; kind_label: string | null; type: string; deal: string; district_name: string | null; area_sqm: number; price: number; unit_price: number | null; attributes: Record<string, unknown>; notes: string | null; district_ppm: Summary; estimate: Est | null };

/** مقارنة جنبًا إلى جنب: الحقول المشتركة، ثم كل حقل منظم يذكره عقار واحد على الأقل (الفارغ «—» لا يُخترع) */
export function CompareView({ ids }: { ids: string[] }) {
  const [items, setItems] = useState<Item[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`/api/compare?ids=${ids.join(',')}`).then((r) => r.json()).then((d) => (d.ok ? setItems(d.items) : setErr(d.error === 'need_2_to_4' ? 'اختر من 2 إلى 4 عقارات من صفحة العقارات.' : 'تعذّرت المقارنة.'))).catch(() => setErr('تعذّرت المقارنة.'));
  }, [ids]);
  if (err) return <div role="alert" className="note err">{err}</div>;
  if (!items) return <p className="muted">جارٍ التحميل…</p>;
  const keys = Object.keys(FIELDS).filter((k) => items.some((i) => i.attributes[k] !== undefined && i.attributes[k] !== null));
  const unit = (i: Item) => (i.deal === 'rent' ? 'ريال/م² سنويًا' : 'ريال/م²');
  const est = (i: Item) => !i.estimate ? '—' : i.estimate.ok ? `${fmt(i.estimate.estimate)} (${fmt(i.estimate.low)} – ${fmt(i.estimate.high)})، من ${i.estimate.n} مقارنات في ${i.estimate.level === 'district' ? 'الحي' : 'المدينة'}` : `بيانات غير كافية (الحي ${i.estimate.n_district}، المدينة ${i.estimate.n_city})`;
  const rows: [string, (i: Item) => React.ReactNode][] = [
    ['النوع', (i) => i.kind_label ?? TYPE_AR[i.type] ?? i.type], ['العملية', (i) => DEAL_AR[i.deal] ?? i.deal], ['الحي', (i) => i.district_name ?? '—'],
    ['المساحة م²', (i) => fmt(i.area_sqm)], ['السعر', (i) => fmt(i.price)], ['سعر المتر', (i) => (i.unit_price ? `${fmt(i.unit_price)} ${unit(i)}` : '—')],
    ['وسيط الحي (النوع نفسه)', (i) => (i.district_ppm.sufficient ? `${fmt(i.district_ppm.median)} (عينة ${i.district_ppm.n})` : `عينة غير كافية (${i.district_ppm.n})`)],
    ['مقابل وسيط الحي', (i) => (i.unit_price && i.district_ppm.sufficient && i.district_ppm.median ? `${i.unit_price >= i.district_ppm.median ? '+' : ''}${Math.round(((i.unit_price - i.district_ppm.median) / i.district_ppm.median) * 100)}%` : '—')],
    ['التقدير من المقارنات', est],
    ...keys.map((k): [string, (i: Item) => React.ReactNode] => [FIELDS[k].label, (i) => (i.attributes[k] === undefined || i.attributes[k] === null ? '—' : formatValue(FIELDS[k], i.attributes[k] as never))]),
    ['ملاحظات إضافية', (i) => i.notes ?? '—'],
  ];
  return (
    <div className="twrap" role="region" aria-label="مقارنة العقارات" tabIndex={0}>
      <table>
        <thead><tr><th>البند</th>{items.map((i, n) => <th key={i.id}>العقار {n + 1}</th>)}</tr></thead>
        <tbody>{rows.map(([label, f]) => <tr key={label}><th scope="row" style={{ background: '#F6F9FC' }}>{label}</th>{items.map((i) => <td key={i.id}>{f(i)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
