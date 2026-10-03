/** تسميات الـCRM للواجهة (لا منطق) */
export const TL_KIND_AR: Record<string, string> = {
  created: 'إنشاء الملف', identified: 'وصول عبر قناة', updated: 'تحديث البيانات', assigned: 'تغيير المسؤول', note: 'ملاحظة', call: 'مكالمة',
  message_in: 'رسالة واردة', message_out: 'رسالة صادرة', enquiry: 'استفسار', request_linked: 'ربط طلب', opportunity_created: 'فرصة جديدة',
  stage_change: 'تغيير المرحلة', task_created: 'مهمة', task_done: 'إنجاز مهمة', task_status: 'حالة مهمة', match_status: 'متابعة مطابقة', merged: 'دمج ملف',
};
export const CHANNEL_AR: Record<string, string> = { whatsapp: 'واتساب', email: 'بريد', web: 'نموذج المنصة', call: 'مكالمة', manual: 'يدوي', import: 'استيراد' };
export const STATUS_CH_AR: Record<string, string> = { connected: 'متصلة', not_connected: 'غير متصلة', needs_configuration: 'تحتاج إعدادًا', error: 'خطأ' };
export const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }) : '—');
export const day = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('ar-SA-u-nu-latn', { dateStyle: 'medium', timeZone: 'Asia/Riyadh' }) : '—');
export const localPhone = (p: unknown) => { const s = String(p ?? ''); return s.startsWith('+966') ? '0' + s.slice(4) : s; };
/** قيمة datetime-local بتوقيت الرياض من تاريخ */
export const toLocalInput = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 16);
/** تحويل datetime-local (بتوقيت الرياض) إلى ISO */
export const fromLocalInput = (v: string) => (v ? new Date(`${v}:00+03:00`).toISOString() : '');
