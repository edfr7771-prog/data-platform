import { guard, json } from '@/lib/api';
import { mapData } from '@/lib/market-data';

export async function GET(req: Request) {
  const g = await guard(req, 'analytics:read'); if ('res' in g) return g.res;
  const sp = new URL(req.url).searchParams;
  const deal = ['sale', 'rent', 'investment'].includes(sp.get('deal') ?? '') ? sp.get('deal')! : undefined;
  return json({ ok: true, ...(await mapData(g.ctx, { deal, kind: sp.get('kind') ?? undefined, request_id: sp.get('request_id') ?? undefined })) });
}
