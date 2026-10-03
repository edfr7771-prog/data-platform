import 'server-only';
import { q } from './db';
import { isUuid, loadGeo } from './properties';
import { getKind } from './property-schema';
import { boundsOf, centroid, estimate, heatGrid, JEDDAH_BOUNDS, market, monthlyTrend, sameKind, summarize, unitPrice, type MarketRow } from './market';
import { candidateOffers, toMatchRequest } from './requests';
import { rankMatches } from './matching';
import type { Ctx } from './api';

/** صفوف السوق: عقارات المؤسسة النشطة فقط (عزل كامل؛ لا بيانات من مؤسسة أخرى ولا أرقام مختلقة) */
export async function loadMarket(orgId: string): Promise<MarketRow[]> {
  const rows = await q<Record<string, unknown>>(`SELECT p.id, p.kind, p.type, p.deal, p.city_id, p.district_id, d.name_ar AS district_name, p.price, p.area_sqm,
      p.attributes->>'rent_period' AS rent_period, p.lat, p.lng, to_char(p.created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') AS created_at
    FROM properties p LEFT JOIN districts d ON d.id = p.district_id
    WHERE p.org_id=$1 AND p.deleted_at IS NULL AND p.status='active' ORDER BY p.created_at DESC LIMIT 50000`, [orgId]);
  return rows.map((r) => ({ ...(r as unknown as MarketRow), price: Number(r.price), area_sqm: Number(r.area_sqm), lat: r.lat === null ? null : Number(r.lat), lng: r.lng === null ? null : Number(r.lng) }));
}
const kindOk = (r: MarketRow, kind?: string) => !kind || (r.kind ? r.kind === kind : getKind(kind)?.base === r.type);

/** الذكاء السعري: سعر المتر لسوق (بيع/إيجار) ونوع اختياري، إجمالًا ولكل حي، مع الاتجاه الشهري */
export async function priceIntel(ctx: Ctx, f: { market?: string; kind?: string }) {
  const m = f.market === 'rent' ? 'rent' : 'sale';
  const kind = f.kind && getKind(f.kind) ? f.kind : undefined;
  const rows = (await loadMarket(ctx.orgId)).filter((r) => market(r.deal) === m && kindOk(r, kind));
  const geo = await loadGeo();
  const byDistrict = new Map<string, MarketRow[]>();
  for (const r of rows) if (r.district_id) byDistrict.set(r.district_id, [...(byDistrict.get(r.district_id) ?? []), r]);
  return {
    market: m, kind: kind ?? null, unit: m === 'rent' ? 'ريال/م² سنويًا' : 'ريال/م²',
    overall: summarize(rows.map((r) => unitPrice(r)!).filter((v) => v !== null)),
    districts: geo.districts.map((d) => ({ district_id: d.id, name: d.name_ar, summary: summarize((byDistrict.get(d.id) ?? []).map((r) => unitPrice(r)!)) }))
      .sort((a, b) => (b.summary.median ?? -1) - (a.summary.median ?? -1) || b.summary.n - a.summary.n),
    trend: monthlyTrend(rows),
    no_district: rows.filter((r) => !r.district_id).length,
  };
}

/** تحليلات الأحياء: العرض حسب العملية، والطلب، ووسيط سعر المتر للبيع والإيجار، وأكثر الأنواع، ونسبة الطلب إلى العرض */
export async function districtAnalytics(ctx: Ctx) {
  const [rows, geo, reqs] = await Promise.all([
    loadMarket(ctx.orgId), loadGeo(),
    q<{ district_ids: string[]; purpose: string }>(`SELECT district_ids, purpose FROM requests WHERE org_id=$1 AND deleted_at IS NULL AND purpose IS NOT NULL AND status='open'`, [ctx.orgId]),
  ]);
  return geo.districts.map((d) => {
    const here = rows.filter((r) => r.district_id === d.id);
    const kinds = new Map<string, number>();
    for (const r of here) { const k = r.kind ?? r.type; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
    const demand = reqs.filter((r) => r.district_ids.includes(d.id)).length;
    return {
      district_id: d.id, name: d.name_ar,
      offers: { total: here.length, sale: here.filter((r) => r.deal === 'sale').length, rent: here.filter((r) => r.deal === 'rent').length, investment: here.filter((r) => r.deal === 'investment').length },
      requests: demand,
      sale_ppm: summarize(here.filter((r) => market(r.deal) === 'sale').map((r) => unitPrice(r)!)),
      rent_ppm: summarize(here.filter((r) => r.deal === 'rent').map((r) => unitPrice(r)!)),
      top_kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => ({ kind: k, label: getKind(k)?.label ?? k, n })),
      demand_supply: here.length ? Math.round((demand / here.length) * 100) / 100 : null,
    };
  }).sort((a, b) => b.offers.total + b.requests - (a.offers.total + a.requests));
}

export async function estimateFor(ctx: Ctx, id: string) {
  if (!isUuid(id)) return null;
  const rows = await loadMarket(ctx.orgId);
  const s = rows.find((r) => r.id === id);
  return s ? { property_id: id, market: market(s.deal), estimate: estimate(s, rows) } : null;
}

/**
 * بيانات الخريطة (جدة أولًا): نقاط العروض (الإحداثيات الفعلية، أو مركز الحي المحسوب من عروض أخرى ذات إحداثيات وتُعلَّم تقريبية)،
 * والطلبات على مراكز أحيائها، وفقاعات أسعار الأحياء، وشبكة الكثافة، وطبقة المطابقة لطلب محدد.
 */
