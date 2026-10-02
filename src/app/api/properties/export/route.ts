import { guard } from '@/lib/api';
import { audit } from '@/lib/audit';
import { toCsv } from '@/lib/csv-export';
import { exportRows } from '@/lib/properties';

/** تصدير CSV محصَّن من حقن الصيغ، ولمؤسسة صاحب الطلب وحدها. التصدير نفسه يُسجَّل في التدقيق. */
export async function GET(req: Request) {
  const g = await guard(req, 'property:export'); if ('res' in g) return g.res;
  const rows = await exportRows(g.ctx);
  await audit({ orgId: g.ctx.orgId, actorId: g.ctx.user.id, action: 'property.export', entity: 'property', ipHash: g.ctx.ipHash, meta: { rows: rows.length - 1 } });
  return new Response(toCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="properties.csv"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
