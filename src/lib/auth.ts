import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { one, q, tx } from './db';
import { audit, auditTx } from './audit';
import { deliverOtp } from './otp-delivery';
import { appUrl, secret, secureCookies } from './env';
import { isLoopbackIp, otpDevDisplayAllowed } from './otp-policy';
import { contactStatus } from './contact-policy';
import type { Identifier } from './identifiers';
import type { Role } from './rbac';

const SESSION_COOKIE = 'rd_session';
const SESSION_DAYS = 30;
const OTP_TTL_MIN = 5;
const OTP_MAX_ATTEMPTS = 5;
// حدود الإرسال والمحاولات: لكل معرّف ولكل IP (مجزّأ)، مع تراكم المحاولات الفاشلة عبر التحديات
const OTP_MAX_SENDS_PER_10MIN = 3, OTP_MAX_SENDS_PER_DAY = 8;
const OTP_IP_MAX_SENDS_PER_10MIN = 10, OTP_IP_MAX_SENDS_PER_DAY = 30;
const OTP_MAX_FAILED_PER_HOUR = 15, OTP_IP_MAX_FAILED_PER_HOUR = 30;

const hmac = (v: string) => createHmac('sha256', secret()).update(v).digest('hex');
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

export type CurrentUser = {
  id: string; email: string | null; phone: string | null; full_name: string | null;
  email_verified: boolean; phone_verified: boolean; phone_pending: string | null;
  platform_role: 'super_admin' | null; locale: 'ar' | 'en';
  org: { id: string; name: string; role: Role } | null;
};

// ───────────── OTP ─────────────
export type OtpStartResult = { ok: true; challengeId: string; devCode?: string } | { ok: false; error: 'rate_limited' | 'daily_limit' | 'locked' | 'delivery_failed' };
export type OtpPurpose = 'login' | 'register' | 'attach';
export type RegisterPayload = { name: string; phone: string; marketing: boolean };
export type LoginPair = { email: string; phone: string };
export type OtpStartContext = { ipHash?: string | null; purpose?: OtpPurpose; payload?: RegisterPayload; userId?: string; pair?: LoginPair };

const adminIdentifiers = () => (process.env.ADMIN_IDENTIFIERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
/** ترقية مدير المنصة لحساب موجود فقط: لا إنشاء حساب عند الدخول ولا استثناء من التوثيق. */
export const isAdminIdentifier = (v: string) => adminIdentifiers().includes(v.toLowerCase());

/** تجزئة IP بـHMAC: لا يُخزَّن عنوان خام. غير الشكل الصالح أو عنوان المقبس المحلي يُعامل «بلا IP». */
export function hashIp(ip: string | null | undefined): string | null {
  const v = (ip ?? '').trim();
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(v) || isLoopbackIp(v)) return null;
  return hmac(`ip:${v}`);
}

