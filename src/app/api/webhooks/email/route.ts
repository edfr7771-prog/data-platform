import { fail, guardWebhook, json } from '@/lib/api';
import { MAX_WEBHOOK_BYTES } from '@/lib/channels';
import { emailWebhook } from '@/lib/crm-channels';

/** بريد وارد من مزوّد معتمد (حمولة موحدة): توقيع X-Inbound-Signature إلزامي (verifySignature داخل emailWebhook) */
export async function POST(req: Request) {
  const g = await guardWebhook(req); if ('res' in g) return g.res;
  if (Number(req.headers.get('content-length') ?? 0) > MAX_WEBHOOK_BYTES) return fail(413, 'too_large');
  const raw = await req.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return fail(413, 'too_large');
  const r = await emailWebhook(raw, req.headers.get('x-inbound-signature'));
  return r.ok ? json(r) : fail(r.status, r.error);
}
