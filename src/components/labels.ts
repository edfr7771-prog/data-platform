export const TYPE_AR: Record<string, string> = { villa: 'فيلا', apartment: 'شقة', land: 'أرض', building: 'عمارة', commercial: 'تجاري', floor: 'دور', office: 'مكتب', shop: 'محل', warehouse: 'مستودع', farm: 'مزرعة', other: 'أخرى' };
export const DEAL_AR: Record<string, string> = { sale: 'بيع', rent: 'إيجار', investment: 'استثمار' };
export const USAGE_AR: Record<string, string> = { residential: 'سكني', commercial: 'تجاري' };
export const STATUS_AR: Record<string, string> = { active: 'متاح', sold: 'مباع', rented: 'مؤجر', withdrawn: 'مسحوب' };
export const ROLE_AR: Record<string, string> = { org_admin: 'مدير المؤسسة', data_analyst: 'محلل بيانات', broker: 'وسيط', employee: 'موظف', investor: 'مستثمر', student: 'طالب', viewer: 'مطّلع' };
export const ROW_AR: Record<string, string> = { ok: 'سليم', fixed: 'مُصحَّح', review: 'مراجعة', duplicate: 'مكرر', invalid: 'غير صالح', imported: 'أُدخل', skipped: 'متجاوز' };
export const FIELD_AR: Record<string, string> = { external_ref: 'الرقم المرجعي', type: 'النوع', deal: 'بيع/إيجار', usage: 'الاستخدام', city: 'المدينة', district: 'الحي', location: 'الموقع', lat: 'خط العرض', lng: 'خط الطول', area_sqm: 'المساحة (م²)', price: 'السعر', age_years: 'العمر', rooms: 'الغرف', street_width_m: 'عرض الشارع', facades: 'الواجهات', status: 'الحالة', notes: 'ملاحظات' };
export const fmt = (n: unknown) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
