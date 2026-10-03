// اختبارات Phase 2: الطلبات المنظمة، والمطابقة من البيانات المنظمة، والذكاء السعري وحسابات الخريطة.
import { describeRequest, criteriaFieldsFor, parseImportance, parsePurpose, requestPayload, validateRequest, type RequestValue } from '../src/lib/request-schema';
import { evaluateCriterion, matchOffer, rankMatches, type MatchRequest, type Offer } from '../src/lib/matching';
import { boundsOf, centroid, estimate, heatGrid, JEDDAH_BOUNDS, MIN_SAMPLE, monthlyTrend, project, quantile, summarize, unitPrice, type MarketRow } from '../src/lib/market';
import { describeListing, fieldsFor, validateListing } from '../src/lib/property-schema';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra: unknown = '') => { cond ? pass++ : fail++; console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : `| ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`); };
const codes = (r: { errors: { code: string; field?: string }[] }) => r.errors.map((e) => `${e.field}:${e.code}`);

console.log('1) الحقول الجديدة للمواصفات التفصيلية في العروض');
check('الشقة والفيلا: التكييف والتشطيب والمزايا', ['ac_type', 'finishing', 'features'].every((k) => fieldsFor('apartment', 'sale').some((f) => f.key === k) && fieldsFor('villa', 'sale').some((f) => f.key === k)));
check('المكتب والمعرض والمحل: التكييف والتشطيب والمزايا', ['office', 'showroom', 'shop'].every((kd) => ['ac_type', 'finishing', 'features'].every((k) => fieldsFor(kd, 'sale').some((f) => f.key === k))));
check('الأرض بلا تكييف ولا تشطيب', !fieldsFor('land', 'sale').some((f) => ['ac_type', 'finishing', 'features'].includes(f.key)));
const apt = validateListing({ deal: 'عرض استثماري', kind: 'apartment', area_sqm: 150, price: 900000, attributes: { bedrooms: 3, bathrooms: 2, floor_number: 1, ac_type: 'سبليت', finishing: 'super_deluxe', features: ['حديقة', 'cctv'] } });
check('«عرض استثماري» عملية استثمار، والقيم العربية تُحفظ بمفاتيحها', apt.value?.deal === 'investment' && apt.value.attributes.ac_type === 'split' && JSON.stringify(apt.value.attributes.features) === '["cctv","garden"]', apt);
check('وصف العرض يذكر التكييف والتشطيب والمزايا بالعربية', (() => { const t = describeListing(apt.value!).text; return t.includes('التكييف: سبليت') && t.includes('التشطيب: سوبر ديلوكس') && t.includes('المزايا: كاميرات مراقبة، حديقة'); })());

