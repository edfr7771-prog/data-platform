'use client';
import { useCallback, useEffect, useState } from 'react';
import { getKind } from '@/lib/property-schema';
import { PURPOSES } from '@/lib/request-schema';
import { DEAL_AR, fmt } from './labels';
import { RequestEntry } from './RequestEntry';

type Req = { id: string; customer_id: string | null; customer_name: string | null; purpose: string; kinds: string[]; description: string | null; notes: string | null; budget_max: number; status: string; created_at: string };
type Reason = { key: string; label: string; importance: string; status: 'met' | 'unmet' | 'unknown'; detail: string };
type Match = { property_id: string; score: number; reasons: Reason[]; kind: string | null; type: string; deal: string; district_name: string | null; price: number; area_sqm: number; price_per_sqm: number | null };
type Result = { considered: number; total_eligible: number; excluded: Record<string, number>; matches: Match[] };
const EXCL_AR: Record<string, string> = { kind: 'نوع مختلف', deal: 'عملية لا تناسب الغرض', city: 'مدينة أخرى', district: 'خارج الأحياء الإلزامية', budget: 'فوق الميزانية', area: 'المساحة خارج الشرط', criterion: 'شرط إلزامي غير متحقق أو غير مذكور' };
const ST: Record<Reason['status'], [string, string]> = { met: ['متحقق', 'b-imported'], unmet: ['غير متحقق', 'b-invalid'], unknown: ['غير مذكور', 'b-duplicate'] };
const line = { color: 'var(--ink)', borderColor: '#8FA3C0' } as const;

export function RequestsManager({ cities, districts, canWrite, customer }: { cities: { id: string; name_ar: string }[]; districts: { id: string; city_id: string; name_ar: string }[]; canWrite: boolean; customer?: { id: string; name: string } | null }) {
  const [items, setItems] = useState<Req[]>([]); const [loading, setLoading] = useState(true); const [msg, setMsg] = useState('');
  const [open, setOpen] = useState<string | null>(null); const [res, setRes] = useState<Result | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetch('/api/requests?pageSize=100').then((r) => r.json()).catch(() => ({}));
    if (d.ok) setItems(d.items); else setMsg('تعذّر تحميل الطلبات.');
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function showMatches(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setRes(null);
    const d = await fetch(`/api/requests/${id}/matches`).then((r) => r.json()).catch(() => ({}));
    if (d.ok) setRes(d); else setMsg('تعذّر حساب المطابقات.');
  }
  async function del(id: string) {
    if (!window.confirm('حذف هذا الطلب؟')) return;
    const d = await fetch(`/api/requests/${id}`, { method: 'DELETE' }).then((r) => r.json()).catch(() => ({}));
    if (d.ok) void load(); else setMsg('تعذّر الحذف.');
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      {canWrite && customer && <div role="note" className="note ok">الطلب الجديد سيُربط بالعميل: <a href={`/app/contacts/${customer.id}`}>{customer.name}</a></div>}
      {canWrite && <RequestEntry cities={cities} districts={districts} onSaved={load} customer={customer} />}
      {msg && <div role="alert" className="note err">{msg}</div>}
      <h2 style={{ fontSize: 20 }}>الطلبات ({fmt(items.length)})</h2>
      {loading && <p className="muted">جارٍ التحميل…</p>}
      {!loading && !items.length && <p className="muted">لا طلبات بعد.</p>}
      {items.map((r) => (
        <article key={r.id} className="panel stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <b>{(r.description ?? '').split('\n')[0] || `${PURPOSES.find((p) => p.value === r.purpose)?.label} ${r.kinds.map((k) => getKind(k)?.label).join('، ')}`}</b>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn sm" onClick={() => showMatches(r.id)} aria-expanded={open === r.id}>{open === r.id ? 'إخفاء المطابقات' : 'المطابقات'}</button>
              <a className="btn line sm" style={line} href={`/app/map?request_id=${r.id}`}>على الخريطة</a>
              {canWrite && <button type="button" className="btn line sm" style={{ color: 'var(--red)', borderColor: '#E4A5A0' }} onClick={() => del(r.id)}>حذف</button>}
            </div>
          </div>
          {r.customer_id && <span className="muted" style={{ fontSize: 14 }}>العميل: <a href={`/app/contacts/${r.customer_id}`}>{r.customer_name ?? '—'}</a></span>}
          <details><summary className="muted">الوصف الكامل</summary><p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{r.description}</p>{r.notes && <p className="muted" style={{ margin: '6px 0 0' }}>ملاحظات: {r.notes}</p>}</details>
          {open === r.id && (
            <div className="stack" aria-live="polite" style={{ gap: 10 }}>
              {!res && <span className="muted">جارٍ حساب المطابقات من البيانات المنظمة…</span>}
              {res && (
                <>
                  <p className="muted" style={{ margin: 0 }}>فُحص {fmt(res.considered)} عرضًا، المؤهل {fmt(res.total_eligible)}.{Object.keys(res.excluded).length > 0 && ` المستبعد: ${Object.entries(res.excluded).map(([k, n]) => `${EXCL_AR[k] ?? k} (${n})`).join('، ')}.`}</p>
                  {!res.matches.length && <div className="note">لا عروض تحقق الشروط الإلزامية حاليًا.</div>}
                  {res.matches.map((m) => (
                    <div key={m.property_id} className="preview" style={{ padding: 14 }}>
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <b>{getKind(m.kind)?.label ?? m.type} · {DEAL_AR[m.deal] ?? m.deal} · {m.district_name ?? '—'}</b>
                        <span className="badge b-ok" aria-label={`درجة المطابقة ${m.score} من 100`}>{m.score}/100</span>
                      </div>
                      <div className="muted" dir="rtl">السعر <span dir="ltr">{fmt(m.price)}</span> ريال · المساحة <span dir="ltr">{fmt(m.area_sqm)}</span> م²</div>
                      <ul style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>
                        {m.reasons.map((x) => <li key={x.key}><span className={`badge ${ST[x.status][1]}`}>{ST[x.status][0]}</span> {x.label}{x.importance === 'must' ? ' (إلزامي)' : x.importance === 'preferred' ? ' (مفضّل)' : ''}: {x.detail}</li>)}
                      </ul>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
