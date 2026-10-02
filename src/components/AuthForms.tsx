'use client';
import { useState } from 'react';

type Res = { status: number; data: Record<string, unknown> };
async function post(url: string, body: unknown): Promise<Res> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const MSG: Record<string, string> = {
  bad_origin: 'تعذّر التحقق من مصدر الطلب. أعد تحميل الصفحة.', consent: 'يلزم الموافقة على سياسة الخصوصية وشروط الاستخدام.',
  name: 'اكتب اسمك (حرفان فأكثر).', email: 'اكتب بريدًا إلكترونيًا بصيغة صحيحة.', phone: 'اكتب رقم جوال سعودي يبدأ بـ 05.',
  registration_closed: 'التسجيل غير متاح مؤقتًا: تسليم البريد أو الرسائل قيد الإعداد.', channel_unavailable: 'هذه الوسيلة غير متاحة الآن. اختر الأخرى أو حاول لاحقًا.',
  rate_limited: 'طلبات كثيرة خلال وقت قصير. انتظر قليلًا ثم حاول.', daily_limit: 'بلغتَ الحد اليومي لطلب الرموز. حاول غدًا.', locked: 'محاولات كثيرة خاطئة، أُوقف طلب الرموز مؤقتًا. حاول بعد ساعة.',
  delivery_failed: 'تعذّر إرسال الرمز الآن. جرّب الوسيلة الأخرى أو حاول لاحقًا.', invalid: 'الرمز غير صحيح.', expired: 'انتهت صلاحية الرمز. اطلب رمزًا جديدًا.', too_many: 'محاولات كثيرة خاطئة. اطلب رمزًا جديدًا.',
  taken: 'هذه القناة مرتبطة بحساب آخر.', unauthenticated: 'انتهت الجلسة. سجّل الدخول من جديد.', already_verified: 'هذه القناة موثّقة أصلًا.', bad_json: 'بيانات غير صالحة.',
};
const say = (e: unknown) => MSG[String(e)] ?? 'حدث خطأ غير متوقع. حاول مرة أخرى.';

function Msg({ err, dev }: { err: string; dev?: string }) {
  return (
    <div aria-live="polite" className="stack" style={{ gap: 10 }}>
      {err && <div role="alert" className="note err">{err}</div>}
      {dev && <div className="note dev">رمز التطوير (يظهر محليًا فقط): <b dir="ltr">{dev}</b></div>}
    </div>
  );
}

function CodeStep({ label, onSubmit, busy }: { label: string; onSubmit: (code: string) => void; busy: boolean }) {
  const [code, setCode] = useState('');
  return (
    <div className="stack">
      <label className="field"><span>{label}</span>
        <input className="input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </label>
      <button className="btn gold" disabled={busy || code.length !== 6} onClick={() => onSubmit(code)}>{busy ? 'جارٍ التحقق…' : 'تحقق'}</button>
    </div>
  );
}

export function RegisterForm() {
  const [f, setF] = useState({ name: '', email: '', phone: '', consent: false, marketing: false });
  const [cid, setCid] = useState(''); const [dev, setDev] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  async function start(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const r = await post('/api/auth/otp/start', { mode: 'register', ...f });
    setBusy(false);
    if (r.data.ok) { setCid(String(r.data.challengeId)); setDev(String(r.data.devCode ?? '')); } else setErr(say(r.data.error));
  }
  async function verify(code: string) {
    setErr(''); setBusy(true);
    const r = await post('/api/auth/otp/verify', { challengeId: cid, code });
    if (r.data.ok) window.location.href = String(r.data.next ?? '/complete'); else { setBusy(false); setErr(say(r.data.error)); }
  }
  if (cid) return (<div className="stack"><p className="muted" style={{ margin: 0 }}>أرسلنا رمزًا إلى بريدك. الخطوة التالية توثيق جوالك.</p><CodeStep label="رمز البريد (6 أرقام)" onSubmit={verify} busy={busy} /><Msg err={err} dev={dev} /></div>);
  return (
    <form className="stack" onSubmit={start} noValidate>
      <label className="field"><span>الاسم الكامل</span><input className="input" autoComplete="name" value={f.name} onChange={(e) => set('name', e.target.value)} required /></label>
      <label className="field"><span>البريد الإلكتروني</span><input className="input" dir="ltr" type="email" autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} required /></label>
      <label className="field"><span>رقم الجوال</span><input className="input" dir="ltr" type="tel" inputMode="tel" autoComplete="tel" placeholder="05XXXXXXXX" value={f.phone} onChange={(e) => set('phone', e.target.value)} required /></label>
      <label className="check"><input type="checkbox" checked={f.consent} onChange={(e) => set('consent', e.target.checked)} /><span>أوافق على سياسة الخصوصية وشروط الاستخدام.</span></label>
      <label className="check"><input type="checkbox" checked={f.marketing} onChange={(e) => set('marketing', e.target.checked)} /><span>أوافق على تلقي رسائل تسويقية (اختياري، ومنفصل عن الموافقة السابقة).</span></label>
      <Msg err={err} />
      <button className="btn gold" disabled={busy}>{busy ? 'جارٍ الإرسال…' : 'أرسل رمز التحقق إلى بريدي'}</button>
    </form>
  );
}

