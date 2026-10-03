import 'server-only';
import type { PoolClient } from 'pg';
import { one, q, tx } from './db';
import { auditTx } from './audit';
import { addEvent, ensureStages, isId, ownedBy } from './crm-core';
import { MATCH_STATUSES, parseMatchStatus, stageKeyFor } from './crm-rules';
import type { Ctx } from './api';

type Db = Pick<PoolClient, 'query'>;
type Row = Record<string, unknown>;

export async function listStages(ctx: Ctx, includeArchived = false) {
  await tx((c) => ensureStages(c, ctx.orgId));
  return q(`SELECT id, key, label, position, kind, archived_at FROM crm_stages WHERE org_id=$1 ${includeArchived ? '' : 'AND archived_at IS NULL'} ORDER BY position, created_at`, [ctx.orgId]);
}

/** مرحلة جديدة قبل مرحلتي الإغلاق؛ المراحل قابلة للإضافة والتسمية وإعادة الترتيب والأرشفة */
export async function createStage(ctx: Ctx, raw: Row) {
  const label = String(raw.label ?? '').trim();
  if (!label || label.length > 60) return { ok: false as const, status: 400, error: 'label_invalid' };
  return tx(async (c) => {
    await ensureStages(c, ctx.orgId);
    const keys = (await c.query<{ key: string }>(`SELECT key FROM crm_stages WHERE org_id=$1`, [ctx.orgId])).rows.map((r) => r.key);
    const lastOpen = Number((await c.query<{ p: number }>(`SELECT coalesce(max(position),0) AS p FROM crm_stages WHERE org_id=$1 AND kind='open'`, [ctx.orgId])).rows[0].p);
    await c.query(`UPDATE crm_stages SET position=position+1 WHERE org_id=$1 AND position>$2`, [ctx.orgId, lastOpen]);
    const r = (await c.query<Row>(`INSERT INTO crm_stages (org_id, key, label, position, kind) VALUES ($1,$2,$3,$4,'open') RETURNING id, key, label, position, kind`, [ctx.orgId, stageKeyFor(label, keys), label, lastOpen + 1])).rows[0];
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'stage.create', entity: 'crm_stage', entityId: r.id as string, ipHash: ctx.ipHash, meta: { key: r.key } });
    return { ok: true as const, stage: r };
  });
}

