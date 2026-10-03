import { fail, guard, json, readJson } from '@/lib/api';
import { createContact, listContacts } from '@/lib/crm-contacts';

/** قائمة العملاء بالبحث والفلترة على كل مدن المنشأة */
export async function GET(req: Request) {
  const g = await guard(req, 'crm:read'); if ('res' in g) return g.res;
  const sp = new URL(req.url).searchParams, b = (k: string) => sp.get(k) === '1' || sp.get(k) === 'true';
  const data = await listContacts(g.ctx, {
    q: sp.get('q') ?? undefined, city_id: sp.get('city_id') ?? undefined, status: sp.get('status') ?? undefined, owner_id: sp.get('owner_id') ?? undefined,
    stage: sp.get('stage') ?? undefined, source: sp.get('source') ?? undefined, contacted_before: sp.get('contacted_before') ?? undefined, contacted_after: sp.get('contacted_after') ?? undefined,
    follow_up_due: b('follow_up_due'), has_request: b('has_request'), has_match: b('has_match'), page: Number(sp.get('page') ?? 1) || 1, pageSize: Number(sp.get('pageSize') ?? 25) || 25,
  });
  return json({ ok: true, ...data });
}

/** إنشاء عميل، أو ربطه بملفه الموجود إن تطابق الجوال أو البريد (deduplicated=true) */
export async function POST(req: Request) {
  const g = await guard(req, 'crm:write'); if ('res' in g) return g.res;
  const b = await readJson(req, 20_000); if (!b) return fail(400, 'bad_json');
  const r = await createContact(g.ctx, b);
  return r.ok ? json({ ok: true, contact: r.contact, deduplicated: r.deduplicated, matched_by: r.matched_by }, r.deduplicated ? 200 : 201) : fail(r.status, r.error, { errors: r.errors, ids: r.ids });
}
