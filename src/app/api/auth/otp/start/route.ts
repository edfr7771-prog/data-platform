import { fail, guardPublic, json, readJson } from '@/lib/api';
import { startOtp } from '@/lib/auth';
import { appUrl } from '@/lib/env';
import { emailDeliveryAvailable, registrationOpen, smsDeliveryAvailable } from '@/lib/contact-policy';
import { normalizeEmail, normalizePhone, type Identifier } from '@/lib/identifiers';

const STATUS = { rate_limited: 429, daily_limit: 429, locked: 429, delivery_failed: 502 } as const;

/** تسجيل: اسم + بريد + جوال (رمز للبريد أولًا). دخول: بريد + جوال معًا ثم رمز واحد لقناة تختارها. بلا كلمات مرور. */
export async function POST(req: Request) {
  const g = await guardPublic(req); if ('res' in g) return g.res;
  const b = await readJson(req); if (!b) return fail(400, 'bad_json');
  const mode = b.mode === 'register' || b.mode === 'login' ? b.mode : null; if (!mode) return fail(400, 'bad_mode');
  if (b.consent !== true) return fail(400, 'consent');
  const email = normalizeEmail(String(b.email ?? '')); if (!email) return fail(400, 'email');
  const phone = normalizePhone(String(b.phone ?? '')); if (!phone) return fail(400, 'phone');
  const url = appUrl();

  if (mode === 'register') {
    const name = String(b.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (name.length < 2) return fail(400, 'name');
    // بلا تسليم بريد وSMS لا نفتح التسجيل: لا نقبل حسابًا لا نستطيع توثيق بريده أو جواله
    if (!registrationOpen(process.env, url)) return fail(503, 'registration_closed');
    const res = await startOtp({ value: email, channel: 'email' }, { ipHash: g.ipHash, purpose: 'register', payload: { name, phone, marketing: b.marketing === true } });
    if (!res.ok) return fail(STATUS[res.error], res.error);
    return json({ ok: true, step: 'verify_email', challengeId: res.challengeId, devCode: res.devCode });
  }

  const channel = b.channel === 'sms' ? 'sms' : 'email';
  // قناة غير متاحة تُرفض للجميع بالصيغة نفسها قبل النظر في الحساب (فلا تكشف صحة الزوج)
  if (channel === 'sms' ? !smsDeliveryAvailable(process.env, url) : !emailDeliveryAvailable(process.env, url)) return fail(503, 'channel_unavailable');
  const idn: Identifier = channel === 'sms' ? { value: phone, channel: 'sms' } : { value: email, channel: 'email' };
  const res = await startOtp(idn, { ipHash: g.ipHash, purpose: 'login', pair: { email, phone } });
  if (!res.ok) return fail(STATUS[res.error], res.error);
  // استجابة واحدة لزوج صحيح أو غير صحيح: لا كشف
  return json({ ok: true, step: 'verify_login', challengeId: res.challengeId, devCode: res.devCode });
}
