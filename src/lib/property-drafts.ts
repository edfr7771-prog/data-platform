import 'server-only';
import { one, q } from './db';
import { isUuid } from './properties';
import { getKind, sanitizeDraft } from './property-schema';
import type { Ctx } from './api';

/** مسودات الإدخال المنظم: يراها صاحبها وحده داخل مؤسسته. لا تحقق إلزامي (المسودة قد تكون ناقصة). */
const MAX_DRAFTS = 50;
type Row = { id: string; data: Record<string, unknown>; created_at: Date; updated_at: Date };
const summary = (r: Row) => {
  const k = getKind(r.data.kind);
  return { id: r.id, kind: k?.key ?? null, kind_label: k?.label ?? null, deal: typeof r.data.deal === 'string' ? r.data.deal : null, updated_at: r.updated_at };
};

export async function listDrafts(ctx: Ctx) {
  const rows = await q<Row>(`SELECT id, data, created_at, updated_at FROM property_drafts WHERE org_id=$1 AND created_by=$2 ORDER BY updated_at DESC LIMIT ${MAX_DRAFTS}`, [ctx.orgId, ctx.user.id]);
  return rows.map(summary);
}

export async function getDraft(ctx: Ctx, id: string) {
  if (!isUuid(id)) return null;
  const r = await one<Row>(`SELECT id, data, created_at, updated_at FROM property_drafts WHERE id=$1 AND org_id=$2 AND created_by=$3`, [id, ctx.orgId, ctx.user.id]);
  return r ? { id: r.id, data: r.data, updated_at: r.updated_at } : null;
}

export async function createDraft(ctx: Ctx, data: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const n = Number((await one<{ n: string }>(`SELECT count(*)::text AS n FROM property_drafts WHERE org_id=$1 AND created_by=$2`, [ctx.orgId, ctx.user.id]))!.n);
  if (n >= MAX_DRAFTS) return { ok: false, error: 'draft_limit' };
  const r = await one<{ id: string }>(`INSERT INTO property_drafts (org_id, created_by, data) VALUES ($1,$2,$3) RETURNING id`, [ctx.orgId, ctx.user.id, JSON.stringify(sanitizeDraft(data))]);
  return { ok: true, id: r!.id };
}

export async function updateDraft(ctx: Ctx, id: string, data: unknown): Promise<boolean> {
  if (!isUuid(id)) return false;
  const r = await q(`UPDATE property_drafts SET data=$4, updated_at=now() WHERE id=$1 AND org_id=$2 AND created_by=$3 RETURNING id`, [id, ctx.orgId, ctx.user.id, JSON.stringify(sanitizeDraft(data))]);
  return r.length > 0;
}

export async function deleteDraft(ctx: Ctx, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const r = await q(`DELETE FROM property_drafts WHERE id=$1 AND org_id=$2 AND created_by=$3 RETURNING id`, [id, ctx.orgId, ctx.user.id]);
  return r.length > 0;
}
