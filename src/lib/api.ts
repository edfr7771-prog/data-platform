import 'server-only';
import { NextResponse } from 'next/server';
import { getCurrentUser, hashIp, type CurrentUser } from './auth';
import { contactStatus } from './contact-policy';
import { can, type Action, type Role } from './rbac';
import { appUrl } from './env';

export type Ctx = { user: CurrentUser; orgId: string; role: Role; ipHash: string | null };

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export const fail = (status: number, code: string, extra: Record<string, unknown> = {}) => json({ ok: false, error: code, ...extra }, status);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * حماية CSRF (مع كوكي SameSite=Lax). المتصفحات تختلف في إرسال Origin لطلبات الصفحة نفسها (بعضها لا يرسله)،
 * فالاعتماد عليه وحده يرفض المستخدمين الشرعيين. الترتيب:
 * 1) Sec-Fetch-Site يضعه المتصفح ولا يزوّره JavaScript: يُقبل same-origin فقط، وأي قيمة أخرى (cross-site/same-site/none) تُرفض.
 * 2) بلا Sec-Fetch-Site (عملاء غير متصفحية أو متصفح قديم): Origin ثم Referer، ويجب أن يطابق مضيفُه مضيف APP_URL.
 * 3) لا شيء منها: رفض.
 */
export function originOk(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  const hostOf = (v: string | null) => { try { return v ? new URL(v).host : null; } catch { return null; } };
  const mine = hostOf(appUrl());
  const origin = req.headers.get('origin');
  if (site) {
    if (site !== 'same-origin') return false;
    return !origin || hostOf(origin) === mine; // إن وُجد Origin مع same-origin فيجب أن يطابق
  }
  if (origin) return hostOf(origin) === mine;
  const ref = hostOf(req.headers.get('referer'));
  return !!ref && ref === mine;
}

// محدّد معدل داخل الذاكرة (لكل نسخة تشغيل). يُستبدل بمخزن مشترك عند تعدد النسخ (موثّق في SAUDI-DEPLOYMENT.md).
const buckets = new Map<string, { n: number; reset: number }>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k); return false; }
  b.n++;
  return b.n > max;
}

/** المعالج خلف وكيل موثوق (Nginx) يضع X-Forwarded-For؛ بلا وكيل يُهمل العنوان. */
export const clientIpHash = (req: Request) => hashIp(req.headers.get('x-forwarded-for')?.split(',')[0]);

/** نقاط عامة (تسجيل/دخول): فحص الأصل وحد معدل لكل عنوان. */
export async function guardPublic(req: Request): Promise<{ ipHash: string | null } | { res: Response }> {
  if (MUTATING.has(req.method) && !originOk(req)) return { res: fail(403, 'bad_origin') };
  const ipHash = clientIpHash(req);
  if (ipHash && limited(`pub:${ipHash}`, 60, 60_000)) return { res: fail(429, 'rate_limited') };
  return { ipHash };
}

/** نقاط تقبل جلسة حساب ناقص (إكمال التوثيق والخروج). */
export async function guardSession(req: Request): Promise<{ user: CurrentUser; ipHash: string | null } | { res: Response }> {
  if (MUTATING.has(req.method) && !originOk(req)) return { res: fail(403, 'bad_origin') };
  const user = await getCurrentUser();
  if (!user) return { res: fail(401, 'unauthenticated') };
  const ipHash = clientIpHash(req);
  if (ipHash && limited(`ses:${ipHash}`, 60, 60_000)) return { res: fail(429, 'rate_limited') };
  return { user, ipHash };
}

/** الحارس الكامل: جلسة + حساب مكتمل + مؤسسة + دور يملك الإجراء. كل التفويض خارج الصفحات يمر من هنا. */
export async function guard(req: Request, action: Action): Promise<{ ctx: Ctx } | { res: Response }> {
  if (MUTATING.has(req.method) && !originOk(req)) return { res: fail(403, 'bad_origin') };
  const user = await getCurrentUser();
  if (!user) return { res: fail(401, 'unauthenticated') };
  if (!contactStatus(user).complete) return { res: fail(403, 'account_incomplete') };
  if (!user.org) return { res: fail(403, 'no_org') };
  if (!can(user.org.role, action)) return { res: fail(403, 'forbidden') };
  if (MUTATING.has(req.method) && limited(`usr:${user.id}`, 120, 60_000)) return { res: fail(429, 'rate_limited') };
  return { ctx: { user, orgId: user.org.id, role: user.org.role, ipHash: clientIpHash(req) } };
}

/** معرّف صاحب الجلسة إن وُجدت (لربط القناة الثانية عند التحقق). لا يفحص الاكتمال. */
export async function sessionUserId(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null;
}

/** قراءة JSON بحد حجم. يعيد null عند الخلل أو التجاوز. */
export async function readJson(req: Request, maxBytes = 200_000): Promise<Record<string, unknown> | null> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) return null;
  try {
    const t = await req.text();
    if (t.length > maxBytes) return null;
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}
