import 'server-only';
import { one, q, tx } from './db';
import { auditTx } from './audit';
import { isUuid, loadGeo } from './properties';
import { getKind } from './property-schema';
import { describeRequest, PURPOSES, validateRequest, type RequestDescription, type RequestValue } from './request-schema';
import { rankMatches, type Offer } from './matching';
import type { Geo, Issue } from './property-rules';
import type { Ctx } from './api';
import { normalizeArabic } from './arabic';

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const COLS = `r.id, r.purpose, r.kinds, r.city_id, r.district_ids, r.district_importance, r.budget_min, r.budget_max, r.area_min, r.area_max, r.area_importance,
  r.rent_period, r.criteria, r.description, r.notes, r.status, r.created_at, r.updated_at`;
const dto = (r: Row): Row => ({ ...r, budget_min: num(r.budget_min), budget_max: num(r.budget_max), area_min: num(r.area_min), area_max: num(r.area_max) });

type Prepared = { ok: true; value: RequestValue; city_id: string | null; description: RequestDescription; ignored: string[] } | { ok: false; errors: Issue[] };

/** تحقق الطلب ثم ربط المدينة والأحياء بالمرجع (معرّفات أو أسماء)، وتوليد الوصف بأسمائها */
export function prepareRequest(raw: Record<string, unknown>, geo: Geo): Prepared {
  const v = validateRequest(raw);
  const errors = [...v.errors];
  let cityId: string | null = null;
  if (isUuid(raw.city_id)) cityId = geo.cities.find((c) => c.id === raw.city_id)?.id ?? null;
  else if (raw.city) cityId = geo.cities.find((c) => normalizeArabic(c.name_ar) === normalizeArabic(String(raw.city)) || c.slug === raw.city)?.id ?? null;
  if (!cityId) errors.push({ code: 'city_required', field: 'city', message: 'المدينة مطلوبة وتُختار من القائمة' });
  const districts: { id: string; name_ar: string }[] = [];
  for (const d of v.value?.district_ids ?? []) {
    const hit = geo.districts.find((x) => (x.id === d || normalizeArabic(x.name_ar) === normalizeArabic(d)) && (!cityId || x.city_id === cityId));
    if (!hit) errors.push({ code: 'district_unknown', field: 'district_ids', message: `الحي «${d}» غير موجود في مرجع المدينة` });
    else if (!districts.some((x) => x.id === hit.id)) districts.push(hit);
  }
  if (errors.length || !v.value) return { ok: false, errors };
  const value = { ...v.value, district_ids: districts.map((d) => d.id) };
  const city = geo.cities.find((c) => c.id === cityId)?.name_ar ?? null;
  return { ok: true, value, city_id: cityId, description: describeRequest(value, { city, districts: districts.map((d) => d.name_ar) }), ignored: v.ignored };
}

const NOTES_MAX = 2000;
const notesOf = (raw: Record<string, unknown>): { notes: string | null; error?: Issue } => {
  const s = raw.notes === undefined || raw.notes === null ? '' : String(raw.notes).trim();
  return s.length > NOTES_MAX ? { notes: null, error: { code: 'notes_too_long', field: 'notes', message: `الملاحظات أطول من ${NOTES_MAX} حرف` } } : { notes: s || null };
};

export async function previewRequest(raw: Record<string, unknown>) {
  const p = prepareRequest(raw, await loadGeo());
  return p.ok ? { ok: true as const, description: p.description, ignored: p.ignored } : { ok: false as const, errors: p.errors };
}

