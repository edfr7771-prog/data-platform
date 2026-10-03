import { fail, guard, json } from '@/lib/api';
import { matchesFor } from '@/lib/requests';

/** مطابقات الطلب من البيانات المنظمة، مع أسباب كل درجة وعدد المستبعد حسب السبب. تُحفظ لقطة النتائج في matches. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, 'request:read'); if ('res' in g) return g.res;
  const r = await matchesFor(g.ctx, (await params).id);
  return r ? json({ ok: true, ...r }) : fail(404, 'not_found');
}
