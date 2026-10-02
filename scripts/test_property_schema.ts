// اختبارات الإدخال المنظم (Phase 2): سجل الأنواع، تغيّر الحقول بالنوع، التحقق، الوصف المولَّد (ترتيب، بلا فراغات، بلا اختلاق)، المسودات، والتوسعة.
import {
  COMMON_ATTRS, describeListing, errorsForStep, FIELDS, fieldsFor, getKind, GROUPS, kindDefProblems, kinds, legacyColumns, payloadFor,
  registerPropertyKind, sanitizeDraft, validateListing, type KindDef, type ListingValue,
} from '../src/lib/property-schema';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra: unknown = '') => { cond ? pass++ : fail++; console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : `| ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`); };
const keys = (kind: string, deal: 'sale' | 'rent' | 'investment' = 'sale') => fieldsFor(kind, deal).map((f) => f.key);
const codes = (r: { errors: { code: string; field?: string }[] }) => r.errors.map((e) => `${e.field}:${e.code}`);
const base = { deal: 'sale', area_sqm: '300', price: '1,450,000' };

console.log('1) سجل الأنواع');
const REQUIRED_LABELS = ['أرض', 'شقة', 'فيلا', 'دوبلكس', 'دور', 'عمارة', 'برج', 'مجمع سكني', 'استراحة', 'مزرعة', 'مستودع', 'معرض', 'محل', 'مكتب', 'مبنى تجاري', 'مجمع تجاري', 'فندق', 'شقق فندقية', 'منتجع', 'محطة وقود', 'مصنع', 'عقار صناعي', 'عقار لوجستي', 'عقار صحي أو تعليمي'];
const labels = kinds().map((k) => k.label);
check(`الأنواع الـ${REQUIRED_LABELS.length} المطلوبة موجودة كلها`, REQUIRED_LABELS.every((l) => labels.includes(l)), REQUIRED_LABELS.filter((l) => !labels.includes(l)));
check('يوجد نوع «آخر» لما لم يُدرج بعد', !!getKind('other'));
const others = (k: KindDef) => new Map(kinds().filter((x) => x.key !== k.key).map((x) => [x.key, x]));
check('كل نوع مسجَّل سليم: مفتاح صالح، حقول معرّفة غير مكررة، نوع أساسي معروف', kinds().every((k) => kindDefProblems(k, others(k)).length === 0), kinds().map((k) => kindDefProblems(k, others(k))).flat());
check('لا مفتاحان لنوعين متطابقان ولا اسمان متطابقان', new Set(kinds().map((k) => k.key)).size === kinds().length && new Set(labels).size === labels.length);
check('كل حقل في المكتبة له مجموعة وصف معروفة ونوع إدخال معروف', Object.values(FIELDS).every((f) => GROUPS.some((g) => g.key === f.group) && ['int', 'decimal', 'enum', 'multi', 'bool', 'text', 'number_list'].includes(f.kind)));
check('حقول القوائم لها خيارات، والأرقام لها حدود', Object.values(FIELDS).every((f) => (f.kind === 'enum' || f.kind === 'multi' ? (f.options?.length ?? 0) > 0 : true) && (['int', 'decimal', 'number_list'].includes(f.kind) ? f.min !== undefined && f.max !== undefined : true)));

