// اختبارات Phase 3 النقية: توحيد العميل ومنع التكرار، المهام والمكالمات، المراحل، الاقتراحات، استيراد العملاء، والقنوات (التواقيع والحمولات والحالة).
import {
  DEFAULT_STAGES, dedupeDecision, mergeMissing, nameKey, normalizeContactEmail, normalizeContactPhone,
  notifKey, parseMatchStatus, processContactRows, riyadhDay, stageKeyFor, suggestContactMapping, suggestionsFor, taskView, validateCall, validateContact, validateTask,
  type SuggestionInput,
} from '../src/lib/crm-rules';
import { channelStatus, parseEmailInbound, parseWhatsApp, signBody, verifySignature, type ChannelFacts } from '../src/lib/channels';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra: unknown = '') => { cond ? pass++ : fail++; console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : `| ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`); };

console.log('1) توحيد بيانات العميل');
check('الجوال السعودي بصيغه المختلفة يتوحد إلى +9665…', ['0501234567', '501234567', '+966501234567', '00966501234567', '966501234567', '٠٥٠١٢٣٤٥٦٧', '050 123 4567', '(050)-123-4567'].every((p) => normalizeContactPhone(p) === '+966501234567'));
check('الرقم الدولي يُقبل بصيغة صريحة (+ أو 00) فقط', normalizeContactPhone('+201001234567') === '+201001234567' && normalizeContactPhone('00201001234567') === '+201001234567' && normalizeContactPhone('201001234567') === null);
check('رقم غير صالح أو فارغ = null (لا تخمين)', [null, '', 'abc', '0123', '12345678', '+12'].every((p) => normalizeContactPhone(p) === null));
check('البريد يتوحد بحروف صغيرة ومسافات محذوفة، والغلط = null', normalizeContactEmail('  Ali@Example.COM ') === 'ali@example.com' && normalizeContactEmail('ali@') === null && normalizeContactEmail('') === null);
check('مفتاح الاسم يوحّد الهمزات والتاء والمسافات (للاقتراح فقط)', nameKey('أحمد  عبدالله.') === nameKey('احمد عبدالله') && nameKey('فاطمة') === nameKey('فاطمه'));

console.log('2) التحقق من العميل');
const ok = validateContact({ name: '  محمد   العتيبي ', phone: '0551112233', email: 'M@x.com', type: 'مشترٍ', source: 'whatsapp' });
check('عميل سليم: اسم منظف وجوال وبريد موحدان ونوع ومصدر بمفاتيحهم', ok.errors.length === 0 && ok.value.name === 'محمد العتيبي' && ok.value.phone_norm === '+966551112233' && ok.value.email_norm === 'm@x.com' && ok.value.type === 'buyer' && ok.value.source === 'whatsapp', ok);
check('بلا جوال ولا بريد = خطأ (لا ملف لا يمكن ربطه)', validateContact({ name: 'سعد' }).errors.some((e) => e.code === 'identifier_required'));
check('جوال أو بريد غير صالح = خطأ صريح', validateContact({ name: 'سعد', phone: '123' }).errors.some((e) => e.code === 'phone_invalid') && validateContact({ name: 'سعد', email: 'x@' }).errors.some((e) => e.code === 'email_invalid'));
check('اسم قصير أو يبدأ بصيغة = خطأ', validateContact({ name: 'س', phone: '0551112233' }).errors.some((e) => e.field === 'name') && validateContact({ name: '=HYPERLINK()', phone: '0551112233' }).errors.some((e) => e.field === 'name'));
check('التعديل الجزئي يتحقق مما أُرسل فقط', validateContact({ status: 'غير نشط' }, { partial: true }).errors.length === 0 && validateContact({ status: 'غير نشط' }, { partial: true }).value.status === 'inactive' && !('name' in validateContact({ status: 'active' }, { partial: true }).value));
check('المصدر الافتراضي يدوي، والحالة الافتراضية نشط', ok.value.status === 'active' && validateContact({ name: 'سعد', phone: '0551112233' }).value.source === 'manual');

