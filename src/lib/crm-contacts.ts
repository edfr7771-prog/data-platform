import 'server-only';
import type { PoolClient } from 'pg';
import { one, q, tx } from './db';
import { auditTx } from './audit';
import { loadGeo } from './properties';
import { addEvent, ensureStages, isId, isMember, notify } from './crm-core';
import { dedupeDecision, mergeMissing, nameKey, notifKey, suggestionsFor, validateCall, validateContact, type ContactValue } from './crm-rules';
import type { Issue } from './property-rules';
import type { Ctx } from './api';

type Db = Pick<PoolClient, 'query'>;
type Row = Record<string, unknown>;
const CHANNEL_NOTE_AR: Record<string, string> = { manual: 'الإضافة اليدوية', web: 'نموذج المنصة', whatsapp: 'واتساب', email: 'البريد', call: 'مكالمة', import: 'الاستيراد' };
const FIELDS = `c.id, c.name, c.phone_norm AS phone, c.email_norm AS email, c.type, c.source, c.status, c.city_id, ci.name_ar AS city_name, c.district_ids, c.owner_id,
  u.full_name AS owner_name, c.notes, c.last_contact_at, c.next_follow_up_at, c.created_at, c.updated_at`;
const FROM = `customers c LEFT JOIN cities ci ON ci.id=c.city_id LEFT JOIN users u ON u.id=c.owner_id`;

export type ContactResult = { ok: true; contact: Row; deduplicated: boolean; matched_by?: string[] } | { ok: false; status: number; error: string; errors?: Issue[]; ids?: string[] };

/** يجد عميلًا نشطًا في المنشأة بالجوال أو البريد الموحَّدين */
async function findBy(c: Db, orgId: string, phone: string | null | undefined, email: string | null | undefined) {
  const byPhone = phone ? (await c.query<{ id: string }>(`SELECT id FROM customers WHERE org_id=$1 AND phone_norm=$2 AND deleted_at IS NULL`, [orgId, phone])).rows[0]?.id ?? null : null;
  const byEmail = email ? (await c.query<{ id: string }>(`SELECT id FROM customers WHERE org_id=$1 AND email_norm=$2 AND deleted_at IS NULL`, [orgId, email])).rows[0]?.id ?? null : null;
  return dedupeDecision(byPhone, byEmail);
}

async function recordSource(c: Db, orgId: string, customerId: string, channel: string, identifier: string | null) {
  await c.query(`INSERT INTO customer_sources (org_id, customer_id, channel, identifier) VALUES ($1,$2,$3,$4)
    ON CONFLICT (customer_id, channel, coalesce(identifier, '')) DO UPDATE SET last_seen_at=now()`, [orgId, customerId, channel, identifier]);
}

/**
 * إنشاء عميل أو ربط القادم بملفه الموجود (قاعدة واحدة لكل القنوات: الجوال أو البريد الموحَّد).
 * عند المطابقة تُملأ الحقول الفارغة فقط، ويُسجَّل وصوله من القناة في الخط الزمني ومصادره. التعارض لا يُحسم آليًا.
 */