console.log('2) تغيّر الحقول بتغيّر النوع');
check('الأرض: الاستخدام والواجهات والشوارع والأبعاد، بلا غرف ولا مصعد', ['land_use', 'facades', 'streets_count', 'street_widths', 'length_m', 'width_m'].every((k) => keys('land').includes(k)) && !keys('land').includes('bedrooms') && !keys('land').includes('elevator'));
check('الشقة: الغرف والصالات ودورات المياه والدور والمصعد والمواقف والعمر، بلا استخدام أرض', ['bedrooms', 'living_rooms', 'bathrooms', 'floor_number', 'elevator', 'parking_spaces', 'age_years'].every((k) => keys('apartment').includes(k)) && !keys('apartment').includes('land_use'));
check('الفيلا: الأدوار والغرف والصالات ودورات المياه والمداخل والملحق والحوش والمواقف', ['floors_count', 'bedrooms', 'living_rooms', 'bathrooms', 'entrances', 'annex', 'yard', 'parking_spaces'].every((k) => keys('villa').includes(k)));
check('العمارة: الأدوار والوحدات والمحلات والدخل والإشغال', ['floors_count', 'units_count', 'shops_count', 'annual_income', 'occupancy_pct'].every((k) => keys('building').includes(k)));
check('الفندق: الغرف والأجنحة والتصنيف وبيانات التشغيل', ['rooms_count', 'suites_count', 'hotel_rating', 'operating_status', 'annual_income', 'occupancy_pct'].every((k) => keys('hotel').includes(k)));
check('محطة الوقود: المضخات والخدمات والتشغيل', ['pumps_count', 'station_services', 'operating_status', 'annual_income'].every((k) => keys('gas_station').includes(k)));
check('حقول الأرض والشقة مختلفة فعلًا', JSON.stringify(keys('land')) !== JSON.stringify(keys('apartment')));
check('الإلزام يتغير بالعملية: تأثيث الشقة مطلوب في الإيجار لا البيع', fieldsFor('apartment', 'rent').find((f) => f.key === 'furnished')!.required && !fieldsFor('apartment', 'sale').find((f) => f.key === 'furnished')!.required);
check('الإلزام يتغير بالعملية: دخل العمارة مطلوب في الاستثمار فقط', fieldsFor('building', 'investment').find((f) => f.key === 'annual_income')!.required && !fieldsFor('building', 'sale').find((f) => f.key === 'annual_income')!.required);
check('نوع غير معروف لا يعطي حقولًا', fieldsFor('nope', 'sale').length === 0);

console.log('3) الحمولة عند تغيير النوع');
const form = { ...base, kind: 'apartment', city_id: 'c1', district_id: 'd1', attributes: { bedrooms: '3', bathrooms: '2', floor_number: '2', land_use: 'commercial' } };
const switched = { ...form, kind: 'land', attributes: { ...form.attributes, land_use: 'residential' } };
check('بعد التحويل من شقة إلى أرض: الحمولة تحمل حقول الأرض فقط', JSON.stringify(Object.keys(payloadFor(switched).attributes as object)) === JSON.stringify(['land_use']));
check('ما كُتب للشقة يبقى في النموذج (لا يضيع عند الرجوع للنوع السابق)', (switched.attributes as Record<string, string>).bedrooms === '3' && Object.keys(payloadFor({ ...switched, kind: 'apartment' }).attributes as object).includes('bedrooms'));
check('مدة الإيجار لا تُرسل في البيع', !('rent_period' in payloadFor({ ...form, rent_period: 'yearly' })) && payloadFor({ ...form, deal: 'rent', rent_period: 'yearly' }).rent_period === 'yearly');
check('الحقول الفارغة لا تُرسل', !('location' in payloadFor({ ...form, location: '  ' })));
const ign = validateListing({ ...form, kind: 'land', attributes: { ...form.attributes, land_use: 'residential' } });
check('الخادم يتجاهل حقول نوع آخر ولا يحفظها، ويذكرها', !!ign.value && !('bedrooms' in ign.value.attributes) && ign.ignored.includes('bedrooms'), ign);

