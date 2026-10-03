/**
 * سياسة اكتمال الحساب (دوال نقية بلا اعتماديات، قابلة للاختبار المباشر).
 * القرار المعتمد: الاسم والبريد والجوال إلزامية وموثَّقة لكل حساب بلا أي استثناء (ولا لمدير المنصة)،
 * ولا يُفعَّل حساب اعتمادًا على بيانات غير موثَّقة.
 */
import { otpConsoleFallbackAllowed } from './otp-policy';

type Env = { OTP_SMS_DELIVERY?: string; SMS_WEBHOOK_URL?: string; OTP_EMAIL_DELIVERY?: string; SMTP_HOST?: string; OTP_DEV_SHOW?: string; NODE_ENV?: string };

/** هل تسليم رسائل SMS ممكن؟ مزوّد ويبهوك مضبوط، أو بيئة محلية للتطوير. لا نعتبر «console» على رابط عام تسليمًا */
export function smsDeliveryAvailable(env: Env, appUrl: string): boolean {
  return (env.OTP_SMS_DELIVERY === 'webhook' && !!env.SMS_WEBHOOK_URL) || otpConsoleFallbackAllowed(env, appUrl);
}

/** هل تسليم البريد ممكن؟ SMTP مضبوط، أو بيئة محلية للتطوير */
export function emailDeliveryAvailable(env: Env, appUrl: string): boolean {
  return (env.OTP_EMAIL_DELIVERY === 'smtp' && !!env.SMTP_HOST) || otpConsoleFallbackAllowed(env, appUrl);
}

/** التسجيل العام يتطلب قناتَي التوثيق معًا: لا نقبل حسابًا لا نستطيع توثيق بريده أو جواله */
export function registrationOpen(env: Env, appUrl: string): boolean {
  return smsDeliveryAvailable(env, appUrl) && emailDeliveryAvailable(env, appUrl);
}

export type ContactUser = {
  full_name: string | null;
  email: string | null; email_verified: boolean;
  phone: string | null; phone_verified: boolean;
};
export type ContactMissing = 'name' | 'email' | 'phone';
export type ContactStatus = { complete: boolean; missing: ContactMissing[] };

export function contactStatus(u: ContactUser): ContactStatus {
  const missing: ContactMissing[] = [];
  if (!(u.full_name ?? '').trim()) missing.push('name');
  if (!(u.email && u.email_verified)) missing.push('email');
  if (!(u.phone && u.phone_verified)) missing.push('phone');
  return { complete: missing.length === 0, missing };
}