export async function upsertContact(c: Db, orgId: string, actorId: string | null, v: Partial<ContactValue>, channel: string, identifier: string | null, ipHash: string | null = null):
  Promise<{ ok: true; id: string; created: boolean; matched_by: string[]; conflicts: string[] } | { ok: false; error: 'identifier_conflict'; ids: string[] }> {
  const d = await findBy(c, orgId, v.phone_norm, v.email_norm);
  if (d.action === 'conflict') return { ok: false, error: 'identifier_conflict', ids: d.ids };
  if (d.action === 'match') {
    const cur = (await c.query<Row>(`SELECT * FROM customers WHERE id=$1`, [d.id])).rows[0];
    const { patch, conflicts } = mergeMissing(cur, v as Row, ['phone_norm', 'email_norm', 'type', 'city_id', 'owner_id', 'notes']);
    const sets = Object.keys(patch);
    if (sets.length) await c.query(`UPDATE customers SET ${sets.map((k, i) => `${k}=$${i + 3}`).join(', ')}, updated_at=now() WHERE id=$1 AND org_id=$2`, [d.id, orgId, ...sets.map((k) => patch[k])]);
    await recordSource(c, orgId, d.id, channel, identifier);
    await addEvent(c, { orgId, customerId: d.id, kind: 'identified', actorId, channel, note: `وصل العميل عبر ${CHANNEL_NOTE_AR[channel] ?? channel}، وطابق ملفه الحالي بـ${d.by.map((b) => (b === 'phone' ? 'الجوال' : 'البريد')).join(' و')}`, meta: { by: d.by, filled: sets, conflicts } });
    await auditTx(c as PoolClient, { orgId, actorId, action: 'contact.dedupe', entity: 'customer', entityId: d.id, ipHash, meta: { channel, by: d.by, filled: sets, conflicts } });
    return { ok: true, id: d.id, created: false, matched_by: d.by, conflicts };
  }
  const r = (await c.query<{ id: string }>(`INSERT INTO customers (org_id, name, phone, email, phone_norm, email_norm, type, source, status, city_id, district_ids, owner_id, next_follow_up_at, notes, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [orgId, v.name, v.phone_norm ?? null, v.email_norm ?? null, v.phone_norm ?? null, v.email_norm ?? null, v.type ?? null, v.source ?? channel, v.status ?? 'active', v.city_id ?? null, v.district_ids ?? [], v.owner_id ?? null, v.next_follow_up_at ?? null, v.notes ?? null, actorId])).rows[0];
  await recordSource(c, orgId, r.id, channel, identifier);
  await addEvent(c, { orgId, customerId: r.id, kind: 'created', actorId, channel, note: 'أُنشئ ملف العميل' });
  await auditTx(c as PoolClient, { orgId, actorId, action: 'contact.create', entity: 'customer', entityId: r.id, ipHash, meta: { channel } });
  return { ok: true, id: r.id, created: true, matched_by: [], conflicts: [] };
}

/** تحقق مرجعي داخل المنشأة: المدينة والأحياء من المرجع، والمسؤول عضو نشط في المنشأة نفسها */
async function checkRefs(c: Db, orgId: string, v: Partial<ContactValue>): Promise<Issue[]> {
  const errors: Issue[] = [];
  if (v.city_id || v.district_ids?.length) {
    const geo = await loadGeo();
    if (v.city_id && !geo.cities.some((x) => x.id === v.city_id)) errors.push({ code: 'city_unknown', field: 'city_id', message: 'المدينة غير موجودة في المرجع' });
    if (v.district_ids?.some((d) => !geo.districts.some((x) => x.id === d))) errors.push({ code: 'district_unknown', field: 'district_ids', message: 'حي غير موجود في المرجع' });
  }
  if (v.owner_id && !(await isMember(c, orgId, v.owner_id))) errors.push({ code: 'owner_not_member', field: 'owner_id', message: 'المسؤول ليس عضوًا في المنشأة' });
  return errors;
}

const pgUnique = (e: unknown) => (e as { code?: string }).code === '23505';

export async function createContact(ctx: Ctx, raw: Row): Promise<ContactResult> {
  const v = validateContact(raw);
  if (v.errors.length) return { ok: false, status: 400, error: 'validation', errors: v.errors };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await tx(async (c) => {
        const refErr = await checkRefs(c, ctx.orgId, v.value);
        if (refErr.length) return { ok: false as const, status: 400, error: 'validation', errors: refErr };
        const u = await upsertContact(c, ctx.orgId, ctx.user.id, v.value, v.value.source ?? 'manual', v.value.phone_norm ?? v.value.email_norm ?? null, ctx.ipHash);
        if (!u.ok) return { ok: false as const, status: 409, error: u.error, ids: u.ids };
        return { ok: true as const, id: u.id, created: u.created, by: u.matched_by };
      });
      if (!res.ok) return res;
      return { ok: true, contact: (await getContactRow(ctx.orgId, res.id))!, deduplicated: !res.created, matched_by: res.by };
    } catch (e) { if (!pgUnique(e) || attempt) throw e; } // سباق متزامن على المعرّف نفسه: أعد المحاولة فتطابق الملف الذي أُنشئ للتو
  }
  return { ok: false, status: 409, error: 'conflict' };
}

export async function getContactRow(orgId: string, id: string): Promise<Row | null> {
  if (!isId(id)) return null;
  return one<Row>(`SELECT ${FIELDS} FROM ${FROM} WHERE c.id=$1 AND c.org_id=$2 AND c.deleted_at IS NULL`, [id, orgId]);
}

export async function updateContact(ctx: Ctx, id: string, patch: Row): Promise<ContactResult | null> {
  if (!isId(id)) return null;
  const allowed = ['name', 'phone', 'email', 'type', 'status', 'city_id', 'district_ids', 'owner_id', 'next_follow_up_at', 'notes'];
  const input = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
  const v = validateContact(input, { partial: true });
  if (v.errors.length) return { ok: false, status: 400, error: 'validation', errors: v.errors };
  try {
    return await tx(async (c) => {
      const cur = (await c.query<Row>(`SELECT * FROM customers WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, ctx.orgId])).rows[0];
      if (!cur) return null;
      const refErr = await checkRefs(c, ctx.orgId, v.value);
      if (refErr.length) return { ok: false as const, status: 400, error: 'validation', errors: refErr };
      const next = { ...cur, ...v.value };
      if (!next.phone_norm && !next.email_norm) return { ok: false as const, status: 400, error: 'validation', errors: [{ code: 'identifier_required', field: 'phone', message: 'يبقى للعميل جوال أو بريد على الأقل' }] };
      const cols = Object.keys(v.value) as (keyof ContactValue)[];
      if (!cols.length) return { ok: true as const, contact: (await getContactRow(ctx.orgId, id))!, deduplicated: false };
      const setCols = cols.flatMap((k) => (k === 'phone_norm' ? ['phone_norm', 'phone'] : k === 'email_norm' ? ['email_norm', 'email'] : [k]));
      const vals = setCols.map((k) => (k === 'phone' ? v.value.phone_norm : k === 'email' ? v.value.email_norm : (v.value as Row)[k]));
      await c.query(`UPDATE customers SET ${setCols.map((k, i) => `${k}=$${i + 3}`).join(', ')}, updated_at=now() WHERE id=$1 AND org_id=$2`, [id, ctx.orgId, ...vals]);
      const changed = cols.filter((k) => String((cur as Row)[k] ?? '') !== String((v.value as Row)[k] ?? ''));
      if ('owner_id' in v.value && cur.owner_id !== v.value.owner_id) {
        await addEvent(c, { orgId: ctx.orgId, customerId: id, kind: 'assigned', actorId: ctx.user.id, note: v.value.owner_id ? 'تغيّر المسؤول عن العميل' : 'أُزيل المسؤول عن العميل', meta: { from: cur.owner_id, to: v.value.owner_id } });
        await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'contact.assign', entity: 'customer', entityId: id, ipHash: ctx.ipHash, meta: { from: cur.owner_id, to: v.value.owner_id } });
        if (v.value.owner_id) await notify(c, { orgId: ctx.orgId, userId: v.value.owner_id, kind: 'assigned', title: `أُسند إليك العميل «${next.name}»`, entity: 'customer', entityId: id, link: `/app/contacts/${id}`, dedupeKey: notifKey.assigned(id, v.value.owner_id, new Date()) }, ctx.user.id);
      }
      const other = changed.filter((k) => k !== 'owner_id');
      if (other.length) {
        await addEvent(c, { orgId: ctx.orgId, customerId: id, kind: 'updated', actorId: ctx.user.id, note: 'تحدّثت بيانات العميل', meta: { fields: other } });
        await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'contact.update', entity: 'customer', entityId: id, ipHash: ctx.ipHash, meta: { fields: other } });
      }
      return { ok: true as const, contact: (await c.query<Row>(`SELECT ${FIELDS} FROM ${FROM} WHERE c.id=$1`, [id])).rows[0], deduplicated: false };
    });
  } catch (e) { if (pgUnique(e)) return { ok: false, status: 409, error: 'identifier_taken' }; throw e; }
}