export async function startOtp(idn: Identifier, ctx: OtpStartContext = {}): Promise<OtpStartResult> {
  const ip = ctx.ipHash ?? null;
  const purpose = ctx.purpose ?? 'login';
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

  // العدّ والإدراج في معاملة واحدة تحت أقفال استشارية (المعرّف ثم العنوان بترتيب ثابت فلا جمود): الطلبات المتزامنة لا تتجاوز الحدود
  const r = await tx(async (c) => {
    const get = async <T extends QueryResultRow>(text: string, params: unknown[]) => (await c.query<T>(text, params as never[])).rows[0] ?? null;
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`otp:id:${idn.value}`]);
    if (ip) await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`otp:ip:${ip}`]);
    const cnt = await get<{ i10: string; i24: string; ifail: string; p10: string; p24: string; pfail: string }>(
      `SELECT
         count(*) FILTER (WHERE identifier=$1 AND created_at > now() - interval '10 minutes')::text AS i10,
         count(*) FILTER (WHERE identifier=$1)::text AS i24,
         COALESCE(sum(attempts) FILTER (WHERE identifier=$1 AND created_at > now() - interval '1 hour'), 0)::text AS ifail,
         count(*) FILTER (WHERE $2::text IS NOT NULL AND ip_hash=$2 AND created_at > now() - interval '10 minutes')::text AS p10,
         count(*) FILTER (WHERE $2::text IS NOT NULL AND ip_hash=$2)::text AS p24,
         COALESCE(sum(attempts) FILTER (WHERE $2::text IS NOT NULL AND ip_hash=$2 AND created_at > now() - interval '1 hour'), 0)::text AS pfail
       FROM otp_challenges WHERE created_at > now() - interval '24 hours' AND (identifier=$1 OR ($2::text IS NOT NULL AND ip_hash=$2))`,
      [idn.value, ip],
    );
    const n = (k: keyof NonNullable<typeof cnt>) => Number(cnt?.[k] ?? 0);
    if (n('ifail') >= OTP_MAX_FAILED_PER_HOUR || n('pfail') >= OTP_IP_MAX_FAILED_PER_HOUR) return { kind: 'limit' as const, error: 'locked' as const };
    if (n('i24') >= OTP_MAX_SENDS_PER_DAY || n('p24') >= OTP_IP_MAX_SENDS_PER_DAY) return { kind: 'limit' as const, error: 'daily_limit' as const };
    if (n('i10') >= OTP_MAX_SENDS_PER_10MIN || n('p10') >= OTP_IP_MAX_SENDS_PER_10MIN) return { kind: 'limit' as const, error: 'rate_limited' as const };

    // تحدٍّ وهمي (بلا إرسال رمز) بدل أي كشف: دخول لا يطابق الحساب، أو تسجيل ببريد حساب مكتمل
    let decoy = false;
    if (purpose === 'login') {
      const pr = ctx.pair;
      const ok = pr ? await get(`SELECT 1 FROM users WHERE email=$1 AND phone=$2 AND is_active AND deleted_at IS NULL AND email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL`, [pr.email, pr.phone]) : null;
      decoy = !ok;
    } else if (purpose === 'register') {
      const done = await get(`SELECT 1 FROM users WHERE email=$1 AND email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL AND coalesce(full_name,'') <> ''`, [idn.value]);
      decoy = !!done;
    }
    // الزوج المقدَّم عند الدخول يُحفظ مع التحدي ليُعاد التحقق منه عند الاستهلاك
    const payload = purpose === 'login' && ctx.pair ? { pair: ctx.pair } : ctx.payload ?? null;
    const row = await get<{ id: string }>(
      `INSERT INTO otp_challenges (identifier, channel, code_hash, expires_at, ip_hash, purpose, payload, user_id)
       VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval, $5, $6, $7, $8) RETURNING id`,
      [idn.value, idn.channel, decoy ? randomBytes(32).toString('hex') : hmac(`${idn.value}:${code}`), String(OTP_TTL_MIN), ip, purpose, payload ? JSON.stringify(payload) : null, ctx.userId ?? null],
    );
    return { kind: 'ok' as const, id: row!.id, decoy };
  });
  if (r.kind === 'limit') return { ok: false, error: r.error };

  if (!r.decoy) {
    try {
      await deliverOtp(idn.channel, idn.value, code);
    } catch (e) {
      console.error('[otp] delivery failed', (e as Error).message);
      return { ok: false, error: 'delivery_failed' };
    }
  }
  // عرض الرمز: محلي فقط. على أي رابط عام يُتجاهل OTP_DEV_SHOW=true تمامًا (مع تحذير في السجل).
  const devShow = otpDevDisplayAllowed(process.env, appUrl());
  if (process.env.OTP_DEV_SHOW === 'true' && !devShow) console.warn('[otp] OTP_DEV_SHOW=true تم تجاهله: رابط المنصة ليس محليًا');
  return { ok: true, challengeId: r.id, devCode: devShow && !r.decoy ? code : undefined };
}

export type OtpVerifyResult =
  | { ok: true; userId: string; isNew: boolean; purpose: OtpPurpose; channel: 'email' | 'sms' }
  | { ok: false; error: 'invalid' | 'expired' | 'too_many' | 'taken' };