console.log('3) منع التكرار والدمج');
check('لا تطابق = إنشاء', dedupeDecision(null, null).action === 'create');
check('تطابق الجوال = نفس العميل', JSON.stringify(dedupeDecision('A', null)) === JSON.stringify({ action: 'match', id: 'A', by: ['phone'] }));
check('الجوال والبريد يشيران للعميل نفسه = تطابق بهما', JSON.stringify(dedupeDecision('A', 'A')) === JSON.stringify({ action: 'match', id: 'A', by: ['phone', 'email'] }));
check('الجوال لعميل والبريد لآخر = تعارض لا يُحسم آليًا', dedupeDecision('A', 'B').action === 'conflict');
const mm = mergeMissing({ name: 'محمد', email_norm: null, type: 'buyer' }, { name: 'محمد العتيبي', email_norm: 'm@x.com', type: 'investor' }, ['name', 'email_norm', 'type']);
check('الدمج يملأ الفارغ فقط ولا يستبدل الموجود، ويذكر التعارضات', JSON.stringify(mm.patch) === JSON.stringify({ email_norm: 'm@x.com' }) && JSON.stringify(mm.conflicts) === JSON.stringify(['name', 'type']));

console.log('4) المراحل والمطابقة');
check('عشر مراحل افتراضية بالترتيب المطلوب، ومرحلتا إغلاق (مكتمل/غير مهتم)', DEFAULT_STAGES.length === 10 && DEFAULT_STAGES[0].label === 'عميل جديد' && DEFAULT_STAGES.filter((s) => s.kind !== 'open').map((s) => s.key).join() === 'won,lost');
check('مفتاح مرحلة جديدة آمن وفريد', /^stage_[a-z0-9_]+$/.test(stageKeyFor('توقيع العقد', [])) && stageKeyFor('توقيع العقد', ['stage_custom']) === 'stage_custom_2');
check('حالات متابعة المطابقة التسع، بالعربية والمفتاح', ['جديد', 'تمت المراجعة', 'أُرسل للعميل', 'مهتم', 'غير مهتم', 'موعد معاينة', 'تفاوض', 'مغلق/تمت الصفقة', 'مرفوض'].map((x) => parseMatchStatus(x)).join() === 'new,reviewed,sent,interested,not_interested,viewing,negotiation,closed,rejected' && parseMatchStatus('xyz') === null);

console.log('5) المهام والمكالمات');
const now = new Date('2026-10-03T09:00:00Z'); // 12:00 بتوقيت الرياض
check('يوم الرياض UTC+3 (الساعة 22:30 UTC = اليوم التالي في الرياض)', riyadhDay(new Date('2026-10-03T22:30:00Z')) === '2026-10-04' && riyadhDay(now) === '2026-10-03');
check('تصنيف المهام: متأخرة، اليوم، قادمة، مكتملة، بلا موعد', taskView({ status: 'open', due_at: '2026-10-03T08:00:00Z' }, now) === 'overdue' && taskView({ status: 'open', due_at: '2026-10-03T18:00:00Z' }, now) === 'today'
  && taskView({ status: 'in_progress', due_at: '2026-10-03T21:30:00Z' }, now) === 'upcoming' && taskView({ status: 'done', due_at: '2026-10-01T00:00:00Z' }, now) === 'done' && taskView({ status: 'open', due_at: null }, now) === 'no_due');