export type ContactFilters = { q?: string; city_id?: string; status?: string; owner_id?: string; stage?: string; source?: string; contacted_before?: string; contacted_after?: string; follow_up_due?: boolean; has_request?: boolean; has_match?: boolean; page?: number; pageSize?: number };
/** البحث والفلترة على كل مدن المنشأة (لا تقييد بمدينة واحدة). كل المدخلات معاملات SQL. */
export async function listContacts(ctx: Ctx, f: ContactFilters) {
  const pageSize = Math.min(100, Math.max(1, Math.floor(f.pageSize ?? 25))), page = Math.max(1, Math.floor(f.page ?? 1));
  const where = ['c.org_id=$1', 'c.deleted_at IS NULL'], args: unknown[] = [ctx.orgId];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
  const qtext = (f.q ?? '').trim().slice(0, 100);
  if (qtext) {
    const digits = qtext.replace(/[^\d]/g, '');
    args.push(`%${qtext.replace(/[%_\\]/g, (m) => '\\' + m)}%`); const i = args.length;
    const parts = [`c.name ILIKE $${i}`, `c.email_norm ILIKE $${i}`];
    if (digits.length >= 4) { args.push(`%${digits.replace(/^0/, '')}%`); parts.push(`c.phone_norm LIKE $${args.length}`); }
    where.push(`(${parts.join(' OR ')})`);
  }
  if (isId(f.city_id)) add('c.city_id=?', f.city_id);
  if (f.status && ['active', 'inactive', 'do_not_contact'].includes(f.status)) add('c.status=?', f.status);
  if (f.owner_id === 'none') where.push('c.owner_id IS NULL'); else if (isId(f.owner_id)) add('c.owner_id=?', f.owner_id);
  if (f.source && /^[a-z]{2,20}$/.test(f.source)) add('c.source=?', f.source);
  if (f.contacted_before && !Number.isNaN(Date.parse(f.contacted_before))) add('(c.last_contact_at IS NULL OR c.last_contact_at < ?)', new Date(f.contacted_before));
  if (f.contacted_after && !Number.isNaN(Date.parse(f.contacted_after))) add('c.last_contact_at >= ?', new Date(f.contacted_after));
  if (f.follow_up_due) where.push('c.next_follow_up_at IS NOT NULL AND c.next_follow_up_at <= now()');
  if (f.has_request) where.push(`EXISTS (SELECT 1 FROM requests r WHERE r.customer_id=c.id AND r.org_id=c.org_id AND r.deleted_at IS NULL AND r.status='open')`);
  if (f.has_match) where.push(`EXISTS (SELECT 1 FROM matches m JOIN requests r ON r.id=m.request_id WHERE r.customer_id=c.id AND m.org_id=c.org_id AND m.eligible AND r.deleted_at IS NULL)`);
  if (f.stage && /^[a-z][a-z0-9_]{1,40}$/.test(f.stage)) add(`EXISTS (SELECT 1 FROM opportunities o JOIN crm_stages s ON s.id=o.stage_id WHERE o.customer_id=c.id AND o.org_id=c.org_id AND o.status='open' AND s.key=?)`, f.stage);
  const W = where.join(' AND ');
  const total = Number((await one<{ n: string }>(`SELECT count(*)::text AS n FROM customers c WHERE ${W}`, args))!.n);
  const rows = await q<Row>(`SELECT ${FIELDS},
      (SELECT s.label FROM opportunities o JOIN crm_stages s ON s.id=o.stage_id WHERE o.customer_id=c.id AND o.status='open' ORDER BY o.updated_at DESC LIMIT 1) AS stage_label,
      (SELECT count(*)::int FROM requests r WHERE r.customer_id=c.id AND r.deleted_at IS NULL AND r.status='open') AS open_requests,
      (SELECT count(*)::int FROM matches m JOIN requests r ON r.id=m.request_id WHERE r.customer_id=c.id AND m.eligible AND m.status='new' AND r.deleted_at IS NULL) AS new_matches
    FROM ${FROM} WHERE ${W} ORDER BY coalesce(c.next_follow_up_at, 'infinity') ASC, c.updated_at DESC, c.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, args);
  return { items: rows, total, page, pageSize };
}

/** ملف العميل الموحد: البيانات، المصادر، الطلبات، المطابقات وحالاتها، الفرص، المهام، الرسائل، الاقتراحات، واحتمالات التكرار */
export async function getContactProfile(ctx: Ctx, id: string) {
  const contact = await getContactRow(ctx.orgId, id);
  if (!contact) return null;
  await tx(async (c) => ensureStages(c, ctx.orgId));
  const [sources, requests, matches, opportunities, tasks, messages, candidates, stages] = await Promise.all([
    q(`SELECT channel, identifier, first_seen_at, last_seen_at FROM customer_sources WHERE customer_id=$1 AND org_id=$2 ORDER BY first_seen_at`, [id, ctx.orgId]),
    q(`SELECT id, purpose, kinds, status, description, budget_max, created_at FROM requests WHERE customer_id=$1 AND org_id=$2 AND deleted_at IS NULL AND purpose IS NOT NULL ORDER BY created_at DESC`, [id, ctx.orgId]),
    q(`SELECT m.id, m.request_id, m.property_id, m.score, m.explanation AS reasons, m.status, m.eligible, m.status_updated_at, p.kind, p.type, p.deal, p.price, p.area_sqm, d.name_ar AS district_name, split_part(coalesce(p.description,''), E'\\n', 1) AS property_title
      FROM matches m JOIN requests r ON r.id=m.request_id JOIN properties p ON p.id=m.property_id LEFT JOIN districts d ON d.id=p.district_id
      WHERE r.customer_id=$1 AND m.org_id=$2 AND r.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY m.eligible DESC, m.score DESC, m.created_at DESC LIMIT 100`, [id, ctx.orgId]),
    q(`SELECT o.id, o.title, o.status, o.request_id, o.value, o.updated_at, s.key AS stage_key, s.label AS stage_label, s.kind AS stage_kind FROM opportunities o JOIN crm_stages s ON s.id=o.stage_id WHERE o.customer_id=$1 AND o.org_id=$2 ORDER BY o.status='open' DESC, o.updated_at DESC`, [id, ctx.orgId]),
    q(`SELECT t.id, t.title, t.status, t.priority, t.due_at, t.completed_at, t.assignee_id, u.full_name AS assignee_name FROM crm_tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.customer_id=$1 AND t.org_id=$2 ORDER BY (t.status IN ('done','cancelled')), t.due_at NULLS LAST LIMIT 100`, [id, ctx.orgId]),
    q(`SELECT id, channel, direction, sender, subject, body, sent_at FROM crm_messages WHERE customer_id=$1 AND org_id=$2 ORDER BY sent_at DESC LIMIT 50`, [id, ctx.orgId]),
    q<{ id: string; name: string }>(`SELECT id, name FROM customers WHERE org_id=$1 AND deleted_at IS NULL AND id<>$2 ORDER BY updated_at DESC LIMIT 5000`, [ctx.orgId, id]),
    q(`SELECT id, key, label, kind, position FROM crm_stages WHERE org_id=$1 AND archived_at IS NULL ORDER BY position`, [ctx.orgId]),
  ]);
  const key = nameKey(contact.name);
  const duplicates = candidates.filter((x) => key.length >= 3 && nameKey(x.name) === key).slice(0, 5).map((x) => ({ id: x.id, name: x.name, reason: 'نفس الاسم بعد التوحيد، بمعرّفات تواصل مختلفة' }));
  const now = new Date();
  const open = opportunities.find((o) => o.status === 'open');
  const newM = matches.filter((m) => m.status === 'new' && m.eligible);
  const suggestions = suggestionsFor({
    now, created_at: new Date(contact.created_at as string), last_contact_at: contact.last_contact_at ? new Date(contact.last_contact_at as string) : null,
    next_follow_up_at: contact.next_follow_up_at ? new Date(contact.next_follow_up_at as string) : null, status: String(contact.status),
    stage: open ? { key: String(open.stage_key), label: String(open.stage_label), kind: String(open.stage_kind) } : null, has_request: requests.length > 0,
    new_matches: { count: newM.length, request_title: newM.length ? String(requests.find((r) => r.id === newM[0].request_id)?.description ?? '').split('\n')[0] || null : null },
    overdue_tasks: tasks.filter((t) => ['open', 'in_progress'].includes(String(t.status)) && t.due_at && new Date(t.due_at as string) < now).map((t) => ({ title: String(t.title), due_at: new Date(t.due_at as string) })),
    duplicates,
  });
  return { contact, sources, requests, matches, opportunities, tasks, messages, stages, suggestions: { provider: 'rules', items: suggestions }, duplicates };
}

/** الخط الزمني مرتبًا زمنيًا (الأحدث أولًا)، مع ترقيم بالمؤشر */
export async function timeline(ctx: Ctx, id: string, f: { before?: string; limit?: number } = {}) {
  if (!(await getContactRow(ctx.orgId, id))) return null;
  const limit = Math.min(200, Math.max(1, f.limit ?? 50));
  const args: unknown[] = [id, ctx.orgId];
  let extra = '';
  if (f.before && !Number.isNaN(Date.parse(f.before))) { args.push(new Date(f.before)); extra = ` AND i.occurred_at < $3`; }
  const items = await q(`SELECT i.id, i.kind, i.note, i.channel, i.direction, i.request_id, i.property_id, i.meta, i.occurred_at, u.full_name AS actor_name
    FROM customer_interactions i LEFT JOIN users u ON u.id=i.created_by WHERE i.customer_id=$1 AND i.org_id=$2${extra} ORDER BY i.occurred_at DESC, i.created_at DESC LIMIT ${limit}`, args);
  return { items };
}

/** «تسجيل مكالمة» يدويًا: لا اتصال آلي. يسجل في الخط الزمني، ويحدّث آخر تواصل، ويضبط المتابعة وينشئ مهمتها إن حُددت. */
export async function logCall(ctx: Ctx, id: string, raw: Row) {
  const v = validateCall(raw);
  if (!v.value) return { ok: false as const, status: 400, errors: v.errors };
  const call = v.value;
  return tx(async (c) => {
    const cur = (await c.query<{ id: string; name: string; owner_id: string | null; phone_norm: string | null }>(`SELECT id, name, owner_id, phone_norm FROM customers WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, ctx.orgId])).rows[0];
    if (!cur) return null;
    await addEvent(c, { orgId: ctx.orgId, customerId: id, kind: 'call', actorId: ctx.user.id, channel: 'call', direction: call.direction, occurredAt: call.occurred_at, note: call.notes, meta: { outcome: call.outcome, next_step: call.next_step, follow_up_at: call.follow_up_at?.toISOString() ?? null, manual: true } });
    await recordSource(c, ctx.orgId, id, 'call', cur.phone_norm);
    let taskId: string | null = null;
    if (call.follow_up_at) {
      await c.query(`UPDATE customers SET next_follow_up_at=$3, updated_at=now() WHERE id=$1 AND org_id=$2`, [id, ctx.orgId, call.follow_up_at]);
      taskId = (await c.query<{ id: string }>(`INSERT INTO crm_tasks (org_id, title, customer_id, assignee_id, due_at, priority, notes, created_by) VALUES ($1,$2,$3,$4,$5,'normal',$6,$7) RETURNING id`,
        [ctx.orgId, `متابعة: ${call.next_step ?? cur.name}`.slice(0, 200), id, cur.owner_id ?? ctx.user.id, call.follow_up_at, call.notes, ctx.user.id])).rows[0].id;
      await addEvent(c, { orgId: ctx.orgId, customerId: id, kind: 'task_created', actorId: ctx.user.id, note: `مهمة متابعة: ${call.next_step ?? 'متابعة العميل'}`, meta: { task_id: taskId } });
    }
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'contact.call', entity: 'customer', entityId: id, ipHash: ctx.ipHash, meta: { direction: call.direction, outcome: call.outcome, task_id: taskId } });
    return { ok: true as const, task_id: taskId };
  });
}

