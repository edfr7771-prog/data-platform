/**
 * قواعد الـCRM النقية (Phase 3): توحيد بيانات العميل، قرار منع التكرار، المراحل، المهام، المكالمات،
 * اقتراحات قابلة للتفسير، ومعالجة استيراد العملاء. بلا قاعدة بيانات ولا Next، فتُختبر مباشرة.
 */
import { normalizeArabic } from './arabic';
import { normalizeEmail, normalizePhone } from './identifiers';
import type { Issue } from './property-rules';

// ——— التوحيد ———
/** جوال سعودي بصيغة +9665XXXXXXXX، أو رقم دولي E.164 (8 إلى 15 رقمًا)، وإلا null */
export function normalizeContactPhone(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const sa = normalizePhone(s);
  if (sa) return sa;
  const d = s.replace(/[٠-٩]/g, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[\s\-().]/g, '');
  const m = d.match(/^(?:\+|00)?([1-9]\d{7,14})$/);
  // الرقم غير السعودي يُقبل بصيغة دولية صريحة فقط (+ أو 00)؛ لا يُخمَّن مفتاح دولة لرقم محلي
  return m && (d.startsWith('+') || d.startsWith('00')) ? `+${m[1]}` : null;
}
export const normalizeContactEmail = (raw: unknown): string | null => (String(raw ?? '').trim() ? normalizeEmail(String(raw)) : null);
/** مفتاح الاسم لاقتراح «احتمال تكرار» فقط (لا دمج تلقائي بالاسم أبدًا). المسافات تُحذف: «عبد الله» = «عبدالله» */
export const nameKey = (s: unknown) => normalizeArabic(String(s ?? '')).replace(/[^\p{L}\p{N}]/gu, '');