console.log('2) الطلب المنظم');
check('الأغراض: شراء واستئجار واستثمار بالعربية والإنجليزية', parsePurpose('شراء') === 'buy' && parsePurpose('استئجار') === 'rent' && parsePurpose('ايجار') === 'rent' && parsePurpose('investment') === 'investment' && parsePurpose('xyz') === null);
check('الأهمية: إلزامي ومفضّل، و«لا يهم» = لا شرط، والمجهول = خطأ', parseImportance('شرط إلزامي') === 'must' && parseImportance('مفضل') === 'preferred' && parseImportance('لا يهم') === null && parseImportance('') === null && parseImportance('ربما') === undefined);
const base = { purpose: 'buy', kinds: ['villa', 'duplex'], budget_max: '2,500,000', district_ids: ['d1', 'd2'] };
const okReq = validateRequest({ ...base, area_min: 300, criteria: { bedrooms: { value: 4, importance: 'must' }, pool: { value: true, importance: 'preferred' }, ac_type: { value: ['central', 'split'], importance: 'preferred' }, finishing: { value: 'deluxe', importance: 'لا يهم' } } });
check('طلب سليم يُقبل والقيم موحدة', !!okReq.value && okReq.value.budget_max === 2500000 && okReq.value.criteria.bedrooms.op === 'min' && okReq.value.criteria.bedrooms.value === 4 && okReq.value.criteria.pool.value === true, okReq);
check('«لا يهم» لا يُحفظ شرطًا', !('finishing' in okReq.value!.criteria));
check('التكييف شرط «أحد القيم» بمفاتيح موحدة', okReq.value!.criteria.ac_type.op === 'in' && JSON.stringify(okReq.value!.criteria.ac_type.value) === '["central","split"]');
check('الحي إلزامي افتراضيًا، والمساحة مفضّلة افتراضيًا', okReq.value!.district_importance === 'must' && okReq.value!.area_importance === 'preferred');
check('العمر شرط «حد أقصى»', validateRequest({ ...base, criteria: { age_years: { value: 5, importance: 'must' } } }).value?.criteria.age_years.op === 'max');
check('الحقول المطلوبة: الغرض والنوع والميزانية القصوى', ['purpose:purpose_invalid', 'kinds:kinds_required', 'budget_max:budget_invalid'].every((c) => codes(validateRequest({})).includes(c)), codes(validateRequest({})));
check('الاستئجار يتطلب مدة الإيجار', codes(validateRequest({ ...base, purpose: 'rent' })).includes('rent_period:rent_period_required') && !!validateRequest({ ...base, purpose: 'rent', rent_period: 'سنويًا' }).value);
check('نطاقات مقلوبة تُرفض (ميزانية ومساحة)', codes(validateRequest({ ...base, budget_min: 3e6 })).includes('budget_min:budget_range') && codes(validateRequest({ ...base, area_min: 500, area_max: 300 })).includes('area_min:area_range'));
check('شرط على حقل لا يخص الأنواع المختارة يُتجاهل ويُذكر', (() => { const r = validateRequest({ ...base, criteria: { land_use: { value: 'commercial', importance: 'must' } } }); return !!r.value && !('land_use' in r.value.criteria) && r.ignored.includes('land_use'); })());
check('قيمة شرط غير صالحة تُرفض (غرف بكسر، تكييف خارج القائمة)', codes(validateRequest({ ...base, criteria: { bedrooms: { value: '3.5', importance: 'must' } } })).includes('bedrooms:criterion_invalid') && codes(validateRequest({ ...base, criteria: { ac_type: { value: 'نووي', importance: 'must' } } })).includes('ac_type:criterion_invalid'));
check('أهمية غير معروفة تُرفض', codes(validateRequest({ ...base, criteria: { bedrooms: { value: 3, importance: 'ربما' } } })).includes('bedrooms:importance_invalid'));
check('حقول وصفية لا تصلح شرطًا (رقم الدور، الأبعاد)', !criteriaFieldsFor(['apartment', 'land']).some((f) => ['floor_number', 'length_m', 'width_m', 'street_widths'].includes(f.key)));
check('حقول الشروط تتغير بالأنواع المختارة', criteriaFieldsFor(['land']).some((f) => f.key === 'land_use') && !criteriaFieldsFor(['land']).some((f) => f.key === 'bedrooms') && criteriaFieldsFor(['hotel']).some((f) => f.key === 'hotel_rating'));
check('الحمولة: شروط الأنواع المختارة فقط، و«لا يهم» لا يُرسل', (() => { const p = requestPayload({ ...base, kinds: ['land'], criteria: { bedrooms: { value: 3, importance: 'must' }, land_use: { value: 'commercial', importance: 'must' }, main_road: { value: true, importance: 'any' } } }); return JSON.stringify(Object.keys(p.criteria as object)) === '["land_use"]'; })());

