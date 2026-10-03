import { guard, json } from '@/lib/api';
import { listNotifications } from '@/lib/crm-notify';

/** تنبيهات المستخدم في منشأته (يُفحص الاستحقاق قبلها) */
export async function GET(req: Request) {
  const g = await guard(req, 'crm:read'); if ('res' in g) return g.res;
  const sp = new URL(req.url).searchParams;
  return json({ ok: true, ...(await listNotifications(g.ctx, { unread: sp.get('unread') === '1', limit: Number(sp.get('limit') ?? 50) || 50 })) });
}