console.log('4) التحقق');
const ok = validateListing({ ...form });
check('شقة سليمة تُقبل والقيم موحدة أرقامًا', !!ok.value && ok.value.attributes.bedrooms === 3 && ok.value.price === 1450000 && ok.value.area_sqm === 300, ok.errors);
check('الحقول المشتركة مطلوبة: العملية والنوع والمساحة والسعر', ['deal:deal_invalid', 'kind:kind_invalid', 'area_sqm:area_invalid', 'price:price_invalid'].every((c) => codes(validateListing({})).includes(c)), codes(validateListing({})));
check('العملية الاستثمارية مقبولة', !!validateListing({ ...form, deal: 'استثمار' }).value);
check('الحقل المطلوب للنوع يُرفض إن غاب (غرف الشقة)', codes(validateListing({ ...form, attributes: { bathrooms: '2', floor_number: '1' } })).includes('bedrooms:required'));
check('الإيجار يتطلب مدة الإيجار والتأثيث للشقة', ['rent_period:rent_period_required', 'furnished:required'].every((c) => codes(validateListing({ ...form, deal: 'rent' })).includes(c)));
check('الاستثمار في عمارة يتطلب الدخل السنوي', codes(validateListing({ ...base, deal: 'investment', kind: 'building', attributes: { floors_count: 4, units_count: 8 } })).includes('annual_income:required'));
check('عدد صحيح بكسر يُرفض (غرف 2.5)', codes(validateListing({ ...form, attributes: { ...form.attributes, bedrooms: '2.5' } })).includes('bedrooms:field_invalid'));
check('قيمة سالبة أو فوق الحد تُرفض', codes(validateListing({ ...form, attributes: { ...form.attributes, bathrooms: '-1' } })).includes('bathrooms:field_invalid') && codes(validateListing({ ...form, attributes: { ...form.attributes, bedrooms: '500' } })).includes('bedrooms:field_invalid'));
check('نص في حقل رقمي يُرفض', codes(validateListing({ ...form, attributes: { ...form.attributes, bedrooms: 'ثلاث' } })).includes('bedrooms:field_invalid'));
check('قيمة قائمة خارج الخيارات تُرفض', codes(validateListing({ ...base, kind: 'land', attributes: { land_use: 'فضائي' } })).includes('land_use:field_invalid'));
check('نسبة إشغال فوق 100 تُرفض', codes(validateListing({ ...base, kind: 'building', attributes: { floors_count: 4, units_count: 8, occupancy_pct: '120' } })).includes('occupancy_pct:field_invalid'));
check('عدد عروض الشوارع يجب أن يطابق عدد الشوارع', codes(validateListing({ ...base, kind: 'land', attributes: { land_use: 'residential', streets_count: 2, street_widths: '20' } })).includes('street_widths:street_widths_mismatch'));
check('الأجنحة لا تتجاوز الغرف في الفندق', codes(validateListing({ ...base, kind: 'hotel', attributes: { rooms_count: 10, suites_count: 12 } })).includes('suites_count:suites_above_rooms'));
check('سعر بيع صفر خطأ، وإيجار صفر مقبول', codes(validateListing({ ...form, price: '0' })).includes('price:price_invalid') && !codes(validateListing({ ...form, deal: 'rent', rent_period: 'yearly', price: '0', attributes: { ...form.attributes, furnished: 'unfurnished' } })).includes('price:price_invalid'));
check('توحيد الأرقام العربية والوحدات (٣٠٠ م²، ١٬٤٥٠٬٠٠٠ ريال)', validateListing({ ...form, area_sqm: '٣٠٠ م²', price: '١٬٤٥٠٬٠٠٠ ريال' }).value?.price === 1450000);
check('توحيد القوائم: الاسم العربي يُحفظ بمفتاحه', validateListing({ ...base, kind: 'land', attributes: { land_use: 'تجاري' } }).value?.attributes.land_use === 'commercial');
check('توحيد نعم/لا: «يوجد» = true و«لا يوجد» = false', (() => { const v = validateListing({ ...form, attributes: { ...form.attributes, elevator: 'يوجد', maid_room: 'لا يوجد' } }).value; return v?.attributes.elevator === true && v?.attributes.maid_room === false; })());
check('عروض الشوارع تُحفظ قائمة أرقام', JSON.stringify(validateListing({ ...base, kind: 'land', attributes: { land_use: 'residential', streets_count: 2, street_widths: '20، 15' } }).value?.attributes.street_widths) === '[20,15]');
check('أبعاد لا تقارب المساحة = تحذير لا خطأ', (() => { const r = validateListing({ ...base, kind: 'land', attributes: { land_use: 'residential', length_m: 30, width_m: 30 } }); return !!r.value && r.warnings.some((w) => w.code === 'dimensions_mismatch'); })());
check('رقم الترخيص يرفض بداية صيغة (=)', codes(validateListing({ ...form, ad_license_no: '=1+1' })).includes('ad_license_no:ad_license_no_invalid'));

