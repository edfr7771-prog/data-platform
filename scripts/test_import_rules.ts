// اختبارات الوحدات للقواعد النقية: التطبيع العربي، تنظيف العقار، التكرار، CSV، التصدير المحصَّن.
import { normalizeArabic, parseNumber, levenshtein } from '../src/lib/arabic';
import { cleanProperty, dedupeKey, pricePerSqm, resolveGeo, type Geo } from '../src/lib/property-rules';
import { parseCsvText, processRows, suggestMapping, summarize, validateUpload } from '../src/lib/csv-rules';
import { csvCell, toCsv } from '../src/lib/csv-export';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? pass++ : fail++; console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : extra); };
const geo: Geo = {
  cities: [{ id: 'c1', slug: 'jeddah', name_ar: 'جدة', name_en: 'Jeddah' }],
  districts: [
    { id: 'd1', city_id: 'c1', slug: 'al-furusiyyah', name_ar: 'الفروسية', name_en: 'Al Furusiyyah' }, { id: 'd2', city_id: 'c1', slug: 'al-riyadh', name_ar: 'الرياض', name_en: 'Al Riyadh' },
    { id: 'd3', city_id: 'c1', slug: 'al-rahmaniyyah', name_ar: 'الرحمانية', name_en: 'Al Rahmaniyyah' }, { id: 'd4', city_id: 'c1', slug: 'al-nuzhah', name_ar: 'النزهة', name_en: 'Al Nuzhah' },
    { id: 'd5', city_id: 'c1', slug: 'al-safa', name_ar: 'الصفا', name_en: 'Al Safa' },
  ],
};
const base = { type: 'فيلا', deal: 'بيع', area_sqm: '300', price: '1,450,000', city: 'جدة', district: 'الفروسية' };

console.log('التطبيع العربي والأرقام');
check('الهمزات والتاء المربوطة والتشكيل تتوحد', normalizeArabic('الفُروسيَّة') === normalizeArabic('الفروسيه') && normalizeArabic('إيجار') === normalizeArabic('ايجار'));
check('الأرقام العربية تتحول لاتينية', normalizeArabic('١٢٣') === '123');
check('parseNumber: فواصل وعملة', parseNumber('1,250,000 ريال') === 1250000);
check('parseNumber: مليون بأرقام عربية', parseNumber('١٫٥ مليون') === 1500000);
check('parseNumber: مساحة بوحدة', parseNumber('٣٠٠ م²') === 300 && parseNumber('300 sqm') === 300);
check('parseNumber: نص غير رقمي أو فارغ = null', parseNumber('abc') === null && parseNumber('') === null && parseNumber(undefined) === null);
check('levenshtein', levenshtein('الفروسيا', 'الفروسيه') === 1 && levenshtein('abc', 'abc') === 0);

