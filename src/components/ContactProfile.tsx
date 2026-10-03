'use client';
import { useCallback, useEffect, useState } from 'react';
import { CALL_OUTCOMES, CONTACT_STATUSES, CUSTOMER_TYPES, MATCH_STATUSES, TASK_PRIORITIES } from '@/lib/crm-rules';
import { getKind } from '@/lib/property-schema';
import { CHANNEL_AR, day, fromLocalInput, localPhone, TL_KIND_AR, toLocalInput, when } from './crm-labels';
import { DEAL_AR, fmt, TYPE_AR } from './labels';

type Row = Record<string, any>;
type Member = { id: string; full_name: string | null };
const line = { color: 'var(--ink)', borderColor: '#8FA3C0' } as const;
const ST: Record<string, [string, string]> = { met: ['متحقق', 'b-imported'], unmet: ['غير متحقق', 'b-invalid'], unknown: ['غير مذكور', 'b-duplicate'] };

export function ContactProfile({ id, members, canWrite, canManage }: { id: string; members: Member[]; canWrite: boolean; canManage: boolean }) {
  const [p, setP] = useState<Row | null>(null); const [tl, setTl] = useState<Row[]>([]); const [more, setMore] = useState(true);
  const [panel, setPanel] = useState<'' | 'call' | 'note' | 'task'>(''); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [errs, setErrs] = useState<Row[]>([]);
  const [call, setCall] = useState({ direction: 'out', outcome: 'answered', occurred_at: toLocalInput(new Date()), notes: '', next_step: '', follow_up_at: '' });
  const [note, setNote] = useState(''); const [task, setTask] = useState({ title: '', due_at: '', priority: 'normal', assignee_id: '', notes: '' });

  const load = useCallback(async () => {
    const d = await fetch(`/api/contacts/${id}`).then((r) => r.json()).catch(() => ({}));
    setP(d.ok ? d : { error: d.error ?? 'error' });
    const t = await fetch(`/api/contacts/${id}/timeline?limit=30`).then((r) => r.json()).catch(() => ({}));
    if (t.ok) { setTl(t.items); setMore(t.items.length === 30); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  async function loadMore() {
    const last = tl[tl.length - 1]; if (!last) return;
    const t = await fetch(`/api/contacts/${id}/timeline?limit=30&before=${encodeURIComponent(last.occurred_at)}`).then((r) => r.json()).catch(() => ({}));
    if (t.ok) { setTl([...tl, ...t.items]); setMore(t.items.length === 30); }
  }
  async function send(method: string, url: string, body: unknown, ok: string) {
    setMsg(null); setErrs([]);
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (d.ok) { setMsg({ ok: true, text: ok }); setPanel(''); await load(); return true; }
    if (d.errors) setErrs(d.errors); else setMsg({ ok: false, text: d.error === 'forbidden' ? 'لا تملك صلاحية هذا الإجراء.' : d.error === 'identifier_taken' ? 'الجوال أو البريد مستخدم لعميل آخر.' : 'تعذّر الحفظ.' });
    return false;
  }
  if (!p) return <p className="muted">جارٍ التحميل…</p>;
  if (p.error) return <div role="alert" className="note err">{p.error === 'not_found' ? 'العميل غير موجود.' : 'تعذّر تحميل الملف.'}</div>;
  const c = p.contact, open = (p.opportunities as Row[]).filter((o) => o.status === 'open');
  const target = (t: string) => (t === 'call' ? () => setPanel('call') : t === 'task' ? () => setPanel('task') : t === 'matches' ? () => document.getElementById('matches')?.scrollIntoView() : t === 'stage' ? () => document.getElementById('deals')?.scrollIntoView() : null);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="panel stack" aria-labelledby="c-name">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 4 }}>
            <h1 id="c-name" style={{ fontSize: 26 }}>{c.name}</h1>
            <div className="meta"><span dir="ltr">{localPhone(c.phone) || '—'}</span><span dir="ltr">{c.email ?? ''}</span><span>{c.city_name ?? ''}</span><span>{CUSTOMER_TYPES.find((t) => t.value === c.type)?.label ?? ''}</span></div>
            <div className="meta"><span>آخر تواصل: {c.last_contact_at ? when(c.last_contact_at) : 'لا يوجد'}</span><span>المصادر: {(p.sources as Row[]).map((s) => CHANNEL_AR[s.channel] ?? s.channel).join('، ') || '—'}</span></div>
            <div className="meta"><span>حالة الصفقة: {open[0] ? <b>{open[0].stage_label}</b> : (p.opportunities as Row[])[0] ? (p.opportunities as Row[])[0].stage_label : 'لا فرصة بعد'}</span></div>
          </div>
          {canWrite && (
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn gold sm" onClick={() => setPanel(panel === 'call' ? '' : 'call')}>تسجيل مكالمة</button>
              <button type="button" className="btn sm" onClick={() => setPanel(panel === 'note' ? '' : 'note')}>ملاحظة</button>
              <button type="button" className="btn sm" onClick={() => setPanel(panel === 'task' ? '' : 'task')}>مهمة</button>
              <a className="btn line sm" style={line} href={`/app/requests?customer_id=${id}`}>طلب جديد</a>
            </div>
          )}
        </div>
        {canWrite && (
          <div className="row">
            <label className="field"><span>المسؤول</span><select className="input" value={c.owner_id ?? ''} onChange={(e) => send('PATCH', `/api/contacts/${id}`, { owner_id: e.target.value || null }, 'تغيّر المسؤول.')}><option value="">—</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name ?? '—'}</option>)}</select></label>
            <label className="field"><span>الحالة</span><select className="input" value={c.status} onChange={(e) => send('PATCH', `/api/contacts/${id}`, { status: e.target.value }, 'تغيّرت الحالة.')}>{CONTACT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
            <label className="field"><span>موعد المتابعة القادمة</span><input type="datetime-local" className="input" dir="ltr" defaultValue={c.next_follow_up_at ? toLocalInput(new Date(c.next_follow_up_at)) : ''} onBlur={(e) => e.target.value !== (c.next_follow_up_at ? toLocalInput(new Date(c.next_follow_up_at)) : '') && send('PATCH', `/api/contacts/${id}`, { next_follow_up_at: fromLocalInput(e.target.value) || null }, 'حُدِّث موعد المتابعة.')} /></label>
          </div>
        )}
        {!canWrite && <div className="meta"><span>المسؤول: {c.owner_name ?? '—'}</span><span>المتابعة: {when(c.next_follow_up_at)}</span></div>}
        {c.notes && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{c.notes}</p>}

        {panel === 'call' && (
          <form className="stack preview" aria-label="تسجيل مكالمة" onSubmit={(e) => { e.preventDefault(); void send('POST', `/api/contacts/${id}/calls`, { ...call, occurred_at: fromLocalInput(call.occurred_at), follow_up_at: fromLocalInput(call.follow_up_at) || null }, 'سُجّلت المكالمة.').then((ok) => ok && setCall({ ...call, notes: '', next_step: '', follow_up_at: '' })); }}>
            <p className="muted" style={{ margin: 0 }}>تسجيل يدوي لمكالمة تمت فعلًا؛ المنصة لا تجري اتصالات.</p>
            <div className="row">
              <fieldset className="fs field"><legend>الاتجاه</legend><div className="seg"><label><input type="radio" name="dir" checked={call.direction === 'out'} onChange={() => setCall({ ...call, direction: 'out' })} />صادرة</label><label><input type="radio" name="dir" checked={call.direction === 'in'} onChange={() => setCall({ ...call, direction: 'in' })} />واردة</label></div></fieldset>
              <label className="field"><span>النتيجة</span><select className="input" value={call.outcome} onChange={(e) => setCall({ ...call, outcome: e.target.value })}>{CALL_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
              <label className="field"><span>وقت المكالمة</span><input type="datetime-local" className="input" dir="ltr" value={call.occurred_at} onChange={(e) => setCall({ ...call, occurred_at: e.target.value })} /></label>
            </div>
            <label className="field"><span>ملاحظات</span><textarea className="input" rows={2} value={call.notes} onChange={(e) => setCall({ ...call, notes: e.target.value })} /></label>
            <div className="row">
              <label className="field"><span>الخطوة التالية</span><input className="input" value={call.next_step} onChange={(e) => setCall({ ...call, next_step: e.target.value })} /></label>
              <label className="field"><span>موعد المتابعة (ينشئ مهمة)</span><input type="datetime-local" className="input" dir="ltr" value={call.follow_up_at} onChange={(e) => setCall({ ...call, follow_up_at: e.target.value })} /></label>
            </div>
            <div><button className="btn gold">حفظ المكالمة</button></div>
          </form>
        )}
        {panel === 'note' && (
          <form className="stack preview" aria-label="ملاحظة" onSubmit={(e) => { e.preventDefault(); void send('POST', `/api/contacts/${id}/notes`, { note }, 'أُضيفت الملاحظة.').then((ok) => ok && setNote('')); }}>
            <label className="field"><span>الملاحظة</span><textarea className="input" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <div><button className="btn">حفظ</button></div>
          </form>
        )}
        {panel === 'task' && (
          <form className="stack preview" aria-label="مهمة جديدة" onSubmit={(e) => { e.preventDefault(); void send('POST', '/api/tasks', { ...task, customer_id: id, due_at: fromLocalInput(task.due_at) || null, assignee_id: task.assignee_id || null }, 'أُنشئت المهمة.').then((ok) => ok && setTask({ title: '', due_at: '', priority: 'normal', assignee_id: '', notes: '' })); }}>
            <label className="field"><span>عنوان المهمة</span><input className="input" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} /></label>
            <div className="row">
              <label className="field"><span>الاستحقاق</span><input type="datetime-local" className="input" dir="ltr" value={task.due_at} onChange={(e) => setTask({ ...task, due_at: e.target.value })} /></label>
              <label className="field"><span>الأولوية</span><select className="input" value={task.priority} onChange={(e) => setTask({ ...task, priority: e.target.value })}>{TASK_PRIORITIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
              <label className="field"><span>المكلّف</span><select className="input" value={task.assignee_id} onChange={(e) => setTask({ ...task, assignee_id: e.target.value })}><option value="">أنا</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name ?? '—'}</option>)}</select></label>
            </div>
            <div><button className="btn">حفظ المهمة</button></div>
          </form>
        )}
        <div aria-live="polite">
          {errs.length > 0 && <div role="alert" className="note err"><ul style={{ margin: 0, paddingInlineStart: 20 }}>{errs.map((x, i) => <li key={i}>{x.message}</li>)}</ul></div>}
          {msg && <div className={`note ${msg.ok ? 'ok' : 'err'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
        </div>
      </section>

      {(p.suggestions.items as Row[]).length > 0 && (
        <section className="panel stack" aria-labelledby="sg">
          <h2 id="sg" style={{ fontSize: 19 }}>اقتراحات <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>(قواعد صريحة من بيانات الـCRM؛ لا تُنفَّذ تلقائيًا)</span></h2>
          {(p.suggestions.items as Row[]).map((s) => {
            const go = target(s.action.target);
            return (
              <div key={s.key} className="card">
                <b>{s.title}</b><span className="muted" style={{ fontSize: 14 }}>السبب: {s.reason}</span>
                <div>{s.action.target === 'new_request' ? <a className="btn line sm" style={line} href={`/app/requests?customer_id=${id}`}>{s.action.label}</a>
                  : s.action.target.startsWith('contact:') ? <a className="btn line sm" style={line} href={`/app/contacts/${s.action.target.slice(8)}`}>{s.action.label}</a>
                  : go && canWrite ? <button type="button" className="btn line sm" style={line} onClick={go}>{s.action.label}</button> : null}</div>
              </div>
            );
          })}
        </section>
      )}

      {canManage && (p.duplicates as Row[]).length > 0 && (
        <section className="panel stack" aria-label="احتمالات التكرار">
          <h2 style={{ fontSize: 19 }}>احتمال تكرار</h2>
          {(p.duplicates as Row[]).map((d) => (
            <div key={d.id} className="row" style={{ alignItems: 'center' }}>
              <a href={`/app/contacts/${d.id}`}>{d.name}</a><span className="muted" style={{ fontSize: 14 }}>{d.reason}</span>
              <button type="button" className="btn danger sm" onClick={() => window.confirm(`دمج «${d.name}» في هذا الملف؟ ينتقل خطه الزمني وطلباته ومهامه إلى هنا.`) && send('POST', `/api/contacts/${d.id}/merge`, { into: id }, 'تم الدمج.')}>ادمج في هذا الملف</button>
            </div>
          ))}
        </section>
      )}

      <section id="deals" className="panel stack" aria-labelledby="dl">
        <h2 id="dl" style={{ fontSize: 19 }}>الطلبات والفرص</h2>
        {!(p.requests as Row[]).length && <p className="muted" style={{ margin: 0 }}>لا طلبات مرتبطة. {canWrite && <a href={`/app/requests?customer_id=${id}`}>أنشئ طلبًا منظمًا</a>}</p>}
        <div className="cards">
          {(p.requests as Row[]).map((r) => {
            const o = (p.opportunities as Row[]).find((x) => x.request_id === r.id);
            return (
              <div key={r.id} className="card">
                <b>{String(r.description ?? '').split('\n')[0]}</b>
                <div className="meta"><span>الحالة: {r.status === 'open' ? 'مفتوح' : 'مغلق'}</span><span>الميزانية حتى {fmt(r.budget_max)} ريال</span></div>
                {o && (canWrite
                  ? <label className="field"><span>مرحلة الفرصة</span><select className="input" value={o.stage_key} onChange={(e) => send('PATCH', `/api/opportunities/${o.id}`, { stage_key: e.target.value }, 'نُقلت الفرصة.')}>{(p.stages as Row[]).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
                  : <span>المرحلة: {o.stage_label}</span>)}
                <details><summary className="muted">الشروط المنظمة</summary><p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0', fontSize: 14 }}>{r.description}</p></details>
              </div>
            );
          })}
          {(p.opportunities as Row[]).filter((o) => !o.request_id).map((o) => (
            <div key={o.id} className="card"><b>{o.title}</b>
              {canWrite ? <label className="field"><span>المرحلة</span><select className="input" value={o.stage_key} onChange={(e) => send('PATCH', `/api/opportunities/${o.id}`, { stage_key: e.target.value }, 'نُقلت الفرصة.')}>{(p.stages as Row[]).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label> : <span>المرحلة: {o.stage_label}</span>}
            </div>
          ))}
        </div>
      </section>

      <section id="matches" className="panel stack" aria-labelledby="mt">
        <h2 id="mt" style={{ fontSize: 19 }}>العقارات المطابقة ({(p.matches as Row[]).filter((m) => m.eligible).length})</h2>
        {!(p.matches as Row[]).length && <p className="muted" style={{ margin: 0 }}>لا مطابقات بعد.</p>}
        <div className="cards">
          {(p.matches as Row[]).map((m) => (
            <div key={m.id} className="card" style={{ opacity: m.eligible ? 1 : 0.6 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <b>{m.property_title || `${getKind(m.kind)?.label ?? TYPE_AR[m.type] ?? m.type} · ${DEAL_AR[m.deal] ?? m.deal}`}</b>
                <span className="badge b-ok" aria-label={`درجة المطابقة ${Number(m.score)} من 100`}>{Number(m.score)}/100</span>
              </div>
              <div className="meta"><span>{m.district_name ?? '—'}</span><span dir="ltr">{fmt(m.price)} ريال</span><span dir="ltr">{fmt(m.area_sqm)} م²</span>{!m.eligible && <span className="badge b-invalid">لم يعد مطابقًا</span>}</div>
              <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 14 }}>
                {(m.reasons as Row[]).map((x) => <li key={x.key}><span className={`badge ${ST[x.status][1]}`}>{ST[x.status][0]}</span> {x.label}{x.importance === 'must' ? ' (إلزامي)' : x.importance === 'preferred' ? ' (مفضّل)' : ''}: {x.detail}</li>)}
              </ul>
              {canWrite ? <label className="field"><span>حالة المتابعة</span><select className="input" value={m.status} onChange={(e) => send('PATCH', `/api/matches/${m.id}`, { status: e.target.value }, 'تحدثت حالة المطابقة.')}>{MATCH_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
                : <span>الحالة: {MATCH_STATUSES.find((s) => s.value === m.status)?.label}</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="panel stack" aria-labelledby="tk">
        <h2 id="tk" style={{ fontSize: 19 }}>المهام</h2>
        {!(p.tasks as Row[]).length && <p className="muted" style={{ margin: 0 }}>لا مهام.</p>}
        {(p.tasks as Row[]).map((t) => {
          const done = t.status === 'done' || t.status === 'cancelled', late = !done && t.due_at && new Date(t.due_at) < new Date();
          return (
            <div key={t.id} className="row" style={{ alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
              <div><b style={{ textDecoration: done ? 'line-through' : undefined }}>{t.title}</b><div className="meta"><span style={{ color: late ? 'var(--red)' : undefined }}>{t.due_at ? when(t.due_at) : 'بلا موعد'}{late ? ' (متأخرة)' : ''}</span><span>{t.assignee_name ?? ''}</span><span>{TASK_PRIORITIES.find((x) => x.value === t.priority)?.label}</span></div></div>
              {canWrite && <button type="button" className="btn line sm" style={line} onClick={() => send('PATCH', `/api/tasks/${t.id}`, { status: done ? 'open' : 'done' }, done ? 'أُعيد فتح المهمة.' : 'أُنجزت المهمة.')}>{done ? 'إعادة فتح' : 'إنجاز'}</button>}
            </div>
          );
        })}
      </section>

      {(p.messages as Row[]).length > 0 && (
        <section className="panel stack" aria-labelledby="ms">
          <h2 id="ms" style={{ fontSize: 19 }}>الرسائل</h2>
          {(p.messages as Row[]).map((m) => <div key={m.id} className="card"><div className="meta"><span className="badge b-ok">{CHANNEL_AR[m.channel] ?? m.channel}</span><span>{m.direction === 'in' ? 'واردة' : 'صادرة'}</span><span>{when(m.sent_at)}</span></div>{m.subject && <b>{m.subject}</b>}<p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.body}</p></div>)}
        </section>
      )}

      <section className="panel stack" aria-labelledby="tlh">
        <h2 id="tlh" style={{ fontSize: 19 }}>الخط الزمني</h2>
        <ol className="timeline">
          {tl.map((e) => (
            <li key={e.id}>
              <div className="meta"><b style={{ color: 'var(--ink)' }}>{TL_KIND_AR[e.kind] ?? e.kind}</b><span>{when(e.occurred_at)}</span>{e.channel && <span>{CHANNEL_AR[e.channel] ?? e.channel}</span>}{e.direction && <span>{e.direction === 'in' ? 'واردة' : 'صادرة'}</span>}{e.actor_name && <span>{e.actor_name}</span>}</div>
              {e.kind === 'call' && <div style={{ fontSize: 14 }}>النتيجة: {CALL_OUTCOMES.find((o) => o.value === e.meta?.outcome)?.label ?? '—'}{e.meta?.next_step ? ` · الخطوة التالية: ${e.meta.next_step}` : ''}{e.meta?.follow_up_at ? ` · المتابعة ${day(e.meta.follow_up_at)}` : ''}</div>}
              {e.note && <div style={{ whiteSpace: 'pre-wrap' }}>{e.note}</div>}
            </li>
          ))}
        </ol>
        {more && tl.length > 0 && <div><button type="button" className="btn line sm" style={line} onClick={loadMore}>المزيد</button></div>}
      </section>
    </div>
  );
}
