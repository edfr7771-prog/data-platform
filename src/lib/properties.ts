import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { one, q, tx } from './db';
import { auditTx } from './audit';
import { cleanProperty, dedupeKey, TYPES, type CleanProperty, type Geo, type Issue } from './property-rules';
import type { Ctx } from './api';

export async function loadGeo(): Promise<Geo> {
  const [cities, districts] = await Promise.all([
    q<Geo['cities'][number]>(`SELECT id, slug, name_ar, name_en FROM cities ORDER BY name_ar`),
    q<Geo['districts'][number]>(`SELECT id, city_id, slug, name_ar, name_en FROM districts ORDER BY name_ar`),
  ]);
  return { cities, districts };
}

const COLS = `p.id, p.external_ref, p.type, p.city_id, p.district_id, d.name_ar AS district_name, p.location, p.lat, p.lng, p.deal, p.usage, p.area_sqm, p.price, p.price_per_sqm,
  p.age_years, p.rooms, p.street_width_m, p.facades, p.status, p.import_id, p.notes, p.created_at, p.updated_at`;
type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const dto = (r: Row) => ({ ...r, lat: num(r.lat), lng: num(r.lng), area_sqm: num(r.area_sqm), price: num(r.price), price_per_sqm: num(r.price_per_sqm), street_width_m: num(r.street_width_m) });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

