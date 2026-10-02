import { guardSession, json } from '@/lib/api';
import { destroySession } from '@/lib/auth';

export async function POST(req: Request) {
  const g = await guardSession(req); if ('res' in g) return g.res;
  await destroySession();
  return json({ ok: true });
}