console.log('3) وصف الطلب');
const d = describeRequest(okReq.value!, { city: 'جدة', districts: ['الفروسية', 'الصفا'] });
check('العنوان: الأنواع والغرض والأحياء والمدينة', d.title === 'مطلوب فيلا أو دوبلكس للشراء في حي الفروسية أو حي الصفا، جدة', d.title);
check('الأقسام بالترتيب: الموقع، الميزانية والمساحة، الشروط الإلزامية، المفضّلات', JSON.stringify(d.sections.map((s) => s.key)) === '["location","budget","must","preferred"]', d.sections.map((s) => s.key));
check('صيغ الشروط: «على الأقل»، «أو»، «يوجد»، والأهمية بين قوسين', d.text.includes('غرف النوم: 4 على الأقل') && d.text.includes('التكييف: مركزي أو سبليت') && d.text.includes('مسبح: يوجد') && d.text.includes('الأحياء: الفروسية، الصفا (شرط إلزامي)') && d.text.includes('المساحة: 300 م² على الأقل (مفضّل)'), d.text);
check('الميزانية: «حتى» بلا حد أدنى، و«من ... إلى» معه', d.text.includes('الميزانية: حتى 2,500,000 ريال') && describeRequest(validateRequest({ ...base, budget_min: 1e6 }).value!).text.includes('من 1,000,000 إلى 2,500,000 ريال'));
check('«لا يهم» لا يظهر في الوصف، ولا قسم فارغ', !d.text.includes('التشطيب') && !describeRequest(validateRequest(base).value!).text.includes('المفضّلات'));
check('الملاحظات الحرة لا تدخل وصف الطلب', !describeRequest(validateRequest({ ...base, notes: 'أفضّل قرب المسجد' }).value!).text.includes('المسجد'));
// بلا اختلاق: كل رقم في الوصف مُدخل
const nums = (t: string) => (t.replace(/(\d),(\d)/g, '$1$2').match(/\d+(\.\d+)?/g) ?? []);
const rv = validateRequest({ purpose: 'rent', rent_period: 'monthly', kinds: ['apartment'], budget_min: 3000, budget_max: 5500, area_max: 180, criteria: { bedrooms: { value: 2, importance: 'must' }, age_years: { value: 7, importance: 'preferred' }, parking_spaces: { value: 1, importance: 'preferred' } } }).value!;
check('بلا اختلاق: كل رقم في وصف الطلب من المدخلات', nums(describeRequest(rv).text).every((n) => ['3000', '5500', '180', '2', '7', '1'].includes(n)), nums(describeRequest(rv).text));

console.log('4) المطابقة من البيانات المنظمة');
const req: MatchRequest = { ...okReq.value!, district_ids: ['d1', 'd2'], city_id: 'c1' };
const offer = (o: Partial<Offer> & { attributes?: Record<string, unknown> }): Offer => ({ id: o.id ?? 'o1', kind: 'villa', type: 'villa', deal: 'sale', city_id: 'c1', district_id: 'd1', price: 2_000_000, area_sqm: 350, ...o, attributes: { bedrooms: 5, pool: true, ac_type: 'central', ...(o.attributes ?? {}) } });
const full = matchOffer(req, offer({}));
check('عرض يحقق الإلزامي والمفضّل كله = مؤهل بدرجة 100', full.eligible && full.score === 100, full);
check('كل شرط له سبب مفسَّر (حالة ونص)', full.reasons.length >= 5 && full.reasons.every((r) => ['met', 'unmet', 'unknown'].includes(r.status) && r.detail.length > 0));
check('شرط إلزامي غير متحقق يستبعد (3 غرف والمطلوب 4)', matchOffer(req, offer({ attributes: { bedrooms: 3 } })).excluded_by === 'criterion:bedrooms');
check('شرط إلزامي مجهول (العرض لا يذكر الغرف) يستبعد', (() => { const r = matchOffer(req, offer({ attributes: { bedrooms: undefined } })); return !r.eligible && r.excluded_by === 'criterion:bedrooms'; })());
check('مفضّل غير متحقق يخفض الدرجة ولا يستبعد', (() => { const r = matchOffer(req, offer({ attributes: { pool: false } })); return r.eligible && r.score < 100 && r.reasons.find((x) => x.key === 'pool')?.status === 'unmet'; })());
check('مفضّل مجهول لا يُحتسب متحققًا', (() => { const r = matchOffer(req, offer({ attributes: { ac_type: undefined } })); return r.eligible && r.score < 100 && r.reasons.find((x) => x.key === 'ac_type')?.status === 'unknown'; })());
check('الاستبعاد الصريح: نوع آخر، عملية إيجار لطلب شراء، مدينة أخرى، حي خارج القائمة، فوق الميزانية', matchOffer(req, offer({ kind: 'apartment' })).excluded_by === 'kind' && matchOffer(req, offer({ deal: 'rent' })).excluded_by === 'deal'
  && matchOffer(req, offer({ city_id: 'c2' })).excluded_by === 'city' && matchOffer(req, offer({ district_id: 'd9' })).excluded_by === 'district' && matchOffer(req, offer({ price: 2_600_000 })).excluded_by === 'budget');