export const CUSTOMER_TYPES = [
  { value: 'buyer', label: 'مشترٍ' }, { value: 'seller', label: 'بائع' }, { value: 'owner', label: 'مالك' }, { value: 'tenant', label: 'مستأجر' },
  { value: 'investor', label: 'مستثمر' }, { value: 'developer', label: 'مطوّر' }, { value: 'broker', label: 'وسيط' },
] as const;
export const CONTACT_SOURCES = [
  { value: 'manual', label: 'إدخال يدوي' }, { value: 'web', label: 'نموذج الموقع' }, { value: 'whatsapp', label: 'واتساب' },
  { value: 'email', label: 'بريد' }, { value: 'call', label: 'مكالمة' }, { value: 'import', label: 'استيراد' },
] as const;
export const CONTACT_STATUSES = [{ value: 'active', label: 'نشط' }, { value: 'inactive', label: 'غير نشط' }, { value: 'do_not_contact', label: 'لا يُتواصل معه' }] as const;
const pick = <T extends readonly { value: string; label: string }[]>(list: T, v: unknown): T[number]['value'] | null => {
  const n = normalizeArabic(String(v ?? ''));
  return n ? (list.find((x) => x.value === n || normalizeArabic(x.label) === n)?.value ?? null) : null;
};
export const parseCustomerType = (v: unknown) => pick(CUSTOMER_TYPES, v);
export const parseContactSource = (v: unknown) => pick(CONTACT_SOURCES, v);
export const parseContactStatus = (v: unknown) => pick(CONTACT_STATUSES, v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
const parseDate = (v: unknown): Date | null => { if (empty(v)) return null; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d; };

export type ContactValue = {
  name: string; phone_norm: string | null; email_norm: string | null; type: string | null; source: string | null; status: string;
  city_id: string | null; district_ids: string[]; owner_id: string | null; next_follow_up_at: Date | null; notes: string | null;
};
/**
 * التحقق من بيانات العميل. partial: للتعديل (يُتحقق فقط مما أُرسل). الإنشاء يتطلب اسمًا ومعرّف تواصل واحدًا على الأقل
 * (جوال أو بريد)، فلا ينشأ ملف لا يمكن ربطه أو منع تكراره.
 */
export function validateContact(input: Record<string, unknown>, opts: { partial?: boolean } = {}): { value: Partial<ContactValue>; errors: Issue[] } {
  const errors: Issue[] = [], v: Partial<ContactValue> = {};
  const err = (field: string, code: string, message: string) => errors.push({ field, code, message });
  const has = (k: string) => !opts.partial || k in input;
  if (has('name')) { const n = String(input.name ?? '').replace(/\s+/g, ' ').trim(); if (n.length < 2 || n.length > 120) err('name', 'name_invalid', 'الاسم مطلوب (2 إلى 120 حرفًا)'); else if (/^[=+\-@]/.test(n)) err('name', 'name_invalid', 'الاسم لا يبدأ برمز صيغة'); else v.name = n; }
  if (has('phone')) { if (empty(input.phone)) v.phone_norm = null; else { const p = normalizeContactPhone(input.phone); if (!p) err('phone', 'phone_invalid', 'رقم الجوال غير صحيح (سعودي مثل 05XXXXXXXX أو دولي يبدأ بـ+)'); else v.phone_norm = p; } }
  if (has('email')) { if (empty(input.email)) v.email_norm = null; else { const e = normalizeContactEmail(input.email); if (!e) err('email', 'email_invalid', 'البريد الإلكتروني غير صحيح'); else v.email_norm = e; } }
  if (!opts.partial && !v.phone_norm && !v.email_norm && !errors.some((e) => e.field === 'phone' || e.field === 'email')) err('phone', 'identifier_required', 'أدخل الجوال أو البريد على الأقل');
  if (has('type')) { if (empty(input.type)) v.type = null; else { const t = parseCustomerType(input.type); if (!t) err('type', 'type_invalid', 'نوع العميل غير معروف'); else v.type = t; } }
  if (has('source')) { const s = empty(input.source) ? 'manual' : parseContactSource(input.source); if (!s) err('source', 'source_invalid', 'مصدر العميل غير معروف'); else v.source = s; }
  if (has('status')) { const s = empty(input.status) ? 'active' : parseContactStatus(input.status); if (!s) err('status', 'status_invalid', 'حالة العميل غير معروفة'); else v.status = s; }
  if (has('city_id')) { if (empty(input.city_id)) v.city_id = null; else if (!UUID.test(String(input.city_id))) err('city_id', 'city_invalid', 'المدينة غير صحيحة'); else v.city_id = String(input.city_id); }
  if (has('district_ids')) { const l = Array.isArray(input.district_ids) ? input.district_ids.map(String) : []; if (l.some((d) => !UUID.test(d)) || l.length > 30) err('district_ids', 'districts_invalid', 'الأحياء غير صحيحة'); else v.district_ids = [...new Set(l)]; }
  if (has('owner_id')) { if (empty(input.owner_id)) v.owner_id = null; else if (!UUID.test(String(input.owner_id))) err('owner_id', 'owner_invalid', 'المسؤول غير صحيح'); else v.owner_id = String(input.owner_id); }
  if (has('next_follow_up_at')) { if (empty(input.next_follow_up_at)) v.next_follow_up_at = null; else { const d = parseDate(input.next_follow_up_at); if (!d) err('next_follow_up_at', 'date_invalid', 'موعد المتابعة غير صحيح'); else v.next_follow_up_at = d; } }
  if (has('notes')) { const n = empty(input.notes) ? null : String(input.notes).trim(); if (n && n.length > 2000) err('notes', 'notes_too_long', 'الملاحظات أطول من 2000 حرف'); else v.notes = n; }
  return { value: v, errors };
}

export type DedupeDecision = { action: 'create' } | { action: 'match'; id: string; by: ('phone' | 'email')[] } | { action: 'conflict'; ids: string[] };
/**
 * قرار منع التكرار بقاعدة صريحة فقط: تطابق الجوال الموحَّد أو البريد الموحَّد (أو المعرّف الداخلي).
 * إذا أشار الجوال إلى عميل والبريد إلى عميل آخر فهذا تعارض لا يُحسم آليًا (لا دمج غير مؤكد).
 */
export function dedupeDecision(byPhone: string | null, byEmail: string | null): DedupeDecision {
  if (byPhone && byEmail && byPhone !== byEmail) return { action: 'conflict', ids: [byPhone, byEmail] };
  const id = byPhone ?? byEmail;
  if (!id) return { action: 'create' };
  return { action: 'match', id, by: [...(byPhone ? ['phone' as const] : []), ...(byEmail ? ['email' as const] : [])] };
}
/** عند مطابقة عميل موجود: تُملأ الحقول الفارغة فقط، ولا يُستبدل ما هو موجود بقيمة مختلفة (تُذكر كتعارض في الخط الزمني) */
export function mergeMissing(existing: Record<string, unknown>, incoming: Record<string, unknown>, fields: string[]): { patch: Record<string, unknown>; conflicts: string[] } {
  const patch: Record<string, unknown> = {}, conflicts: string[] = [];
  for (const f of fields) {
    const a = existing[f], b = incoming[f];
    if (empty(b)) continue;
    if (empty(a)) patch[f] = b; else if (String(a) !== String(b)) conflicts.push(f);
  }
  return { patch, conflicts };
}

// ——— الـPipeline ———
export const DEFAULT_STAGES: { key: string; label: string; kind: 'open' | 'won' | 'lost' }[] = [
  { key: 'new', label: 'عميل جديد', kind: 'open' }, { key: 'contacted', label: 'تم التواصل', kind: 'open' }, { key: 'qualified', label: 'مؤهل', kind: 'open' },
  { key: 'matching', label: 'مطابقة عقارات', kind: 'open' }, { key: 'offers_sent', label: 'تم إرسال عروض', kind: 'open' }, { key: 'viewing', label: 'معاينة', kind: 'open' },
  { key: 'negotiation', label: 'تفاوض', kind: 'open' }, { key: 'agreement', label: 'اتفاق', kind: 'open' },
  { key: 'won', label: 'مكتمل', kind: 'won' }, { key: 'lost', label: 'غير مهتم/مغلق', kind: 'lost' },
];
/** مفتاح مرحلة جديدة من اسمها (لاتيني آمن)، فريد بإضافة رقم عند التكرار */
export function stageKeyFor(label: string, existing: string[]): string {
  const base = 'stage_' + (normalizeArabic(label).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'custom');
  let k = base, i = 2;
  while (existing.includes(k)) k = `${base}_${i++}`;
  return k;
}

// ——— المطابقة داخل الـCRM ———
export const MATCH_STATUSES = [
  { value: 'new', label: 'جديد' }, { value: 'reviewed', label: 'تمت المراجعة' }, { value: 'sent', label: 'أُرسل للعميل' },
  { value: 'interested', label: 'مهتم' }, { value: 'not_interested', label: 'غير مهتم' }, { value: 'viewing', label: 'موعد معاينة' },
  { value: 'negotiation', label: 'تفاوض' }, { value: 'closed', label: 'مغلق/تمت الصفقة' }, { value: 'rejected', label: 'مرفوض' },
] as const;
export const parseMatchStatus = (v: unknown) => pick(MATCH_STATUSES, v);

// ——— المهام ———
export const TASK_PRIORITIES = [{ value: 'low', label: 'منخفضة' }, { value: 'normal', label: 'عادية' }, { value: 'high', label: 'عالية' }, { value: 'urgent', label: 'عاجلة' }] as const;
export const TASK_STATUSES = [{ value: 'open', label: 'مفتوحة' }, { value: 'in_progress', label: 'قيد التنفيذ' }, { value: 'done', label: 'مكتملة' }, { value: 'cancelled', label: 'ملغاة' }] as const;
export type TaskValue = { title: string; due_at: Date | null; priority: string; status: string; notes: string | null; customer_id: string | null; request_id: string | null; property_id: string | null; opportunity_id: string | null; assignee_id: string | null };
export function validateTask(input: Record<string, unknown>, opts: { partial?: boolean } = {}): { value: Partial<TaskValue>; errors: Issue[] } {
  const errors: Issue[] = [], v: Partial<TaskValue> = {};
  const err = (field: string, code: string, message: string) => errors.push({ field, code, message });
  const has = (k: string) => !opts.partial || k in input;
  if (has('title')) { const t = String(input.title ?? '').trim(); if (!t || t.length > 200) err('title', 'title_invalid', 'عنوان المهمة مطلوب (حتى 200 حرف)'); else v.title = t; }
  if (has('due_at')) { if (empty(input.due_at)) v.due_at = null; else { const d = parseDate(input.due_at); if (!d) err('due_at', 'date_invalid', 'تاريخ الاستحقاق غير صحيح'); else v.due_at = d; } }
  if (has('priority')) { const p = empty(input.priority) ? 'normal' : pick(TASK_PRIORITIES, input.priority); if (!p) err('priority', 'priority_invalid', 'الأولوية غير معروفة'); else v.priority = p; }
  if (has('status')) { const s = empty(input.status) ? 'open' : pick(TASK_STATUSES, input.status); if (!s) err('status', 'status_invalid', 'حالة المهمة غير معروفة'); else v.status = s; }
  if (has('notes')) { const n = empty(input.notes) ? null : String(input.notes).trim(); if (n && n.length > 2000) err('notes', 'notes_too_long', 'الملاحظات أطول من 2000 حرف'); else v.notes = n; }
  for (const k of ['customer_id', 'request_id', 'property_id', 'opportunity_id', 'assignee_id'] as const) if (has(k)) { if (empty(input[k])) v[k] = null; else if (!UUID.test(String(input[k]))) err(k, 'id_invalid', 'معرّف غير صحيح'); else v[k] = String(input[k]); }
  return { value: v, errors };
}
/** يوم الرياض (UTC+3 بلا توقيت صيفي) بصيغة YYYY-MM-DD */
export const riyadhDay = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
export type TaskView = 'today' | 'overdue' | 'upcoming' | 'done' | 'no_due';
/** تصنيف المهمة لعروض «اليوم / المتأخرة / القادمة / المكتملة» بتوقيت الرياض */
export function taskView(t: { status: string; due_at: Date | string | null }, now: Date): TaskView {
  if (t.status === 'done' || t.status === 'cancelled') return 'done';
  if (!t.due_at) return 'no_due';
  const due = new Date(t.due_at);
  if (due.getTime() < now.getTime()) return 'overdue';
  return riyadhDay(due) === riyadhDay(now) ? 'today' : 'upcoming';
}

// ——— تسجيل المكالمات يدويًا ———
export const CALL_OUTCOMES = [
  { value: 'answered', label: 'تم الرد' }, { value: 'no_answer', label: 'لم يرد' }, { value: 'busy', label: 'مشغول' },
  { value: 'callback', label: 'طلب معاودة الاتصال' }, { value: 'wrong_number', label: 'رقم خاطئ' },
] as const;
export type CallValue = { direction: 'in' | 'out'; occurred_at: Date; outcome: string; notes: string | null; next_step: string | null; follow_up_at: Date | null };
export function validateCall(input: Record<string, unknown>, now = new Date()): { value: CallValue | null; errors: Issue[] } {
  const errors: Issue[] = [];
  const err = (field: string, code: string, message: string) => errors.push({ field, code, message });
  const dir = input.direction === 'in' || input.direction === 'واردة' ? 'in' : input.direction === 'out' || input.direction === 'صادرة' ? 'out' : null;
  if (!dir) err('direction', 'direction_invalid', 'اتجاه المكالمة مطلوب (واردة أو صادرة)');
  const at = empty(input.occurred_at) ? now : parseDate(input.occurred_at);
  if (!at) err('occurred_at', 'date_invalid', 'وقت المكالمة غير صحيح'); else if (at.getTime() > now.getTime() + 5 * 60_000) err('occurred_at', 'date_future', 'وقت المكالمة لا يكون في المستقبل');
  const outcome = pick(CALL_OUTCOMES, input.outcome); if (!outcome) err('outcome', 'outcome_invalid', 'نتيجة المكالمة مطلوبة');
  const text = (k: string, max: number) => { const s = empty(input[k]) ? null : String(input[k]).trim(); if (s && s.length > max) { err(k, `${k}_too_long`, `النص أطول من ${max} حرف`); return null; } return s; };
  const notes = text('notes', 2000), next_step = text('next_step', 200);
  const follow = empty(input.follow_up_at) ? null : parseDate(input.follow_up_at);
  if (!empty(input.follow_up_at) && !follow) err('follow_up_at', 'date_invalid', 'موعد المتابعة غير صحيح');
  if (errors.length || !dir || !at || !outcome) return { value: null, errors };
  return { value: { direction: dir, occurred_at: at, outcome, notes, next_step, follow_up_at: follow }, errors };
}

// ——— الاقتراحات (قواعد حتمية قابلة للتفسير؛ لا مزوّد ذكاء اصطناعي مربوط) ———
export type SuggestionInput = {
  now: Date; created_at: Date; last_contact_at: Date | null; next_follow_up_at: Date | null; status: string;
  stage: { key: string; label: string; kind: string } | null; has_request: boolean;
  new_matches: { count: number; request_title: string | null };
  overdue_tasks: { title: string; due_at: Date }[];
  duplicates: { id: string; name: string; reason: string }[];
};
export type Suggestion = { key: string; priority: number; title: string; reason: string; action: { label: string; target: string } };
export const STALE_DAYS = 14;
const days = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86_400_000);
/** كل اقتراح يذكر سببه من بيانات الـCRM الفعلية؛ لا ينفّذ شيئًا تلقائيًا */
export function suggestionsFor(s: SuggestionInput): Suggestion[] {
  const out: Suggestion[] = [];
  if (s.status === 'do_not_contact') return [{ key: 'do_not_contact', priority: 100, title: 'العميل طلب عدم التواصل', reason: 'حالته «لا يُتواصل معه»؛ لا تقترح المنصة أي تواصل', action: { label: 'عرض الملف', target: 'profile' } }];
  if (s.new_matches.count > 0) out.push({ key: 'new_matches', priority: 90, title: `يوجد ${s.new_matches.count} ${s.new_matches.count === 1 ? 'عرض مطابق جديد' : 'عروض مطابقة جديدة'} لم تُراجع`, reason: `مطابقة منظمة لطلب العميل${s.new_matches.request_title ? ` «${s.new_matches.request_title}»` : ''} بحالة «جديد»`, action: { label: 'راجع المطابقات', target: 'matches' } });
  for (const t of s.overdue_tasks.slice(0, 3)) out.push({ key: `overdue:${t.title}`, priority: 85, title: `مهمة متأخرة: ${t.title}`, reason: `موعدها ${riyadhDay(t.due_at)} (متأخرة ${Math.max(1, days(s.now, t.due_at))} يوم)`, action: { label: 'افتح المهام', target: 'tasks' } });
  if (s.next_follow_up_at && s.next_follow_up_at.getTime() <= s.now.getTime()) out.push({ key: 'follow_up_due', priority: 80, title: 'حلّ موعد متابعة العميل', reason: `موعد المتابعة المحدد ${riyadhDay(s.next_follow_up_at)}`, action: { label: 'سجّل مكالمة', target: 'call' } });
  const ref = s.last_contact_at ?? s.created_at, since = days(s.now, ref);
  if (since >= STALE_DAYS && (!s.stage || s.stage.kind === 'open')) out.push({ key: 'stale', priority: 70, title: s.last_contact_at ? `لم يُتواصل مع العميل منذ ${since} يومًا` : `لا تواصل مسجل منذ إنشاء الملف قبل ${since} يومًا`, reason: s.last_contact_at ? `آخر تواصل ${riyadhDay(s.last_contact_at)}` : `أُنشئ الملف ${riyadhDay(s.created_at)} بلا مكالمة أو رسالة`, action: { label: 'سجّل مكالمة', target: 'call' } });
  for (const d of s.duplicates.slice(0, 3)) out.push({ key: `dup:${d.id}`, priority: 60, title: `احتمال تكرار مع «${d.name}»`, reason: `${d.reason}. لا يُدمج تلقائيًا؛ راجع ثم ادمج يدويًا إن تأكدت`, action: { label: 'افتح الملف الآخر', target: `contact:${d.id}` } });
  const step = nextStep(s);
  if (step) out.push(step);
  return out.sort((a, b) => b.priority - a.priority);
}
function nextStep(s: SuggestionInput): Suggestion | null {
  const st = s.stage?.key, mk = (title: string, reason: string, label: string, target: string): Suggestion => ({ key: 'next_step', priority: 50, title, reason, action: { label, target } });
  if (!s.stage) return s.has_request ? null : mk('أنشئ طلبًا منظمًا للعميل', 'لا طلب مرتبطًا بالعميل بعد، والمطابقة تحتاج طلبًا', 'طلب جديد', 'new_request');
  if (s.stage.kind !== 'open') return null;
  if (st === 'new') return s.last_contact_at
    ? mk('انقل الفرصة إلى «تم التواصل»', `سُجّل تواصل ${riyadhDay(s.last_contact_at)} والفرصة ما زالت في «${s.stage.label}»`, 'غيّر المرحلة', 'stage')
    : mk('سجّل أول تواصل مع العميل', `المرحلة «${s.stage.label}» بلا تواصل بعد`, 'سجّل مكالمة', 'call');
  if (st === 'contacted' && !s.has_request) return mk('أهّل العميل بطلب منظم', 'تم التواصل ولا يوجد طلب بشروط منظمة', 'طلب جديد', 'new_request');
  if ((st === 'qualified' || st === 'matching') && s.new_matches.count > 0) return mk('أرسل العروض المطابقة للعميل', `المرحلة «${s.stage.label}» وتوجد مطابقات جديدة`, 'راجع المطابقات', 'matches');
  if (st === 'offers_sent') return mk('تابع رد العميل أو حدّد معاينة', 'أُرسلت العروض ولم تُسجل معاينة', 'أنشئ مهمة', 'task');
  if (st === 'viewing') return mk('سجّل نتيجة المعاينة', 'العميل في مرحلة المعاينة', 'سجّل مكالمة', 'call');
  if (st === 'negotiation') return mk('حدّد موعد متابعة للتفاوض', 'التفاوض جارٍ بلا موعد قادم', 'أنشئ مهمة', 'task');
  if (st === 'agreement') return mk('أكمل الإجراءات وانقل الفرصة إلى «مكتمل»', 'تم الاتفاق', 'غيّر المرحلة', 'stage');
  return null;
}