export async function verifyOtp(challengeId: string, code: string, consentVersion: string, expectUserId?: string): Promise<OtpVerifyResult> {
  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) return { ok: false, error: 'expired' };
  // كل محاولة تُحسب ذريًا قبل المقارنة: الطلبات المتوازية لا تتجاوز حد المحاولات، والتحدي المستهلك أو المنتهي لا يُقبل
  const ch = await one<{ id: string; identifier: string; channel: 'email' | 'sms'; code_hash: string; purpose: OtpPurpose; payload: Partial<RegisterPayload> & { pair?: LoginPair } | null; user_id: string | null }>(
    `UPDATE otp_challenges SET attempts = attempts + 1
     WHERE id=$1 AND consumed_at IS NULL AND expires_at >= now() AND attempts < $2
     RETURNING id, identifier, channel, code_hash, purpose, payload, user_id`,
    [challengeId, OTP_MAX_ATTEMPTS],
  );
  if (!ch) {
    const why = await one<{ dead: boolean }>(`SELECT (consumed_at IS NOT NULL OR expires_at < now()) AS dead FROM otp_challenges WHERE id=$1`, [challengeId]);
    return { ok: false, error: !why || why.dead ? 'expired' : 'too_many' };
  }
  const expected = Buffer.from(ch.code_hash, 'hex');
  const given = Buffer.from(hmac(`${ch.identifier}:${code}`), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, error: 'invalid' };
  // الاستهلاك ذري: لو وصل طلبان صحيحان معًا ينجح أحدهما فقط
  const used = await one<{ id: string }>(`UPDATE otp_challenges SET consumed_at = now() WHERE id=$1 AND consumed_at IS NULL RETURNING id`, [ch.id]);
  if (!used) return { ok: false, error: 'expired' };

  const col = ch.channel === 'email' ? 'email' : 'phone';
  const verifiedCol = ch.channel === 'email' ? 'email_verified_at' : 'phone_verified_at';

  // رمز دخول صادر لزوج (بريد + جوال) مطابق وقتها: يُعاد التحقق عند الاستهلاك
  if (ch.purpose === 'login') {
    const pr = ch.payload?.pair;
    const still = pr ? await one(`SELECT 1 FROM users WHERE email=$1 AND phone=$2 AND is_active AND deleted_at IS NULL AND email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL`, [pr.email, pr.phone]) : null;
    if (!still) return { ok: false, error: 'invalid' };
  }

  // ربط قناة ثانية بحساب قائم: يجب أن يطابق صاحب الجلسة صاحب التحدي، ولا تُربط قناة يملكها حساب آخر
  if (ch.purpose === 'attach') {
    if (!ch.user_id || ch.user_id !== expectUserId) return { ok: false, error: 'invalid' };
    const other = await one<{ id: string }>(`SELECT id FROM users WHERE ${col}=$1 AND id <> $2`, [ch.identifier, ch.user_id]);
    if (other) return { ok: false, error: 'taken' };
    const done = await one<{ id: string }>(
      `UPDATE users SET ${col}=$1, ${verifiedCol}=now()${ch.channel === 'sms' ? ', phone_pending=NULL' : ''}, updated_at=now() WHERE id=$2 AND is_active RETURNING id`, [ch.identifier, ch.user_id]);
    if (!done) return { ok: false, error: 'invalid' };
    await audit({ actorId: ch.user_id, action: 'user.contact_verified', entity: 'user', entityId: ch.user_id, meta: { channel: ch.channel } });
    return { ok: true, userId: ch.user_id, isNew: false, purpose: 'attach', channel: ch.channel };
  }

  let user = await one<{ id: string; is_active: boolean }>(`SELECT id, is_active FROM users WHERE ${col}=$1 AND deleted_at IS NULL`, [ch.identifier]);
  let isNew = false;
  if (!user) {
    // لا إنشاء حساب عند الدخول ولا استثناء لأحد: الحساب الجديد يُنشأ بالتسجيل فقط
    if (ch.purpose !== 'register') return { ok: false, error: 'invalid' };
    const pl = ch.payload;
    user = await one(
      `INSERT INTO users (${col}, ${verifiedCol}, full_name, phone_pending, consent_version, consent_at, marketing_consent_at)
       VALUES ($1, now(), $2, $3, $4, now(), CASE WHEN $5::boolean THEN now() END)
       ON CONFLICT (${col}) DO NOTHING RETURNING id, is_active`,
      [ch.identifier, pl?.name?.slice(0, 80) ?? null, pl?.phone ?? null, consentVersion, !!pl?.marketing],
    );
    if (user) {
      isNew = true;
      // كل مسجِّل جديد يبدأ بمؤسسته المستقلة (عزل المستأجرين) ويكون مديرها
      await tx(async (c) => {
        const org = (await c.query<{ id: string }>(`INSERT INTO organizations (name, created_by) VALUES ($1, $2) RETURNING id`, [`مؤسسة ${(pl?.name ?? 'جديدة').slice(0, 60)}`, user!.id])).rows[0];
        await c.query(`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1,$2,'org_admin')`, [org.id, user!.id]);
        await c.query(`INSERT INTO subscriptions (org_id, plan, limits) VALUES ($1,'free','{}'::jsonb)`, [org.id]);
        await auditTx(c, { orgId: org.id, actorId: user!.id, action: 'user.register', entity: 'user', entityId: user!.id, meta: { channel: ch.channel, marketing: !!pl?.marketing } });
      });
    } else {
      user = await one(`SELECT id, is_active FROM users WHERE ${col}=$1 AND deleted_at IS NULL`, [ch.identifier]);
    }
  }
  if (!user || !user.is_active) return { ok: false, error: 'invalid' };
  // رمز تسجيل سابق لحساب كان ناقصًا ثم اكتمل: لا يمنح جلسة (وإلا لالتُفَّ على شرط الحقلين بقناة واحدة). الاستئناف مسموح للحساب الناقص فقط.
  if (ch.purpose === 'register' && !isNew) {
    const complete = await one(`SELECT 1 FROM users WHERE id=$1 AND email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL AND coalesce(full_name,'') <> ''`, [user.id]);
    if (complete) return { ok: false, error: 'invalid' };
  }
  await q(`UPDATE users SET ${verifiedCol} = COALESCE(${verifiedCol}, now()), last_login_at = now() WHERE id=$1`, [user.id]);
  if (isAdminIdentifier(ch.identifier)) {
    await q(`UPDATE users SET platform_role='super_admin' WHERE id=$1 AND platform_role IS DISTINCT FROM 'super_admin'`, [user.id]);
  }
  return { ok: true, userId: user.id, isNew, purpose: ch.purpose, channel: ch.channel };
}

