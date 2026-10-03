import 'server-only';
import type { PoolClient } from 'pg';
import { one, q, tx } from './db';
import { isId, notify, requestRecipient } from './crm-core';
import { notifKey, riyadhDay } from './crm-rules';
import type { Ctx } from './api';

type Db = Pick<PoolClient, 'query'>;

/** تنبيه مسؤول الطلب بكل عرض مطابق جديد (مرة واحدة لكل طلب×عقار)، وتنبيه صاحب العرض بأن طلبًا يناسبه */
export async function notifyNewMatches(c: Db, orgId: string, requestId: string, propertyIds: string[], actorId: string | null) {
  if (!propertyIds.length) return 0;
  const rec = await requestRecipient(c, orgId, requestId);
  let n = 0;
  for (const pid of propertyIds) {
    const p = (await c.query<{ created_by: string | null; title: string }>(`SELECT created_by, split_part(coalesce(description, ''), E'\\n', 1) AS title FROM properties WHERE id=$1 AND org_id=$2`, [pid, orgId])).rows[0];
    if (!p) continue;
    if (await notify(c, { orgId, userId: rec.userId, kind: 'match_found', title: `عرض مطابق جديد لطلب «${rec.title || 'طلب'}»`, body: p.title || null, entity: 'request', entityId: requestId, link: rec.customerId ? `/app/contacts/${rec.customerId}` : `/app/requests`, dedupeKey: notifKey.matchFound(requestId, pid) }, actorId)) n++;
    await notify(c, { orgId, userId: p.created_by, kind: 'request_for_offer', title: `طلب مناسب لعرضك «${p.title || 'عقار'}»`, body: rec.title || null, entity: 'property', entityId: pid, link: `/app/requests`, dedupeKey: notifKey.requestForOffer(pid, requestId) }, actorId);
  }
  return n;
}

/**
 * فحص الاستحقاق: مواعيد متابعة العملاء التي حلّت، والمهام المتأخرة. كل حدث يُنبَّه مرة واحدة (مفتاح يتضمن الموعد نفسه).
 * يُشغَّل عند فتح التنبيهات (بحد مرة كل دقيقة لكل منشأة في هذه النسخة) أو عبر POST /api/crm/sweep.
 */
const lastSweep = new Map<string, number>();
export async function runSweep(orgId: string, force = false): Promise<{ followups: number; overdue: number } | null> {
  const now = Date.now();
  if (!force && (lastSweep.get(orgId) ?? 0) > now - 60_000) return null;
  lastSweep.set(orgId, now);
  return tx(async (c) => {
    let followups = 0, overdue = 0;
    const due = (await c.query<{ id: string; name: string; owner_id: string | null; created_by: string | null; next_follow_up_at: Date }>(
      `SELECT id, name, owner_id, created_by, next_follow_up_at FROM customers WHERE org_id=$1 AND deleted_at IS NULL AND status<>'do_not_contact' AND next_follow_up_at <= now() LIMIT 1000`, [orgId])).rows;
    for (const d of due) if (await notify(c, { orgId, userId: d.owner_id ?? d.created_by, kind: 'follow_up_due', title: `حلّ موعد متابعة العميل «${d.name}»`, body: `الموعد ${riyadhDay(d.next_follow_up_at)}`, entity: 'customer', entityId: d.id, link: `/app/contacts/${d.id}`, dedupeKey: notifKey.followUp(d.id, d.next_follow_up_at) })) followups++;
    const late = (await c.query<{ id: string; title: string; assignee_id: string | null; created_by: string | null; customer_id: string | null; due_at: Date }>(
      `SELECT id, title, assignee_id, created_by, customer_id, due_at FROM crm_tasks WHERE org_id=$1 AND status IN ('open','in_progress') AND due_at < now() LIMIT 1000`, [orgId])).rows;
    for (const t of late) if (await notify(c, { orgId, userId: t.assignee_id ?? t.created_by, kind: 'task_overdue', title: `مهمة متأخرة: ${t.title}`, body: `موعدها ${riyadhDay(t.due_at)}`, entity: 'task', entityId: t.id, link: t.customer_id ? `/app/contacts/${t.customer_id}` : '/app/tasks', dedupeKey: notifKey.taskOverdue(t.id, t.due_at) })) overdue++;
    return { followups, overdue };
  });
}

export async function listNotifications(ctx: Ctx, f: { unread?: boolean; limit?: number } = {}) {
  await runSweep(ctx.orgId).catch((e) => console.error('[crm] sweep failed', (e as Error).message));
  const limit = Math.min(200, Math.max(1, f.limit ?? 50));
  const items = await q(`SELECT id, kind, title, body, entity, entity_id, link, read_at, created_at FROM notifications WHERE user_id=$1 AND org_id=$2 ${f.unread ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC LIMIT ${limit}`, [ctx.user.id, ctx.orgId]);
  const unread = Number((await one<{ n: string }>(`SELECT count(*)::text AS n FROM notifications WHERE user_id=$1 AND org_id=$2 AND read_at IS NULL`, [ctx.user.id, ctx.orgId]))!.n);
  return { items, unread };
}
export async function unreadCount(userId: string, orgId: string) {
  return Number((await one<{ n: string }>(`SELECT count(*)::text AS n FROM notifications WHERE user_id=$1 AND org_id=$2 AND read_at IS NULL`, [userId, orgId]))!.n);
}
/** قراءة تنبيه: صاحبه فقط، داخل منشأته */
export async function markRead(ctx: Ctx, id: string) {
  if (!isId(id)) return false;
  const r = await q(`UPDATE notifications SET read_at=coalesce(read_at, now()) WHERE id=$1 AND user_id=$2 AND org_id=$3 RETURNING id`, [id, ctx.user.id, ctx.orgId]);
  return r.length > 0;
}
export async function markAllRead(ctx: Ctx) {
  const r = await q(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND org_id=$2 AND read_at IS NULL RETURNING id`, [ctx.user.id, ctx.orgId]);
  return r.length;
}