// ——— استيراد العملاء من CSV (معاينة) ———
export const CONTACT_CSV_FIELDS = ['name', 'phone', 'email', 'type', 'source', 'city', 'notes'] as const;
export type ContactCsvField = (typeof CONTACT_CSV_FIELDS)[number];
const SYN: Record<ContactCsvField, string[]> = {
  name: ['الاسم', 'اسم العميل', 'name', 'full name', 'العميل'], phone: ['الجوال', 'رقم الجوال', 'الهاتف', 'phone', 'mobile', 'جوال'],
  email: ['البريد', 'البريد الالكتروني', 'الايميل', 'email', 'e-mail'], type: ['النوع', 'نوع العميل', 'type'], source: ['المصدر', 'source'],
  city: ['المدينة', 'city'], notes: ['ملاحظات', 'notes'],
};
export function suggestContactMapping(header: string[]): Record<ContactCsvField, number | null> {
  const h = header.map((x) => normalizeArabic(x));
  return Object.fromEntries(CONTACT_CSV_FIELDS.map((f) => [f, (() => { const i = h.findIndex((x) => SYN[f].some((s) => normalizeArabic(s) === x)); return i >= 0 ? i : null; })()])) as Record<ContactCsvField, number | null>;
}
export type ContactCsvRow = { row_number: number; raw: string[]; status: 'new' | 'update' | 'duplicate' | 'invalid'; normalized: Record<string, unknown> | null; issues: Issue[]; existing_id: string | null };
/**
 * يصنّف صفوف العملاء قبل أي إدخال: جديد، تحديث لعميل موجود (بالجوال أو البريد الموحَّد)، مكرر داخل الملف نفسه، أو غير صالح.
 * الصف غير الصالح لا يُدخل بصمت أبدًا. تعارض (جوال لعميل وبريد لآخر) = غير صالح للمراجعة اليدوية.
 */
