import 'server-only';
import type { PoolClient } from 'pg';
import { DEFAULT_STAGES } from './crm-rules';

/** عمليات قاعدة البيانات المشتركة للـCRM. كل دالة تأخذ عميل معاملة لتبقى العملية وأثرها في معاملة واحدة. */
type Db = Pick<PoolClient, 'query'>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

/** أنواع أحداث الخط الزمني التي تعني «تواصلًا فعليًا» مع العميل (تحدّث آخر تواصل) */
const CONTACT_KINDS = new Set(['call', 'message_in', 'message_out', 'enquiry']);
export type TimelineEvent = {
  orgId: string; customerId: string; kind: string; note?: string | null; actorId?: string | null;
  channel?: string | null; direction?: 'in' | 'out' | null; requestId?: string | null; propertyId?: string | null;
  meta?: Record<string, unknown>; occurredAt?: Date;
};
/** يسجّل حدثًا في الخط الزمني للعميل، ويحدّث «آخر تواصل» إن كان الحدث تواصلًا فعليًا (بالأحدث فقط) */
export async function addEvent(c: Db, e: TimelineEvent): Promise<void> {
  const at = e.occurredAt ?? new Date();
  await c.query(`INSERT INTO customer_interactions (org_id, customer_id, kind, note, created_by, occurred_at, channel, direction, request_id, property_id, meta)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [e.orgId, e.customerId, e.kind, e.note ?? null, e.actorId ?? null, at, e.channel ?? null, e.direction ?? null, e.requestId ?? null, e.propertyId ?? null, JSON.stringify(e.meta ?? {})]);
  if (CONTACT_KINDS.has(e.kind)) await c.query(`UPDATE customers SET last_contact_at = greatest(coalesce(last_contact_at, $3), $3), updated_at=now() WHERE id=$1 AND org_id=$2`, [e.customerId, e.orgId, at]);
}

export type Notice = { orgId: string; userId: string | null | undefined; kind: string; title: string; body?: string | null; entity?: string | null; entityId?: string | null; link?: string | null; dedupeKey: string };
/**
 * تنبيه داخلي لمستخدم داخل منشأته. نفس الحدث (dedupeKey) لا يُنشئ تنبيهًا ثانيًا للمستخدم نفسه (قيد فريد في القاعدة).
 * لا يُرسل أي شيء خارج المنصة (لا SMS ولا واتساب ولا بريد). يعيد true إن أُنشئ تنبيه جديد.
 */
export async function notify(c: Db, n: Notice, actorId?: string | null): Promise<boolean> {
  if (!n.userId || n.userId === actorId) return false; // لا يُنبَّه الفاعل على فعله
  // المستلم يجب أن يكون عضوًا نشطًا في المنشأة نفسها
  if (!(await isMember(c, n.orgId, n.userId))) return false;
  const r = await c.query(`INSERT INTO notifications (user_id, org_id, kind, title, body, entity, entity_id, link, dedupe_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [n.userId, n.orgId, n.kind, n.title.slice(0, 200), n.body ?? null, n.entity ?? null, isId(n.entityId) ? n.entityId : null, n.link ?? null, n.dedupeKey]);
  return (r.rowCount ?? 0) > 0;
}

export async function isMember(c: Db, orgId: string, userId: string): Promise<boolean> {
  if (!isId(userId)) return false;
  const r = await c.query(`SELECT 1 FROM organization_members WHERE org_id=$1 AND user_id=$2 AND deleted_at IS NULL`, [orgId, userId]);
  return (r.rowCount ?? 0) > 0;
}
/** مديرو المنشأة (لتنبيهات الأحداث التي ليس لها مسؤول محدد) */
export async function orgAdmins(c: Db, orgId: string): Promise<string[]> {
  return (await c.query<{ user_id: string }>(`SELECT user_id FROM organization_members WHERE org_id=$1 AND role='org_admin' AND deleted_at IS NULL`, [orgId])).rows.map((r) => r.user_id);
}

/** المراحل الافتراضية تُنشأ لكل منشأة عند أول استعمال، ثم تبقى قابلة للتعديل والإضافة (ليست ثابتة في الكود) */
export async function ensureStages(c: Db, orgId: string): Promise<void> {
  const n = Number((await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM crm_stages WHERE org_id=$1`, [orgId])).rows[0].n);
  if (n > 0) return;
  for (const [i, s] of DEFAULT_STAGES.entries())
    await c.query(`INSERT INTO crm_stages (org_id, key, label, position, kind) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (org_id, key) DO NOTHING`, [orgId, s.key, s.label, i + 1, s.kind]);
}

/** يتحقق أن معرّفات الربط تخص المنشأة نفسها (عميل، طلب، عقار، فرصة)، فلا ربط عبر المنشآت */
export async function ownedBy(c: Db, orgId: string, table: 'customers' | 'requests' | 'properties' | 'opportunities', id: string | null | undefined): Promise<boolean> {
  if (!id) return true;
  if (!isId(id)) return false;
  const soft = table === 'opportunities' ? '' : ' AND deleted_at IS NULL';
  const r = await c.query(`SELECT 1 FROM ${table} WHERE id=$1 AND org_id=$2${soft}`, [id, orgId]);
  return (r.rowCount ?? 0) > 0;
}

/** مستلم أحداث الطلب: مسؤول العميل المرتبط، وإلا منشئ الطلب */
export async function requestRecipient(c: Db, orgId: string, requestId: string): Promise<{ userId: string | null; customerId: string | null; title: string }> {
  const r = (await c.query<{ owner_id: string | null; created_by: string | null; customer_id: string | null; description: string | null }>(
    `SELECT cu.owner_id, r.created_by, r.customer_id, r.description FROM requests r LEFT JOIN customers cu ON cu.id=r.customer_id AND cu.deleted_at IS NULL WHERE r.id=$1 AND r.org_id=$2`, [requestId, orgId])).rows[0];
  return { userId: r?.owner_id ?? r?.created_by ?? null, customerId: r?.customer_id ?? null, title: (r?.description ?? '').split('\n')[0] };
}
