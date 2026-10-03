import 'server-only';
import { q, tx } from './db';
import { getKind } from './property-schema';
import { PURPOSES } from './request-schema';
import { matchOffer, type Offer } from './matching';
import { toMatchRequest } from './requests';
import { notifyNewMatches } from './crm-notify';
import type { Ctx } from './api';

/**
 * عند إضافة عرض جديد: يُطابَق (بخوارزمية Phase 2 نفسها دون تغيير) مع الطلبات المفتوحة في المنشأة،
 * وتُحفظ المطابقات المؤهلة بحالة «جديد»، ويُنبَّه مسؤول كل طلب مرة واحدة.
 * يعمل بعد حفظ العقار؛ فشله لا يُفشل الحفظ (يُسجَّل في سجل الخادم فقط).
 */
export async function onPropertyCreated(ctx: Ctx, propertyId: string): Promise<number> {
  try {
    const p = (await q<Record<string, unknown>>(`SELECT id, kind, type, deal, city_id, district_id, price, area_sqm, attributes, rooms, age_years FROM properties WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL AND status='active'`, [propertyId, ctx.orgId]))[0];
    if (!p) return 0;
    const offer: Offer = { id: p.id as string, kind: (p.kind ?? null) as string | null, type: p.type as string, deal: p.deal as string, city_id: (p.city_id ?? null) as string | null, district_id: (p.district_id ?? null) as string | null,
      price: Number(p.price), area_sqm: Number(p.area_sqm), attributes: (p.attributes ?? {}) as Record<string, unknown>, rooms: p.rooms === null ? null : Number(p.rooms), age_years: p.age_years === null ? null : Number(p.age_years) };
    const purposes = PURPOSES.filter((x) => (x.offerDeals as string[]).includes(offer.deal)).map((x) => x.value);
    const kinds = offer.kind ? [offer.kind] : [];
    const reqs = await q<Record<string, unknown>>(`SELECT * FROM requests WHERE org_id=$1 AND deleted_at IS NULL AND status='open' AND purpose = ANY($2) LIMIT 5000`, [ctx.orgId, purposes]);
    let created = 0;
    for (const r of reqs) {
      const req = toMatchRequest(r);
      if (offer.kind ? !req.kinds.some((k) => kinds.includes(k)) : !req.kinds.some((k) => getKind(k)?.base === offer.type)) continue;
      const m = matchOffer(req, offer);
      if (!m.eligible) continue;
      await tx(async (c) => {
        const ins = await c.query(`INSERT INTO matches (org_id, request_id, property_id, score, explanation) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (request_id, property_id) WHERE property_id IS NOT NULL DO UPDATE SET score=EXCLUDED.score, explanation=EXCLUDED.explanation, eligible=true, updated_at=now()
          RETURNING (xmax = 0) AS inserted`, [ctx.orgId, r.id, offer.id, m.score, JSON.stringify(m.reasons)]);
        if (ins.rows[0]?.inserted) created += await notifyNewMatches(c, ctx.orgId, r.id as string, [offer.id], ctx.user.id);
      });
    }
    return created;
  } catch (e) { console.error('[crm] onPropertyCreated failed', (e as Error).message); return 0; }
}
