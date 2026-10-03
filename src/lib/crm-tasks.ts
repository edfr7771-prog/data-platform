import 'server-only';
import { q, tx } from './db';
import { auditTx } from './audit';
import { addEvent, isId, isMember, notify, ownedBy } from './crm-core';
import { notifKey, riyadhDay, TASK_STATUSES, validateTask } from './crm-rules';
import type { Ctx } from './api';

type Row = Record<string, unknown>;
const COLS = `t.id, t.title, t.customer_id, cu.name AS customer_name, t.request_id, t.property_id, t.opportunity_id, t.assignee_id, u.full_name AS assignee_name,
  t.due_at, t.priority, t.status, t.notes, t.completed_at, t.created_by, t.created_at, t.updated_at`;
const FROM = `crm_tasks t LEFT JOIN customers cu ON cu.id=t.customer_id LEFT JOIN users u ON u.id=t.assignee_id`;

async function refsOk(c: Parameters<typeof ownedBy>[0], orgId: string, v: Row) {
  return (await ownedBy(c, orgId, 'customers', v.customer_id as string)) && (await ownedBy(c, orgId, 'requests', v.request_id as string))
    && (await ownedBy(c, orgId, 'properties', v.property_id as string)) && (await ownedBy(c, orgId, 'opportunities', v.opportunity_id as string))
    && (!v.assignee_id || (await isMember(c, orgId, v.assignee_id as string)));
}

