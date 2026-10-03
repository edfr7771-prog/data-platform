import { guard, json } from '@/lib/api';
import { markAllRead } from '@/lib/crm-notify';

export async function POST(req: Request) {
  const g = await guard(req, 'crm:read'); if ('res' in g) return g.res;
  return json({ ok: true, updated: await markAllRead(g.ctx) });
}
