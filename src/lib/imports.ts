import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { one, q, tx } from './db';
import { auditTx } from './audit';
import { FIELDS, parseCsvText, processRows, suggestMapping, summarize, validateUpload, type Mapping, type ProcessedRow } from './csv-rules';
import { INSERT_COL_COUNT, INSERT_SQL, isUuid, loadGeo, propertyValues } from './properties';
import { dedupeKey, type CleanProperty } from './property-rules';
import type { Ctx } from './api';

export const maxImportBytes = () => Math.max(1, Number(process.env.MAX_IMPORT_MB ?? 5)) * 1048576;
const safeName = (n: string) => n.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 200) || 'upload.csv';

async function existingKeys(c: { query: PoolClient['query'] } | null, orgId: string): Promise<Set<string>> {
  const sql = `SELECT dedupe_key AS k FROM properties WHERE org_id=$1 AND deleted_at IS NULL AND dedupe_key IS NOT NULL`;
  const rows = c ? (await c.query<{ k: string }>(sql, [orgId])).rows : await q<{ k: string }>(sql, [orgId]);
  return new Set(rows.map((r) => r.k));
}

async function insertRows(c: PoolClient, importId: string, rows: ProcessedRow[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const ch = rows.slice(i, i + 500);
    await c.query(
      `INSERT INTO import_rows (import_id, row_number, raw, normalized, status, issues)
       SELECT $1, * FROM unnest($2::int[], $3::jsonb[], $4::jsonb[], $5::text[], $6::jsonb[])`,
      [importId, ch.map((r) => r.row_number), ch.map((r) => JSON.stringify(r.raw)), ch.map((r) => (r.normalized ? JSON.stringify(r.normalized) : null)), ch.map((r) => r.status), ch.map((r) => JSON.stringify(r.issues))],
    );
  }
}

const previewRows = (rows: { row_number: number; raw: string[]; status: string; issues: unknown }[]) => rows.map((r) => ({ row_number: r.row_number, raw: r.raw, status: r.status, issues: r.issues }));

export type PreviewResult = { ok: true; import: { id: string; filename: string; status: string; header: string[]; mapping: Mapping; summary: Record<string, unknown> }; rows: ReturnType<typeof previewRows> } | { ok: false; error: string };