export async function createRequest(ctx: Ctx, raw: Record<string, unknown>) {
  const p = prepareRequest(raw, await loadGeo()); const n = notesOf(raw);
  if (!p.ok || n.error) return { ok: false as const, errors: [...(p.ok ? [] : p.errors), ...(n.error ? [n.error] : [])] };
  const v = p.value;
  const row = await tx(async (c) => {
    const r = (await c.query<Row>(`INSERT INTO requests (org_id, created_by, status, purpose, kinds, city_id, district_ids, district_importance, budget_min, budget_max, area_min, area_max, area_importance, rent_period, criteria, description, notes)
      VALUES ($1,$2,'open',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [ctx.orgId, ctx.user.id, v.purpose, v.kinds, p.city_id, v.district_ids, v.district_importance, v.budget_min, v.budget_max, v.area_min, v.area_max, v.area_importance, v.rent_period, JSON.stringify(v.criteria), p.description.text, n.notes])).rows[0];
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'request.create', entity: 'request', entityId: r.id as string, ipHash: ctx.ipHash, meta: { purpose: v.purpose, kinds: v.kinds } });
    return (await c.query<Row>(`SELECT ${COLS} FROM requests r WHERE r.id=$1`, [r.id])).rows[0];
  });
  return { ok: true as const, request: dto(row), ignored: p.ignored };
}

export async function listRequests(ctx: Ctx, f: { page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(100, Math.max(1, Math.floor(f.pageSize ?? 25))), page = Math.max(1, Math.floor(f.page ?? 1));
  const total = Number((await one<{ n: string }>(`SELECT count(*)::text AS n FROM requests r WHERE r.org_id=$1 AND r.deleted_at IS NULL AND r.purpose IS NOT NULL`, [ctx.orgId]))!.n);
  const rows = await q<Row>(`SELECT ${COLS} FROM requests r WHERE r.org_id=$1 AND r.deleted_at IS NULL AND r.purpose IS NOT NULL ORDER BY r.created_at DESC, r.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, [ctx.orgId]);
  return { items: rows.map(dto), total, page, pageSize };
}

export async function getRequest(ctx: Ctx, id: string) {
  if (!isUuid(id)) return null;
  const r = await one<Row>(`SELECT ${COLS} FROM requests r WHERE r.id=$1 AND r.org_id=$2 AND r.deleted_at IS NULL AND r.purpose IS NOT NULL`, [id, ctx.orgId]);
  return r ? dto(r) : null;
}

/** تعديل الطلب: يُدمج المُرسل مع الحالي ثم يُعاد التحقق وتوليد الوصف كاملًا */
export async function updateRequest(ctx: Ctx, id: string, patch: Record<string, unknown>) {
  const cur = await getRequest(ctx, id);
  if (!cur) return null;
  const keys = ['purpose', 'kinds', 'city_id', 'city', 'district_ids', 'district_importance', 'budget_min', 'budget_max', 'area_min', 'area_max', 'area_importance', 'rent_period', 'criteria', 'notes', 'status'];
  const merged: Record<string, unknown> = { ...cur, criteria: Object.fromEntries(Object.entries((cur.criteria ?? {}) as Record<string, { value: unknown; importance: string }>).map(([k, c]) => [k, { value: c.value, importance: c.importance }])) };
  for (const k of keys) if (k in patch) merged[k] = patch[k];
  if ('city' in patch && !('city_id' in patch)) delete merged.city_id;
  const status = merged.status === 'closed' ? 'closed' : 'open';
  const p = prepareRequest(merged, await loadGeo()); const n = notesOf(merged);
  if (!p.ok || n.error) return { ok: false as const, errors: [...(p.ok ? [] : p.errors), ...(n.error ? [n.error] : [])] };
  const v = p.value;
  await tx(async (c) => {
    await c.query(`UPDATE requests SET purpose=$3, kinds=$4, city_id=$5, district_ids=$6, district_importance=$7, budget_min=$8, budget_max=$9, area_min=$10, area_max=$11, area_importance=$12,
      rent_period=$13, criteria=$14, description=$15, notes=$16, status=$17, updated_at=now() WHERE id=$1 AND org_id=$2`,
      [id, ctx.orgId, v.purpose, v.kinds, p.city_id, v.district_ids, v.district_importance, v.budget_min, v.budget_max, v.area_min, v.area_max, v.area_importance, v.rent_period, JSON.stringify(v.criteria), p.description.text, n.notes, status]);
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'request.update', entity: 'request', entityId: id, ipHash: ctx.ipHash, meta: { fields: Object.keys(patch).filter((k) => keys.includes(k)) } });
  });
  return { ok: true as const, request: (await getRequest(ctx, id))! };
}

export async function deleteRequest(ctx: Ctx, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return tx(async (c) => {
    const r = await c.query(`UPDATE requests SET deleted_at=now(), updated_at=now() WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL AND purpose IS NOT NULL`, [id, ctx.orgId]);
    if (!r.rowCount) return false;
    await auditTx(c, { orgId: ctx.orgId, actorId: ctx.user.id, action: 'request.delete', entity: 'request', entityId: id, ipHash: ctx.ipHash });
    return true;
  });
}

/** يحوّل صف الطلب المحفوظ إلى مدخل المطابقة */
export function toMatchRequest(r: Row) {
  return {
    purpose: r.purpose as RequestValue['purpose'], kinds: r.kinds as string[], district_ids: r.district_ids as string[], district_importance: (r.district_importance ?? null) as RequestValue['district_importance'],
    budget_min: num(r.budget_min), budget_max: num(r.budget_max)!, area_min: num(r.area_min), area_max: num(r.area_max), area_importance: (r.area_importance ?? null) as RequestValue['area_importance'],
    rent_period: (r.rent_period ?? null) as string | null, criteria: r.criteria as RequestValue['criteria'], city_id: (r.city_id ?? null) as string | null,
  };
}

/** العروض المرشحة: عقارات المؤسسة النشطة، بعملية تناسب الغرض ونوع مطلوب (تفصيلي أو أساسي للعروض القديمة) */
export async function candidateOffers(orgId: string, req: ReturnType<typeof toMatchRequest>): Promise<(Offer & { district_name: string | null; description: string | null; price_per_sqm: number | null; lat: number | null; lng: number | null })[]> {
  const deals = PURPOSES.find((p) => p.value === req.purpose)!.offerDeals;
  const bases = [...new Set(req.kinds.map((k) => getKind(k)?.base).filter(Boolean))] as string[];
  const rows = await q<Row>(`SELECT p.id, p.kind, p.type, p.deal, p.city_id, p.district_id, d.name_ar AS district_name, p.price, p.area_sqm, p.price_per_sqm, p.attributes, p.rooms, p.age_years, p.description, p.lat, p.lng
    FROM properties p LEFT JOIN districts d ON d.id=p.district_id
    WHERE p.org_id=$1 AND p.deleted_at IS NULL AND p.status='active' AND p.deal = ANY($2) AND (p.kind = ANY($3) OR (p.kind IS NULL AND p.type = ANY($4)))
    ORDER BY p.created_at DESC LIMIT 5000`, [orgId, deals, req.kinds, bases]);
  return rows.map((r) => ({ ...(r as Offer), district_name: (r.district_name ?? null) as string | null, description: (r.description ?? null) as string | null, price: Number(r.price), area_sqm: Number(r.area_sqm), price_per_sqm: num(r.price_per_sqm), lat: num(r.lat), lng: num(r.lng), rooms: num(r.rooms), age_years: num(r.age_years), attributes: (r.attributes ?? {}) as Record<string, unknown> }));
}

/** يحسب مطابقات الطلب من البيانات المنظمة، ويحفظ لقطة النتائج في matches (يستبدل السابقة) */
export async function matchesFor(ctx: Ctx, id: string) {
  if (!isUuid(id)) return null;
  const r = await one<Row>(`SELECT ${COLS} FROM requests r WHERE r.id=$1 AND r.org_id=$2 AND r.deleted_at IS NULL AND r.purpose IS NOT NULL`, [id, ctx.orgId]);
  if (!r) return null;
  const req = toMatchRequest(r);
  const offers = await candidateOffers(ctx.orgId, req);
  const ranked = rankMatches(req, offers);
  await tx(async (c) => {
    await c.query(`DELETE FROM matches WHERE request_id=$1 AND org_id=$2`, [id, ctx.orgId]);
    for (const m of ranked.matches) await c.query(`INSERT INTO matches (org_id, request_id, property_id, score, explanation) VALUES ($1,$2,$3,$4,$5)`, [ctx.orgId, id, m.offer.id, m.score, JSON.stringify(m.reasons)]);
  });
  const byId = new Map(offers.map((o) => [o.id, o]));
  return {
    request: dto(r), considered: offers.length, total_eligible: ranked.total_eligible, excluded: ranked.excluded,
    matches: ranked.matches.map((m) => { const o = byId.get(m.offer.id)!; return { property_id: o.id, score: m.score, reasons: m.reasons, kind: o.kind, type: o.type, deal: o.deal, district_name: o.district_name, price: o.price, area_sqm: o.area_sqm, price_per_sqm: o.price_per_sqm, description: o.description }; }),
  };
}
