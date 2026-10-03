import { fail, guard, json, readJson } from '@/lib/api';
import { previewProperty } from '@/lib/properties';

/** معاينة الإدخال المنظم قبل النشر: نفس التحقق والوصف الذي يُحفظ، بلا كتابة */
export async function POST(req: Request) {
  const g = await guard(req, 'property:write'); if ('res' in g) return g.res;
  const b = await readJson(req, 50_000); if (!b) return fail(400, 'bad_json');
  const r = await previewProperty(b);
  return r.ok ? json(r) : fail(400, 'validation', { errors: r.errors, warnings: r.warnings });
}
