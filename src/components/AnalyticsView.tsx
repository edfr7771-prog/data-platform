'use client';
import { useEffect, useState } from 'react';
import { kinds } from '@/lib/property-schema';
import { fmt } from './labels';

type Summary = { n: number; sufficient: boolean; median: number | null; p25: number | null; p75: number | null; min: number | null; max: number | null };
type Prices = { market: string; unit: string; overall: Summary; districts: { district_id: string; name: string; summary: Summary }[]; trend: { month: string; summary: Summary }[]; no_district: number };
type District = { district_id: string; name: string; offers: { total: number; sale: number; rent: number; investment: number }; requests: number; sale_ppm: Summary; rent_ppm: Summary; top_kinds: { label: string; n: number }[]; demand_supply: number | null };

/** قيمة الوسيط أو سبب غيابه: لا رقم بلا عينة كافية */
const med = (s: Summary) => (s.sufficient ? <span dir="ltr">{fmt(s.median)}</span> : <span className="muted">عينة غير كافية ({s.n})</span>);

export function AnalyticsView() {
  const [market, setMarket] = useState('sale'); const [kind, setKind] = useState('');
  const [prices, setPrices] = useState<Prices | null>(null); const [districts, setDistricts] = useState<District[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => {
    setPrices(null);
    fetch(`/api/analytics/prices?market=${market}${kind ? `&kind=${kind}` : ''}`).then((r) => r.json()).then((d) => (d.ok ? setPrices(d) : setErr('تعذّر تحميل الأسعار.'))).catch(() => setErr('تعذّر تحميل الأسعار.'));
  }, [market, kind]);
  useEffect(() => {
    fetch('/api/analytics/districts').then((r) => r.json()).then((d) => (d.ok ? setDistricts(d.items) : setErr('تعذّر تحميل الأحياء.'))).catch(() => setErr('تعذّر تحميل الأحياء.'));
  }, []);
  const max = Math.max(1, ...(prices?.districts.map((d) => d.summary.median ?? 0) ?? [1]));

  return (
    <div className="stack" style={{ gap: 22 }}>
      {err && <div role="alert" className="note err">{err}</div>}
      <div className="note">كل الأرقام محسوبة من عقارات مؤسستك النشطة فقط. لا يُعرض وسيط لأي عينة أقل من 3 عقارات.</div>
      <section className="panel stack" aria-labelledby="pi">
        <h2 id="pi" style={{ fontSize: 20 }}>الذكاء السعري</h2>
        <div className="row">
          <label className="field"><span>السوق</span><select className="input" value={market} onChange={(e) => setMarket(e.target.value)}><option value="sale">بيع واستثمار</option><option value="rent">إيجار</option></select></label>
          <label className="field"><span>نوع العقار</span><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">كل الأنواع</option>{kinds().map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
        </div>
        {!prices && <p className="muted">جارٍ الحساب…</p>}
        {prices && (
          <>
            <div className="grid">
              <div className="panel"><div className="muted">وسيط سعر المتر ({prices.unit})</div><b style={{ fontSize: 26 }}>{med(prices.overall)}</b><div className="muted" style={{ fontSize: 14 }}>حجم العينة {fmt(prices.overall.n)}</div></div>
              <div className="panel"><div className="muted">النطاق الأوسط (الربع الأول – الثالث)</div><b style={{ fontSize: 22 }}>{prices.overall.sufficient ? <span dir="ltr">{fmt(prices.overall.p25)} – {fmt(prices.overall.p75)}</span> : '—'}</b></div>
            </div>
            <div className="twrap" role="region" aria-label="أسعار الأحياء" tabIndex={0}>
              <table>
                <thead><tr><th>الحي</th><th>الوسيط</th><th>النطاق الأوسط</th><th>العينة</th><th><span className="sr-only">مقارنة بصرية</span></th></tr></thead>
                <tbody>{prices.districts.map((d) => (
                  <tr key={d.district_id}><td>{d.name}</td><td>{med(d.summary)}</td><td dir="ltr">{d.summary.sufficient ? `${fmt(d.summary.p25)} – ${fmt(d.summary.p75)}` : '—'}</td><td dir="ltr">{d.summary.n}</td>
                    <td style={{ minWidth: 140 }}>{d.summary.sufficient && <div aria-hidden style={{ height: 10, borderRadius: 5, background: 'var(--sky-ink)', width: `${Math.round(((d.summary.median ?? 0) / max) * 100)}%` }} />}</td></tr>
                ))}</tbody>
              </table>
            </div>
            {prices.no_district > 0 && <p className="muted" style={{ margin: 0 }}>{fmt(prices.no_district)} عقار بلا حي لا يدخل جدول الأحياء.</p>}
            <h3 style={{ fontSize: 17 }}>الاتجاه الشهري (حسب تاريخ الإدخال)</h3>
            {!prices.trend.length ? <p className="muted">لا بيانات.</p> : (
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>{prices.trend.map((t) => <li key={t.month}><span dir="ltr">{t.month}</span>: {med(t.summary)} (عينة {t.summary.n})</li>)}</ul>
            )}
          </>
        )}
      </section>
      <section className="panel stack" aria-labelledby="da">
        <h2 id="da" style={{ fontSize: 20 }}>تحليلات الأحياء</h2>
        {!districts && <p className="muted">جارٍ الحساب…</p>}
        {districts && (
          <div className="twrap" role="region" aria-label="تحليلات الأحياء" tabIndex={0}>
            <table>
              <thead><tr><th>الحي</th><th>العروض (بيع/إيجار/استثمار)</th><th>الطلبات المفتوحة</th><th>الطلب ÷ العرض</th><th>وسيط البيع ريال/م²</th><th>وسيط الإيجار ريال/م² سنويًا</th><th>أكثر الأنواع</th></tr></thead>
              <tbody>{districts.map((d) => (
                <tr key={d.district_id}><td>{d.name}</td><td dir="ltr">{d.offers.total} ({d.offers.sale}/{d.offers.rent}/{d.offers.investment})</td><td dir="ltr">{d.requests}</td><td dir="ltr">{d.demand_supply ?? '—'}</td>
                  <td>{med(d.sale_ppm)}</td><td>{med(d.rent_ppm)}</td><td>{d.top_kinds.map((k) => `${k.label} (${k.n})`).join('، ') || '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
