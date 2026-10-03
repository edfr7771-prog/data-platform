'use client';
import { useState } from 'react';

type Issue = { field?: string; message: string };
type Row = { row_number: number; raw: Record<string, string>; status: string; issues: Issue[] };
type Summary = { total: number; new: number; update: number; duplicate: number; invalid: number; header: string[] };
const ST: Record<string, [string, string]> = { new: ['جديد', 'b-imported'], update: ['تحديث عميل موجود', 'b-ok'], duplicate: ['مكرر في الملف', 'b-duplicate'], invalid: ['غير صالح', 'b-invalid'] };

/** استيراد العملاء: رفع ← معاينة كل صف وسبب رفضه ← موافقة ← تقرير. لا يُدخل شيء قبل الموافقة. */
export function ContactsImport() {
  const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [prev, setPrev] = useState<{ id: string; summary: Summary; rows: Row[] } | null>(null); const [filter, setFilter] = useState('');
  const [report, setReport] = useState<{ created: number; updated: number; skipped: number; problems: { row_number: number; issues: Issue[] }[] } | null>(null);
  async function upload(e: React.FormEvent) {
    e.preventDefault(); if (!file) { setErr('اختر ملف CSV.'); return; }
    setBusy(true); setErr(''); setPrev(null); setReport(null);
    const fd = new FormData(); fd.append('file', file);
    const d = await fetch('/api/contacts/import', { method: 'POST', body: fd }).then((r) => r.json()).catch(() => ({}));
    setBusy(false);
    if (d.ok) setPrev({ id: d.import.id, summary: d.import.summary, rows: d.rows }); else setErr(d.message ?? (d.error === 'file_too_large' ? 'الملف أكبر من الحد المسموح.' : d.error === 'forbidden' ? 'لا تملك صلاحية الاستيراد.' : 'تعذّرت قراءة الملف.'));
  }
  async function approve() {
    if (!prev) return; setBusy(true); setErr('');
    const d = await fetch(`/api/contacts/import/${prev.id}/approve`, { method: 'POST' }).then((r) => r.json()).catch(() => ({}));
    setBusy(false);
    if (d.ok) setReport(d.report); else setErr(d.error === 'already_processed' ? 'هذا الاستيراد اعتُمد من قبل.' : 'تعذّرت الموافقة.');
  }
  const s = prev?.summary; const rows = prev?.rows.filter((r) => !filter || r.status === filter) ?? [];
  return (
    <div className="stack" style={{ gap: 18 }}>
      <form className="panel stack" onSubmit={upload} aria-label="رفع ملف العملاء">
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>أعمدة مقبولة: الاسم (مطلوب)، الجوال أو البريد (أحدهما مطلوب)، المدينة، نوع العميل، ملاحظات. تُوحَّد الأرقام والبريد ويُمنع التكرار بالجوال أو البريد.</p>
        <label className="field"><span>ملف CSV (UTF-8)</span><input className="input" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <div><button className="btn" disabled={busy}>{busy && !prev ? 'جارٍ الفحص…' : 'معاينة'}</button></div>
      </form>
      {err && <div role="alert" className="note err">{err}</div>}
      {s && !report && (
        <section className="panel stack" aria-label="المعاينة">
          <h2 style={{ fontSize: 20 }}>المعاينة ({s.total} صف)</h2>
          <div className="tabs" role="tablist" aria-label="تصفية الصفوف">
            <button type="button" role="tab" aria-selected={filter === ''} onClick={() => setFilter('')}>الكل {s.total}</button>
            {(['new', 'update', 'duplicate', 'invalid'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>{ST[k][0]} {s[k]}</button>)}
          </div>
          <div className="cards">
            {rows.map((r) => (
              <article key={r.row_number} className="card">
                <div className="meta"><strong>صف {r.row_number}</strong><span className={`badge ${ST[r.status]?.[1] ?? 'b-duplicate'}`}>{ST[r.status]?.[0] ?? r.status}</span></div>
                <div className="meta" style={{ wordBreak: 'break-word' }}>{Object.values(r.raw).filter(Boolean).slice(0, 4).map((v, i) => <span key={i} dir="auto">{v}</span>)}</div>
                {r.issues.length > 0 && <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 14, color: r.status === 'invalid' ? 'var(--red)' : undefined }}>{r.issues.map((x, i) => <li key={i}>{x.message}</li>)}</ul>}
              </article>
            ))}
          </div>
          {prev!.rows.length < s.total && <p className="muted">تُعرض أول {prev!.rows.length} صفًا فقط؛ الملخص يشمل كل الصفوف.</p>}
          <div className="row" style={{ alignItems: 'center' }}>
            <button type="button" className="btn gold" disabled={busy || s.new + s.update === 0} onClick={approve}>اعتماد {s.new} جديد و{s.update} تحديث</button>
            <span className="muted" style={{ fontSize: 14 }}>المكرر وغير الصالح يُتجاوز ويظهر في التقرير.</span>
          </div>
        </section>
      )}
      {report && (
        <section className="panel stack" aria-label="تقرير الاستيراد">
          <div role="status" className="note ok">اكتمل الاستيراد: {report.created} عميل جديد، {report.updated} تحديث، {report.skipped} متجاوز.</div>
          {report.problems.length > 0 && (
            <>
              <h2 style={{ fontSize: 18 }}>تقرير الأخطاء</h2>
              <ul style={{ paddingInlineStart: 20, margin: 0 }}>{report.problems.map((p) => <li key={p.row_number}>صف {p.row_number}: {p.issues.map((x) => x.message).join('، ') || 'مكرر'}</li>)}</ul>
            </>
          )}
          <div><a className="btn" href="/app/contacts">إلى العملاء</a></div>
        </section>
      )}
    </div>
  );
}
