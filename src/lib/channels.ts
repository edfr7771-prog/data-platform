/**
 * القنوات (Phase 3): التحقق من التواقيع، وقراءة الحمولات الواردة، وحساب الحالة الصادقة لكل قناة.
 * نقي (node:crypto فقط) فيُختبر مباشرة. لا إرسال خارجي هنا إطلاقًا، ولا أسرار في الكود: الأسرار من البيئة فقط.
 *
 * WhatsApp: واجهة WhatsApp Business Cloud API الرسمية من Meta (webhook بمصافحة hub.challenge وتوقيع X-Hub-Signature-256).
 * Email: محوّل عام لبريد وارد من مزوّد معتمد لاحقًا: حمولة موحدة موقّعة بـHMAC (يُكتب مُحوِّل المزوّد عند اختياره).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_WEBHOOK_BYTES = 256_000;

/** يتحقق من «sha256=<hex>» = HMAC-SHA256(السر، الجسم الخام) بمقارنة ثابتة الزمن */
export function verifySignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const got = Buffer.from(m[1], 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}
export const signBody = (rawBody: string, secret: string) => `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;

export type InboundMessage = { channel: 'whatsapp' | 'email'; account: string; external_id: string; from: string; name: string | null; subject: string | null; text: string; sent_at: Date };

/** حمولة WhatsApp Cloud API: entry[].changes[].value { metadata.phone_number_id, contacts[], messages[], statuses[] } */
export function parseWhatsApp(body: unknown): { messages: InboundMessage[]; statuses: number; ignored: number } | { error: string } {
  const b = body as { object?: string; entry?: unknown[] };
  if (!b || b.object !== 'whatsapp_business_account' || !Array.isArray(b.entry)) return { error: 'not_whatsapp_payload' };
  const messages: InboundMessage[] = [];
  let statuses = 0, ignored = 0;
  for (const e of b.entry as { changes?: { field?: string; value?: Record<string, unknown> }[] }[]) {
    for (const ch of e?.changes ?? []) {
      const v = ch?.value ?? {};
      const account = String((v.metadata as { phone_number_id?: string } | undefined)?.phone_number_id ?? '');
      const names = new Map(((v.contacts as { wa_id?: string; profile?: { name?: string } }[]) ?? []).map((c) => [String(c.wa_id ?? ''), c.profile?.name ?? null]));
      statuses += Array.isArray(v.statuses) ? v.statuses.length : 0;
      for (const m of (v.messages as { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string } }[]) ?? []) {
        if (!m?.id || !m.from || !account) { ignored++; continue; }
        const ts = Number(m.timestamp);
        const text = m.type === 'text' ? String(m.text?.body ?? '') : `[${m.type ?? 'unknown'}]`;
        messages.push({ channel: 'whatsapp', account, external_id: String(m.id).slice(0, 200), from: String(m.from), name: names.get(String(m.from)) ?? null, subject: null, text: text.slice(0, 4000), sent_at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date() });
      }
    }
  }
  return { messages, statuses, ignored };
}

/** حمولة البريد الوارد الموحدة: { message_id, from, to, subject?, text, date? } ، و from مثل «الاسم <a@b.com>» أو بريد فقط */
export function parseEmailInbound(body: unknown): InboundMessage | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = String(b.message_id ?? '').trim(), to = String(b.to ?? '').trim().toLowerCase(), from = String(b.from ?? '').trim();
  if (!id || id.length > 300) return { error: 'message_id_required' };
  if (!to) return { error: 'to_required' };
  const m = /^(?:"?([^"<]*?)"?\s*<)?([^<>\s]+@[^<>\s]+)>?$/.exec(from);
  if (!m) return { error: 'from_invalid' };
  const d = b.date ? new Date(String(b.date)) : new Date();
  return { channel: 'email', account: to.replace(/^.*<|>.*$/g, ''), external_id: id, from: m[2].toLowerCase(), name: m[1]?.trim() || null, subject: b.subject ? String(b.subject).slice(0, 300) : null, text: String(b.text ?? '').slice(0, 20000), sent_at: Number.isNaN(d.getTime()) ? new Date() : d };
}

export type ChannelKey = 'whatsapp' | 'email' | 'web' | 'manual_call';
export type ChannelStatus = 'connected' | 'not_connected' | 'needs_configuration' | 'error';
export type ChannelFacts = {
  channel: ChannelKey; env_configured: boolean; account: string | null; verified_at: Date | null;
  last_processed_at: Date | null; last_rejected_at: Date | null; last_reject_reason: string | null;
};
/**
 * الحالة الصادقة: «متصلة» فقط عند ثبوت الاتصال فعليًا (رسالة موقّعة عولجت لهذه المنشأة)، لا لمجرد وجود إعداد.
 * الإرسال الخارجي غير مفعّل في كل القنوات في هذه المرحلة (لا إرسال SMS أو واتساب أو بريد دون اعتماد).
 */
export function channelStatus(f: ChannelFacts): { status: ChannelStatus; reason: string; outbound: 'disabled' } {
  const r = (status: ChannelStatus, reason: string) => ({ status, reason, outbound: 'disabled' as const });
  if (f.channel === 'manual_call') return r('connected', 'قناة داخلية: تسجيل المكالمات يدويًا، بلا خدمة اتصال آلي');
  if (f.channel === 'web') return f.account ? r('connected', 'قناة داخلية: نموذج الاستفسار على المنصة يعمل بمفتاح المنشأة') : r('needs_configuration', 'أنشئ مفتاح نموذج الاستفسار لتفعيل القناة');
  const name = f.channel === 'whatsapp' ? 'WhatsApp Business' : 'البريد الوارد';
  if (!f.env_configured) return r('not_connected', f.channel === 'whatsapp' ? 'غير مربوطة: لم تُضبط WHATSAPP_APP_SECRET وWHATSAPP_VERIFY_TOKEN على الخادم (لا حساب ولا مفاتيح)' : 'غير مربوطة: لم يُضبط EMAIL_INBOUND_SECRET على الخادم ولم يُختر مزوّد بريد');
  if (!f.account) return r('needs_configuration', f.channel === 'whatsapp' ? 'أدخل معرّف رقم واتساب الرسمي (phone_number_id) لهذه المنشأة' : 'أدخل عنوان البريد الوارد لهذه المنشأة');
  if (f.last_rejected_at && (!f.last_processed_at || f.last_rejected_at > f.last_processed_at)) return r('error', `آخر حدث رُفض: ${f.last_reject_reason ?? 'سبب غير معروف'}`);
  if (f.channel === 'whatsapp' && !f.verified_at) return r('needs_configuration', 'لم تكتمل مصافحة webhook من Meta بعد');
  if (!f.last_processed_at) return r('needs_configuration', `${name}: الإعداد مكتمل وبانتظار أول رسالة موقّعة لإثبات الاتصال`);
  return r('connected', `${name}: آخر رسالة موقّعة عولجت ${f.last_processed_at.toISOString().slice(0, 16).replace('T', ' ')} UTC`);
}
