import 'server-only';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { q, tx } from './db';
import { audit, auditTx } from './audit';
import { appUrl } from './env';
import { addEvent, isId, notify, orgAdmins, ownedBy } from './crm-core';
import { upsertContact } from './crm-contacts';
import { createOpportunityTx } from './crm-pipeline';
import { normalizeContactEmail, normalizeContactPhone, notifKey, validateContact } from './crm-rules';
import { channelStatus, parseEmailInbound, parseWhatsApp, verifySignature, type ChannelKey, type InboundMessage } from './channels';
import type { Ctx } from './api';

type Db = Pick<PoolClient, 'query'>;
const env = {
  waSecret: () => process.env.WHATSAPP_APP_SECRET || undefined,
  waVerify: () => process.env.WHATSAPP_VERIFY_TOKEN || undefined,
  emailSecret: () => process.env.EMAIL_INBOUND_SECRET || undefined,
};

/** حالة القنوات الصادقة للمنشأة، مع روابط الـwebhook وإعداد الحساب (ليس سرًا). مفتاح نموذج الويب يظهر كاملًا لمدير المنشأة فقط. */
export async function channelsOverview(ctx: Ctx, canManage: boolean) {
  const [accounts, state, events] = await Promise.all([
    q<{ channel: string; external_id: string }>(`SELECT channel, external_id FROM channel_accounts WHERE org_id=$1`, [ctx.orgId]),
    q<{ channel: string; verified_at: Date | null; last_signature_failure_at: Date | null }>(`SELECT channel, verified_at, last_signature_failure_at FROM channel_state`),
    q<{ channel: string; status: string; at: Date; reason: string | null }>(`SELECT DISTINCT ON (channel, status) channel, status, created_at AS at, reason FROM channel_events WHERE org_id=$1 ORDER BY channel, status, created_at DESC`, [ctx.orgId]),
  ]);
  const acc = (ch: string) => accounts.find((a) => a.channel === ch)?.external_id ?? null;
  const ev = (ch: string, st: string) => events.find((e) => e.channel === ch && e.status === st);
  const base = appUrl().replace(/\/$/, '');
  const row = (key: ChannelKey, label: string, envOk: boolean, extra: Record<string, unknown>) => {
    const ch = key === 'manual_call' ? 'call' : key;
    const s = channelStatus({ channel: key, env_configured: envOk, account: key === 'manual_call' ? 'internal' : acc(ch), verified_at: state.find((x) => x.channel === ch)?.verified_at ?? null,
      last_processed_at: ev(ch, 'processed')?.at ?? null, last_rejected_at: ev(ch, 'rejected')?.at ?? null, last_reject_reason: ev(ch, 'rejected')?.reason ?? null });
    return { key, label, ...s, ...extra };
  };
  const formKey = acc('web');
  return [
    row('whatsapp', 'WhatsApp Business (الواجهة الرسمية من Meta)', !!(env.waSecret() && env.waVerify()), { account: acc('whatsapp'), webhook_url: `${base}/api/webhooks/whatsapp`, signature_failures_at: state.find((x) => x.channel === 'whatsapp')?.last_signature_failure_at ?? null }),
    row('email', 'البريد الإلكتروني (وارد)', !!env.emailSecret(), { account: acc('email'), webhook_url: `${base}/api/webhooks/email`, signature_failures_at: state.find((x) => x.channel === 'email')?.last_signature_failure_at ?? null }),
    row('web', 'استفسارات نموذج المنصة', true, { account: formKey ? (canManage ? formKey : `${formKey.slice(0, 4)}…`) : null, form_url: formKey && canManage ? `${base}/enquire/${formKey}` : null }),
    row('manual_call', 'المكالمات (تسجيل يدوي)', true, { account: null }),
  ];
}

