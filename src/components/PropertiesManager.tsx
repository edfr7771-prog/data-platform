'use client';
import { useCallback, useEffect, useState } from 'react';
import { DEAL_AR, fmt, STATUS_AR, TYPE_AR, USAGE_AR } from './labels';

type Prop = { id: string; type: string; deal: string; usage: string; district_name: string | null; location: string | null; area_sqm: number; price: number; price_per_sqm: number | null; age_years: number | null; rooms: number | null; status: string };
type Issue = { code: string; field?: string; message: string };
type District = { id: string; name_ar: string };

const empty = { type: 'villa', deal: 'sale', usage: '', district_id: '', area_sqm: '', price: '', age_years: '', rooms: '', location: '', notes: '' };

export function PropertiesManager({ districts, canWrite, canDelete, canExport }: { districts: District[]; canWrite: boolean; canDelete: boolean; canExport: boolean }) {
  const [items, setItems] = useState<Prop[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true);
  const [f, setF] = useState(empty); const [errs, setErrs] = useState<Issue[]>([]); const [info, setInfo] = useState<Issue[]>([]); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const pageSize = 25;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    const r = await fetch(`/api/properties?page=${p}&pageSize=${pageSize}`); const d = await r.json().catch(() => ({}));
    if (d.ok) { setItems(d.items); setTotal(d.total); } else setMsg('تعذّر تحميل العقارات.');
    setLoading(false);
  }, []);
  useEffect(() => { void load(page); }, [load, page]);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErrs([]); setInfo([]); setMsg('');
    const body: Record<string, unknown> = { ...f }; for (const k of Object.keys(body)) if (body[k] === '') delete body[k];
    const r = await fetch('/api/properties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({})); setBusy(false);
    if (d.ok) { setF(empty); setInfo([...(d.warnings ?? []), ...(d.fixes ?? [])]); setMsg('تمت إضافة العقار. سعر المتر يُحسب تلقائيًا.'); setPage(1); void load(1); }
    else if (d.errors) setErrs(d.errors); else setMsg(d.error === 'forbidden' ? 'لا تملك صلاحية الإضافة.' : 'تعذّرت الإضافة.');
  }
  async function del(id: string) {
    if (!window.confirm('حذف هذا العقار؟ يبقى أثره في سجل التدقيق.')) return;
    const r = await fetch(`/api/properties/${id}`, { method: 'DELETE' }); const d = await r.json().catch(() => ({}));
    if (d.ok) void load(page); else setMsg(d.error === 'forbidden' ? 'لا تملك صلاحية الحذف.' : 'تعذّر الحذف.');
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="stack" style={{ gap: 22 }}>
      {canWrite && (
        <form className="panel stack" onSubmit={add} noValidate aria-label="إضافة عقار">
          <h2 style={{ fontSize: 20 }}>إضافة عقار</h2>
          <div className="row">
            <label className="field"><span>النوع</span><select className="input" value={f.type} onChange={(e) => set('type', e.target.value)}>{Object.entries(TYPE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field"><span>بيع / إيجار</span><select className="input" value={f.deal} onChange={(e) => set('deal', e.target.value)}>{Object.entries(DEAL_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field"><span>الاستخدام</span><select className="input" value={f.usage} onChange={(e) => set('usage', e.target.value)}><option value="">تلقائي</option>{Object.entries(USAGE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field"><span>الحي</span><select className="input" value={f.district_id} onChange={(e) => set('district_id', e.target.value)}><option value="">—</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}</select></label>
          </div>
          <div className="row">
            <label className="field"><span>المساحة (م²)</span><input className="input" dir="ltr" inputMode="decimal" value={f.area_sqm} onChange={(e) => set('area_sqm', e.target.value)} required /></label>
            <label className="field"><span>السعر (ريال)</span><input className="input" dir="ltr" inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} required /></label>
            <label className="field"><span>العمر (سنوات)</span><input className="input" dir="ltr" inputMode="numeric" value={f.age_years} onChange={(e) => set('age_years', e.target.value)} /></label>
            <label className="field"><span>الغرف</span><input className="input" dir="ltr" inputMode="numeric" value={f.rooms} onChange={(e) => set('rooms', e.target.value)} /></label>
          </div>
          <label className="field"><span>الموقع (اختياري)</span><input className="input" value={f.location} onChange={(e) => set('location', e.target.value)} /></label>
          <div aria-live="polite" className="stack" style={{ gap: 8 }}>
            {errs.length > 0 && <div role="alert" className="note err"><b>يلزم تصحيح:</b><ul style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>{errs.map((x, i) => <li key={i}>{x.message}</li>)}</ul></div>}
            {info.length > 0 && <div className="note"><ul style={{ margin: 0, paddingInlineStart: 20 }}>{info.map((x, i) => <li key={i}>{x.message}</li>)}</ul></div>}
            {msg && <div className="note ok">{msg}</div>}
          </div>
          <div><button className="btn gold" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'إضافة العقار'}</button></div>
        </form>
      )}

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
                <td>{TYPE_AR[p.type] ?? p.type}</td><td>{DEAL_AR[p.deal] ?? p.deal}</td><td>{p.district_name ?? p.location ?? '—'}</td>
                <td dir="ltr">{fmt(p.area_sqm)}</td><td dir="ltr">{fmt(p.price)}</td><td dir="ltr">{fmt(p.price_per_sqm)}</td><td dir="ltr">{p.age_years ?? '—'}</td><td>{STATUS_AR[p.status] ?? p.status}</td>
                {canDelete && <td><button className="btn danger sm" onClick={() => del(p.id)} aria-label={`حذف ${TYPE_AR[p.type] ?? p.type}`}>حذف</button></td>}
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