export async function listProperties(ctx: Ctx, f: { page?: number; pageSize?: number; type?: string; deal?: string; district_id?: string }) {
  const pageSize = Math.min(100, Math.max(1, Math.floor(f.pageSize ?? 25)));
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const where = ['p.org_id = $1', 'p.deleted_at IS NULL']; const args: unknown[] = [ctx.orgId];
  if (f.type && (TYPES as readonly string[]).includes(f.type)) { args.push(f.type); where.push(`p.type = $${args.length}`); }
  if (f.deal === 'sale' || f.deal === 'rent') { args.push(f.deal); where.push(`p.deal = $${args.length}`); }
  if (f.district_id && isUuid(f.district_id)) { args.push(f.district_id); where.push(`p.district_id = $${args.length}`); }
  const W = where.join(' AND ');
  const total = Number((await one<{ n: string }>(`SELECT count(*)::text AS n FROM properties p WHERE ${W}`, args))!.n);
  const rows = await q<Row>(`SELECT ${COLS} FROM properties p LEFT JOIN districts d ON d.id = p.district_id WHERE ${W} ORDER BY p.created_at DESC, p.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, args);
  return { items: rows.map(dto), total, page, pageSize };
}

export async function getProperty(ctx: Ctx, id: string) {
  if (!isUuid(id)) return null;
  const r = await one<Row>(`SELECT ${COLS} FROM properties p LEFT JOIN districts d ON d.id = p.district_id WHERE p.id = $1 AND p.org_id = $2 AND p.deleted_at IS NULL`, [id, ctx.orgId]);
  return r ? dto(r) : null;
}

export type SaveResult = { ok: true; property: ReturnType<typeof dto>; warnings: Issue[]; fixes: Issue[] } | { ok: false; errors: Issue[] };

/** يقبل أسماء أو معرّفات للمدينة والحي. المعرّف يُحوَّل إلى اسم ثم يمر بنفس قواعد التنظيف. */
function withGeoNames(raw: Record<string, unknown>, geo: Geo): Record<string, unknown> {
  const out = { ...raw };
  if (isUuid(out.district_id)) { const d = geo.districts.find((x) => x.id === out.district_id); if (d) out.district = d.name_ar; }
  if (isUuid(out.city_id)) { const c = geo.cities.find((x) => x.id === out.city_id); if (c) out.city = c.name_ar; }
  return out;
}

const INSERT_COLS = ['id', 'org_id', 'external_ref', 'type', 'city_id', 'district_id', 'location', 'lat', 'lng', 'deal', 'usage', 'area_sqm', 'price', 'age_years', 'rooms', 'street_width_m', 'facades', 'status', 'source_id', 'import_id', 'dedupe_key', 'notes', 'created_by'] as const;
export function propertyValues(id: string, orgId: string, v: CleanProperty, extra: { source_id?: string | null; import_id?: string | null; created_by: string }): unknown[] {
  return [id, orgId, v.external_ref, v.type, v.city_id, v.district_id, v.location, v.lat, v.lng, v.deal, v.usage, v.area_sqm, v.price, v.age_years, v.rooms, v.street_width_m, v.facades, v.status,
    extra.source_id ?? null, extra.import_id ?? null, dedupeKey(v), v.notes, extra.created_by];
}
export const INSERT_SQL = `INSERT INTO properties (${INSERT_COLS.join(', ')})`;
export const INSERT_COL_COUNT = INSERT_COLS.length;

export async function createProperty(ctx: Ctx, raw: Record<string, unknown>): Promise<SaveResult> {
  const geo = await loadGeo();
  const r = cleanProperty(withGeoNames(raw, geo), geo);
  if (!r.value) return { ok: false, errors: r.errors };
  const id = randomUUID();
  const row = await tx(async (c) => {
    await c.query(`${INSERT_SQL} VALUES (${INSERT_COLS.map((_, i) => `$${i + 1}`).join(',')})`, propertyValues(id, ctx.orgId, r.value!, { created_by: ctx.user.id }));
    await c.query(`INSERT INTO property_prices (property_id, price, area_sqm) VALUES ($1,$2,$3)`, [id, r.value!.price, r.value!.area_sqm]);
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'property.create', entity: 'property', entityId: id, ipHash: ctx.ipHash, meta: { type: r.value!.type, deal: r.value!.deal } });
    return (await c.query<Row>(`SELECT ${COLS} FROM properties p LEFT JOIN districts d ON d.id = p.district_id WHERE p.id=$1 AND p.org_id=$2`, [id, ctx.orgId])).rows[0];
  });
  return { ok: true, property: dto(row), warnings: r.warnings, fixes: r.fixes };
}

const PATCHABLE = ['external_ref', 'type', 'deal', 'usage', 'city', 'district', 'city_id', 'district_id', 'location', 'lat', 'lng', 'area_sqm', 'price', 'age_years', 'rooms', 'street_width_m', 'facades', 'status', 'notes'];

export async function updateProperty(ctx: Ctx, id: string, patch: Record<string, unknown>): Promise<SaveResult | null> {
  if (!isUuid(id)) return null;
  const geo = await loadGeo();
  return tx(async (c: PoolClient) => {
    // القفل مقيّد بالمؤسسة: عقار مؤسسة أخرى يظهر كأنه غير موجود
    const cur = (await c.query<Row>(`SELECT p.*, d.name_ar AS district_name, ci.name_ar AS city_name FROM properties p LEFT JOIN districts d ON d.id=p.district_id LEFT JOIN cities ci ON ci.id=p.city_id
      WHERE p.id=$1 AND p.org_id=$2 AND p.deleted_at IS NULL FOR UPDATE OF p`, [id, ctx.orgId])).rows[0];
    if (!cur) return null;
    const merged: Record<string, unknown> = {
      external_ref: cur.external_ref, type: cur.type, deal: cur.deal, usage: cur.usage, city: cur.city_name ?? '', district: cur.district_name ?? '', location: cur.location,
      lat: cur.lat, lng: cur.lng, area_sqm: cur.area_sqm, price: cur.price, age_years: cur.age_years, rooms: cur.rooms, street_width_m: cur.street_width_m, facades: cur.facades, status: cur.status, notes: cur.notes,
    };
    const p2 = withGeoNames(Object.fromEntries(Object.entries(patch).filter(([k]) => PATCHABLE.includes(k))), geo);
    for (const [k, v] of Object.entries(p2)) if (k !== 'city_id' && k !== 'district_id') merged[k] = v === null ? '' : v;
    const r = cleanProperty(merged, geo);
    if (!r.value) return { ok: false as const, errors: r.errors };
    const v = r.value;
    await c.query(`UPDATE properties SET external_ref=$3, type=$4, city_id=$5, district_id=$6, location=$7, lat=$8, lng=$9, deal=$10, usage=$11, area_sqm=$12, price=$13, age_years=$14, rooms=$15,
      street_width_m=$16, facades=$17, status=$18, dedupe_key=$19, notes=$20, updated_at=now() WHERE id=$1 AND org_id=$2`,
      [id, ctx.orgId, v.external_ref, v.type, v.city_id, v.district_id, v.location, v.lat, v.lng, v.deal, v.usage, v.area_sqm, v.price, v.age_years, v.rooms, v.street_width_m, v.facades, v.status, dedupeKey(v), v.notes]);
    if (Number(cur.price) !== v.price || Number(cur.area_sqm) !== v.area_sqm) await c.query(`INSERT INTO property_prices (property_id, price, area_sqm) VALUES ($1,$2,$3)`, [id, v.price, v.area_sqm]);
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'property.update', entity: 'property', entityId: id, ipHash: ctx.ipHash, meta: { fields: Object.keys(p2) } });
    const row = (await c.query<Row>(`SELECT ${COLS} FROM properties p LEFT JOIN districts d ON d.id = p.district_id WHERE p.id=$1 AND p.org_id=$2`, [id, ctx.orgId])).rows[0];
    return { ok: true as const, property: dto(row), warnings: r.warnings, fixes: r.fixes };
  });
}

/** حذف ناعم: يبقى السجل للتدقيق ولا يظهر في أي استعلام. */
export async function deleteProperty(ctx: Ctx, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return tx(async (c) => {
    const r = await c.query(`UPDATE properties SET deleted_at=now(), updated_at=now() WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, [id, ctx.orgId]);
    if (!r.rowCount) return false;
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'property.delete', entity: 'property', entityId: id, ipHash: ctx.ipHash });
    return true;
  });
}

export async function exportRows(ctx: Ctx): Promise<unknown[][]> {
  const rows = await q<Row>(`SELECT ${COLS} FROM properties p LEFT JOIN districts d ON d.id = p.district_id WHERE p.org_id=$1 AND p.deleted_at IS NULL ORDER BY p.created_at DESC, p.id LIMIT 50000`, [ctx.orgId]);
  const head = ['id', 'external_ref', 'type', 'deal', 'usage', 'district', 'location', 'area_sqm', 'price', 'price_per_sqm', 'age_years', 'rooms', 'street_width_m', 'facades', 'status', 'notes', 'created_at'];
  return [head, ...rows.map((r) => [r.id, r.external_ref, r.type, r.deal, r.usage, r.district_name, r.location, r.area_sqm, r.price, r.price_per_sqm, r.age_years, r.rooms, r.street_width_m, r.facades, r.status, r.notes, r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at])];
}