/** ضبط حساب القناة للمنشأة (مدير المنشأة): رقم واتساب الرسمي، أو عنوان البريد الوارد، أو توليد مفتاح جديد لنموذج الويب */
export async function setChannelAccount(ctx: Ctx, channel: string, raw: Record<string, unknown>) {
  let value: string;
  if (channel === 'whatsapp') { value = String(raw.external_id ?? '').trim(); if (!/^\d{5,30}$/.test(value)) return { ok: false as const, status: 400, error: 'phone_number_id_invalid' }; }
  else if (channel === 'email') { const e = normalizeContactEmail(raw.external_id); if (!e) return { ok: false as const, status: 400, error: 'email_invalid' }; value = e; }
  else if (channel === 'web') value = randomBytes(18).toString('base64url');
  else return { ok: false as const, status: 404, error: 'unknown_channel' };
  try {
    await tx(async (c) => {
      await c.query(`INSERT INTO channel_accounts (org_id, channel, external_id, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT (org_id, channel) DO UPDATE SET external_id=EXCLUDED.external_id, created_by=EXCLUDED.created_by, created_at=now()`, [ctx.orgId, channel, value, ctx.user.id]);
      await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'channel.configure', entity: 'channel', entityId: channel, ipHash: ctx.ipHash, meta: { channel } });
    });
  } catch (e) { if ((e as { code?: string }).code === '23505') return { ok: false as const, status: 409, error: 'account_in_use' }; throw e; }
  return { ok: true as const };
}

/** مصافحة Meta: hub.mode=subscribe ومطابقة رمز التحقق من البيئة، ثم إعادة hub.challenge */
export async function whatsappVerify(params: URLSearchParams): Promise<{ ok: true; challenge: string } | { ok: false; status: number }> {
  const token = env.waVerify();
  if (!token || !env.waSecret()) return { ok: false, status: 503 };
  const got = params.get('hub.verify_token') ?? '', challenge = params.get('hub.challenge') ?? '';
  const a = Buffer.from(got), b = Buffer.from(token);
  if (params.get('hub.mode') !== 'subscribe' || a.length !== b.length || !timingSafeEqual(a, b) || !/^[\w-]{1,200}$/.test(challenge)) return { ok: false, status: 403 };
  await q(`INSERT INTO channel_state (channel, verified_at) VALUES ('whatsapp', now()) ON CONFLICT (channel) DO UPDATE SET verified_at=now()`);
  await audit({ action: 'channel.verified', entity: 'channel', entityId: 'whatsapp' });
  return { ok: true, challenge };
}

type IngestResult = { ok: true; processed: number; duplicates: number; rejected: number; ignored: number } | { ok: false; status: number; error: string };