console.log('5) الوصف المولَّد');
const villa: ListingValue = validateListing({ ...base, kind: 'villa', ad_license_no: '7200001234', attributes: { floors_count: 2, bedrooms: 5, living_rooms: 2, bathrooms: 6, entrances: 2, annex: true, yard: true, pool: false, parking_spaces: 2, age_years: 3 } }).value!;
const d = describeListing(villa, { city: 'جدة', district: 'الفروسية', location: 'قرب طريق الملك' });
check('العنوان: النوع ثم العملية ثم الحي والمدينة', d.title === 'فيلا للبيع في حي الفروسية، جدة', d.title);
check('الأقسام بالترتيب الثابت: الموقع، المساحة والسعر، المواصفات، المرافق، النظامية', JSON.stringify(d.sections.map((s) => s.key)) === JSON.stringify(['location', 'price', 'specs', 'amenities', 'legal']), d.sections.map((s) => s.key));
const specs = d.sections.find((s) => s.key === 'specs')!.lines;
check('الحقول داخل القسم بترتيب تعريف النوع', specs.join('|') === 'عدد الأدوار: 2|غرف النوم: 5|الصالات: 2|دورات المياه: 6|عمر العقار: 3 سنوات|المداخل: 2', specs);
check('صيغة العدد العربية للعمر، والنسبة ملتصقة', describeListing(validateListing({ ...base, kind: 'building', attributes: { floors_count: 3, units_count: 6, age_years: 1, occupancy_pct: 92 } }).value!).text.includes('عمر العقار: سنة واحدة') && describeListing(validateListing({ ...base, kind: 'building', attributes: { floors_count: 3, units_count: 6, age_years: 15, occupancy_pct: 92 } }).value!).text.includes('عمر العقار: 15 سنة') && describeListing(validateListing({ ...base, kind: 'building', attributes: { floors_count: 3, units_count: 6, occupancy_pct: 92 } }).value!).text.includes('نسبة الإشغال: 92%'));
check('المساحة والسعر بصيغة موحدة', d.sections[1].lines.join('|') === 'المساحة: 300 م²|السعر: 1,450,000 ريال', d.sections[1].lines);
check('«لا يوجد» يظهر لأن المستخدم أدخله، لا لأنه فارغ', d.text.includes('مسبح: لا يوجد') && d.text.includes('ملحق: يوجد'));
check('الحقول غير المُدخلة لا تظهر (المطبخ، غرفة الخادمة، المصعد، الواجهات)', !['مطبخ', 'غرفة خادمة', 'مصعد', 'الواجهات', 'التأثيث'].some((l) => d.text.includes(l)));
check('لا قسم بلا بيانات (لا «البيانات التشغيلية» لفيلا بلا دخل)', !d.text.includes('البيانات التشغيلية'));
check('لا قيم فارغة أو غير معرّفة في النص', !/undefined|null|NaN|:\s*(\n|$)/.test(d.text), d.text);
const rent = describeListing(validateListing({ ...form, deal: 'rent', price: '60000', rent_period: 'yearly', attributes: { ...form.attributes, furnished: 'furnished' } }).value!, { city: 'جدة' });
check('الإيجار: «الإيجار: 60,000 ريال سنويًا» والعنوان بلا حي إن لم يُدخل', rent.text.includes('الإيجار: 60,000 ريال سنويًا') && rent.title === 'شقة للإيجار في جدة', rent.title);
const minimal = describeListing(validateListing({ ...base, kind: 'land', attributes: { land_use: 'residential' } }).value!);
check('أقل إدخال: عنوان بلا مكان، وقسمان فقط', minimal.title === 'أرض للبيع' && minimal.sections.length === 2 && minimal.sections.map((s) => s.key).join() === 'price,specs', minimal);
check('ملاحظات إضافية لا تدخل الوصف المنظم', !describeListing(validateListing({ ...form, notes: 'نص حر خاص' }).value!).text.includes('نص حر خاص'));

