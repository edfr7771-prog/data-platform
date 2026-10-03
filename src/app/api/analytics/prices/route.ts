import { guard, json } from '@/lib/api';
import { priceIntel } from '@/lib/market-data';

export async function GET(req: Request) {
  const g = await guard(req, 'analytics:read'); if ('res' in g) return g.res;
  const sp = new URL(req.url).searchParams;
  return json({ ok: true, ...(await priceIntel(g.ctx, { market: sp.get('market') ?? undefined, kind: sp.get('kind') ?? undefined })) });
}