/** يسجّل حدث القناة مرة واحدة (idempotency): إن وُجد المعرّف من قبل فهو تكرار ولا يُعالج ثانية */
async function claimEvent(c: Db, channel: string, externalId: string, orgId: string | null, status: 'processed' | 'rejected', reason: string | null) {
  const r = await c.query(`INSERT INTO channel_events (org_id, channel, external_id, status, reason) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (channel, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING id`, [orgId, channel, externalId, status, reason]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * إدخال رسالة واردة موقّعة: ربطها بالعميل (بالجوال أو البريد الموحَّد)، أو إنشاء عميل جديد بقاعدة صريحة:
 * رقم/بريد غير موجود في المنشأة = عميل جديد باسم المرسل (أو «عميل واتساب/بريد» مع آخر أرقام)، ومصدره القناة.
 */
async function ingestOne(m: InboundMessage): Promise<'processed' | 'duplicate' | 'rejected'> {
  return tx(async (c) => {
    const org = (await c.query<{ org_id: string }>(`SELECT org_id FROM channel_accounts WHERE channel=$1 AND external_id=$2`, [m.channel, m.account])).rows[0]?.org_id ?? null;
    if (!org) return (await claimEvent(c, m.channel, m.external_id, null, 'rejected', 'unknown_account')) ? 'rejected' : 'duplicate';
    const phone = m.channel === 'whatsapp' ? normalizeContactPhone(`+${m.from.replace(/^\+/, '')}`) : null;
    const email = m.channel === 'email' ? normalizeContactEmail(m.from) : null;
    if (!phone && !email) return (await claimEvent(c, m.channel, m.external_id, org, 'rejected', 'sender_invalid')) ? 'rejected' : 'duplicate';
    if (!(await claimEvent(c, m.channel, m.external_id, org, 'processed', null))) return 'duplicate';
    const fallback = m.channel === 'whatsapp' ? `عميل واتساب ${phone!.slice(-4)}` : `عميل بريد ${email!.split('@')[0].slice(0, 20)}`;
    const v = validateContact({ name: m.name && m.name.trim().length >= 2 ? m.name.slice(0, 120) : fallback, phone, email, source: m.channel });
    const u = await upsertContact(c, org, null, v.errors.length ? { name: fallback, phone_norm: phone, email_norm: email, source: m.channel, status: 'active' } : v.value, m.channel, phone ?? email);
    if (!u.ok) { await c.query(`UPDATE channel_events SET status='rejected', reason='identifier_conflict' WHERE channel=$1 AND external_id=$2`, [m.channel, m.external_id]); return 'rejected'; }
    await c.query(`INSERT INTO crm_messages (org_id, customer_id, channel, direction, external_id, sender, subject, body, sent_at) VALUES ($1,$2,$3,'in',$4,$5,$6,$7,$8)`, [org, u.id, m.channel, m.external_id, phone ?? email, m.subject, m.text, m.sent_at]);
    await addEvent(c, { orgId: org, customerId: u.id, kind: 'message_in', channel: m.channel, direction: 'in', occurredAt: m.sent_at, note: (m.subject ? `${m.subject}: ` : '') + m.text.slice(0, 500), meta: { external_id: m.external_id, created_contact: u.created } });
    const owner = (await c.query<{ owner_id: string | null; name: string }>(`SELECT owner_id, name FROM customers WHERE id=$1`, [u.id])).rows[0];
    for (const userId of owner.owner_id ? [owner.owner_id] : await orgAdmins(c, org))
      await notify(c, { orgId: org, userId, kind: 'message_in', title: `${m.channel === 'whatsapp' ? 'رسالة واتساب' : 'بريد'} جديد من «${owner.name}»`, body: m.text.slice(0, 200), entity: 'customer', entityId: u.id, link: `/app/contacts/${u.id}`, dedupeKey: notifKey.inbound(m.channel, m.external_id) });
    await auditTx(c as PoolClient, { orgId: org, action: 'channel.message_in', entity: 'customer', entityId: u.id, meta: { channel: m.channel, created_contact: u.created } });
    return 'processed';
  });
}

async function ingest(channel: 'whatsapp' | 'email', messages: InboundMessage[], ignored: number): Promise<IngestResult> {
  let processed = 0, duplicates = 0, rejected = 0;
  for (const m of messages) {
    const r = await ingestOne(m);
    if (r === 'processed') processed++; else if (r === 'duplicate') duplicates++; else rejected++;
  }
  return { ok: true, processed, duplicates, rejected, ignored };
}

async function signatureFailed(channel: 'whatsapp' | 'email') {
  await q(`INSERT INTO channel_state (channel, last_signature_failure_at) VALUES ($1, now()) ON CONFLICT (channel) DO UPDATE SET last_signature_failure_at=now()`, [channel]);
}

/** webhook واتساب: القناة معطلة بأمان بلا إعداد (503)، والتوقيع إلزامي (401)، والتكرار لا يُعالج مرتين */
export async function whatsappWebhook(rawBody: string, signature: string | null): Promise<IngestResult> {
  const secret = env.waSecret();
  if (!secret || !env.waVerify()) return { ok: false, status: 503, error: 'channel_disabled' };
  if (!verifySignature(rawBody, signature, secret)) { await signatureFailed('whatsapp'); return { ok: false, status: 401, error: 'bad_signature' }; }
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return { ok: false, status: 400, error: 'bad_json' }; }
  const p = parseWhatsApp(body);
  if ('error' in p) return { ok: false, status: 400, error: p.error };
  return ingest('whatsapp', p.messages, p.statuses + p.ignored);
}

/** webhook البريد الوارد (محوّل عام لمزوّد معتمد لاحقًا): نفس قواعد التوقيع والتكرار */
export async function emailWebhook(rawBody: string, signature: string | null): Promise<IngestResult> {
  const secret = env.emailSecret();
  if (!secret) return { ok: false, status: 503, error: 'channel_disabled' };
  if (!verifySignature(rawBody, signature, secret)) { await signatureFailed('email'); return { ok: false, status: 401, error: 'bad_signature' }; }
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return { ok: false, status: 400, error: 'bad_json' }; }
  const m = parseEmailInbound(body);
  if ('error' in m) return { ok: false, status: 400, error: m.error };
  return ingest('email', [m], 0);
}

/**
 * استفسار من نموذج المنصة (عام، بمفتاح نموذج المنشأة): ينشئ أو يحدّث العميل بلا تكرار، ويسجل حدثًا في خطه الزمني،
 * ويربط العقار أو الطلب إن أُرسل (من المنشأة نفسها فقط)، وينشئ فرصة إن لم تكن للعميل فرصة مفتوحة.
 * إرسال النموذج نفسه مرتين خلال 10 دقائق لا يُنشئ استفسارًا ثانيًا.
 */