// بلا اختلاق: لكل نوع، إدخال عشوائي محدد البذرة؛ كل رقم في الوصف مُدخل، وكل عنوان حقل في الوصف مُدخل، وكل حقل مُدخل ظاهر
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const sample = (f: (typeof FIELDS)[string]) => {
  if (f.kind === 'bool') return rnd() > 0.5;
  if (f.kind === 'enum') return f.options![Math.floor(rnd() * f.options!.length)].value;
  if (f.kind === 'multi') return [f.options![0].value];
  if (f.kind === 'text') return 'نص';
  const lo = Math.max(f.min ?? 0, 1), hi = Math.min(f.max ?? 50, 50);
  const n = Math.floor(lo + rnd() * (hi - lo));
  return f.kind === 'number_list' ? [n] : n;
};
let inventionOk = true, missingOk = true; const bad: string[] = [];
for (const k of kinds()) for (let t = 0; t < 6; t++) {
  const attrs: Record<string, unknown> = {};
  for (const kf of k.fields) if (kf.required || rnd() > 0.5) attrs[kf.key] = sample(FIELDS[kf.key]);
  if ('streets_count' in attrs && 'street_widths' in attrs) attrs.streets_count = (attrs.street_widths as number[]).length;
  if ('floor_number' in attrs && 'floors_count' in attrs) attrs.floor_number = 1, attrs.floors_count = Math.max(1, attrs.floors_count as number);
  if ('suites_count' in attrs && 'rooms_count' in attrs) attrs.suites_count = 0;
  if ('facades' in attrs && 'facade_directions' in attrs) attrs.facades = 4;
  const deal = (['sale', 'rent', 'investment'] as const)[t % 3];
  const r = validateListing({ deal, kind: k.key, area_sqm: 1234, price: 98765, rent_period: 'monthly', attributes: attrs });
  if (!r.value) { // حقول مطلوبة حسب العملية قد تنقص عشوائيًا؛ تُكمل ثم يعاد
    for (const kf of fieldsFor(k.key, deal)) if (kf.required && !(kf.key in attrs)) attrs[kf.key] = sample(FIELDS[kf.key]);
  }
  const v = validateListing({ deal, kind: k.key, area_sqm: 1234, price: 98765, rent_period: 'monthly', attributes: attrs }).value;
  if (!v) { inventionOk = false; bad.push(`${k.key}: لم يقبل إدخالًا سليمًا ${JSON.stringify(validateListing({ deal, kind: k.key, area_sqm: 1234, price: 98765, rent_period: 'monthly', attributes: attrs }).errors)}`); continue; }
  const text = describeListing(v).text;
  const allowedNums = new Set<string>(['1234', '98765']);
  for (const val of Object.values(v.attributes)) for (const x of ([] as unknown[]).concat(val)) if (typeof x === 'number') allowedNums.add(String(x));
  for (const m of text.replace(/(\d),(\d)/g, '$1$2').match(/\d+(\.\d+)?/g) ?? []) if (!allowedNums.has(m)) { inventionOk = false; bad.push(`${k.key}: رقم غير مُدخل ${m}`); }
  for (const kf of k.fields) {
    const label = FIELDS[kf.key].label, shown = text.split('\n').some((l) => l.startsWith(`• ${label}:`));
    if ((kf.key in v.attributes) !== shown) { (kf.key in v.attributes ? (missingOk = false) : (inventionOk = false)); bad.push(`${k.key}.${kf.key}: مُدخل=${kf.key in v.attributes} ظاهر=${shown}`); }
  }
}
check('بلا اختلاق: كل رقم في الوصف مُدخل، ولا يظهر حقل لم يُدخل (كل الأنواع × 6 إدخالات)', inventionOk, bad.slice(0, 5));
check('بلا إسقاط: كل حقل مُدخل يظهر في الوصف', missingOk, bad.slice(0, 5));

console.log('6) أعمدة التوافق');
const lc = legacyColumns(villa);
check('الفيلا: النوع الأساسي villa، سكني، الغرف من غرف النوم، والعمر', lc.type === 'villa' && lc.usage === 'residential' && lc.rooms === 5 && lc.age_years === 3);
check('أرض تجارية: الاستخدام تجاري، وعرض الشارع الأكبر', (() => { const c = legacyColumns(validateListing({ ...base, kind: 'land', attributes: { land_use: 'commercial', streets_count: 2, street_widths: [15, 30] } }).value!); return c.type === 'land' && c.usage === 'commercial' && c.street_width_m === 30; })());
check('الفندق يُخزَّن بنوع أساسي تجاري، وغرفه (حتى 120) لا تُنسخ إلى عمود غرف السكن', (() => { const c = legacyColumns(validateListing({ ...base, kind: 'hotel', attributes: { rooms_count: 120 } }).value!); return c.type === 'commercial' && c.rooms === null; })());

