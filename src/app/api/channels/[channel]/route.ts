import { fail, guard, json, readJson } from '@/lib/api';
import { setChannelAccount } from '@/lib/crm-channels';

/** ضبط حساب القناة للمنشأة (مدير المنشأة). لا أسرار هنا: الأسرار في بيئة الخادم فقط */
export async function PUT(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const g = await guard(req, 'crm:manage'); if ('res' in g) return g.res;
  const b = await readJson(req, 2_000); if (!b) return fail(400, 'bad_json');
  const r = await setChannelAccount(g.ctx, (await params).channel, b);
  return r.ok ? json({ ok: true }) : fail(r.status, r.error);
}