export async function createTask(ctx: Ctx, raw: Row) {
  const v = validateTask(raw);
  if (v.errors.length) return { ok: false as const, status: 400, errors: v.errors };
  return tx(async (c) => {
    if (!(await refsOk(c, ctx.orgId, v.value as Row))) return { ok: false as const, status: 400, errors: [{ code: 'ref_invalid', message: 'عميل أو طلب أو عقار أو فرصة أو مكلّف لا يخص المنشأة' }] };
    const assignee = v.value.assignee_id ?? ctx.user.id;
    const t = (await c.query<{ id: string }>(`INSERT INTO crm_tasks (org_id, title, customer_id, request_id, property_id, opportunity_id, assignee_id, due_at, priority, status, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [ctx.orgId, v.value.title, v.value.customer_id ?? null, v.value.request_id ?? null, v.value.property_id ?? null, v.value.opportunity_id ?? null, assignee, v.value.due_at ?? null, v.value.priority ?? 'normal', v.value.status ?? 'open', v.value.notes ?? null, ctx.user.id])).rows[0];
    if (v.value.customer_id) await addEvent(c, { orgId: ctx.orgId, customerId: v.value.customer_id, kind: 'task_created', actorId: ctx.user.id, requestId: v.value.request_id ?? null, propertyId: v.value.property_id ?? null, note: `مهمة: ${v.value.title}${v.value.due_at ? ` (موعدها ${riyadhDay(v.value.due_at)})` : ''}`, meta: { task_id: t.id } });
    await notify(c, { orgId: ctx.orgId, userId: assignee, kind: 'task_assigned', title: `مهمة جديدة: ${v.value.title}`, entity: 'task', entityId: t.id, link: v.value.customer_id ? `/app/contacts/${v.value.customer_id}` : '/app/tasks', dedupeKey: `task_assigned:${t.id}:${assignee}` }, ctx.user.id);
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'task.create', entity: 'task', entityId: t.id, ipHash: ctx.ipHash, meta: { customer_id: v.value.customer_id ?? null } });
    return { ok: true as const, task: (await c.query<Row>(`SELECT ${COLS} FROM ${FROM} WHERE t.id=$1`, [t.id])).rows[0] };
  });
}

/** تعديل المهمة. تغيّر الحالة يُسجَّل في الخط الزمني والتدقيق ويُنبَّه المكلّف والمنشئ (لا الفاعل نفسه) */
export async function updateTask(ctx: Ctx, id: string, raw: Row) {
  if (!isId(id)) return null;
  const allowed = ['title', 'due_at', 'priority', 'status', 'notes', 'assignee_id', 'customer_id', 'request_id', 'property_id', 'opportunity_id'];
  const v = validateTask(Object.fromEntries(Object.entries(raw).filter(([k]) => allowed.includes(k))), { partial: true });
  if (v.errors.length) return { ok: false as const, status: 400, errors: v.errors };
  return tx(async (c) => {
    const cur = (await c.query<Row>(`SELECT * FROM crm_tasks WHERE id=$1 AND org_id=$2 FOR UPDATE`, [id, ctx.orgId])).rows[0];
    if (!cur) return null;
    if (!(await refsOk(c, ctx.orgId, v.value as Row))) return { ok: false as const, status: 400, errors: [{ code: 'ref_invalid', message: 'ربط لا يخص المنشأة' }] };
    const cols = Object.keys(v.value);
    if (!cols.length) return { ok: true as const, task: cur };
    const statusChanged = 'status' in v.value && v.value.status !== cur.status;
    const done = statusChanged && v.value.status === 'done';
    const extra = statusChanged ? `, completed_at=${done ? 'now()' : 'NULL'}` : '';
    await c.query(`UPDATE crm_tasks SET ${cols.map((k, i) => `${k}=$${i + 3}`).join(', ')}${extra}, updated_at=now() WHERE id=$1 AND org_id=$2`, [id, ctx.orgId, ...cols.map((k) => (v.value as Row)[k])]);
    const title = String(v.value.title ?? cur.title);
    if (statusChanged) {
      const label = TASK_STATUSES.find((s) => s.value === v.value.status)!.label;
      const customerId = (v.value.customer_id ?? cur.customer_id) as string | null;
      if (customerId) await addEvent(c, { orgId: ctx.orgId, customerId, kind: done ? 'task_done' : 'task_status', actorId: ctx.user.id, note: `${title}: ${label}`, meta: { task_id: id, from: cur.status, to: v.value.status } });
      const at = new Date();
      for (const u of new Set([cur.assignee_id as string | null, cur.created_by as string | null]))
        await notify(c, { orgId: ctx.orgId, userId: u, kind: 'task_status', title: `تغيّرت حالة مهمة «${title}» إلى «${label}»`, entity: 'task', entityId: id, link: customerId ? `/app/contacts/${customerId}` : '/app/tasks', dedupeKey: notifKey.taskStatus(id, String(v.value.status), at) }, ctx.user.id);
      await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: done ? 'task.complete' : 'task.status', entity: 'task', entityId: id, ipHash: ctx.ipHash, meta: { from: cur.status, to: v.value.status } });
    } else await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'task.update', entity: 'task', entityId: id, ipHash: ctx.ipHash, meta: { fields: cols } });
    if ('assignee_id' in v.value && v.value.assignee_id && v.value.assignee_id !== cur.assignee_id)
      await notify(c, { orgId: ctx.orgId, userId: v.value.assignee_id, kind: 'task_assigned', title: `أُسندت إليك مهمة: ${title}`, entity: 'task', entityId: id, link: '/app/tasks', dedupeKey: `task_assigned:${id}:${v.value.assignee_id}` }, ctx.user.id);
    return { ok: true as const, task: (await c.query<Row>(`SELECT ${COLS} FROM ${FROM} WHERE t.id=$1`, [id])).rows[0] };
  });
}

/** عروض المهام بتوقيت الرياض: اليوم، المتأخرة، القادمة (ومنها بلا موعد)، المكتملة */
export async function listTasks(ctx: Ctx, f: { view?: string; assignee?: string; customer_id?: string } = {}) {
  const now = new Date();
  const dayEnd = new Date(`${riyadhDay(now)}T00:00:00+03:00`); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const where = ['t.org_id=$1'], args: unknown[] = [ctx.orgId, now, dayEnd];
  const active = `t.status IN ('open','in_progress')`;
  const view = ['today', 'overdue', 'upcoming', 'done'].includes(f.view ?? '') ? f.view : 'today';
  if (view === 'overdue') where.push(`${active} AND t.due_at < $2`);
  else if (view === 'today') where.push(`${active} AND t.due_at >= $2 AND t.due_at < $3`);
  else if (view === 'upcoming') where.push(`${active} AND (t.due_at >= $3 OR t.due_at IS NULL)`);
  else where.push(`t.status IN ('done','cancelled')`);
  if (f.assignee !== 'all') { args.push(isId(f.assignee) ? f.assignee : ctx.user.id); where.push(`t.assignee_id=$${args.length}`); }
  if (isId(f.customer_id)) { args.push(f.customer_id); where.push(`t.customer_id=$${args.length}`); }
  const order = view === 'done' ? 't.completed_at DESC NULLS LAST' : 't.due_at ASC NULLS LAST';
  const items = await q(`SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')} AND $2::timestamptz IS NOT NULL AND $3::timestamptz IS NOT NULL ORDER BY ${order}, t.created_at LIMIT 500`, args);
  const counts = (await q<{ v: string; n: number }>(`SELECT CASE WHEN status IN ('done','cancelled') THEN 'done' WHEN due_at < $2 THEN 'overdue' WHEN due_at < $3 THEN 'today' ELSE 'upcoming' END AS v, count(*)::int AS n
    FROM crm_tasks WHERE org_id=$1 ${f.assignee !== 'all' ? `AND assignee_id=$4` : ''} GROUP BY 1`, f.assignee !== 'all' ? [ctx.orgId, now, dayEnd, isId(f.assignee) ? f.assignee : ctx.user.id] : [ctx.orgId, now, dayEnd]));
  return { view, items, counts: Object.fromEntries(counts.map((x) => [x.v, x.n])) };
}
