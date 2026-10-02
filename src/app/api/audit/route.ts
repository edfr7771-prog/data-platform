import { guard, json } from '@/lib/api';
import { q } from '@/lib/db';

/** سجل التدقيق لمؤسسة صاحب الطلب فقط، ولمدير المؤسسة وحده. لا يُعرض فيه عنوان IP ولو مجزَّأ. */
export async function GET(req: Request) {
  const g = await guard(req, 'audit:read'); if ('res' in g) return g.res;
  const action = new URL(req.url).searchParams.get('action');
  const rows = await q(`SELECT a.created_at, a.action, a.entity, a.entity_id, a.meta, u.full_name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.org_id = $1 ${action ? 'AND a.action = $2' : ''} ORDER BY a.created_at DESC LIMIT 100`, action ? [g.ctx.orgId, action] : [g.ctx.orgId]);
  return json({ ok: true, items: rows });
}
