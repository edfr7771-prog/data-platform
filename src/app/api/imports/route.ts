import { fail, guard, json } from '@/lib/api';
import { createImportPreview, maxImportBytes } from '@/lib/imports';

/** رفع ملف CSV: يُفحص ويُعاين ويُصنَّف، ولا يُدخل أي عقار قبل موافقة صريحة. */
export async function POST(req: Request) {
  const g = await guard(req, 'import:run'); if ('res' in g) return g.res;
  if (Number(req.headers.get('content-length') ?? 0) > maxImportBytes() + 200_000) return fail(413, 'file_too_large');
  let form: FormData;
  try { form = await req.formData(); } catch { return fail(400, 'bad_form'); }
  const f = form.get('file');
  if (!(f instanceof File)) return fail(400, 'file_required');
  const r = await createImportPreview(g.ctx, { name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) });
  return r.ok ? json(r, 201) : fail(400, 'invalid_file', { message: r.error });
}