// ───────────── الجلسات ─────────────
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('hex');
  await q(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2, now() + ($3 || ' days')::interval)`, [userId, sha(token), String(SESSION_DAYS)]);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies(), path: '/', maxAge: SESSION_DAYS * 86400 });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await q(`DELETE FROM sessions WHERE token_hash=$1`, [sha(t)]);
  jar.delete(SESSION_COOKIE);
}

/** للعرض فقط: لا يفحص اكتمال الحساب. التفويض يستعمل getCompleteUser أو requireUser (انظر الاختبار البنيوي). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const t = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!t) return null;
  const r = await one<{
    id: string; email: string | null; phone: string | null; full_name: string | null; email_verified: boolean; phone_verified: boolean;
    phone_pending: string | null; platform_role: 'super_admin' | null; locale: 'ar' | 'en'; org_id: string | null; org_name: string | null; org_role: Role | null;
  }>(
    `SELECT u.id, u.email, u.phone, u.full_name, (u.email_verified_at IS NOT NULL) AS email_verified, (u.phone_verified_at IS NOT NULL) AS phone_verified,
            u.phone_pending, u.platform_role, u.locale, o.id AS org_id, o.name AS org_name, m.role AS org_role
     FROM sessions s
     JOIN users u ON u.id = s.user_id AND u.is_active AND u.deleted_at IS NULL
     LEFT JOIN organization_members m ON m.user_id = u.id AND m.deleted_at IS NULL
     LEFT JOIN organizations o ON o.id = m.org_id AND o.deleted_at IS NULL
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha(t)],
  );
  if (!r) return null;
  return {
    id: r.id, email: r.email, phone: r.phone, full_name: r.full_name, email_verified: r.email_verified, phone_verified: r.phone_verified,
    phone_pending: r.phone_pending, platform_role: r.platform_role, locale: r.locale,
    org: r.org_id && r.org_role ? { id: r.org_id, name: r.org_name ?? '', role: r.org_role } : null,
  };
});

/** مستخدم مكتمل فقط (اسم + بريد موثَّق + جوال موثَّق). يُستعمل لكل تفويض خارج الصفحات (route handlers والإجراءات). */
export async function getCompleteUser(): Promise<CurrentUser | null> {
  const u = await getCurrentUser();
  return u && contactStatus(u).complete ? u : null;
}

/** حارس الصفحات: الحساب الناقص يُحوَّل إلى /complete ولا يدخل أي صفحة محمية. */
export async function requireUser(next = '/app', opts: { allowIncomplete?: boolean } = {}): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!opts.allowIncomplete && !contactStatus(u).complete) redirect(`/complete?next=${encodeURIComponent(next)}`);
  return u;
}

export function safeNext(next: string | undefined | null, fallback = '/app'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}

export async function accountComplete(userId: string): Promise<boolean> {
  return !!(await one(`SELECT 1 FROM users WHERE id=$1 AND is_active AND deleted_at IS NULL AND email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL AND coalesce(full_name,'') <> ''`, [userId]));
}
