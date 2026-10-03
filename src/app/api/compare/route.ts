import { fail, guard, json } from '@/lib/api';
import { compareProperties } from '@/lib/market-data';

export async function GET(req: Request) {
  const g = await guard(req, 'analytics:read'); if ('res' in g) return g.res;
  const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const r = await compareProperties(g.ctx, ids);
  return r.ok ? json(r) : fail(r.error === 'not_found' ? 404 : 400, r.error);
}