console.log('تنظيف العقار');
const ok = cleanProperty(base, geo);
check('عقار سليم يُقبل بلا أخطاء', !!ok.value && ok.errors.length === 0 && ok.value.district_id === 'd1' && ok.value.city_id === 'c1');
check('سعر المتر = السعر ÷ المساحة (4833.33)', pricePerSqm(1450000, 300) === 4833.33 && pricePerSqm(100, 0) === null);
check('تنظيف الرقم يُسجَّل تصحيحًا لا يُخفى', ok.fixes.some((f) => f.code === 'number_normalized' && f.field === 'price'));
check('الاستخدام الافتراضي: فيلا سكني، ومكتب تجاري', ok.value!.usage === 'residential' && cleanProperty({ ...base, type: 'مكتب' }, geo).value!.usage === 'commercial');
check('نوع مجهول خطأ', cleanProperty({ ...base, type: 'xyz' }, geo).errors.some((e) => e.code === 'type_invalid'));
check('مساحة صفر أو سالبة خطأ', cleanProperty({ ...base, area_sqm: '0' }, geo).errors.some((e) => e.code === 'area_invalid') && cleanProperty({ ...base, area_sqm: '-5' }, geo).errors.length > 0);
check('سعر سالب خطأ، وسعر بيع صفر خطأ، وإيجار صفر مقبول', cleanProperty({ ...base, price: '-1' }, geo).errors.length > 0 && cleanProperty({ ...base, price: '0' }, geo).errors.length > 0 && cleanProperty({ ...base, deal: 'إيجار', price: '0' }, geo).errors.length === 0);
check('غرف كسرية وواجهات خارج 0..4 أخطاء', cleanProperty({ ...base, rooms: '2.5' }, geo).errors.some((e) => e.code === 'rooms_invalid') && cleanProperty({ ...base, facades: '5' }, geo).errors.some((e) => e.code === 'facades_invalid'));
check('إحداثيات خارج النطاق أو ناقصة خطأ', cleanProperty({ ...base, lat: '95', lng: '40' }, geo).errors.length > 0 && cleanProperty({ ...base, lat: '21.5' }, geo).errors.length > 0);
const odd = cleanProperty({ ...base, area_sqm: '1000', price: '50000' }, geo);
check('سعر متر غير منطقي (50) يعطي تحذير مراجعة لا رفضًا', !!odd.value && odd.warnings.some((w) => w.code === 'ppm_out_of_range'));
check('نص يبدأ بـ = يعطي تحذير formula_like', cleanProperty({ ...base, notes: '=HYPERLINK("x")' }, geo).warnings.some((w) => w.code === 'formula_like'));
check('أرقام عربية وكلمات عملة تُقبل', cleanProperty({ ...base, area_sqm: '٣٠٠ م²', price: '١٬٤٥٠٬٠٠٠ ريال' }, geo).value?.price === 1450000);

console.log('مطابقة الأحياء');
check('الحي بحرف مختلف يُصحَّح ويُسجَّل', (() => { const r = resolveGeo('جدة', 'الفروسيا', geo); return r.districtId === 'd1' && r.fixes[0]?.code === 'district_corrected'; })());
check('بادئة «حي» تُزال', resolveGeo('', 'حي النزهة', geo).districtId === 'd4');
check('الاسم الإنجليزي والـslug يُطابقان', resolveGeo('Jeddah', 'Al Safa', geo).districtId === 'd5' && resolveGeo('', 'al-riyadh', geo).districtId === 'd2');
check('حي مجهول يعطي تحذيرًا ولا يُخمَّن', (() => { const r = resolveGeo('جدة', 'أبحر الشمالية', geo); return r.districtId === null && r.issues[0]?.code === 'district_unknown'; })());
check('مدينة مجهولة تحذير', resolveGeo('الرياض مدينة', '', geo).issues[0]?.code === 'city_unknown');

console.log('مفتاح التكرار');
const A = { type: 'villa' as const, deal: 'sale' as const, district_id: 'd1', location: null, area_sqm: 300, price: 1450000 };
check('نفس المدخلات = نفس المفتاح، والتقريب للمتر والألف', dedupeKey(A) === dedupeKey({ ...A, area_sqm: 300.2, price: 1450400 }));
check('سعر أو نوع مختلف = مفتاح مختلف', dedupeKey(A) !== dedupeKey({ ...A, price: 1500000 }) && dedupeKey(A) !== dedupeKey({ ...A, type: 'apartment' }));

console.log('CSV: قراءة وتخمين الأعمدة وتصنيف الصفوف');
const header = ['رقم العقار', 'النوع', 'نوع العرض', 'المدينة', 'الحي', 'المساحة', 'السعر', 'العمر', 'ملاحظات'];
const m = suggestMapping(header);
check('تخمين الأعمدة العربية', m.external_ref === 0 && m.type === 1 && m.deal === 2 && m.city === 3 && m.district === 4 && m.area_sqm === 5 && m.price === 6 && m.age_years === 7 && m.notes === 8);
check('تخمين الأعمدة الإنجليزية', (() => { const e = suggestMapping(['ID', 'Type', 'Deal', 'City', 'District', 'Area', 'Price']); return e.type === 1 && e.area_sqm === 5 && e.price === 6 && e.district === 4; })());
const text = [header.join(','), 'A1,فيلا,بيع,جدة,الفروسية,300,"1,450,000",3,جيد', 'A2,فيلا,بيع,جدة,الفروسية,300.2,1450400,3,مكرر داخل الملف',
  'A3,شقة,بيع,جدة,الفروسيا,120,600000,5,', 'A4,xyz,بيع,جدة,الرياض,100,500000,1,', 'A5,فيلا,بيع,جدة,أبحر الشمالية,400,2000000,2,', 'A6,أرض,بيع,جدة,النزهة,1000,50000,0,'].join('\n');
