import { fail, guardWebhook, json } from '@/lib/api';
import { MAX_WEBHOOK_BYTES } from '@/lib/channels';
import { whatsappVerify, whatsappWebhook } from '@/lib/crm-channels';

/** مصافحة Meta لتسجيل الـwebhook */
export async function GET(req: Request) {
  const g = await guardWebhook(req); if ('res' in g) return g.res;
  const r = await whatsappVerify(new URL(req.url).searchParams);
  return r.ok ? new Response(r.challenge, { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } }) : fail(r.status, r.status === 503 ? 'channel_disabled' : 'forbidden');
}

/** رسائل واردة من WhatsApp Business Cloud API: توقيع X-Hub-Signature-256 إلزامي (verifySignature داخل whatsappWebhook) */
export async function POST(req: Request) {
  const g = await guardWebhook(req); if ('res' in g) return g.res;
  if (Number(req.headers.get('content-length') ?? 0) > MAX_WEBHOOK_BYTES) return fail(413, 'too_large');
  const raw = await req.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return fail(413, 'too_large');
  const r = await whatsappWebhook(raw, req.headers.get('x-hub-signature-256'));
  return r.ok ? json(r) : fail(r.status, r.error);
}
