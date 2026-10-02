import 'server-only';
import nodemailer from 'nodemailer';
import { appUrl } from './env';
import { otpConsoleFallbackAllowed } from './otp-policy';
import { displayPhone } from './identifiers';

/**
 * إرسال رمز التحقق. المزوّد يُحدَّد من متغيرات البيئة فقط، ولا مفاتيح داخل الكود.
 * console: للتطوير المحلي فقط. smtp: بريد. webhook: مزوّد SMS يُحدَّد لاحقًا.
 * ملاحظة صريحة: مساري smtp وwebhook لم يُختبرا أمام مزوّد حقيقي (لا مزوّد محدد بعد).
 */
export async function deliverOtp(channel: 'email' | 'sms', to: string, code: string): Promise<void> {
  const text = `رمز التحقق لحسابك في تم الآن للبيانات: ${code} (صالح 5 دقائق)`;
  const mode = (channel === 'email' ? process.env.OTP_EMAIL_DELIVERY : process.env.OTP_SMS_DELIVERY) ?? 'console';

  if (mode === 'smtp' && channel === 'email') {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await t.sendMail({ from: process.env.SMTP_FROM, to, subject: 'رمز التحقق: تم الآن للبيانات', text });
    return;
  }
  if (mode === 'webhook' && channel === 'sms') {
    const url = process.env.SMS_WEBHOOK_URL;
    if (!url) throw new Error('SMS_WEBHOOK_URL is not set');
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN ?? ''}` },
      body: JSON.stringify({ to, toLocal: displayPhone(to), message: text }),
    });
    if (!res.ok) throw new Error(`SMS provider responded ${res.status}`);
    return;
  }
  // لا يُطبع الرمز في السجل إلا محليًا. على أي رابط عام يفشل التسليم صراحةً (حتى لو ضُبط OTP_DEV_SHOW=true).
  if (!otpConsoleFallbackAllowed(process.env, appUrl())) throw new Error(`OTP delivery for ${channel} is not configured`);
  console.log(`[OTP:${channel}] ${to} → ${code}`);
}