const parsed = parseCsvText(text);
check('قراءة CSV بفاصلة داخل علامات اقتباس', !('error' in parsed) && parsed.rows.length === 6 && parsed.rows[0][6] === '1,450,000');
if (!('error' in parsed)) {
  const rows = processRows(parsed.rows, m, geo, new Set());
  const st = rows.map((r) => r.status);
  check('تصنيف الصفوف: سليم، مكرر داخل الملف، مُصحَّح، غير صالح، مراجعة، مراجعة', JSON.stringify(st) === JSON.stringify(['fixed', 'duplicate', 'fixed', 'invalid', 'review', 'review']), JSON.stringify(st));
  check('أرقام الصفوف تبدأ من 2 (بعد الترويسة)', rows[0].row_number === 2 && rows[5].row_number === 7);
  const ex = new Set([dedupeKey(rows[0].normalized!)]);
  check('مكرر مع بيانات موجودة في قاعدة البيانات', processRows(parsed.rows, m, geo, ex)[0].status === 'duplicate');
  const s = summarize(rows);
  check('الملخص يطابق الصفوف', s.total === 6 && s.fixed === 2 && s.duplicate === 1 && s.invalid === 1 && s.review === 2 && s.ok === 0, JSON.stringify(s));
}
check('فاصلة منقوطة تُكتشف تلقائيًا', (() => { const p = parseCsvText('نوع;سعر\nفيلا;100'); return !('error' in p) && p.header.length === 2 && p.rows[0][1] === '100'; })());
check('ملف بلا صفوف بيانات يُرفض', 'error' in parseCsvText('نوع,سعر'));

console.log('فحص الملف المرفوع');
const enc = (s: string) => new TextEncoder().encode(s);
check('امتداد غير csv يُرفض', !validateUpload({ filename: 'a.xlsx', size: 10 }, enc('x'), 1e6).ok);
check('ملف ثنائي (NUL) يُرفض', !validateUpload({ filename: 'a.csv', size: 4 }, new Uint8Array([97, 0, 98, 99]), 1e6).ok);
check('حجم أكبر من الحد يُرفض', !validateUpload({ filename: 'a.csv', size: 2e6 }, enc('x'), 1e6).ok && !validateUpload({ filename: 'a.csv', size: 0 }, new Uint8Array(), 1e6).ok);
check('UTF-8 مع BOM يُقبل ويُزال BOM', (() => { const r = validateUpload({ filename: 'a.csv', size: 6 }, new Uint8Array([0xEF, 0xBB, 0xBF, 97, 98, 99]), 1e6); return r.ok && r.text === 'abc'; })());
check('ترميز Windows-1256 (إكسل العربي) يُقرأ', (() => { const r = validateUpload({ filename: 'a.csv', size: 4 }, new Uint8Array([0xC7, 0xE1, 0xE1, 0xE5]), 1e6); return r.ok && r.encoding === 'windows-1256' && r.text === 'الله'; })());

console.log('التصدير المحصَّن من حقن الصيغ');
check('= و+ و- و@ تُسبق بفاصلة عليا', csvCell('=1+1') === "'=1+1" && csvCell('+cmd') === "'+cmd" && csvCell('-2+3') === "'-2+3" && csvCell('@SUM(A1)') === "'@SUM(A1)");
check('Tab وCR في البداية تُحصَّن', csvCell('\tx') === "'\tx" && csvCell('\rx').startsWith('"\'\r'));
check('الاقتباس والفواصل والأسطر تُهرَّب', csvCell('a,b') === '"a,b"' && csvCell('say "hi"') === '"say ""hi"""' && csvCell('a\nb') === '"a\nb"');
check('الأرقام العادية تبقى كما هي', csvCell(1450000) === '1450000' && csvCell(null) === '' && csvCell('فيلا') === 'فيلا');
check('BOM في بداية الملف المصدَّر', toCsv([['a'], ['=x']]).startsWith('\uFEFF') && toCsv([['=x']]).includes("'=x"));

console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
