'use client';
import { useCallback, useEffect, useState } from 'react';
import { CONTACT_SOURCES, CONTACT_STATUSES, CUSTOMER_TYPES } from '@/lib/crm-rules';
import { day, localPhone, when } from './crm-labels';
import { fmt } from './labels';

type City = { id: string; name_ar: string };
type Member = { id: string; full_name: string | null };
type Contact = { id: string; name: string; phone: string | null; email: string | null; city_name: string | null; owner_name: string | null; status: string; source: string | null; stage_label: string | null; open_requests: number; new_matches: number; last_contact_at: string | null; next_follow_up_at: string | null };
const blank = { name: '', phone: '', email: '', type: '', city_id: '', owner_id: '' };
const line = { color: 'var(--ink)', borderColor: '#8FA3C0' } as const;

/** قائمة العملاء: بحث وفلترة على كل مدن المنشأة، وبطاقات متجاوبة، وإضافة عميل بمنع التكرار */
export function ContactsList({ cities, members, canWrite }: { cities: City[]; members: Member[]; canWrite: boolean }) {
  const [f, setF] = useState({ q: '', city_id: '', status: '', owner_id: '', stage: '', source: '', follow_up_due: false, has_request: false, has_match: false });
  const [data, setData] = useState<{ items: Contact[]; total: number } | null>(null); const [page, setPage] = useState(1);
  const [form, setForm] = useState(blank); const [open, setOpen] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string; link?: string } | null>(null); const [errs, setErrs] = useState<{ field?: string; message: string }[]>([]);
  const [stages, setStages] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => { fetch('/api/crm/stages').then((r) => r.json()).then((d) => d.ok && setStages(d.items)).catch(() => {}); }, []);
  const load = useCallback(async (p: number) => {
    const sp = new URLSearchParams({ page: String(p), pageSize: '24' });
    for (const [k, v] of Object.entries(f)) if (v) sp.set(k, v === true ? '1' : String(v));
    const d = await fetch(`/api/contacts?${sp}`).then((r) => r.json()).catch(() => ({}));
    setData(d.ok ? d : { items: [], total: 0 });
  }, [f]);
  useEffect(() => { const t = setTimeout(() => void load(page), 250); return () => clearTimeout(t); }, [load, page]);
  const set = (k: string, v: unknown) => { setPage(1); setF((p) => ({ ...p, [k]: v })); };

  async function add(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setErrs([]);
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v));
    const r = await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (d.ok) { setForm(blank); setMsg({ ok: true, text: d.deduplicated ? `العميل موجود مسبقًا (تطابق ${d.matched_by.map((b: string) => (b === 'phone' ? 'الجوال' : 'البريد')).join(' و')})؛ رُبطت البيانات بملفه دون تكرار.` : 'أُضيف العميل.', link: `/app/contacts/${d.contact.id}` }); void load(1); }
    else if (d.error === 'identifier_conflict') setMsg({ ok: false, text: 'الجوال يخص عميلًا والبريد يخص عميلًا آخر. راجع الملفين يدويًا؛ لا يُدمج تلقائيًا.' });
    else if (d.errors) setErrs(d.errors); else setMsg({ ok: false, text: d.error === 'forbidden' ? 'لا تملك صلاحية الإضافة.' : 'تعذّرت الإضافة.' });
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / 24)) : 1;

  return (
    <div className="stack" style={{ gap: 18 }}>
      {canWrite && (
        <section className="panel stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <button type="button" className="btn gold" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'إغلاق' : 'إضافة عميل'}</button>
            <a className="btn line sm" style={line} href="/app/contacts/import">استيراد CSV</a>
          </div>
          {open && (
            <form className="stack" onSubmit={add} noValidate aria-label="إضافة عميل">
              <div className="row">
                <label className="field"><span>الاسم *</span><input id="ct-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <label className="field"><span>الجوال</span><input id="ct-phone" className="input" dir="ltr" inputMode="tel" placeholder="05XXXXXXXX" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
                <label className="field"><span>البريد</span><input id="ct-email" className="input" dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              </div>
              <div className="row">
                <label className="field"><span>نوع العميل</span><select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="">—</option>{CUSTOMER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
                <label className="field"><span>المدينة</span><select className="input" value={form.city_id} onChange={(e) => setForm({ ...form, city_id: e.target.value })}><option value="">—</option>{cities.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}</select></label>
                <label className="field"><span>المسؤول</span><select className="input" value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}><option value="">—</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name ?? '—'}</option>)}</select></label>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>الجوال أو البريد مطلوب. إن وُجد عميل بالجوال أو البريد نفسه يُربط بملفه بدل إنشاء ملف مكرر.</p>
              {errs.length > 0 && <div role="alert" className="note err"><ul style={{ margin: 0, paddingInlineStart: 20 }}>{errs.map((x, i) => <li key={i}>{x.message}</li>)}</ul></div>}
              <div><button className="btn">حفظ العميل</button></div>
            </form>
          )}
          {msg && <div role="status" className={`note ${msg.ok ? 'ok' : 'err'}`}>{msg.text} {msg.link && <a href={msg.link}>فتح الملف</a>}</div>}
        </section>
      )}

      <section className="panel stack" aria-label="البحث والفلترة">
        <label className="field"><span>بحث بالاسم أو الجوال أو البريد</span><input type="search" className="input" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="مثل: محمد أو 0551…" /></label>
        <div className="row">
          <label className="field"><span>المدينة</span><select className="input" value={f.city_id} onChange={(e) => set('city_id', e.target.value)}><option value="">كل المدن</option>{cities.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}</select></label>
          <label className="field"><span>الحالة</span><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">الكل</option>{CONTACT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
          <label className="field"><span>المسؤول</span><select className="input" value={f.owner_id} onChange={(e) => set('owner_id', e.target.value)}><option value="">الكل</option><option value="none">بلا مسؤول</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name ?? '—'}</option>)}</select></label>
          <label className="field"><span>المرحلة</span><select className="input" value={f.stage} onChange={(e) => set('stage', e.target.value)}><option value="">الكل</option>{stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
          <label className="field"><span>المصدر</span><select className="input" value={f.source} onChange={(e) => set('source', e.target.value)}><option value="">الكل</option>{CONTACT_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        </div>
        <div className="seg">
          <label><input type="checkbox" checked={f.follow_up_due} onChange={(e) => set('follow_up_due', e.target.checked)} />متابعة حلّ موعدها</label>
          <label><input type="checkbox" checked={f.has_request} onChange={(e) => set('has_request', e.target.checked)} />لديه طلب نشط</label>
          <label><input type="checkbox" checked={f.has_match} onChange={(e) => set('has_match', e.target.checked)} />لديه مطابقة</label>
        </div>
      </section>

      <h2 style={{ fontSize: 20 }}>العملاء ({fmt(data?.total ?? 0)})</h2>
      {!data && <p className="muted">جارٍ التحميل…</p>}
      {data && !data.items.length && <p className="muted">لا نتائج.</p>}
      <div className="cards">
        {data?.items.map((c) => (
          <article key={c.id} className="card">
            <a className="title" href={`/app/contacts/${c.id}`}>{c.name}</a>
            <div className="meta"><span dir="ltr">{localPhone(c.phone)}</span>{c.email && <span dir="ltr">{c.email}</span>}</div>
            <div className="meta">{c.city_name && <span>{c.city_name}</span>}{c.stage_label && <span className="badge b-ok">{c.stage_label}</span>}{c.status !== 'active' && <span className="badge b-review">{CONTACT_STATUSES.find((s) => s.value === c.status)?.label}</span>}{c.new_matches > 0 && <span className="badge b-fixed">{c.new_matches} مطابقة جديدة</span>}</div>
            <div className="meta"><span>المسؤول: {c.owner_name ?? '—'}</span><span>آخر تواصل: {c.last_contact_at ? day(c.last_contact_at) : 'لا يوجد'}</span></div>
            {c.next_follow_up_at && <div className="meta" style={{ color: new Date(c.next_follow_up_at) <= new Date() ? 'var(--red)' : undefined }}>المتابعة: {when(c.next_follow_up_at)}</div>}
            <div className="meta"><span>طلبات نشطة: {c.open_requests}</span><span>المصدر: {CONTACT_SOURCES.find((s) => s.value === c.source)?.label ?? '—'}</span></div>
          </article>
        ))}
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button type="button" className="btn line sm" style={line} disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</button>
        <span className="muted">صفحة {page} من {pages}</span>
        <button type="button" className="btn line sm" style={line} disabled={page >= pages} onClick={() => setPage(page + 1)}>التالي</button>
      </div>
    </div>
  );
}
