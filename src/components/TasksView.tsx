'use client';
import { useCallback, useEffect, useState } from 'react';
import { TASK_PRIORITIES } from '@/lib/crm-rules';
import { fromLocalInput, when } from './crm-labels';

type Task = { id: string; title: string; customer_id: string | null; customer_name: string | null; assignee_id: string | null; assignee_name: string | null; due_at: string | null; priority: string; status: string; notes: string | null; completed_at: string | null };
type Member = { id: string; full_name: string | null };
const VIEWS = [{ v: 'today', l: 'اليوم' }, { v: 'overdue', l: 'المتأخرة' }, { v: 'upcoming', l: 'القادمة' }, { v: 'done', l: 'المكتملة' }] as const;
const PRI: Record<string, string> = { low: 'b-duplicate', normal: 'b-ok', high: 'b-review', urgent: 'b-invalid' };
const line = { color: 'var(--ink)', borderColor: '#8FA3C0' } as const;

/** المهام بعروض الرياض (اليوم/المتأخرة/القادمة/المكتملة) مع العدّ، والإنجاز وإعادة الفتح، وإنشاء مهمة */
export function TasksView({ members, canWrite, me }: { members: Member[]; canWrite: boolean; me: string }) {
  const [view, setView] = useState<string>('today'); const [who, setWho] = useState('me');
  const [d, setD] = useState<{ items: Task[]; counts: Record<string, number> } | null>(null);
  const [form, setForm] = useState({ title: '', due_at: '', priority: 'normal', assignee_id: me, notes: '' }); const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [errs, setErrs] = useState<{ message: string }[]>([]);
  const load = useCallback(async () => {
    const r = await fetch(`/api/tasks?view=${view}&assignee=${who}`).then((x) => x.json()).catch(() => ({}));
    setD(r.ok ? r : { items: [], counts: {} });
  }, [view, who]);
  useEffect(() => { void load(); }, [load]);
  async function send(method: string, url: string, body: unknown, ok: string) {
    setMsg(null); setErrs([]);
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({}));
    if (r.ok) { setMsg({ ok: true, text: ok }); await load(); return true; }
    if (r.errors) setErrs(r.errors); else setMsg({ ok: false, text: r.error === 'forbidden' ? 'لا تملك صلاحية هذا الإجراء.' : 'تعذّر الحفظ.' });
    return false;
  }
  const now = Date.now();

  return (
    <div className="stack" style={{ gap: 18 }}>
      {canWrite && (
        <section className="panel stack">
          <div><button type="button" className="btn gold" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'إغلاق' : 'مهمة جديدة'}</button></div>
          {open && (
            <form className="stack" noValidate aria-label="مهمة جديدة" onSubmit={async (e) => { e.preventDefault(); const b = { ...form, due_at: fromLocalInput(form.due_at), assignee_id: form.assignee_id || null }; if (await send('POST', '/api/tasks', b, 'أُنشئت المهمة.')) { setForm({ ...form, title: '', due_at: '', notes: '' }); setOpen(false); } }}>
              <label className="field"><span>العنوان *</span><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
              <div className="row">
                <label className="field"><span>الموعد (بتوقيت الرياض)</span><input className="input" type="datetime-local" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} /></label>
                <label className="field"><span>الأولوية</span><select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
                <label className="field"><span>المسند إليه</span><select className="input" value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}><option value="">—</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name ?? '—'}</option>)}</select></label>
              </div>
              <label className="field"><span>ملاحظات</span><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              {errs.length > 0 && <div role="alert" className="note err"><ul style={{ margin: 0, paddingInlineStart: 20 }}>{errs.map((x, i) => <li key={i}>{x.message}</li>)}</ul></div>}
              <div><button className="btn">حفظ المهمة</button></div>
            </form>
          )}
        </section>
      )}
      {msg && <div role="status" className={`note ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      <div className="row" style={{ alignItems: 'end', justifyContent: 'space-between' }}>
        <div className="tabs" role="tablist" aria-label="عرض المهام">
          {VIEWS.map((x) => (
            <button key={x.v} type="button" role="tab" aria-selected={view === x.v} onClick={() => setView(x.v)}>
              {x.l}{(d?.counts[x.v] ?? 0) > 0 && <span className={x.v === 'overdue' ? 'count' : 'badge b-duplicate'} style={{ padding: '0 6px' }}>{d!.counts[x.v]}</span>}
            </button>
          ))}
        </div>
        <label className="field" style={{ maxWidth: 260 }}><span>مهام</span><select className="input" value={who} onChange={(e) => setWho(e.target.value)}><option value="me">مهامي</option><option value="all">كل الفريق</option>{members.filter((m) => m.id !== me).map((m) => <option key={m.id} value={m.id}>{m.full_name ?? '—'}</option>)}</select></label>
      </div>

      {!d && <p className="muted">جارٍ التحميل…</p>}
      {d && !d.items.length && <p className="muted">لا مهام في هذا العرض.</p>}
      <div className="cards">
        {d?.items.map((t) => {
          const late = t.due_at && new Date(t.due_at).getTime() < now && (t.status === 'open' || t.status === 'in_progress');
          return (
            <article key={t.id} className="card">
              <h3 style={{ textDecoration: t.status === 'done' ? 'line-through' : undefined }}>{t.title}</h3>
              <div className="meta"><span className={`badge ${PRI[t.priority] ?? 'b-ok'}`}>{TASK_PRIORITIES.find((p) => p.value === t.priority)?.label}</span>{t.status === 'cancelled' && <span className="badge b-duplicate">ملغاة</span>}{t.status === 'in_progress' && <span className="badge b-ok">قيد التنفيذ</span>}</div>
              <div className="meta" style={{ color: late ? 'var(--red)' : undefined }}><span>الموعد: {t.due_at ? when(t.due_at) : 'بلا موعد'}</span>{late && <strong>متأخرة</strong>}</div>
              <div className="meta">{t.customer_id && <a href={`/app/contacts/${t.customer_id}`}>{t.customer_name}</a>}<span>المسند إليه: {t.assignee_name ?? '—'}</span></div>
              {t.notes && <p className="muted" style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{t.notes}</p>}
              {canWrite && (
                <div className="row" style={{ gap: 8 }}>
                  {t.status === 'done' || t.status === 'cancelled'
                    ? <button type="button" className="btn line sm" style={line} onClick={() => send('PATCH', `/api/tasks/${t.id}`, { status: 'open' }, 'أُعيد فتح المهمة.')}>إعادة فتح</button>
                    : <>
                        <button type="button" className="btn sm" onClick={() => send('PATCH', `/api/tasks/${t.id}`, { status: 'done' }, 'أُنجزت المهمة.')}>إنجاز</button>
                        {t.status === 'open' && <button type="button" className="btn line sm" style={line} onClick={() => send('PATCH', `/api/tasks/${t.id}`, { status: 'in_progress' }, 'بدأ تنفيذ المهمة.')}>بدء</button>}
                        <button type="button" className="btn line sm" style={line} onClick={() => send('PATCH', `/api/tasks/${t.id}`, { status: 'cancelled' }, 'أُلغيت المهمة.')}>إلغاء</button>
                      </>}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
