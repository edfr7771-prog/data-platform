import { guard, json } from '@/lib/api';
import { districtAnalytics } from '@/lib/market-data';

export async function GET(req: Request) {
  const g = await guard(req, 'analytics:read'); if ('res' in g) return g.res;
  return json({ ok: true, items: await districtAnalytics(g.ctx) });
}
