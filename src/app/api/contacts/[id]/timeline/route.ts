import { fail, guard, json } from '@/lib/api';
import { timeline } from '@/lib/crm-contacts';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, 'crm:read'); if ('res' in g) return g.res;
  const sp = new URL(req.url).searchParams;
  const t = await timeline(g.ctx, (await params).id, { before: sp.get('before') ?? undefined, limit: Number(sp.get('limit') ?? 50) || 50 });
  return t ? json({ ok: true, ...t }) : fail(404, 'not_found');
}
