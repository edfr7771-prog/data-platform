import { guard, json } from '@/lib/api';
import { orgMembers } from '@/lib/crm-contacts';

/** أعضاء المنشأة لاختيار المسؤول والمكلّف (الاسم والدور فقط) */
export async function GET(req: Request) {
  const g = await guard(req, 'crm:read'); if ('res' in g) return g.res;
  return json({ ok: true, items: await orgMembers(g.ctx) });
}
