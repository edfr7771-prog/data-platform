import { fail, guardSession, json, readJson } from '@/lib/api';
import { startOtp } from '@/lib/auth';
import { appUrl } from '@/lib/env';
import { emailDeliveryAvailable, smsDeliveryAvailable } from '@/lib/contact-policy';
import { normalizeEmail, normalizePhone, type Identifier } from '@/lib/identifiers';

const STATUS = { rate_limited: 429, daily_limit: 429, locked: 429, delivery_failed: 502 } as const;

/** إكمال توثيق القناة الناقصة لحساب مسجَّل الدخول: يُرسل رمزًا للقناة الجديدة فيُثبَت بها الملكية في /api/auth/otp/verify. */
export async function POST(req: Request) {
  const g = await guardSession(req); if ('res' in g) return g.res;
  const b = await readJson(req); if (!b) return fail(400, 'bad_json');
  const url = appUrl();
  let idn: Identifier;
  if (b.kind === 'phone') {
    const phone = normalizePhone(String(b.value ?? '')); if (!phone) return fail(400, 'phone');
    if (g.user.phone_verified) return fail(409, 'already_verified');
    if (!smsDeliveryAvailable(process.env, url)) return fail(503, 'channel_unavailable');
    idn = { value: phone, channel: 'sms' };
  } else if (b.kind === 'email') {
    const email = normalizeEmail(String(b.value ?? '')); if (!email) return fail(400, 'email');
    if (g.user.email_verified) return fail(409, 'already_verified');
    if (!emailDeliveryAvailable(process.env, url)) return fail(503, 'channel_unavailable');
    idn = { value: email, channel: 'email' };
  } else return fail(400, 'bad_kind');
  const res = await startOtp(idn, { ipHash: g.ipHash, purpose: 'attach', userId: g.user.id });
  if (!res.ok) return fail(STATUS[res.error], res.error);
  return json({ ok: true, challengeId: res.challengeId, devCode: res.devCode });
}
