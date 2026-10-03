import { fail, guard, json } from '@/lib/api';
import { approveContactsImport } from '@/lib/crm-import';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, 'crm:write'); if ('res' in g) return g.res;
  const r = await approveContactsImport(g.ctx, (await params).id);
  if (!r) return fail(404, 'not_found');
  return r.ok ? json(r) : fail(r.status, r.error);
}