export async function publicEnquiry(raw: Record<string, unknown>, ipHash: string | null) {
  const key = String(raw.form_key ?? '');
  if (!/^[\w-]{10,80}$/.test(key)) return { ok: false as const, status: 404, error: 'form_not_found' };
  if (raw.consent !== true) return { ok: false as const, status: 400, error: 'consent_required' };
  const message = String(raw.message ?? '').trim();
  if (!message || message.length > 2000) return { ok: false as const, status: 400, error: 'message_invalid' };
  const v = validateContact({ name: raw.name, phone: raw.phone, email: raw.email, source: 'web' });
  if (v.errors.length) return { ok: false as const, status: 400, error: 'validation', errors: v.errors };
  return tx(async (c) => {
    const org = (await c.query<{ org_id: string }>(`SELECT org_id FROM channel_accounts WHERE channel='web' AND external_id=$1`, [key])).rows[0]?.org_id;
    if (!org) return { ok: false as const, status: 404, error: 'form_not_found' };
    const propertyId = isId(raw.property_id) ? raw.property_id : null, requestId = isId(raw.request_id) ? raw.request_id : null;
    if (!(await ownedBy(c, org, 'properties', propertyId)) || !(await ownedBy(c, org, 'requests', requestId))) return { ok: false as const, status: 400, error: 'reference_invalid' };
    const u = await upsertContact(c, org, null, v.value, 'web', v.value.phone_norm ?? v.value.email_norm ?? null, ipHash);
    if (!u.ok) return { ok: false as const, status: 409, error: 'identifier_conflict' };
    const dup = (await c.query(`SELECT 1 FROM crm_messages WHERE org_id=$1 AND customer_id=$2 AND channel='web' AND body=$3 AND created_at > now() - interval '10 minutes'`, [org, u.id, message])).rowCount;
    if (dup) return { ok: true as const, duplicate: true };
    const ext = randomUUID();
    await c.query(`INSERT INTO crm_messages (org_id, customer_id, channel, direction, external_id, sender, body, property_id, sent_at) VALUES ($1,$2,'web','in',$3,$4,$5,$6,now())`, [org, u.id, ext, v.value.phone_norm ?? v.value.email_norm, message, propertyId]);
    await claimEvent(c, 'web', ext, org, 'processed', null);
    await addEvent(c, { orgId: org, customerId: u.id, kind: 'enquiry', channel: 'web', direction: 'in', propertyId, requestId, note: message.slice(0, 500), meta: { message_id: ext } });
    let opportunityId: string | null = null;
    const open = (await c.query(`SELECT 1 FROM opportunities WHERE customer_id=$1 AND org_id=$2 AND status='open'`, [u.id, org])).rowCount;
    if (!open) opportunityId = await createOpportunityTx(c, org, null, { customer_id: u.id, request_id: requestId, title: 'استفسار من نموذج المنصة', stage_key: 'new' }, ipHash);
    const owner = (await c.query<{ owner_id: string | null; name: string }>(`SELECT owner_id, name FROM customers WHERE id=$1`, [u.id])).rows[0];
    for (const userId of owner.owner_id ? [owner.owner_id] : await orgAdmins(c, org))
      await notify(c, { orgId: org, userId, kind: 'enquiry', title: `استفسار جديد من «${owner.name}»`, body: message.slice(0, 200), entity: 'customer', entityId: u.id, link: `/app/contacts/${u.id}`, dedupeKey: notifKey.inbound('web', ext) });
    await auditTx(c, { orgId: org, action: 'channel.enquiry', entity: 'customer', entityId: u.id, ipHash, meta: { created_contact: u.created, property_id: propertyId, request_id: requestId } });
    return { ok: true as const, duplicate: false, created_contact: u.created, opportunity_created: !!opportunityId };
  });
}

/** هل مفتاح النموذج صالح؟ (لصفحة النموذج العامة؛ لا يكشف اسم المنشأة ولا أي بيانات) */
export async function formKeyExists(key: string) {
  if (!/^[\w-]{10,80}$/.test(key)) return false;
  return (await q(`SELECT 1 FROM channel_accounts WHERE channel='web' AND external_id=$1`, [key])).length > 0;
}
