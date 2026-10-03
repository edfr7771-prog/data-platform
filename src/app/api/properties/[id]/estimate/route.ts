import { fail, guard, json } from '@/lib/api';
import { estimateFor } from '@/lib/market-data';

/** تقدير القيمة من مقارنات المؤسسة الفعلية، أو رفض صريح عند نقص العينة */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, 'analytics:read'); if ('res' in g) return g.res;
  const r = await estimateFor(g.ctx, (await params).id);
  return r ? json({ ok: true, ...r }) : fail(404, 'not_found');
}
