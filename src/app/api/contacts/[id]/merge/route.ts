import { fail, guard, json, readJson } from '@/lib/api';
import { mergeContacts } from '@/lib/crm-contacts';

/** دمج يدوي صريح: يُدمج هذا الملف في الملف «into» (مدير المنشأة فقط) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, 'crm:manage'); if ('res' in g) return g.res;
  const b = await readJson(req, 5_000); if (!b) return fail(400, 'bad_json');
  const r = await mergeContacts(g.ctx, (await params).id, String(b.into ?? ''));
  return r.ok ? json(r) : fail(r.status, r.error);
}
