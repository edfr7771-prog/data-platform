import 'server-only';
import { one, q, tx } from './db';
import { auditTx } from './audit';
import { loadGeo } from './properties';
import { parseCsvText, validateUpload } from './csv-rules';
import { maxImportBytes } from './imports';
import { isId } from './crm-core';
import { upsertContact } from './crm-contacts';
import { processContactRows, suggestContactMapping, type ContactValue } from './crm-rules';
import type { Ctx } from './api';

const safeName = (n: string) => n.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 200) || 'contacts.csv';

/** معاينة استيراد العملاء: لا يُدخل أي عميل. كل صف يُصنَّف (جديد/تحديث/مكرر في الملف/غير صالح) مع سببه. */
export async function previewContactsImport(ctx: Ctx, file: { name: string; size: number; bytes: Uint8Array }) {
  const v = validateUpload({ filename: file.name, size: file.size }, file.bytes, maxImportBytes());
  if (!v.ok) return { ok: false as const, error: v.error };
  const p = parseCsvText(v.text);
  if ('error' in p) return { ok: false as const, error: p.error };
  const mapping = suggestContactMapping(p.header);
  if (mapping.name === null || (mapping.phone === null && mapping.email === null)) return { ok: false as const, error: 'يلزم عمود للاسم وعمود للجوال أو البريد (مثل: الاسم، الجوال، البريد)' };
  const existing = await q<{ id: string; phone_norm: string | null; email_norm: string | null }>(`SELECT id, phone_norm, email_norm FROM customers WHERE org_id=$1 AND deleted_at IS NULL`, [ctx.orgId]);
  const maps = { phones: new Map(existing.filter((e) => e.phone_norm).map((e) => [e.phone_norm!, e.id])), emails: new Map(existing.filter((e) => e.email_norm).map((e) => [e.email_norm!, e.id])) };
  const rows = processContactRows(p.rows, mapping, maps, (await loadGeo()).cities);
  const summary = { total: rows.length, new: rows.filter((r) => r.status === 'new').length, update: rows.filter((r) => r.status === 'update').length, duplicate: rows.filter((r) => r.status === 'duplicate').length, invalid: rows.filter((r) => r.status === 'invalid').length, header: p.header, mapping };
  const id = await tx(async (c) => {
    const imp = (await c.query<{ id: string }>(`INSERT INTO crm_imports (org_id, filename, summary, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [ctx.orgId, safeName(file.name), JSON.stringify(summary), ctx.user.id])).rows[0];
    for (let i = 0; i < rows.length; i += 500) {
      const ch = rows.slice(i, i + 500);
      await c.query(`INSERT INTO crm_import_rows (import_id, row_number, raw, normalized, status, issues, customer_id) SELECT $1, * FROM unnest($2::int[], $3::jsonb[], $4::jsonb[], $5::text[], $6::jsonb[], $7::uuid[])`,
        [imp.id, ch.map((r) => r.row_number), ch.map((r) => JSON.stringify(r.raw)), ch.map((r) => (r.normalized ? JSON.stringify(r.normalized) : null)), ch.map((r) => r.status), ch.map((r) => JSON.stringify(r.issues)), ch.map((r) => r.existing_id)]);
    }
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'contact.import_preview', entity: 'crm_import', entityId: imp.id, ipHash: ctx.ipHash, meta: { rows: rows.length } });
    return imp.id;
  });
  return { ok: true as const, import: { id, status: 'previewed', summary }, rows: rows.slice(0, 200).map((r) => ({ row_number: r.row_number, raw: r.raw, status: r.status, issues: r.issues })) };
}

export async function getContactsImport(ctx: Ctx, id: string) {
  if (!isId(id)) return null;
  const imp = await one(`SELECT id, filename, status, summary, created_at, approved_at FROM crm_imports WHERE id=$1 AND org_id=$2`, [id, ctx.orgId]);
  if (!imp) return null;
  const rows = await q(`SELECT row_number, raw, status, issues, customer_id FROM crm_import_rows WHERE import_id=$1 ORDER BY row_number LIMIT 1000`, [id]);
  return { import: imp, rows };
}

/**
 * الموافقة: تُدخل الصفوف الجديدة وتحدّث الموجودة (الحقول الفارغة فقط) في معاملة واحدة، مرة واحدة فقط.
 * منع التكرار يُعاد عند الموافقة (قد يكون العميل أُضيف بعد المعاينة). غير الصالح والمكرر يبقيان «متجاوزين» بسببهما في التقرير.
 */
export async function approveContactsImport(ctx: Ctx, id: string) {
  if (!isId(id)) return null;
  return tx(async (c) => {
    const imp = (await c.query<{ status: string }>(`SELECT status FROM crm_imports WHERE id=$1 AND org_id=$2 FOR UPDATE`, [id, ctx.orgId])).rows[0];
    if (!imp) return null;
    if (imp.status !== 'previewed') return { ok: false as const, status: 409, error: 'already_processed' };
    const rows = (await c.query<{ id: string; row_number: number; status: string; normalized: Partial<ContactValue> | null; issues: unknown[] }>(`SELECT id, row_number, status, normalized, issues FROM crm_import_rows WHERE import_id=$1 ORDER BY row_number`, [id])).rows;
    let created = 0, updated = 0, skipped = 0;
    const problems: { row_number: number; issues: unknown[] }[] = [];
    for (const r of rows) {
      if ((r.status !== 'new' && r.status !== 'update') || !r.normalized) { skipped++; problems.push({ row_number: r.row_number, issues: r.issues }); await c.query(`UPDATE crm_import_rows SET status='skipped' WHERE id=$1`, [r.id]); continue; }
      const u = await upsertContact(c, ctx.orgId, ctx.user.id, { ...r.normalized, next_follow_up_at: null }, 'import', r.normalized.phone_norm ?? r.normalized.email_norm ?? null, ctx.ipHash);
      if (!u.ok) { skipped++; problems.push({ row_number: r.row_number, issues: [{ code: 'identifier_conflict', message: 'تعارض عند الموافقة: الجوال لعميل والبريد لآخر' }] }); await c.query(`UPDATE crm_import_rows SET status='skipped' WHERE id=$1`, [r.id]); continue; }
      if (u.created) created++; else updated++;
      await c.query(`UPDATE crm_import_rows SET status=$2, customer_id=$3 WHERE id=$1`, [r.id, u.created ? 'imported' : 'updated', u.id]);
    }
    const report = { created, updated, skipped, problems: problems.slice(0, 500) };
    await c.query(`UPDATE crm_imports SET status='approved', approved_at=now(), summary=summary || $2::jsonb WHERE id=$1`, [id, JSON.stringify({ report })]);
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'contact.import', entity: 'crm_import', entityId: id, ipHash: ctx.ipHash, meta: { created, updated, skipped } });
    return { ok: true as const, report };
  });
}
