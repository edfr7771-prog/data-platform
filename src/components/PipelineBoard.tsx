'use client';
import { useCallback, useEffect, useState } from 'react';
import { day } from './crm-labels';
import { fmt } from './labels';

type Opp = { id: string; title: string; status: string; value: string | null; updated_at: string; stage_id: string; customer_id: string; customer_name: string; owner_name: string | null; request_title: string | null };
type Stage = { id: string; key: string; label: string; position: number; kind: string; archived_at: string | null; opportunities: Opp[] };
type Member = { id: string; full_name: string | null };
const line = { color: 'var(--ink)', borderColor: '#8FA3C0' } as const;
const ERR: Record<string, string> = { forbidden: 'لا تملك صلاحية هذا الإجراء.', stage_has_open_opportunities: 'لا تُؤرشف مرحلة فيها فرص مفتوحة؛ انقل الفرص أولًا.', label_invalid: 'اسم المرحلة مطلوب (60 حرفًا كحد أقصى).' };

/** لوحة الـPipeline: أعمدة أفقية على الشاشات الواسعة وتتراص عموديًا على الجوال. النقل بقائمة اختيار (يعمل باللمس ولوحة المفاتيح). */
export function PipelineBoard({ members, canWrite, canManage }: { members: Member[]; canWrite: boolean; canManage: boolean }) {
  const [stages, setStages] = useState<Stage[] | null>(null); const [owner, setOwner] = useState(''); const [closed, setClosed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [newStage, setNewStage] = useState(''); const [edit, setEdit] = useState(false);
  const [all, setAll] = useState<Omit<Stage, 'opportunities'>[]>([]);
  const load = useCallback(async () => {
    const sp = new URLSearchParams(); if (owner) sp.set('owner_id', owner); if (closed) sp.set('include_closed', '1');
    const d = await fetch(`/api/opportunities?${sp}`).then((r) => r.json()).catch(() => ({}));
    setStages(d.ok ? d.stages : []);
    if (canManage) { const s = await fetch('/api/crm/stages?archived=1').then((r) => r.json()).catch(() => ({})); if (s.ok) setAll(s.items); }
  }, [owner, closed, canManage]);
  useEffect(() => { void load(); }, [load]);
  async function send(method: string, url: string, body: unknown, ok: string) {
    setMsg(null);
    const d = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({}));
    setMsg(d.ok ? { ok: true, text: ok } : { ok: false, text: ERR[d.error] ?? 'تعذّر الحفظ.' });
    if (d.ok) await load();
    return !!d.ok;
  }
  const total = stages?.reduce((n, s) => n + s.opportunities.length, 0) ?? 0;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="panel stack" aria-label="فلترة">
        <div className="row" style={{ alignItems: 'end' }}>
          <label className="field"><span>المسؤول</span><select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">الكل</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name ?? '—'}</option>)}</select></label>
          <div className="seg"><label><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />إظهار المغلقة</label></div>
          {canManage && <button type="button" className="btn line sm" style={line} aria-expanded={edit} onClick={() => setEdit(!edit)}>{edit ? 'إغلاق إدارة المراحل' : 'إدارة المراحل'}</button>}
        </div>
        {msg && <div role="status" className={`note ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
      </section>

      {canManage && edit && (
        <section className="panel stack" aria-label="إدارة المراحل">
          <h2 style={{ fontSize: 18 }}>المراحل</h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>المراحل قابلة للإضافة وإعادة التسمية والترتيب والأرشفة. الأرشفة لا تحذف السجل التاريخي.</p>
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 8 }}>
            {all.map((s, i) => (
              <li key={s.id} className="row" style={{ alignItems: 'center', gap: 8, opacity: s.archived_at ? 0.6 : 1 }}>
                <input aria-label={`اسم المرحلة ${s.label}`} className="input" style={{ flex: '1 1 160px' }} defaultValue={s.label} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.label) void send('PATCH', `/api/crm/stages/${s.id}`, { label: v }, 'حُدّث اسم المرحلة.'); }} />
                <button type="button" className="btn line sm" style={line} aria-label={`رفع ${s.label}`} disabled={i === 0} onClick={() => send('PATCH', `/api/crm/stages/${s.id}`, { position: i }, 'أُعيد الترتيب.')}>↑</button>
                <button type="button" className="btn line sm" style={line} aria-label={`خفض ${s.label}`} disabled={i === all.length - 1} onClick={() => send('PATCH', `/api/crm/stages/${s.id}`, { position: i + 2 }, 'أُعيد الترتيب.')}>↓</button>
                {s.kind === 'open' && <button type="button" className="btn line sm" style={line} onClick={() => send('PATCH', `/api/crm/stages/${s.id}`, { archived: !s.archived_at }, s.archived_at ? 'أُعيدت المرحلة.' : 'أُرشفت المرحلة.')}>{s.archived_at ? 'استعادة' : 'أرشفة'}</button>}
                {s.kind !== 'open' && <span className="badge b-duplicate">{s.kind === 'won' ? 'إغلاق ناجح' : 'إغلاق خاسر'}</span>}
              </li>
            ))}
          </ul>
          <form className="row" style={{ alignItems: 'end' }} onSubmit={async (e) => { e.preventDefault(); if (await send('POST', '/api/crm/stages', { label: newStage }, 'أُضيفت المرحلة.')) setNewStage(''); }}>
            <label className="field"><span>مرحلة جديدة</span><input className="input" value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="مثل: بانتظار التمويل" /></label>
            <div><button className="btn">إضافة</button></div>
          </form>
        </section>
      )}

      <h2 style={{ fontSize: 20 }}>الفرص ({fmt(total)})</h2>
      {!stages && <p className="muted">جارٍ التحميل…</p>}
      {stages && total === 0 && <p className="muted">لا فرص بعد. تُنشأ الفرصة عند ربط طلب بعميل أو وصول استفسار.</p>}
      <div className="board">
        {stages?.map((s) => (
          <section key={s.id} className="col" aria-label={s.label}>
            <h3><span>{s.label}</span><span className="muted">{s.opportunities.length}</span></h3>
            {s.opportunities.map((o) => (
              <article key={o.id} className="card">
                <a className="title" href={`/app/contacts/${o.customer_id}`}>{o.customer_name}</a>
                <div className="meta"><span>{o.title}</span></div>
                {o.request_title && <div className="meta"><span className="muted">{o.request_title}</span></div>}
                <div className="meta"><span>المسؤول: {o.owner_name ?? '—'}</span><span>{day(o.updated_at)}</span>{o.value && <span>{fmt(Number(o.value))} ر.س</span>}</div>
                {o.status !== 'open' && <span className="badge b-duplicate">{o.status === 'won' ? 'مغلقة بنجاح' : 'مغلقة'}</span>}
                {canWrite && o.status === 'open' && (
                  <label className="field"><span>نقل إلى</span>
                    <select className="input" value={s.key} onChange={(e) => send('PATCH', `/api/opportunities/${o.id}`, { stage_key: e.target.value }, `نُقلت فرصة ${o.customer_name}.`)}>
                      {stages.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                  </label>
                )}
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