console.log('7) خطوات النموذج والمسودات');
const s1 = errorsForStep({ deal: 'sale', kind: 'apartment', area_sqm: '', price: '1', attributes: {} }, 1);
check('الخطوة 1 تعرض أخطاء الحقول المشتركة والمدينة والحي فقط', s1.some((e) => e.field === 'area_sqm') && s1.some((e) => e.field === 'city') && s1.some((e) => e.field === 'district') && !s1.some((e) => e.field === 'bedrooms'), s1);
const s2 = errorsForStep({ ...form, attributes: {} }, 2);
check('الخطوة 2 تعرض أخطاء حقول النوع فقط', s2.length > 0 && s2.every((e) => keys('apartment').includes(e.field!)), s2);
const dr = sanitizeDraft({ kind: 'villa', evil: '<script>', notes: 'x'.repeat(5000), attributes: { bedrooms: '4', land_use: 'commercial', hacker: 1, nested: { a: 1 } } });
check('المسودة تحفظ المفاتيح المعروفة فقط وتقص النصوص', !('evil' in dr) && (dr.notes as string).length === 2000 && dr.kind === 'villa');
check('المسودة تحفظ حقول كل الأنواع المعروفة (للرجوع) وترفض المجهول والمتداخل', JSON.stringify(dr.attributes) === JSON.stringify({ bedrooms: '4', land_use: 'commercial' }), dr.attributes);
check('المسودة ناقصة مقبولة (لا تحقق إلزامي)', JSON.stringify(sanitizeDraft({})) === JSON.stringify({ attributes: {} }));

console.log('8) التوسعة: نوع جديد دون كسر الحالية');
const snapshot = JSON.stringify(kinds().map((k) => [k.key, fieldsFor(k.key, 'sale')]));
const sampleDescBefore = describeListing(villa, { city: 'جدة', district: 'الفروسية' }).text;
registerPropertyKind({ key: 'camp', label: 'مخيم', category: 'other', base: 'other', usage: 'commercial', fields: [{ key: 'units_count', required: true }, { key: 'pool' }, { key: 'operating_status' }] });
check('النوع الجديد مسجَّل وله حقوله', getKind('camp')?.label === 'مخيم' && keys('camp').join() === 'units_count,pool,operating_status');
const camp = validateListing({ deal: 'investment', kind: 'camp', area_sqm: 5000, price: 2_000_000, attributes: { units_count: 12, pool: true } });
check('النوع الجديد يُتحقق منه ويولّد وصفه دون أي تعديل آخر', !!camp.value && describeListing(camp.value).text.includes('مخيم للاستثمار') && codes(validateListing({ deal: 'sale', kind: 'camp', area_sqm: 1, price: 1 })).includes('units_count:required'));
check('الأنواع الحالية لم تتغير حقولها', JSON.stringify(kinds().filter((k) => !['camp', 'test_unit'].includes(k.key)).map((k) => [k.key, fieldsFor(k.key, 'sale')])) === snapshot);
check('وصف نوع حالي لم يتغير بعد الإضافة', describeListing(villa, { city: 'جدة', district: 'الفروسية' }).text === sampleDescBefore);
registerPropertyKind({ key: 'test_unit', label: 'وحدة اختبار', category: 'other', base: 'other', usage: 'residential', fields: [{ key: 'floor_number' }, { key: 'floors_count' }] });
check('قاعدة بين الحقول تعمل في نوع جديد: رقم الدور لا يتجاوز عدد الأدوار', codes(validateListing({ ...base, kind: 'test_unit', attributes: { floor_number: 5, floors_count: 3 } })).includes('floor_number:floor_above_count') && codes(validateListing({ ...base, kind: 'test_unit', attributes: { floor_number: 3, floors_count: 3 } })).length === 0);
const throws = (fn: () => void) => { try { fn(); return false; } catch { return true; } };
check('يُرفض نوع مكرر المفتاح، أو بحقل غير معرّف، أو بنوع أساسي مجهول، أو بمفتاح غير صالح', throws(() => registerPropertyKind({ ...getKind('villa')! })) && throws(() => registerPropertyKind({ key: 'x1', label: 'س', category: 'other', base: 'other', usage: 'residential', fields: [{ key: 'flying' }] }))
  && throws(() => registerPropertyKind({ key: 'x2', label: 'س', category: 'other', base: 'spaceship' as never, usage: 'residential', fields: [] })) && throws(() => registerPropertyKind({ key: 'Bad Key', label: 'س', category: 'other', base: 'other', usage: 'residential', fields: [] })));
check('الحقول المشتركة غير الأعمدة معرّفة (مدة الإيجار والبيانات النظامية)', ['rent_period', 'ad_license_no', 'deed_no'].every((k) => k in COMMON_ATTRS));

console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
