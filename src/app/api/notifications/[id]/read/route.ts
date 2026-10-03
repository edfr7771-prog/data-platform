import { fail, guard, json } from '@/lib/api';
import { markRead } from '@/lib/crm-notify';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, 'crm:read'); if ('res' in g) return g.res;
  return (await markRead(g.ctx, (await params).id)) ? json({ ok: true }) : fail(404, 'not_found');
}