export async function addNote(ctx: Ctx, id: string, raw: Row) {
  const note = String(raw.note ?? '').trim();
  if (!note || note.length > 2000) return { ok: false as const, status: 400, errors: [{ code: 'note_invalid', field: 'note', message: 'الملاحظة مطلوبة (حتى 2000 حرف)' }] };
  return tx(async (c) => {
    if (!(await c.query(`SELECT 1 FROM customers WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, [id, ctx.orgId])).rowCount) return null;
    await addEvent(c, { orgId: ctx.orgId, customerId: id, kind: 'note', actorId: ctx.user.id, note });
    return { ok: true as const };
  });
}

/**
 * دمج يدوي صريح لملفين (مدير المنشأة): ينقل الطلبات والخط الزمني والمهام والفرص والرسائل والمصادر إلى الملف الهدف،
 * ويملأ فراغاته فقط، ويُبقي الملف المدموج محذوفًا ناعمًا مع إشارة merged_into. لا دمج تلقائي بالاسم أبدًا.
 */
export async function mergeContacts(ctx: Ctx, sourceId: string, targetId: string) {
  if (!isId(sourceId) || !isId(targetId) || sourceId === targetId) return { ok: false as const, status: 400, error: 'bad_ids' };
  return tx(async (c) => {
    const rows = (await c.query<Row>(`SELECT * FROM customers WHERE id = ANY($1) AND org_id=$2 AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [[sourceId, targetId], ctx.orgId])).rows;
    const src = rows.find((r) => r.id === sourceId), dst = rows.find((r) => r.id === targetId);
    if (!src || !dst) return { ok: false as const, status: 404, error: 'not_found' };
    const { patch, conflicts } = mergeMissing(dst, src, ['phone_norm', 'email_norm', 'type', 'city_id', 'owner_id', 'notes', 'next_follow_up_at']);
    // أفرغ معرّفات المصدر أولًا لتتحرر القيود الفريدة، ثم انقلها إلى الهدف
    await c.query(`UPDATE customers SET phone_norm=NULL, email_norm=NULL, deleted_at=now(), merged_into=$3, updated_at=now() WHERE id=$1 AND org_id=$2`, [sourceId, ctx.orgId, targetId]);
    const sets = Object.keys(patch);
    if (sets.length) await c.query(`UPDATE customers SET ${sets.map((k, i) => `${k}=$${i + 3}`).join(', ')}, phone=coalesce(phone, phone_norm), email=coalesce(email, email_norm), updated_at=now() WHERE id=$1 AND org_id=$2`, [targetId, ctx.orgId, ...sets.map((k) => patch[k])]);
    await c.query(`UPDATE customers SET last_contact_at=greatest(last_contact_at, $3) WHERE id=$1 AND org_id=$2`, [targetId, ctx.orgId, src.last_contact_at ?? null]);
    for (const t of ['requests', 'customer_interactions', 'crm_tasks', 'opportunities', 'crm_messages']) await c.query(`UPDATE ${t} SET customer_id=$3 WHERE customer_id=$1 AND org_id=$2`, [sourceId, ctx.orgId, targetId]);
    await c.query(`DELETE FROM customer_sources s WHERE s.customer_id=$1 AND EXISTS (SELECT 1 FROM customer_sources t WHERE t.customer_id=$2 AND t.channel=s.channel AND coalesce(t.identifier,'')=coalesce(s.identifier,''))`, [sourceId, targetId]);
    await c.query(`UPDATE customer_sources SET customer_id=$2 WHERE customer_id=$1`, [sourceId, targetId]);
    await addEvent(c, { orgId: ctx.orgId, customerId: targetId, kind: 'merged', actorId: ctx.user.id, note: `دُمج ملف «${src.name}» في هذا الملف`, meta: { merged_id: sourceId, filled: sets, conflicts } });
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'contact.merge', entity: 'customer', entityId: targetId, ipHash: ctx.ipHash, meta: { merged_id: sourceId, filled: sets, conflicts } });
    return { ok: true as const, id: targetId, filled: sets, conflicts };
  });
}

/** أعضاء المنشأة (للمسؤول والمكلّف): الاسم والدور فقط */
export async function orgMembers(ctx: Ctx) {
  return q(`SELECT u.id, u.full_name, m.role FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.deleted_at IS NULL AND u.is_active ORDER BY u.full_name`, [ctx.orgId]);
}
