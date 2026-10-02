'use client';
import { useCallback, useEffect, useState } from 'react';
import { getKind } from '@/lib/property-schema';
import { DEAL_AR, fmt, STATUS_AR, TYPE_AR } from './labels';
import { PropertyEntry } from './PropertyEntry';

type Prop = { id: string; type: string; kind: string | null; description: string | null; deal: string; usage: string; district_name: string | null; location: string | null; area_sqm: number; price: number; price_per_sqm: number | null; age_years: number | null; rooms: number | null; status: string };
type District = { id: string; city_id: string; name_ar: string };
type City = { id: string; name_ar: string };

export function PropertiesManager({ cities, districts, canWrite, canDelete, canExport }: { cities: City[]; districts: District[]; canWrite: boolean; canDelete: boolean; canExport: boolean }) {
  const [items, setItems] = useState<Prop[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const pageSize = 25;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    const r = await fetch(`/api/properties?page=${p}&pageSize=${pageSize}`); const d = await r.json().catch(() => ({}));
    if (d.ok) { setItems(d.items); setTotal(d.total); } else setMsg('تعذّر تحميل العقارات.');
    setLoading(false);
  }, []);
  useEffect(() => { void load(page); }, [load, page]);

  async function del(id: string) {
    if (!window.confirm('حذف هذا العقار؟ يبقى أثره في سجل التدقيق.')) return;
    const r = await fetch(`/api/properties/${id}`, { method: 'DELETE' }); const d = await r.json().catch(() => ({}));
    if (d.ok) void load(page); else setMsg(d.error === 'forbidden' ? 'لا تملك صلاحية الحذف.' : 'تعذّر الحذف.');
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="stack" style={{ gap: 22 }}>
      {canWrite && <PropertyEntry cities={cities} districts={districts} onPublished={() => { setPage(1); void load(1); }} />}
      {msg && <div role="alert" className="note err">{msg}</div>}

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 20 }}>العقارات ({fmt(total)})</h2>
        {canExport && <a className="btn line sm" style={{ color: 'var(--ink)', borderColor: '#8FA3C0' }} href="/api/properties/export">تصدير CSV</a>}
      </div>
      <div className="twrap" role="region" aria-label="جدول العقارات" tabIndex={0}>
        <table>
          <thead><tr><th>النوع</th><th>الصفقة</th><th>الحي</th><th>المساحة م²</th><th>السعر</th><th>سعر المتر</th><th>العمر</th><th>الحالة</th>{canDelete && <th><span className="sr-only">إجراء</span></th>}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="muted">جارٍ التحميل…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={9} className="muted">لا عقارات بعد. أضف عقارًا أو استورد ملف CSV من صفحة الاستيراد.</td></tr>}
            {items.map((p) => (
              <tr key={p.id}>
                <td>{(p.kind && getKind(p.kind)?.label) ?? TYPE_AR[p.type] ?? p.type}{p.description && <details><summary className="muted" style={{ fontSize: 13 }}>الوصف</summary><p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontSize: 14 }}>{p.description}</p></details>}</td><td>{DEAL_AR[p.deal] ?? p.deal}</td><td>{p.district_name ?? p.location ?? '—'}</td>
                <td dir="ltr">{fmt(p.area_sqm)}</td><td dir="ltr">{fmt(p.price)}</td><td dir="ltr">{fmt(p.price_per_sqm)}</td><td dir="ltr">{p.age_years ?? '—'}</td><td>{STATUS_AR[p.status] ?? p.status}</td>
                {canDelete && <td><button className="btn danger sm" onClick={() => del(p.id)} aria-label={`حذف ${(p.kind && getKind(p.kind)?.label) ?? TYPE_AR[p.type] ?? p.type}`}>حذف</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button className="btn line sm" style={{ color: 'var(--ink)', borderColor: '#8FA3C0' }} disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</button>
        <span className="muted">صفحة {page} من {pages}</span>
        <button className="btn line sm" style={{ color: 'var(--ink)', borderColor: '#8FA3C0' }} disabled={page >= pages} onClick={() => setPage(page + 1)}>التالي</button>
      </div>
    </div>
  );
}
