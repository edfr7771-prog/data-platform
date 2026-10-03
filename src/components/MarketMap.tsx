'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { project, type Bounds } from '@/lib/market';
import { kinds } from '@/lib/property-schema';
import { DEAL_AR, fmt } from './labels';

type Summary = { n: number; sufficient: boolean; median: number | null };
type MapData = {
  bounds: Bounds; offers: { id: string; lat: number; lng: number; approx: boolean; kind: string; deal: string; price: number; area_sqm: number; ppm: number | null; district: string | null }[];
  unplaced_offers: number; requests: { id: string; lat: number; lng: number; title: string; district: string }[]; unplaced_requests: number;
  districts: { id: string; name: string; lat: number; lng: number; ppm: Summary }[];
  heat: { cols: number; rows: number; bounds: Bounds; cells: number[][] };
  matching: { request_id: string; title: string; matches: { property_id: string; score: number }[] } | null;
};
type Layer = 'offers' | 'requests' | 'prices' | 'heat' | 'matching';
const LAYERS: { key: Layer; label: string }[] = [{ key: 'offers', label: 'العروض' }, { key: 'requests', label: 'الطلبات' }, { key: 'prices', label: 'أسعار الأحياء' }, { key: 'heat', label: 'الكثافة (هيتماب)' }, { key: 'matching', label: 'المطابقة' }];
const DEAL_COLOR: Record<string, string> = { sale: '#0B5F8C', rent: '#0A7D52', investment: '#9A4410' };
const W = 800, H = 600;

/**
 * خريطة السوق: إسقاط خطي للإحداثيات الفعلية على SVG، بلا مكتبة خرائط ولا طلبات لطرف ثالث (لا خلفية بلاطات بعد؛ قرار مزوّد الخرائط معلّق).
 * تبدأ بجدة، وتتسع لنقاط مؤسستك. الطبقات: العروض، الطلبات، أسعار الأحياء، الكثافة، والمطابقة لطلب مختار.
 */