export async function updateStage(ctx: Ctx, id: string, raw: Row) {
  if (!isId(id)) return null;
  return tx(async (c) => {
    const st = (await c.query<Row>(`SELECT * FROM crm_stages WHERE id=$1 AND org_id=$2 FOR UPDATE`, [id, ctx.orgId])).rows[0];
    if (!st) return null;
    if ('label' in raw) { const l = String(raw.label ?? '').trim(); if (!l || l.length > 60) return { ok: false as const, status: 400, error: 'label_invalid' }; await c.query(`UPDATE crm_stages SET label=$2 WHERE id=$1`, [id, l]); }
    if ('position' in raw) {
      const p = Number(raw.position);
      if (!Number.isInteger(p) || p < 1) return { ok: false as const, status: 400, error: 'position_invalid' };
      const ids = (await c.query<{ id: string }>(`SELECT id FROM crm_stages WHERE org_id=$1 ORDER BY position, created_at`, [ctx.orgId])).rows.map((r) => r.id).filter((x) => x !== id);
      ids.splice(Math.min(p - 1, ids.length), 0, id);
      for (const [i, sid] of ids.entries()) await c.query(`UPDATE crm_stages SET position=$2 WHERE id=$1`, [sid, i + 1]);
    }
    if ('archived' in raw) {
      if (raw.archived) {
        const open = Number((await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM opportunities WHERE stage_id=$1 AND status='open'`, [id])).rows[0].n);
        if (open > 0) return { ok: false as const, status: 409, error: 'stage_has_open_opportunities', count: open };
        await c.query(`UPDATE crm_stages SET archived_at=now() WHERE id=$1`, [id]);
      } else await c.query(`UPDATE crm_stages SET archived_at=NULL WHERE id=$1`, [id]);
    }
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'stage.update', entity: 'crm_stage', entityId: id, ipHash: ctx.ipHash, meta: { fields: Object.keys(raw).filter((k) => ['label', 'position', 'archived'].includes(k)) } });
    return { ok: true as const, stage: (await c.query<Row>(`SELECT id, key, label, position, kind, archived_at FROM crm_stages WHERE id=$1`, [id])).rows[0] };
  });
}

async function stageBy(c: Db, orgId: string, raw: Row): Promise<Row | null> {
  if (isId(raw.stage_id)) return (await c.query<Row>(`SELECT * FROM crm_stages WHERE id=$1 AND org_id=$2 AND archived_at IS NULL`, [raw.stage_id, orgId])).rows[0] ?? null;
  const key = typeof raw.stage_key === 'string' ? raw.stage_key : 'new';
  return (await c.query<Row>(`SELECT * FROM crm_stages WHERE key=$1 AND org_id=$2 AND archived_at IS NULL`, [key, orgId])).rows[0] ?? null;
}

/** إنشاء فرصة (تستعمل داخليًا عند ربط طلب أو وصول استفسار، وعبر الـAPI) */
export async function createOpportunityTx(c: Db, orgId: string, actorId: string | null, o: { customer_id: string; request_id?: string | null; title: string; stage_key?: string; value?: number | null }, ipHash: string | null = null) {
  await ensureStages(c, orgId);
  const st = await stageBy(c, orgId, { stage_key: o.stage_key ?? 'new' });
  if (!st) throw new Error('stage_missing');
  const r = (await c.query<{ id: string }>(`INSERT INTO opportunities (org_id, customer_id, request_id, title, stage_id, status, value, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [orgId, o.customer_id, o.request_id ?? null, o.title.slice(0, 200), st.id, st.kind === 'open' ? 'open' : st.kind, o.value ?? null, actorId])).rows[0];
  await c.query(`INSERT INTO opportunity_stage_history (org_id, opportunity_id, from_stage_id, to_stage_id, changed_by, note) VALUES ($1,$2,NULL,$3,$4,'إنشاء')`, [orgId, r.id, st.id, actorId]);
  await addEvent(c, { orgId, customerId: o.customer_id, kind: 'opportunity_created', actorId, requestId: o.request_id ?? null, note: `فرصة جديدة: ${o.title} (${st.label})`, meta: { opportunity_id: r.id, stage: st.key } });
  await auditTx(c as PoolClient, { orgId, actorId, action: 'opportunity.create', entity: 'opportunity', entityId: r.id, ipHash, meta: { stage: st.key, request_id: o.request_id ?? null } });
  return r.id;
}

export async function createOpportunity(ctx: Ctx, raw: Row) {
  const title = String(raw.title ?? '').trim();
  if (!isId(raw.customer_id) || !title || title.length > 200) return { ok: false as const, status: 400, error: 'validation' };
  const value = raw.value === undefined || raw.value === null || raw.value === '' ? null : Number(raw.value);
  if (value !== null && (!Number.isFinite(value) || value < 0)) return { ok: false as const, status: 400, error: 'value_invalid' };
  return tx(async (c) => {
    if (!(await ownedBy(c, ctx.orgId, 'customers', raw.customer_id as string)) || !(await ownedBy(c, ctx.orgId, 'requests', raw.request_id as string | null))) return { ok: false as const, status: 404, error: 'not_found' };
    await ensureStages(c, ctx.orgId);
    if (raw.stage_key && !(await stageBy(c, ctx.orgId, raw))) return { ok: false as const, status: 400, error: 'stage_invalid' };
    const id = await createOpportunityTx(c, ctx.orgId, ctx.user.id, { customer_id: raw.customer_id as string, request_id: (raw.request_id as string) ?? null, title, stage_key: (raw.stage_key as string) ?? 'new', value }, ctx.ipHash);
    return { ok: true as const, id };
  });
}

/** نقل الفرصة بين المراحل مع حفظ تاريخ الانتقال، ومرحلة الإغلاق تغلق الفرصة (مكتملة أو خاسرة) */
export async function moveOpportunity(ctx: Ctx, id: string, raw: Row) {
  if (!isId(id)) return null;
  return tx(async (c) => {
    const o = (await c.query<Row>(`SELECT o.*, s.key AS stage_key, s.label AS stage_label FROM opportunities o JOIN crm_stages s ON s.id=o.stage_id WHERE o.id=$1 AND o.org_id=$2 FOR UPDATE OF o`, [id, ctx.orgId])).rows[0];
    if (!o) return null;
    const st = await stageBy(c, ctx.orgId, raw);
    if (!st) return { ok: false as const, status: 400, error: 'stage_invalid' };
    const note = raw.note ? String(raw.note).trim().slice(0, 500) : null;
    if (st.id === o.stage_id) return { ok: true as const, unchanged: true };
    const status = st.kind === 'open' ? 'open' : st.kind;
    await c.query(`UPDATE opportunities SET stage_id=$3, status=$4, closed_at=CASE WHEN $4='open' THEN NULL ELSE now() END, updated_at=now() WHERE id=$1 AND org_id=$2`, [id, ctx.orgId, st.id, status]);
    await c.query(`INSERT INTO opportunity_stage_history (org_id, opportunity_id, from_stage_id, to_stage_id, changed_by, note) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.orgId, id, o.stage_id, st.id, ctx.user.id, note]);
    await addEvent(c, { orgId: ctx.orgId, customerId: o.customer_id as string, kind: 'stage_change', actorId: ctx.user.id, requestId: (o.request_id as string) ?? null, note: `${o.title}: من «${o.stage_label}» إلى «${st.label}»${note ? ` (${note})` : ''}`, meta: { opportunity_id: id, from: o.stage_key, to: st.key } });
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'opportunity.stage', entity: 'opportunity', entityId: id, ipHash: ctx.ipHash, meta: { from: o.stage_key, to: st.key } });
    return { ok: true as const, status: status, stage_key: st.key };
  });
}

export async function getOpportunity(ctx: Ctx, id: string) {
  if (!isId(id)) return null;
  const o = await one<Row>(`SELECT o.*, s.key AS stage_key, s.label AS stage_label, c.name AS customer_name FROM opportunities o JOIN crm_stages s ON s.id=o.stage_id JOIN customers c ON c.id=o.customer_id WHERE o.id=$1 AND o.org_id=$2`, [id, ctx.orgId]);
  if (!o) return null;
  const history = await q(`SELECT h.changed_at, h.note, f.label AS from_label, t.label AS to_label, u.full_name AS by_name FROM opportunity_stage_history h LEFT JOIN crm_stages f ON f.id=h.from_stage_id JOIN crm_stages t ON t.id=h.to_stage_id LEFT JOIN users u ON u.id=h.changed_by WHERE h.opportunity_id=$1 ORDER BY h.changed_at, h.id`, [id]);
  return { opportunity: o, history };
}

/** لوحة الـPipeline: المراحل النشطة وفرص كل مرحلة */
export async function board(ctx: Ctx, f: { owner_id?: string; include_closed?: boolean } = {}) {
  const stages = await listStages(ctx);
  const args: unknown[] = [ctx.orgId]; let extra = f.include_closed ? '' : ` AND o.status='open'`;
  if (isId(f.owner_id)) { args.push(f.owner_id); extra += ` AND c.owner_id=$2`; }
  const opps = await q(`SELECT o.id, o.title, o.status, o.value, o.updated_at, o.stage_id, o.customer_id, c.name AS customer_name, c.owner_id, u.full_name AS owner_name, split_part(coalesce(r.description,''), E'\\n', 1) AS request_title
    FROM opportunities o JOIN customers c ON c.id=o.customer_id AND c.deleted_at IS NULL LEFT JOIN users u ON u.id=c.owner_id LEFT JOIN requests r ON r.id=o.request_id
    WHERE o.org_id=$1${extra} ORDER BY o.updated_at DESC LIMIT 2000`, args);
  return { stages: stages.map((s) => ({ ...s, opportunities: opps.filter((o) => o.stage_id === s.id) })) };
}

/** حالة متابعة المطابقة داخل الـCRM (لا تغيّر خوارزمية المطابقة) */
export async function setMatchStatus(ctx: Ctx, id: string, raw: Row) {
  if (!isId(id)) return null;
  const status = parseMatchStatus(raw.status);
  if (!status) return { ok: false as const, status: 400, error: 'status_invalid' };
  return tx(async (c) => {
    const m = (await c.query<Row>(`SELECT m.*, r.customer_id, r.created_by AS request_by FROM matches m JOIN requests r ON r.id=m.request_id WHERE m.id=$1 AND m.org_id=$2 FOR UPDATE OF m`, [id, ctx.orgId])).rows[0];
    if (!m) return null;
    if (m.status === status) return { ok: true as const, unchanged: true };
    await c.query(`UPDATE matches SET status=$3, status_updated_at=now(), status_by=$4, updated_at=now() WHERE id=$1 AND org_id=$2`, [id, ctx.orgId, status, ctx.user.id]);
    const label = MATCH_STATUSES.find((s) => s.value === status)!.label;
    if (m.customer_id) await addEvent(c, { orgId: ctx.orgId, customerId: m.customer_id as string, kind: 'match_status', actorId: ctx.user.id, requestId: m.request_id as string, propertyId: m.property_id as string, note: `مطابقة (${m.score}/100): ${label}`, meta: { match_id: id, from: m.status, to: status } });
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'match.status', entity: 'match', entityId: id, ipHash: ctx.ipHash, meta: { from: m.status, to: status } });
    return { ok: true as const };
  });
}
