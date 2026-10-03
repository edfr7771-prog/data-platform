'use client';
import { useCallback, useEffect, useState } from 'react';
import { STATUS_CH_AR, when } from './crm-labels';

type Ch = { key: string; label: string; status: string; reason: string; outbound: string; account: string | null; webhook_url?: string; form_url?: string | null; signature_failures_at?: string | null };
const ERR: Record<string, string> = { phone_number_id_invalid: 'معرّف رقم واتساب (phone_number_id) أرقام فقط.', email_invalid: 'البريد غير صحيح.', account_in_use: 'هذا الحساب مربوط بمنشأة أخرى.', forbidden: 'لا تملك صلاحية الإعداد.' };

/** حالة القنوات الصادقة: «متصلة» فقط بعد ثبوت الاتصال فعليًا. لا أسرار تُدخل هنا؛ الأسرار في بيئة الخادم. */
export function ChannelsView({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<Ch[] | null>(null); const [val, setVal] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => { const d = await fetch('/api/channels').then((r) => r.json()).catch(() => ({})); setItems(d.ok ? d.items : []); }, []);
  useEffect(() => { void load(); }, [load]);
  async function save(ch: string, body: unknown, ok: string) {
    setMsg(null);
    const d = await fetch(`/api/channels/${ch}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({}));
    setMsg(d.ok ? { ok: true, text: ok } : { ok: false, text: ERR[d.error] ?? 'تعذّر الحفظ.' });
    if (d.ok) await load();
  }
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div role="note" className="note dev">الإرسال الخارجي غير مفعّل في كل القنوات: لا تُرسل أي رسالة SMS أو واتساب أو بريد من المنصة. القنوات تستقبل فقط، وكل رسالة واردة تُربط بملف العميل.</div>
      {msg && <div role="status" className={`note ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
      {!items && <p className="muted">جارٍ التحميل…</p>}
      <div className="cards">
        {items?.map((c) => (
          <article key={c.key} className="card" aria-label={c.label}>
            <h3>{c.label}</h3>
            <div className="meta"><span className={`badge st-${c.status}`}>{STATUS_CH_AR[c.status] ?? c.status}</span><span className="badge b-duplicate">الإرسال: غير مفعّل</span></div>
            <p style={{ margin: 0, fontSize: 15 }}>{c.reason}</p>
            {c.account && <div className="meta"><span>الحساب: <span dir="ltr">{c.account}</span></span></div>}
            {c.webhook_url && <div className="meta" style={{ wordBreak: 'break-all' }}><span>رابط الـwebhook: <code dir="ltr">{c.webhook_url}</code></span></div>}
            {c.signature_failures_at && <div className="meta" style={{ color: 'var(--red)' }}>آخر فشل تحقق توقيع على رابط المنصة المشترك: {when(c.signature_failures_at)}</div>}
            {c.form_url && <div className="meta" style={{ wordBreak: 'break-all' }}><span>رابط النموذج: <a dir="ltr" href={c.form_url} target="_blank" rel="noreferrer">{c.form_url}</a></span></div>}
            {canManage && (c.key === 'whatsapp' || c.key === 'email') && (
              <form className="row" style={{ alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); void save(c.key, { external_id: val[c.key] ?? '' }, 'حُفظ إعداد الحساب.'); }}>
                <label className="field"><span>{c.key === 'whatsapp' ? 'معرّف الرقم الرسمي (phone_number_id)' : 'عنوان البريد الوارد'}</span>
                  <input className="input" dir="ltr" inputMode={c.key === 'whatsapp' ? 'numeric' : 'email'} value={val[c.key] ?? ''} onChange={(e) => setVal({ ...val, [c.key]: e.target.value })} /></label>
                <div><button className="btn sm">حفظ</button></div>
              </form>
            )}
            {canManage && c.key === 'web' && <div><button type="button" className="btn sm" onClick={() => save('web', {}, c.account ? 'وُلّد مفتاح جديد؛ الرابط القديم توقف.' : 'فُعّل نموذج الاستفسار.')}>{c.account ? 'توليد مفتاح جديد' : 'تفعيل نموذج الاستفسار'}</button></div>}
          </article>
        ))}
      </div>
      <details className="panel">
        <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>ما المطلوب لربط واتساب والبريد فعليًا؟</summary>
        <ul style={{ paddingInlineStart: 20 }}>
          <li>WhatsApp Business: حساب Meta Business موثّق ورقم على WhatsApp Cloud API، ثم ضبط WHATSAPP_APP_SECRET وWHATSAPP_VERIFY_TOKEN على الخادم، وتسجيل رابط الـwebhook أعلاه في لوحة Meta، وإدخال phone_number_id هنا. لا يُستخدم واتساب الشخصي ولا أي استخراج غير رسمي.</li>
          <li>البريد الوارد: مزوّد بريد يدعم إعادة توجيه الرسائل الواردة إلى webhook موقّع (HMAC-SHA256) بالسر EMAIL_INBOUND_SECRET، ثم إدخال عنوان البريد هنا.</li>
          <li>القناة لا تظهر «متصلة» إلا بعد معالجة أول رسالة موقّعة فعليًا.</li>
        </ul>
      </details>
    </div>
  );
}