check('المهمة: العنوان مطلوب والأولوية والحالة من القائمة', validateTask({}).errors.some((e) => e.field === 'title') && validateTask({ title: 'x', priority: 'عاجلة' }).value.priority === 'urgent' && validateTask({ title: 'x', priority: 'خارقة' }).errors.some((e) => e.field === 'priority') && validateTask({ title: 'x', status: 'zzz' }).errors.length === 1);
check('المهمة: معرّفات الربط تُرفض إن لم تكن UUID', validateTask({ title: 'x', customer_id: "1' OR 1=1" }).errors.some((e) => e.field === 'customer_id'));
const call = validateCall({ direction: 'صادرة', outcome: 'تم الرد', notes: 'مهتم بفيلا', next_step: 'إرسال عروض', follow_up_at: '2026-10-05T07:00:00Z' }, now);
check('المكالمة: اتجاه ونتيجة وخطوة ومتابعة، ووقتها الآن افتراضيًا', !!call.value && call.value.direction === 'out' && call.value.outcome === 'answered' && call.value.occurred_at.getTime() === now.getTime() && call.value.follow_up_at?.toISOString() === '2026-10-05T07:00:00.000Z', call);
check('المكالمة: بلا اتجاه أو نتيجة = خطأ، ووقت في المستقبل = خطأ', validateCall({ outcome: 'answered' }, now).errors.some((e) => e.field === 'direction') && validateCall({ direction: 'in' }, now).errors.some((e) => e.field === 'outcome') && validateCall({ direction: 'in', outcome: 'busy', occurred_at: '2026-10-04T09:00:00Z' }, now).errors.some((e) => e.code === 'date_future'));

console.log('6) الاقتراحات (قواعد قابلة للتفسير)');
const sIn = (o: Partial<SuggestionInput>): SuggestionInput => ({ now, created_at: new Date('2026-09-01T00:00:00Z'), last_contact_at: new Date('2026-10-02T00:00:00Z'), next_follow_up_at: null, status: 'active', stage: { key: 'qualified', label: 'مؤهل', kind: 'open' }, has_request: true, new_matches: { count: 0, request_title: null }, overdue_tasks: [], duplicates: [], ...o });
check('عميل محدّث بلا مستجدات = لا اقتراحات', suggestionsFor(sIn({})).length === 0, suggestionsFor(sIn({})));
const s1 = suggestionsFor(sIn({ new_matches: { count: 3, request_title: 'مطلوب فيلا' } }));
check('عروض مطابقة جديدة = اقتراح بالعدد والسبب، ثم الخطوة التالية «أرسل العروض»', s1[0].key === 'new_matches' && s1[0].title.includes('3') && s1[0].reason.includes('مطلوب فيلا') && s1.some((x) => x.key === 'next_step' && x.title.includes('أرسل')));
check('آخر تواصل قبل 14 يومًا أو أكثر = «لم يُتواصل منذ»', suggestionsFor(sIn({ last_contact_at: new Date('2026-09-15T00:00:00Z') })).some((x) => x.key === 'stale' && x.title.includes('18')) && !suggestionsFor(sIn({ last_contact_at: new Date('2026-09-25T00:00:00Z') })).some((x) => x.key === 'stale'));
check('مهمة متأخرة ومتابعة حلّ موعدها تظهران بسببهما', (() => { const s = suggestionsFor(sIn({ overdue_tasks: [{ title: 'اتصال', due_at: new Date('2026-10-01T09:00:00Z') }], next_follow_up_at: new Date('2026-10-03T06:00:00Z') })); return s.some((x) => x.key.startsWith('overdue:') && x.reason.includes('2026-10-01')) && s.some((x) => x.key === 'follow_up_due'); })());
check('احتمال تكرار يُقترح للمراجعة ولا يُدمج تلقائيًا', suggestionsFor(sIn({ duplicates: [{ id: 'x', name: 'محمد', reason: 'نفس الاسم' }] })).some((x) => x.key === 'dup:x' && x.reason.includes('لا يُدمج تلقائيًا')));
check('«لا يُتواصل معه» يوقف كل الاقتراحات', (() => { const s = suggestionsFor(sIn({ status: 'do_not_contact', new_matches: { count: 5, request_title: null } })); return s.length === 1 && s[0].key === 'do_not_contact'; })());
check('بلا طلب ولا فرصة = اقترح طلبًا منظمًا', suggestionsFor(sIn({ stage: null, has_request: false })).some((x) => x.action.target === 'new_request'));
check('الفرصة المغلقة لا تُقترح لها متابعة قديمة', !suggestionsFor(sIn({ stage: { key: 'won', label: 'مكتمل', kind: 'won' }, last_contact_at: new Date('2026-01-01T00:00:00Z') })).some((x) => x.key === 'stale'));
check('الترتيب بالأولوية (الأهم أولًا)', (() => { const s = suggestionsFor(sIn({ new_matches: { count: 1, request_title: null }, duplicates: [{ id: 'x', name: 'a', reason: 'r' }], last_contact_at: new Date('2026-09-01T00:00:00Z') })); return s.every((x, i) => i === 0 || s[i - 1].priority >= x.priority); })());

