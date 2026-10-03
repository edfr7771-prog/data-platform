import { fail, guard, json } from '@/lib/api';
import { getContactsImport } from '@/lib/crm-import';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, 'crm:write'); if ('res' in g) return g.res;
  const r = await getContactsImport(g.ctx, (await params).id);
  return r ? json({ ok: true, ...r }) : fail(404, 'not_found');
}
