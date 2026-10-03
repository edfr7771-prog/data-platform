import { fail, guardPublic, json, readJson, sessionUserId } from '@/lib/api';
import { accountComplete, createSession, destroySession, verifyOtp } from '@/lib/auth';

const STATUS = { invalid: 400, expired: 410, too_many: 429, taken: 409 } as const;

export async function POST(req: Request) {
  const g = await guardPublic(req); if ('res' in g) return g.res;
  const b = await readJson(req); if (!b) return fail(400, 'bad_json');
  const r = await verifyOtp(String(b.challengeId ?? ''), String(b.code ?? ''), 'v1', (await sessionUserId()) ?? undefined);
  if (!r.ok) return fail(STATUS[r.error], r.error);
  const complete = await accountComplete(r.userId);
  if (r.purpose !== 'attach') {
    await destroySession();          // جلسة جديدة عند كل دخول (لا تثبيت جلسة قديمة)
    await createSession(r.userId);
  }
  return json({ ok: true, purpose: r.purpose, isNew: r.isNew, complete, next: complete ? '/app' : '/complete' });
}