console.log('7) استيراد العملاء (معاينة)');
const header = ['الاسم', 'الجوال', 'البريد', 'المدينة', 'ملاحظات'];
const mp = suggestContactMapping(header);
check('تخمين الأعمدة بالعربية', mp.name === 0 && mp.phone === 1 && mp.email === 2 && mp.city === 3 && mp.notes === 4 && mp.type === null);
const rows = processContactRows([
  ['سعد', '0501111111', '', 'جدة', ''], ['ريم', '', 'reem@x.com', '', ''], ['سعد مكرر', '966501111111', '', '', ''], ['', '0502222222', '', '', ''],
  ['موجود', '0503333333', '', '', ''], ['تعارض', '0503333333', 'other@x.com', '', ''], ['مدينة مجهولة', '0504444444', '', 'أطلانتس', ''],
], mp, { phones: new Map([['+966503333333', 'EX1']]), emails: new Map([['other@x.com', 'EX2']]) }, [{ id: '11111111-1111-4111-8111-111111111111', name_ar: 'جدة' }]);
check('التصنيف: جديد، جديد، مكرر داخل الملف، غير صالح، تحديث موجود، تعارض غير صالح، جديد بتنبيه مدينة', rows.map((r) => r.status).join() === 'new,new,duplicate,invalid,update,duplicate,new', rows.map((r) => r.status));
check('أرقام الصفوف بحسب الملف (الرأس = 1)', rows[0].row_number === 2 && rows[6].row_number === 8);
check('صف التحديث يحمل معرّف العميل الموجود، والمدينة تُربط بمعرّفها', rows[4].existing_id === 'EX1' && rows[0].normalized?.city_id === '11111111-1111-4111-8111-111111111111');
check('الصف غير الصالح يحمل سببه ولا تطبيع له', rows[3].normalized === null && rows[3].issues.some((i) => i.field === 'name'));
check('مدينة مجهولة = تنبيه مع بقاء الصف صالحًا', rows[6].status === 'new' && rows[6].issues.some((i) => i.code === 'city_unknown'));
const conflictRows = processContactRows([['تعارض', '0503333333', 'other@x.com']], { name: 0, phone: 1, email: 2, type: null, source: null, city: null, notes: null }, { phones: new Map([['+966503333333', 'EX1']]), emails: new Map([['other@x.com', 'EX2']]) }, []);
check('جوال لعميل وبريد لآخر = غير صالح للمراجعة اليدوية (لا دمج)', conflictRows[0].status === 'invalid' && conflictRows[0].issues[0].code === 'identifier_conflict');

console.log('8) مفاتيح منع تكرار التنبيهات');
check('الحدث نفسه = المفتاح نفسه، وحدث مختلف = مفتاح مختلف', notifKey.matchFound('r', 'p') === notifKey.matchFound('r', 'p') && notifKey.matchFound('r', 'p') !== notifKey.matchFound('r', 'q') && notifKey.followUp('c', now) !== notifKey.followUp('c', new Date(now.getTime() + 1)));