check('الحي المفضّل يخفض الدرجة ولا يستبعد', (() => { const r = matchOffer({ ...req, district_importance: 'preferred' }, offer({ district_id: 'd9' })); return r.eligible && r.score < 100; })());
check('الاستثمار يطابق العروض الاستثمارية وعروض البيع، لا الإيجار', ['investment', 'sale'].every((dl) => matchOffer({ ...req, purpose: 'investment' }, offer({ deal: dl })).eligible) && !matchOffer({ ...req, purpose: 'investment' }, offer({ deal: 'rent' })).eligible);
check('العرض القديم بلا kind يُطابق بالنوع الأساسي ويقرأ الغرف من عمود Phase 1', matchOffer(req, { ...offer({}), kind: null, attributes: { pool: true, ac_type: 'central' }, rooms: 4 }).eligible && !matchOffer(req, { ...offer({}), kind: null, attributes: {}, rooms: 3 }).eligible);
// النص الحر لا يدخل المطابقة إطلاقًا
const textOnly = { ...offer({ attributes: { pool: undefined } }), notes: 'فيلا فيها مسبح كبير', description: 'مسبح: يوجد' } as Offer;
check('ذكر «مسبح» في الملاحظات أو الوصف النصي لا يحقق شرط المسبح (المطابقة على البيانات المنظمة)', matchOffer({ ...req, criteria: { ...req.criteria, pool: { op: 'is', value: true, importance: 'must' } } }, textOnly).excluded_by === 'criterion:pool');
check('والمسبح في البيانات المنظمة يحققه', matchOffer({ ...req, criteria: { ...req.criteria, pool: { op: 'is', value: true, importance: 'must' } } }, offer({})).eligible);
// الإيجار يُوحَّد سنويًا
const rentReq: MatchRequest = { ...validateRequest({ purpose: 'rent', rent_period: 'yearly', kinds: ['apartment'], budget_max: 60000 }).value!, city_id: null };
const rentOffer = (price: number, period?: string): Offer => ({ id: 'r', kind: 'apartment', type: 'apartment', deal: 'rent', city_id: 'c1', district_id: 'd1', price, area_sqm: 120, attributes: period ? { rent_period: period } : {} });
check('الإيجار يوحَّد سنويًا: 4,500 شهريًا (54,000 سنويًا) ضمن 60,000 سنويًا، و5,500 شهريًا خارجها', matchOffer(rentReq, rentOffer(4500, 'monthly')).eligible && matchOffer(rentReq, rentOffer(5500, 'monthly')).excluded_by === 'budget');
check('عرض إيجار بلا مدة: يُعامل بمدة الطلب ويُذكر ذلك في السبب', matchOffer(rentReq, rentOffer(50000)).reasons.some((r) => r.detail.includes('غير مذكورة في العرض')));
check('معايير المقارنة: حد أدنى، حد أقصى، أحد، يحوي، نعم/لا', evaluateCriterion({ op: 'min', value: 3, importance: 'must' }, 3) === 'met' && evaluateCriterion({ op: 'max', value: 5, importance: 'must' }, 6) === 'unmet'
  && evaluateCriterion({ op: 'in', value: ['a', 'b'], importance: 'must' }, 'b') === 'met' && evaluateCriterion({ op: 'has', value: ['x', 'y'], importance: 'must' }, ['x']) === 'unmet' && evaluateCriterion({ op: 'is', value: false, importance: 'must' }, false) === 'met' && evaluateCriterion({ op: 'is', value: true, importance: 'must' }, undefined) === 'unknown');
const ranked = rankMatches(req, [offer({ id: 'a', attributes: { pool: false } }), offer({ id: 'b' }), offer({ id: 'c', price: 1_500_000 }), offer({ id: 'x', kind: 'apartment' }), offer({ id: 'y', price: 9e6 })]);
check('الترتيب بالدرجة ثم السعر الأقل، والمستبعد يُعدّ بسببه', ranked.matches.map((m) => m.offer.id).join() === 'c,b,a' && ranked.excluded.kind === 1 && ranked.excluded.budget === 1 && ranked.total_eligible === 3, ranked.matches.map((m) => [m.offer.id, m.score]));