export function processContactRows(rows: string[][], mapping: Record<ContactCsvField, number | null>, existing: { phones: Map<string, string>; emails: Map<string, string> }, cities: { id: string; name_ar: string }[]): ContactCsvRow[] {
  const seenP = new Set<string>(), seenE = new Set<string>();
  return rows.map((raw, i) => {
    const get = (f: ContactCsvField) => (mapping[f] === null ? '' : String(raw[mapping[f]!] ?? '').trim());
    const issues: Issue[] = [];
    const city = get('city') ? cities.find((c) => normalizeArabic(c.name_ar) === normalizeArabic(get('city'))) : null;
    if (get('city') && !city) issues.push({ code: 'city_unknown', field: 'city', message: `المدينة «${get('city')}» غير موجودة في المرجع (تُترك فارغة)` });
    const v = validateContact({ name: get('name'), phone: get('phone'), email: get('email'), type: get('type'), source: get('source') || 'import', notes: get('notes'), city_id: city?.id ?? null });
    const base = { row_number: i + 2, raw, existing_id: null as string | null };
    if (v.errors.length) return { ...base, status: 'invalid' as const, normalized: null, issues: [...v.errors, ...issues] };
    const p = v.value.phone_norm ?? null, e = v.value.email_norm ?? null;
    if ((p && seenP.has(p)) || (e && seenE.has(e))) return { ...base, status: 'duplicate' as const, normalized: null, issues: [{ code: 'duplicate_in_file', message: 'مكرر داخل الملف (نفس الجوال أو البريد في صف سابق)' }, ...issues] };
    if (p) seenP.add(p); if (e) seenE.add(e);
    const d = dedupeDecision(p ? existing.phones.get(p) ?? null : null, e ? existing.emails.get(e) ?? null : null);
    const normalized = { ...v.value, next_follow_up_at: null } as Record<string, unknown>;
    if (d.action === 'conflict') return { ...base, status: 'invalid' as const, normalized: null, issues: [{ code: 'identifier_conflict', message: 'الجوال لعميل والبريد لعميل آخر؛ يحتاج مراجعة يدوية' }, ...issues] };
    if (d.action === 'match') return { ...base, status: 'update' as const, normalized, issues, existing_id: d.id };
    return { ...base, status: 'new' as const, normalized, issues };
  });
}

// ——— التنبيهات: مفاتيح منع التكرار لنفس الحدث ———
export const notifKey = {
  matchFound: (requestId: string, propertyId: string) => `match:${requestId}:${propertyId}`,
  requestForOffer: (propertyId: string, requestId: string) => `offer_request:${propertyId}:${requestId}`,
  followUp: (contactId: string, at: Date) => `followup:${contactId}:${at.toISOString()}`,
  taskOverdue: (taskId: string, due: Date) => `task_overdue:${taskId}:${due.toISOString()}`,
  taskStatus: (taskId: string, status: string, at: Date) => `task_status:${taskId}:${status}:${at.toISOString()}`,
  assigned: (contactId: string, ownerId: string, at: Date) => `assigned:${contactId}:${ownerId}:${at.toISOString()}`,
  inbound: (channel: string, externalId: string) => `inbound:${channel}:${externalId}`,
};