console.log('9) القنوات: التواقيع');
const secret = 'test-secret-only', body = '{"a":1}';
const sig = signBody(body, secret);
check('توقيع صحيح يُقبل', verifySignature(body, sig, secret));
check('توقيع بسر مختلف، أو جسم معدّل، أو صيغة خاطئة، أو بلا سر = رفض', !verifySignature(body, signBody(body, 'other'), secret) && !verifySignature('{"a":2}', sig, secret) && !verifySignature(body, sig.replace('sha256=', ''), secret) && !verifySignature(body, sig, undefined) && !verifySignature(body, null, secret) && !verifySignature(body, 'sha256=zz', secret));

console.log('10) القنوات: الحمولات');
const wa = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'PN1' }, contacts: [{ wa_id: '966501234567', profile: { name: 'خالد' } }], messages: [{ id: 'wamid.1', from: '966501234567', timestamp: '1790000000', type: 'text', text: { body: 'أبحث عن شقة' } }, { id: 'wamid.2', from: '966501234567', timestamp: '1790000001', type: 'image' }], statuses: [{ id: 's1' }] } }] }] };
const pw = parseWhatsApp(wa);
check('واتساب: رسالتان بالمعرّف والمرسل والاسم والرقم الرسمي، وغير النص يُعلَّم بنوعه', !('error' in pw) && pw.messages.length === 2 && pw.messages[0].account === 'PN1' && pw.messages[0].name === 'خالد' && pw.messages[0].text === 'أبحث عن شقة' && pw.messages[1].text === '[image]' && pw.statuses === 1, pw);
check('واتساب: حمولة ليست من واتساب = خطأ، ورسالة بلا معرّف تُتجاهل', 'error' in parseWhatsApp({ object: 'page' }) && (parseWhatsApp({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: 'P' }, messages: [{ from: '1' }] } }] }] }) as { ignored: number }).ignored === 1);
const em = parseEmailInbound({ message_id: '<m1@x>', from: '"سارة" <Sara@Example.com>', to: 'Leads@Inbound.Test', subject: 'استفسار', text: 'نص' });
check('البريد: المرسل والاسم والعنوان الوارد موحدة', !('error' in em) && em.from === 'sara@example.com' && em.name === 'سارة' && em.account === 'leads@inbound.test' && em.external_id === '<m1@x>', em);
check('البريد: بلا معرّف رسالة أو بمرسل غير صالح = خطأ', 'error' in parseEmailInbound({ from: 'a@b.com', to: 'x@y.z' }) && 'error' in parseEmailInbound({ message_id: '1', from: 'not an email', to: 'x@y.z' }));

console.log('11) القنوات: الحالة الصادقة');
const f = (o: Partial<ChannelFacts>): ChannelFacts => ({ channel: 'whatsapp', env_configured: true, account: 'PN1', verified_at: new Date(), last_processed_at: new Date(), last_rejected_at: null, last_reject_reason: null, ...o });
check('بلا إعداد على الخادم = غير متصلة (لا ادعاء اتصال)', channelStatus(f({ env_configured: false })).status === 'not_connected' && channelStatus(f({ channel: 'email', env_configured: false })).status === 'not_connected');
check('إعداد بلا حساب أو بلا مصافحة أو بلا أول رسالة موقّعة = تحتاج إعدادًا', channelStatus(f({ account: null })).status === 'needs_configuration' && channelStatus(f({ verified_at: null })).status === 'needs_configuration' && channelStatus(f({ last_processed_at: null })).status === 'needs_configuration');
check('رسالة موقّعة عولجت = متصلة، ورفض أحدث منها = خطأ', channelStatus(f({})).status === 'connected' && channelStatus(f({ last_rejected_at: new Date(Date.now() + 1000), last_reject_reason: 'unknown_account' })).status === 'error');
check('الويب والمكالمات قنوات داخلية، والإرسال الخارجي غير مفعّل في كل القنوات', channelStatus(f({ channel: 'manual_call' })).status === 'connected' && channelStatus(f({ channel: 'web', account: null })).status === 'needs_configuration' && channelStatus(f({ channel: 'web' })).status === 'connected' && channelStatus(f({})).outbound === 'disabled');

console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
