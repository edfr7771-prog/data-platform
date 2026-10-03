import { json } from '@/lib/api';
import { one } from '@/lib/db';
import { appUrl } from '@/lib/env';
import { otpDevDisplayAllowed } from '@/lib/otp-policy';
import { registrationOpen } from '@/lib/contact-policy';

// نقطة عامة بلا بيانات حساسة: حالة القاعدة وإعدادات عامة فقط.
export async function GET() {
  let db = 'down';
  try { await one('SELECT 1'); db = 'up'; } catch { /* يبقى down */ }
  const url = appUrl();
  return json({ ok: db === 'up', db, app_url: url, otp_dev_display: otpDevDisplayAllowed(process.env, url), registration_open: registrationOpen(process.env, url) }, db === 'up' ? 200 : 503);
}
