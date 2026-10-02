'use client';
import { useState } from 'react';
import { FIELD_AR, fmt, ROW_AR } from './labels';

type Row = { row_number: number; raw: string[]; status: string; issues: { message: string; level: string }[] };
type Imp = { id: string; filename: string; status: string; header: string[]; mapping: Record<string, number | null>; summary: Record<string, number | unknown> };
type Report = { total: number; imported: number; imported_fixed: number; imported_review: number; review_skipped: number; duplicates_ignored: number; invalid_skipped: number };
const ERR: Record<string, string> = { file_required: 'اختر ملف CSV أولًا.', file_too_large: 'الملف أكبر من الحد المسموح.', invalid_file: 'الملف غير صالح.', forbidden: 'لا تملك صلاحية الاستيراد.', already_processed: 'اعتُمد هذا الاستيراد سابقًا.', unauthenticated: 'انتهت الجلسة.' };

export function ImportWizard() {
  const [imp, setImp] = useState<Imp | null>(null); const [rows, setRows] = useState<Row[]>([]); const [map, setMap] = useState<Record<string, number | null>>({});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [report, setReport] = useState<Report | null>(null); const [inc, setInc] = useState(false);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setReport(null);
    const file = (e.currentTarget.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!file) { setErr(ERR.file_required); return; }
    setBusy(true); const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/api/imports', { method: 'POST', body: fd }); const d = await r.json().catch(() => ({})); setBusy(false);
    if (d.ok) { setImp(d.import); setRows(d.rows); setMap(d.import.mapping); } else setErr(d.message ?? ERR[d.error] ?? 'تعذّر رفع الملف.');
  }
  async function remap() {
    if (!imp) return; setBusy(true); setErr('');
    const r = await fetch(`/api/imports/${imp.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapping: map }) }); const d = await r.json().catch(() => ({}));
    if (d.ok) { const g = await (await fetch(`/api/imports/${imp.id}?limit=100`)).json(); setImp({ ...imp, mapping: map, summary: d.summary }); setRows(g.rows ?? []); } else setErr(ERR[d.error] ?? 'تعذّر تطبيق التطابق.');
    setBusy(false);
  }
  async function approve() {
    if (!imp) return; setBusy(true); setErr('');
    const r = await fetch(`/api/imports/${imp.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ include_review: inc }) }); const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (d.ok) { setReport(d.report); setImp({ ...imp, status: 'approved' }); } else setErr(ERR[d.error] ?? 'تعذّر الاعتماد.');
  }
  const s = (imp?.summary ?? {}) as Record<string, number>;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <form className="panel stack" onSubmit={upload} aria-label="رفع ملف">
        <h2 style={{ fontSize: 20 }}>1. رفع الملف</h2>
        <p className="muted" style={{ margin: 0 }}>يُقبل CSV (UTF-8 أو ترميز Excel العربي). Excel بصيغة xlsx غير مدعوم بعد: احفظه CSV. لا يدخل أي عقار قبل موافقتك.</p>
        <label className="field"><span>ملف CSV</span><input className="input" type="file" name="file" accept=".csv,text/csv" /></label>
        <div><button className="btn gold" disabled={busy}>{busy ? 'جارٍ الفحص…' : 'رفع ومعاينة'}</button></div>
      </form>
      <div aria-live="polite">{err && <div role="alert" className="note err">{err}</div>}</div>

      {imp && !report && (
        <>
          <div className="panel stack">
            <h2 style={{ fontSize: 20 }}>2. نتيجة الفحص: {imp.filename}</h2>
            <div className="row" style={{ alignItems: 'center' }}>
              <span className="badge b-ok">سليم {fmt(s.ok)}</span><span className="badge b-fixed">مُصحَّح {fmt(s.fixed)}</span><span className="badge b-review">مراجعة {fmt(s.review)}</span>
              <span className="badge b-duplicate">مكرر {fmt(s.duplicate)}</span><span className="badge b-invalid">غير صالح {fmt(s.invalid)}</span><span className="muted">من {fmt(s.total)} صفًا</span>
            </div>
            <h3 style={{ fontSize: 17, marginTop: 6 }}>تطابق الأعمدة</h3>
            <div className="grid">
              {Object.keys(FIELD_AR).map((k) => (
                <label className="field" key={k}><span>{FIELD_AR[k]}</span>
                  <select className="input" value={map[k] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value === '' ? null : Number(e.target.value) }))}>
                    <option value="">— بلا —</option>{imp.header.map((h, i) => <option key={i} value={i}>{h || `عمود ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div><button className="btn sm" onClick={remap} disabled={busy}>تطبيق التطابق وإعادة الفحص</button></div>
          </div>

          <div className="twrap" role="region" aria-label="معاينة الصفوف" tabIndex={0}>
            <table><thead><tr><th>الصف</th><th>الحالة</th><th>البيانات الأصلية</th><th>الملاحظات</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.row_number}><td dir="ltr">{r.row_number}</td><td><span className={`badge b-${r.status}`}>{ROW_AR[r.status] ?? r.status}</span></td>
                  <td dir="auto" style={{ maxWidth: 360 }}>{r.raw.join(' | ').slice(0, 140)}</td>
                  <td>{r.issues.length ? <ul style={{ margin: 0, paddingInlineStart: 18 }}>{r.issues.map((x, i) => <li key={i}>{x.message}</li>)}</ul> : '—'}</td></tr>))}</tbody></table>
          </div>
          <p className="muted" style={{ margin: 0 }}>تُعرض أول 100 صف. البيانات الأصلية لا تتغير أبدًا؛ التصحيحات مسجَّلة بجانب كل صف.</p>

          <div className="panel stack">
            <h2 style={{ fontSize: 20 }}>3. الموافقة والاستيراد</h2>
            <label className="check"><input type="checkbox" checked={inc} onChange={(e) => setInc(e.target.checked)} /><span>أُدخل صفوف «مراجعة» أيضًا (غير ذلك تُتجاوز). المكررة وغير الصالحة لا تُدخل أبدًا.</span></label>
            <div><button className="btn gold" onClick={approve} disabled={busy}>{busy ? 'جارٍ الاستيراد…' : 'اعتماد الاستيراد'}</button></div>
          </div>
        </>
      )}

      {report && (
        <div className="panel stack" role="status">
          <h2 style={{ fontSize: 20 }}>4. التقرير النهائي</h2>
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            <li>تم استيراد <b>{fmt(report.imported)}</b> عقارًا (منها {fmt(report.imported_fixed)} مُصحَّح و{fmt(report.imported_review)} من المراجعة)</li>
            <li>يوجد <b>{fmt(report.review_skipped)}</b> يحتاج مراجعة وتُجوِّز</li>
            <li>تم تجاهل <b>{fmt(report.duplicates_ignored)}</b> مكرر</li>
            <li>تم تجاوز <b>{fmt(report.invalid_skipped)}</b> غير صالح</li>
          </ul>
          <div><a className="btn sm" href="/app/properties">عرض العقارات</a></div>
        </div>
      )}
    </div>
  );
}
