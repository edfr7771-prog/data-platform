'use client';
import { useState } from 'react';

/** نموذج استفسار عام: اسم، وجوال أو بريد، ورسالة، وموافقة صريحة. يُرسل إلى المنصة نفسها فقط. */
export function EnquiryForm({ formKey, propertyId, requestId }: { formKey: string; propertyId?: string; requestId?: string }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', message: '', consent: false });
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle'); const [err, setErr] = useState('');
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setState('busy');
    const r = await fetch('/api/enquiries/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, form_key: formKey, property_id: propertyId, request_id: requestId }) });
    const d = await r.json().catch(() => ({}));
    if (d.ok) { setState('done'); return; }
    setState('idle');
    setErr(d.error === 'consent_required' ? 'يلزم الموافقة على التواصل.' : d.errors?.[0]?.message ?? (d.error === 'message_invalid' ? 'اكتب رسالتك.' : d.error === 'rate_limited' ? 'محاولات كثيرة، حاول بعد دقيقة.' : 'تعذّر الإرسال.'));
  }
  if (state === 'done') return <div role="status" className="note ok">وصل استفسارك. شكرًا لك، سنتواصل معك قريبًا.</div>;
  return (
    <form className="panel stack" onSubmit={submit} noValidate aria-label="نموذج الاستفسار">
      <label className="field"><span>الاسم</span><input className="input" autoComplete="name" value={f.name} onChange={(e) => set('name', e.target.value)} required /></label>
      <label className="field"><span>الجوال</span><input className="input" dir="ltr" type="tel" inputMode="tel" autoComplete="tel" placeholder="05XXXXXXXX" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></label>
      <label className="field"><span>البريد الإلكتروني (اختياري إن أدخلت الجوال)</span><input className="input" dir="ltr" type="email" autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></label>
      <label className="field"><span>رسالتك</span><textarea className="input" rows={4} maxLength={2000} value={f.message} onChange={(e) => set('message', e.target.value)} required /></label>
      <label className="check"><input type="checkbox" checked={f.consent} onChange={(e) => set('consent', e.target.checked)} /><span>أوافق على تواصل المكتب معي بخصوص هذا الاستفسار.</span></label>
      {err && <div role="alert" className="note err">{err}</div>}
      <div><button className="btn gold" disabled={state === 'busy'}>{state === 'busy' ? 'جارٍ الإرسال…' : 'إرسال الاستفسار'}</button></div>
    </form>
  );
}