export async function mapData(ctx: Ctx, f: { deal?: string; kind?: string; request_id?: string }) {
  const [all, geo] = await Promise.all([loadMarket(ctx.orgId), loadGeo()]);
  const rows = all.filter((r) => (!f.deal || r.deal === f.deal) && kindOk(r, f.kind && getKind(f.kind) ? f.kind : undefined));
  const located = all.filter((r) => r.lat !== null && r.lng !== null) as (MarketRow & { lat: number; lng: number })[];
  const centers = new Map<string, { lat: number; lng: number }>();
  for (const d of geo.districts) { const c = centroid(located.filter((r) => r.district_id === d.id)); if (c) centers.set(d.id, c); }
  const offers: { id: string; lat: number; lng: number; approx: boolean; kind: string; deal: string; price: number; area_sqm: number; ppm: number | null; district: string | null }[] = [];
  let unplaced = 0;
  for (const r of rows) {
    const pos = r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng, approx: false } : r.district_id && centers.get(r.district_id) ? { ...centers.get(r.district_id)!, approx: true } : null;
    if (!pos) { unplaced++; continue; }
    offers.push({ id: r.id, ...pos, kind: getKind(r.kind)?.label ?? r.type, deal: r.deal, price: r.price, area_sqm: r.area_sqm, ppm: unitPrice(r), district: r.district_name });
  }
  const reqRows = await q<{ id: string; description: string | null; district_ids: string[]; purpose: string }>(`SELECT id, description, district_ids, purpose FROM requests WHERE org_id=$1 AND deleted_at IS NULL AND purpose IS NOT NULL AND status='open' ORDER BY created_at DESC LIMIT 2000`, [ctx.orgId]);
  const requests: { id: string; lat: number; lng: number; title: string; district: string }[] = [];
  let requestsUnplaced = 0;
  for (const r of reqRows) {
    const placed = r.district_ids.filter((d) => centers.has(d));
    if (!placed.length) { requestsUnplaced++; continue; }
    for (const d of placed) requests.push({ id: r.id, ...centers.get(d)!, title: (r.description ?? '').split('\n')[0], district: geo.districts.find((x) => x.id === d)?.name_ar ?? '' });
  }
  const districts = geo.districts.filter((d) => centers.has(d.id)).map((d) => {
    const here = rows.filter((r) => r.district_id === d.id && market(r.deal) === (f.deal === 'rent' ? 'rent' : 'sale'));
    return { id: d.id, name: d.name_ar, ...centers.get(d.id)!, ppm: summarize(here.map((r) => unitPrice(r)!)) };
  });
  const bounds = boundsOf([...offers, ...requests], JEDDAH_BOUNDS);
  let matching: { request_id: string; title: string; matches: { property_id: string; score: number }[] } | null = null;
  if (f.request_id && isUuid(f.request_id)) {
    const rq = await q<Record<string, unknown>>(`SELECT * FROM requests WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL AND purpose IS NOT NULL`, [f.request_id, ctx.orgId]);
    if (rq[0]) {
      const req = toMatchRequest(rq[0]);
      const ranked = rankMatches(req, await candidateOffers(ctx.orgId, req));
      matching = { request_id: f.request_id, title: String(rq[0].description ?? '').split('\n')[0], matches: ranked.matches.map((m) => ({ property_id: m.offer.id, score: m.score })) };
    }
  }
  return {
    bounds, start: JEDDAH_BOUNDS, offers, unplaced_offers: unplaced, requests, unplaced_requests: requestsUnplaced, districts,
    heat: { cols: 24, rows: 24, bounds, cells: heatGrid(offers.map((o) => ({ lat: o.lat, lng: o.lng })), bounds) },
    matching,
  };
}

/** مقارنة 2 إلى 4 عقارات: البيانات المنظمة جنبًا إلى جنب، مع سعر المتر ووسيط الحي والتقدير من المقارنات */
export async function compareProperties(ctx: Ctx, ids: string[]) {
  const uniq = [...new Set(ids)].filter(isUuid);
  if (uniq.length < 2 || uniq.length > 4) return { ok: false as const, error: 'need_2_to_4' };
  const rows = await q<Record<string, unknown>>(`SELECT p.id, p.kind, p.type, p.deal, p.area_sqm, p.price, p.price_per_sqm, p.attributes, p.description, p.notes, d.name_ar AS district_name, p.district_id
    FROM properties p LEFT JOIN districts d ON d.id=p.district_id WHERE p.org_id=$1 AND p.deleted_at IS NULL AND p.id = ANY($2)`, [ctx.orgId, uniq]);
  if (rows.length !== uniq.length) return { ok: false as const, error: 'not_found' };
  const all = await loadMarket(ctx.orgId);
  const items = uniq.map((id) => {
    const r = rows.find((x) => x.id === id)!, m = all.find((x) => x.id === id);
    // وسيط الحي لنفس النوع ونفس السوق فقط (مقارنة فيلا بفندق مضللة)
    const peers = m ? all.filter((x) => x.id !== id && x.district_id === m.district_id && market(x.deal) === market(m.deal) && sameKind(x, m)) : [];
    return {
      id, kind: r.kind, kind_label: getKind(r.kind)?.label ?? null, type: r.type, deal: r.deal, district_name: r.district_name,
      area_sqm: Number(r.area_sqm), price: Number(r.price), unit_price: m ? unitPrice(m) : null, attributes: r.attributes ?? {}, description: r.description, notes: r.notes,
      district_ppm: summarize(peers.map((x) => unitPrice(x)!)), estimate: m ? estimate(m, all) : null,
    };
  });
  return { ok: true as const, items };
}