console.log('5) الذكاء السعري');
check('الكمّيات بالاستيفاء الخطي (مطابقة percentile_cont)', quantile([1, 2, 3, 4], 0.5) === 2.5 && quantile([10, 20, 30, 40, 50], 0.25) === 20 && quantile([5], 0.75) === 5);
check(`عينة أقل من ${MIN_SAMPLE} = بلا وسيط ومعلَّمة غير كافية`, summarize([1000, 2000]).median === null && !summarize([1000, 2000]).sufficient && summarize([1000, 2000]).n === 2);
check('الملخص الكافي: وسيط وربيعان وحدود', JSON.stringify(summarize([3000, 1000, 2000, 4000])) === JSON.stringify({ n: 4, sufficient: true, median: 2500, p25: 1750, p75: 3250, min: 1000, max: 4000 }));
check('سعر المتر للإيجار سنوي (شهري × 12)', unitPrice({ deal: 'rent', price: 5000, area_sqm: 100, rent_period: 'monthly' }) === 600 && unitPrice({ deal: 'sale', price: 1e6, area_sqm: 250, rent_period: null }) === 4000);
const row = (id: string, o: Partial<MarketRow>): MarketRow => ({ id, kind: 'villa', type: 'villa', deal: 'sale', city_id: 'c1', district_id: 'd1', district_name: 'الفروسية', price: 1_000_000, area_sqm: 250, rent_period: null, lat: null, lng: null, created_at: '2026-09-01', ...o });
const pool = [row('a', { price: 1_000_000 }), row('b', { price: 1_250_000 }), row('c', { price: 1_500_000 }), row('d', { price: 900_000, district_id: 'd2' }), row('e', { deal: 'rent', price: 60000 }), row('f', { kind: 'apartment', type: 'apartment', price: 3e6 })];
const est = estimate(row('s', { area_sqm: 300 }), pool);
check('التقدير من مقارنات الحي نفسه والنوع والسوق فقط (3 مقارنات)', est.ok && est.level === 'district' && est.n === 3 && JSON.stringify([...est.comparables].sort()) === '["a","b","c"]', est);
check('التقدير = وسيط سعر المتر × المساحة، والنطاق من الربعين', est.ok && est.estimate === 5000 * 300 && est.low === 4500 * 300 && est.high === 5500 * 300, est);
const est2 = estimate(row('s', { district_id: 'd2' }), pool);
check('حي بعينة ناقصة ينتقل إلى المدينة', est2.ok && est2.level === 'city' && est2.n === 4, est2);
const est3 = estimate(row('s', { kind: 'hotel', type: 'commercial' }), pool);
check('نوع بلا مقارنات كافية = رفض صريح مع أعداد العينة، بلا رقم', !est3.ok && est3.reason === 'insufficient_data' && est3.n_city === 0);
check('العقار نفسه لا يدخل مقارناته', !estimate(pool[0], pool.slice(0, 3)).ok);
check('الاتجاه الشهري: وسيط لكل شهر بالترتيب', (() => { const t = monthlyTrend([row('a', { created_at: '2026-08-03' }), row('b', { created_at: '2026-09-10' }), row('c', { created_at: '2026-09-11' })]); return t.map((x) => x.month).join() === '2026-08,2026-09' && t[1].summary.n === 2; })());

console.log('6) حسابات الخريطة');
check('نافذة البداية جدة عند غياب النقاط', JSON.stringify(boundsOf([])) === JSON.stringify(JEDDAH_BOUNDS));
const bb = boundsOf([{ lat: 21.5, lng: 39.2 }, { lat: 21.6, lng: 39.1 }]);
check('الحدود تتسع لتشمل النقاط مع هامش', bb.south < 21.5 && bb.north > 21.6 && bb.west < 39.1 && bb.east > 39.2);
const pA = project(21.6, 39.1, bb, 800, 600), pB = project(21.5, 39.2, bb, 800, 600);
check('الإسقاط: الشمال أعلى والشرق يمين وداخل الإطار', pA.y < pB.y && pA.x < pB.x && [pA, pB].every((p) => p.x >= 0 && p.x <= 800 && p.y >= 0 && p.y <= 600));
check('المركز متوسط النقاط، ولا مركز بلا نقاط', JSON.stringify(centroid([{ lat: 21, lng: 39 }, { lat: 22, lng: 40 }])) === JSON.stringify({ lat: 21.5, lng: 39.5 }) && centroid([]) === null);
const hg = heatGrid([{ lat: 21.6, lng: 39.12 }, { lat: 21.6, lng: 39.12 }, { lat: 21.4, lng: 39.3 }], JEDDAH_BOUNDS, 10, 10);
const peak = Math.max(...hg.flat());
check('الكثافة مطبّعة 0..1 وذروتها حيث تتكدس النقاط', peak === 1 && hg.flat().every((v) => v >= 0 && v <= 1) && hg.findIndex((r) => r.includes(1)) < 5);
check('بلا نقاط = شبكة أصفار', heatGrid([], JEDDAH_BOUNDS, 4, 4).flat().every((v) => v === 0));

console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