export function LoginForm() {
  const [f, setF] = useState({ email: '', phone: '', channel: 'email', consent: false });
  const [cid, setCid] = useState(''); const [dev, setDev] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  async function start(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const r = await post('/api/auth/otp/start', { mode: 'login', ...f });
    setBusy(false);
    if (r.data.ok) { setCid(String(r.data.challengeId)); setDev(String(r.data.devCode ?? '')); } else setErr(say(r.data.error));
  }
  async function verify(code: string) {
    setErr(''); setBusy(true);
    const r = await post('/api/auth/otp/verify', { challengeId: cid, code });
    if (r.data.ok) window.location.href = String(r.data.next ?? '/app'); else { setBusy(false); setErr(say(r.data.error)); }
  }
  if (cid) return (<div className="stack"><p className="muted" style={{ margin: 0 }}>إن كان الزوج صحيحًا وصلك رمز واحد على القناة التي اخترتها.</p><CodeStep label="رمز التحقق (6 أرقام)" onSubmit={verify} busy={busy} /><Msg err={err} dev={dev} /></div>);
  return (
    <form className="stack" onSubmit={start} noValidate>
      <label className="field"><span>البريد الإلكتروني</span><input className="input" dir="ltr" type="email" autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} required /></label>
      <label className="field"><span>رقم الجوال</span><input className="input" dir="ltr" type="tel" inputMode="tel" autoComplete="tel" placeholder="05XXXXXXXX" value={f.phone} onChange={(e) => set('phone', e.target.value)} required /></label>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack"><legend>أرسل الرمز إلى</legend>
        <label className="check"><input type="radio" name="channel" checked={f.channel === 'email'} onChange={() => set('channel', 'email')} /><span>بريدي الإلكتروني</span></label>
        <label className="check"><input type="radio" name="channel" checked={f.channel === 'sms'} onChange={() => set('channel', 'sms')} /><span>جوالي (رسالة نصية)</span></label>
      </fieldset>
      <label className="check"><input type="checkbox" checked={f.consent} onChange={(e) => set('consent', e.target.checked)} /><span>أوافق على سياسة الخصوصية وشروط الاستخدام.</span></label>
      <Msg err={err} />
      <button className="btn gold" disabled={busy}>{busy ? 'جارٍ الإرسال…' : 'أرسل رمز التحقق'}</button>
    </form>
  );
}

export function CompleteForm({ needPhone, prefill }: { needPhone: boolean; prefill: string }) {
  const [phone, setPhone] = useState(prefill); const [cid, setCid] = useState(''); const [dev, setDev] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function start(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const r = await post('/api/auth/complete', { kind: 'phone', value: phone });
    setBusy(false);
    if (r.data.ok) { setCid(String(r.data.challengeId)); setDev(String(r.data.devCode ?? '')); } else setErr(say(r.data.error));
  }
  async function verify(code: string) {
    setErr(''); setBusy(true);
    const r = await post('/api/auth/otp/verify', { challengeId: cid, code });
    if (r.data.ok) window.location.href = '/app'; else { setBusy(false); setErr(say(r.data.error)); }
  }
  if (!needPhone) return <div className="note ok">حسابك مكتمل. <a href="/app">متابعة إلى لوحتك</a></div>;
  if (cid) return (<div className="stack"><CodeStep label="رمز الجوال (6 أرقام)" onSubmit={verify} busy={busy} /><Msg err={err} dev={dev} /></div>);
  return (
    <form className="stack" onSubmit={start} noValidate>
      <label className="field"><span>رقم الجوال</span><input className="input" dir="ltr" type="tel" inputMode="tel" autoComplete="tel" placeholder="05XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
      <Msg err={err} />
      <button className="btn gold" disabled={busy}>{busy ? 'جارٍ الإرسال…' : 'أرسل رمز الجوال'}</button>
    </form>
  );
}

export function LogoutButton() {
  return <button className="nav-btn" style={{ minHeight: 44, background: 'none', border: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }} onClick={async () => { await post('/api/auth/logout', {}); window.location.href = '/'; }}>تسجيل الخروج</button>;
}