export function MarketMap({ initialRequest }: { initialRequest?: string }) {
  const [deal, setDeal] = useState(''); const [kind, setKind] = useState(''); const [requestId, setRequestId] = useState(initialRequest ?? '');
  const [layers, setLayers] = useState<Set<Layer>>(() => new Set<Layer>(initialRequest ? ['offers', 'requests', 'matching'] : ['offers', 'requests', 'prices']));
  const [data, setData] = useState<MapData | null>(null); const [err, setErr] = useState('');
  const [reqs, setReqs] = useState<{ id: string; description: string | null }[]>([]);
  const [view, setView] = useState({ x: 0, y: 0, w: W, h: H });
  const [sel, setSel] = useState<{ title: string; lines: string[] } | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => { fetch('/api/requests?pageSize=100').then((r) => r.json()).then((d) => d.ok && setReqs(d.items)).catch(() => {}); }, []);
  useEffect(() => {
    const p = new URLSearchParams(); if (deal) p.set('deal', deal); if (kind) p.set('kind', kind); if (requestId) p.set('request_id', requestId);
    fetch(`/api/map?${p}`).then((r) => r.json()).then((d) => (d.ok ? setData(d) : setErr('تعذّر تحميل الخريطة.'))).catch(() => setErr('تعذّر تحميل الخريطة.'));
  }, [deal, kind, requestId]);

  const P = (lat: number, lng: number) => project(lat, lng, data!.bounds, W, H);
  const on = (l: Layer) => layers.has(l);
  const toggle = (l: Layer) => setLayers((s) => { const n = new Set(s); n.has(l) ? n.delete(l) : n.add(l); return n; });
  const zoom = (f: number) => setView((v) => { const w = Math.min(W * 2, Math.max(W / 16, v.w * f)), h = w * (H / W); return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h }; });
  const r = (base: number) => base * (view.w / W); // أحجام ثابتة بصريًا مع التكبير
  const matched = useMemo(() => new Map((data?.matching?.matches ?? []).map((m) => [m.property_id, m.score])), [data]);
  const ppmMax = Math.max(1, ...(data?.districts.map((d) => d.ppm.median ?? 0) ?? []));

  function onDown(e: React.PointerEvent) { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.target as Element).setPointerCapture?.(e.pointerId); }
  function onMove(e: React.PointerEvent) {
    if (!drag.current || !svg.current) return;
    const k = view.w / svg.current.getBoundingClientRect().width;
    setView((v) => ({ ...v, x: drag.current!.vx - (e.clientX - drag.current!.x) * k, y: drag.current!.vy - (e.clientY - drag.current!.y) * k }));
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {err && <div role="alert" className="note err">{err}</div>}
      <div className="row">
        <label className="field"><span>العملية</span><select className="input" value={deal} onChange={(e) => setDeal(e.target.value)}><option value="">الكل</option>{Object.entries(DEAL_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>النوع</span><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">كل الأنواع</option>{kinds().map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
        <label className="field"><span>طلب للمطابقة</span><select className="input" value={requestId} onChange={(e) => { setRequestId(e.target.value); if (e.target.value) setLayers((s) => new Set([...s, 'matching'])); }}><option value="">—</option>{reqs.map((q) => <option key={q.id} value={q.id}>{(q.description ?? '').split('\n')[0]}</option>)}</select></label>
      </div>
      <fieldset className="fs field"><legend>الطبقات</legend>
        <div className="seg">{LAYERS.map((l) => <label key={l.key}><input type="checkbox" checked={on(l.key)} onChange={() => toggle(l.key)} />{l.label}</label>)}</div>
      </fieldset>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <button type="button" className="btn sm" onClick={() => zoom(0.7)} aria-label="تكبير">+</button>
        <button type="button" className="btn sm" onClick={() => zoom(1 / 0.7)} aria-label="تصغير">−</button>
        <button type="button" className="btn line sm" style={{ color: 'var(--ink)', borderColor: '#8FA3C0' }} onClick={() => setView({ x: 0, y: 0, w: W, h: H })}>جدة كاملة</button>
        <span className="muted" style={{ fontSize: 14 }}>اسحب للتحريك، واستعمل العجلة أو الأزرار للتكبير.</span>
      </div>
      <div style={{ position: 'relative', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden', background: '#F2F6FB', touchAction: 'none' }}>
        {!data ? <div className="muted" style={{ padding: 40 }}>جارٍ تحميل الخريطة…</div> : (
          <svg ref={svg} role="img" aria-label={`خريطة جدة: ${data.offers.length} عرضًا و${data.requests.length} موضع طلب`} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} style={{ width: '100%', height: 'auto', display: 'block', cursor: 'grab' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}
            onWheel={(e) => zoom(e.deltaY > 0 ? 1.15 : 0.87)}>
            {Array.from({ length: 9 }, (_, i) => <line key={`v${i}`} x1={(i * W) / 8} y1={-H} x2={(i * W) / 8} y2={2 * H} stroke="#DCE5F0" strokeWidth={r(1)} />)}
            {Array.from({ length: 7 }, (_, i) => <line key={`h${i}`} x1={-W} y1={(i * H) / 6} x2={2 * W} y2={(i * H) / 6} stroke="#DCE5F0" strokeWidth={r(1)} />)}
            {on('heat') && data.heat.cells.map((row, y) => row.map((v, x) => {
              if (v < 0.05) return null;
              const tl = project(data.heat.bounds.north - (y * (data.heat.bounds.north - data.heat.bounds.south)) / data.heat.rows, data.heat.bounds.west + (x * (data.heat.bounds.east - data.heat.bounds.west)) / data.heat.cols, data.bounds, W, H);
              const br = project(data.heat.bounds.north - ((y + 1) * (data.heat.bounds.north - data.heat.bounds.south)) / data.heat.rows, data.heat.bounds.west + ((x + 1) * (data.heat.bounds.east - data.heat.bounds.west)) / data.heat.cols, data.bounds, W, H);
              return <rect key={`${x}-${y}`} x={tl.x} y={tl.y} width={br.x - tl.x + 0.5} height={br.y - tl.y + 0.5} fill="#E0B454" opacity={0.15 + v * 0.6} />;
            }))}
            {on('prices') && data.districts.map((d) => {
              const p = P(d.lat, d.lng), t = d.ppm.sufficient ? (d.ppm.median ?? 0) / ppmMax : 0;
              return (
                <g key={d.id} onClick={() => setSel({ title: `حي ${d.name}`, lines: [d.ppm.sufficient ? `وسيط سعر المتر: ${fmt(d.ppm.median)}` : `عينة غير كافية (${d.ppm.n})`] })} style={{ cursor: 'pointer' }}>
                  <circle cx={p.x} cy={p.y} r={r(26)} fill={d.ppm.sufficient ? `rgba(11,95,140,${0.15 + t * 0.4})` : 'rgba(74,93,120,.12)'} stroke="#0B5F8C" strokeWidth={r(1.5)} />
                  <text x={p.x} y={p.y - r(30)} textAnchor="middle" fontSize={r(13)} fill="#0B1F3A" pointerEvents="none">{d.name}</text>
                  <text x={p.x} y={p.y + r(4)} textAnchor="middle" fontSize={r(11)} fill="#0B1F3A" direction="ltr" pointerEvents="none">{d.ppm.sufficient ? fmt(d.ppm.median) : '—'}</text>
                </g>
              );
            })}
            {on('offers') && data.offers.map((o) => {
              const p = P(o.lat, o.lng), score = matched.get(o.id), dim = on('matching') && data.matching && score === undefined;
              return (
                <g key={o.id} onClick={() => setSel({ title: `${o.kind} · ${DEAL_AR[o.deal] ?? o.deal}`, lines: [`الحي: ${o.district ?? '—'}`, `السعر: ${fmt(o.price)} ريال`, `المساحة: ${fmt(o.area_sqm)} م²`, o.ppm ? `سعر المتر: ${fmt(o.ppm)}` : '', o.approx ? 'الموقع تقريبي (مركز الحي)' : '', score !== undefined ? `درجة المطابقة: ${score}/100` : ''].filter(Boolean) })} style={{ cursor: 'pointer' }} opacity={dim ? 0.25 : 1}>
                  <circle cx={p.x} cy={p.y} r={r(6)} fill={DEAL_COLOR[o.deal] ?? '#4A5D78'} stroke="#fff" strokeWidth={r(1.5)} strokeDasharray={o.approx ? `${r(2)} ${r(2)}` : undefined}><title>{o.kind}</title></circle>
                  {on('matching') && score !== undefined && <><circle cx={p.x} cy={p.y} r={r(11)} fill="none" stroke="#E0B454" strokeWidth={r(3)} pointerEvents="none" /><text x={p.x + r(13)} y={p.y + r(4)} fontSize={r(11)} fill="#7A5A12" direction="ltr" textAnchor="start" pointerEvents="none">{score}</text></>}
                </g>
              );
            })}
            {on('requests') && data.requests.map((q, i) => {
              const p = P(q.lat, q.lng), s = r(7), active = q.id === data.matching?.request_id;
              return <rect key={`${q.id}-${i}`} x={p.x - s + r(10)} y={p.y - s - r(10)} width={2 * s} height={2 * s} transform={`rotate(45 ${p.x + r(10)} ${p.y - r(10)})`} fill={active ? '#E0B454' : '#7A1912'} stroke="#fff" strokeWidth={r(1.5)}
                onClick={() => setSel({ title: 'طلب', lines: [q.title, `موضعه: مركز حي ${q.district}`] })} style={{ cursor: 'pointer' }}><title>{q.title}</title></rect>;
            })}
          </svg>
        )}
      </div>
      <div className="row" style={{ gap: 18, fontSize: 14 }} aria-label="مفتاح الخريطة">
        {Object.entries(DEAL_COLOR).map(([k, c]) => <span key={k}><svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="6" fill={c} /></svg> {DEAL_AR[k]}</span>)}
        <span><svg width="14" height="14" aria-hidden><rect x="3" y="3" width="8" height="8" transform="rotate(45 7 7)" fill="#7A1912" /></svg> طلب</span>
        <span>الحد المتقطع = موقع تقريبي</span>
      </div>
      {data && (data.unplaced_offers > 0 || data.unplaced_requests > 0) && <p className="muted" style={{ margin: 0 }}>خارج الخريطة: {fmt(data.unplaced_offers)} عرض و{fmt(data.unplaced_requests)} طلب بلا إحداثيات ولا مركز حي معروف. أضف الإحداثيات للعروض لتظهر.</p>}
      {data?.matching && <div className="note">طبقة المطابقة: «{data.matching.title}»، {data.matching.matches.length} عرضًا مطابقًا (حلقة ذهبية ودرجة).</div>}
      {sel && <div className="panel" aria-live="polite"><b>{sel.title}</b><ul style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>{sel.lines.map((l) => <li key={l}>{l}</li>)}</ul></div>}
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>الخريطة بلا خلفية شوارع بعد: اختيار مزوّد بلاطات الخرائط (واستضافته داخل المملكة) قرار معلّق. المواقع من إحداثيات عقاراتك الفعلية.</p>
    </div>
  );
}