export async function createImportPreview(ctx: Ctx, file: { name: string; size: number; bytes: Uint8Array }): Promise<PreviewResult> {
  const v = validateUpload({ filename: file.name, size: file.size }, file.bytes, maxImportBytes());
  if (!v.ok) return { ok: false, error: v.error };
  const p = parseCsvText(v.text);
  if ('error' in p) return { ok: false, error: p.error };
  const mapping = suggestMapping(p.header);
  const processed = processRows(p.rows, mapping, await loadGeo(), await existingKeys(null, ctx.orgId));
  const summary = { ...summarize(processed), header: p.header, encoding: v.encoding };
  const id = randomUUID(), name = safeName(file.name);
  await tx(async (c) => {
    const src = (await c.query<{ id: string }>(`INSERT INTO data_sources (org_id, kind, name) VALUES ($1,'USER_UPLOADED',$2) RETURNING id`, [ctx.orgId, name])).rows[0];
    await c.query(`INSERT INTO imports (id, org_id, filename, mapping, summary, source_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, ctx.orgId, name, JSON.stringify(mapping), JSON.stringify(summary), src.id, ctx.user.id]);
    await insertRows(c, id, processed);
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'import.preview', entity: 'import', entityId: id, ipHash: ctx.ipHash, meta: { rows: processed.length } });
  });
  return { ok: true, import: { id, filename: name, status: 'previewed', header: p.header, mapping, summary }, rows: previewRows(processed.slice(0, 100)) };
}

export async function getImport(ctx: Ctx, id: string, opts: { status?: string; limit?: number } = {}) {
  if (!isUuid(id)) return null;
  const imp = await one<{ id: string; filename: string; status: string; mapping: Mapping; summary: Record<string, unknown> & { header?: string[] }; created_at: Date; approved_at: Date | null }>(
    `SELECT id, filename, status, mapping, summary, created_at, approved_at FROM imports WHERE id=$1 AND org_id=$2`, [id, ctx.orgId]);
  if (!imp) return null;
  const lim = Math.min(500, Math.max(1, opts.limit ?? 100));
  const rows = await q<{ row_number: number; raw: string[]; status: string; issues: unknown }>(
    `SELECT row_number, raw, status, issues FROM import_rows WHERE import_id=$1 ${opts.status ? 'AND status=$3' : ''} ORDER BY row_number LIMIT $2`, opts.status ? [id, lim, opts.status] : [id, lim]);
  return { import: { ...imp, header: imp.summary.header ?? [] }, rows };
}

/** يعيد تصنيف الصفوف بتطابق أعمدة جديد. الصفوف الأصلية (raw) لا تُمسّ أبدًا: يُحدَّث التصنيف والتطبيع فقط. */
export async function remapImport(ctx: Ctx, id: string, input: unknown): Promise<{ ok: true; summary: Record<string, unknown> } | { ok: false; error: string; status: number }> {
  if (!isUuid(id)) return { ok: false, error: 'not_found', status: 404 };
  const imp = await one<{ status: string; summary: { header?: string[] } }>(`SELECT status, summary FROM imports WHERE id=$1 AND org_id=$2`, [id, ctx.orgId]);
  if (!imp) return { ok: false, error: 'not_found', status: 404 };
  if (imp.status !== 'previewed') return { ok: false, error: 'already_processed', status: 409 };
  const header = imp.summary.header ?? [];
  const mapping = Object.fromEntries(FIELDS.map((f) => [f, null])) as Mapping;
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(src)) {
    if (!(FIELDS as readonly string[]).includes(k)) return { ok: false, error: `unknown_field:${k}`, status: 400 };
    if (v === null) continue;
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= header.length) return { ok: false, error: `bad_column:${k}`, status: 400 };
    mapping[k as keyof Mapping] = v as number;
  }
  const rawRows = (await q<{ raw: string[] }>(`SELECT raw FROM import_rows WHERE import_id=$1 ORDER BY row_number`, [id])).map((r) => r.raw);
  const processed = processRows(rawRows, mapping, await loadGeo(), await existingKeys(null, ctx.orgId));
  const summary = { ...imp.summary, ...summarize(processed) };
  await tx(async (c) => {
    for (let i = 0; i < processed.length; i += 500) {
      const ch = processed.slice(i, i + 500);
      await c.query(
        `UPDATE import_rows r SET normalized=v.n, status=v.s, issues=v.i FROM unnest($2::int[], $3::jsonb[], $4::text[], $5::jsonb[]) AS v(rn, n, s, i) WHERE r.import_id=$1 AND r.row_number=v.rn`,
        [id, ch.map((r) => r.row_number), ch.map((r) => (r.normalized ? JSON.stringify(r.normalized) : null)), ch.map((r) => r.status), ch.map((r) => JSON.stringify(r.issues))]);
    }
    await c.query(`UPDATE imports SET mapping=$2, summary=$3 WHERE id=$1 AND org_id=$4`, [id, JSON.stringify(mapping), JSON.stringify(summary), ctx.orgId]);
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'import.remap', entity: 'import', entityId: id, ipHash: ctx.ipHash });
  });
  return { ok: true, summary };
}

export type ApproveResult =
  | { ok: true; report: { total: number; imported: number; imported_fixed: number; imported_review: number; review_skipped: number; duplicates_ignored: number; invalid_skipped: number } }
  | { ok: false; error: 'not_found' | 'already_processed' };

/** الموافقة: معاملة واحدة. يُعاد فحص التكرار لحظة الموافقة لأن البيانات قد تغيّرت بعد المعاينة. */
export async function approveImport(ctx: Ctx, id: string, opts: { includeReview: boolean }): Promise<ApproveResult> {
  if (!isUuid(id)) return { ok: false, error: 'not_found' };
  return tx(async (c) => {
    const imp = (await c.query<{ status: string; source_id: string | null; summary: Record<string, unknown> }>(`SELECT status, source_id, summary FROM imports WHERE id=$1 AND org_id=$2 FOR UPDATE`, [id, ctx.orgId])).rows[0];
    if (!imp) return { ok: false as const, error: 'not_found' as const };
    if (imp.status !== 'previewed') return { ok: false as const, error: 'already_processed' as const };
    const rows = (await c.query<{ row_number: number; status: string; normalized: CleanProperty | null }>(`SELECT row_number, status, normalized FROM import_rows WHERE import_id=$1 ORDER BY row_number`, [id])).rows;
    const existing = await existingKeys(c, ctx.orgId);
    const take = rows.filter((r) => r.normalized && (r.status === 'ok' || r.status === 'fixed' || (opts.includeReview && r.status === 'review')));
    const seen = new Set<string>(); const items: { row_number: number; id: string; v: CleanProperty; status: string }[] = []; const lateDup: number[] = [];
    for (const r of take) {
      const k = dedupeKey(r.normalized!);
      if (existing.has(k) || seen.has(k)) { lateDup.push(r.row_number); continue; }
      seen.add(k); items.push({ row_number: r.row_number, id: randomUUID(), v: r.normalized!, status: r.status });
    }
    const perChunk = Math.floor(60000 / INSERT_COL_COUNT);
    for (let i = 0; i < items.length; i += Math.min(200, perChunk)) {
      const ch = items.slice(i, i + Math.min(200, perChunk));
      const params = ch.flatMap((it) => propertyValues(it.id, ctx.orgId, it.v, { source_id: imp.source_id, import_id: id, created_by: ctx.user.id }));
      const ph = ch.map((_, r) => `(${Array.from({ length: INSERT_COL_COUNT }, (_, k) => `$${r * INSERT_COL_COUNT + k + 1}`).join(',')})`).join(',');
      await c.query(`${INSERT_SQL} VALUES ${ph}`, params);
      await c.query(`INSERT INTO property_prices (property_id, price, area_sqm, source_id, import_id) SELECT *, $4::uuid, $5::uuid FROM unnest($1::uuid[], $2::numeric[], $3::numeric[])`,
        [ch.map((it) => it.id), ch.map((it) => it.v.price), ch.map((it) => it.v.area_sqm), imp.source_id, id]);
    }
    if (items.length) await c.query(`UPDATE import_rows r SET status='imported', property_id=v.pid FROM unnest($2::int[], $3::uuid[]) AS v(rn, pid) WHERE r.import_id=$1 AND r.row_number=v.rn`, [id, items.map((i) => i.row_number), items.map((i) => i.id)]);
    if (lateDup.length) await c.query(`UPDATE import_rows SET status='duplicate' WHERE import_id=$1 AND row_number = ANY($2::int[])`, [id, lateDup]);
    const reviewSkipped = opts.includeReview ? 0 : rows.filter((r) => r.status === 'review').length;
    if (reviewSkipped) await c.query(`UPDATE import_rows SET status='skipped' WHERE import_id=$1 AND status='review'`, [id]);
    const report = {
      total: rows.length, imported: items.length, imported_fixed: items.filter((i) => i.status === 'fixed').length, imported_review: items.filter((i) => i.status === 'review').length,
      review_skipped: reviewSkipped, duplicates_ignored: rows.filter((r) => r.status === 'duplicate').length + lateDup.length, invalid_skipped: rows.filter((r) => r.status === 'invalid').length,
    };
    await c.query(`UPDATE imports SET status='approved', approved_at=now(), summary = summary || $2::jsonb WHERE id=$1`, [id, JSON.stringify({ report })]);
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'import.approve', entity: 'import', entityId: id, ipHash: ctx.ipHash, meta: { ...report, include_review: opts.includeReview } });
    return { ok: true as const, report };
  });
}
