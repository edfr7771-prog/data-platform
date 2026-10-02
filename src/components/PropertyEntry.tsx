'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { COMMON_ATTRS, DEALS, errorsForStep, fieldsFor, kinds, payloadFor, RENT_PERIODS, type Description, type EntryForm, type FieldDef, type Issue } from '@/lib/property-schema';

type City = { id: string; name_ar: string };
type District = { id: string; city_id: string; name_ar: string };
type DraftSummary = { id: string; kind_label: string | null; deal: string | null; updated_at: string };

const CATEGORY_AR: Record<string, string> = { residential: 'سكني', commercial: 'تجاري', hospitality: 'ضيافة', industrial: 'صناعي ولوجستي', land: 'أراضٍ', agricultural: 'زراعي', other: 'أخرى' };
const STEPS = ['البيانات الأساسية', 'تفاصيل العقار', 'المعاينة والنشر'];
const blank = (): EntryForm => ({ deal: '', kind: '', city_id: '', district_id: '', location: '', area_sqm: '', price: '', rent_period: '', ad_license_no: '', deed_no: '', notes: '', attributes: {} });
const asText = (v: unknown) => (v === undefined || v === null ? '' : Array.isArray(v) ? v.join('، ') : String(v));

/**
 * إدخال عقاري منظم بثلاث خطوات. كل القيم في حالة واحدة، فالرجوع بين الخطوات أو تغيير النوع لا يمسح ما كُتب،
 * لكن النشر والمعاينة يرسلان حقول النوع المختار فقط (payloadFor). الوصف يأتي من الخادم بنفس دالة الحفظ.
 */
export function PropertyEntry({ cities, districts, onPublished }: { cities: City[]; districts: District[]; onPublished: () => void }) {
  const [f, setF] = useState<EntryForm>(() => ({ ...blank(), city_id: cities.length === 1 ? cities[0].id : '' }));
  const [step, setStep] = useState(0);
  const [errs, setErrs] = useState<Issue[]>([]);
  const [preview, setPreview] = useState<{ description: Description; warnings: Issue[] } | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);

  const loadDrafts = useCallback(async () => {
    const d = await fetch('/api/property-drafts').then((r) => r.json()).catch(() => ({}));
    if (d.ok) setDrafts(d.items);
  }, []);
  useEffect(() => { void loadDrafts(); }, [loadDrafts]);

  const deal = (f.deal as string) || null;
  const fields = useMemo(() => (f.kind ? fieldsFor(f.kind as string, deal as never) : []), [f.kind, deal]);
  const kindLabel = kinds().find((k) => k.key === f.kind)?.label;
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const setAttr = (k: string, v: unknown) => setF((p) => ({ ...p, attributes: { ...(p.attributes ?? {}), [k]: v } }));
  const errOf = (k: string) => errs.find((e) => e.field === k)?.message;
  const cityDistricts = districts.filter((d) => !f.city_id || d.city_id === f.city_id);

  function go(next: number) {
    setMsg('');
    if (next > step && step < 2) {
      const e = errorsForStep(f, (step + 1) as 1 | 2);
      setErrs(e);
      if (e.length) { requestAnimationFrame(() => document.getElementById(`pf-${e[0].field}`)?.focus()); return; }
    } else setErrs([]);
    setStep(next);
    if (next === 2) void loadPreview();
  }

  async function loadPreview(form = f) {
    setPreview(null);
    const r = await fetch('/api/properties/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadFor(form)) });
    const d = await r.json().catch(() => ({}));
    if (d.ok) setPreview({ description: d.description, warnings: [...(d.warnings ?? []), ...(d.fixes ?? [])] });
    else setErrs(d.errors ?? [{ code: 'x', message: 'تعذّرت المعاينة.' }]);
  }

  async function saveDraft() {
    setBusy(true); setMsg('');
    const body = JSON.stringify({ data: f });
    const r = draftId
      ? await fetch(`/api/property-drafts/${draftId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      : await fetch('/api/property-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const d = await r.json().catch(() => ({})); setBusy(false);
    if (d.ok) { if (d.id) setDraftId(d.id); setMsg('حُفظت المسودة. تجدها في «مسوداتك» للمتابعة لاحقًا.'); void loadDrafts(); }
    else setMsg(d.error === 'draft_limit' ? 'بلغت الحد الأقصى للمسودات (50). احذف بعضها أولًا.' : 'تعذّر حفظ المسودة.');
  }

  async function openDraft(id: string) {
    const d = await fetch(`/api/property-drafts/${id}`).then((r) => r.json()).catch(() => ({}));
    if (!d.ok) { setMsg('تعذّر فتح المسودة.'); return; }
    setF({ ...blank(), ...d.draft.data, attributes: { ...(d.draft.data.attributes ?? {}) } }); setDraftId(id); setStep(0); setErrs([]); setPreview(null);
    setMsg('فُتحت المسودة. أكمل البيانات ثم انشر.');
  }
  async function removeDraft(id: string) {
    if (!window.confirm('حذف هذه المسودة؟')) return;
    await fetch(`/api/property-drafts/${id}`, { method: 'DELETE' });
    if (id === draftId) setDraftId(null);
    void loadDrafts();
  }

  async function publish() {
    setBusy(true); setMsg(''); setErrs([]);
    const r = await fetch('/api/properties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payloadFor(f), ...(draftId ? { draft_id: draftId } : {}) }) });
    const d = await r.json().catch(() => ({})); setBusy(false);
    if (d.ok) { setF({ ...blank(), city_id: f.city_id }); setDraftId(null); setStep(0); setPreview(null); setMsg('نُشر العقار ببياناته المنظمة ووصفه المولَّد.'); void loadDrafts(); onPublished(); }
    else if (d.errors) setErrs(d.errors);
    else setMsg(d.error === 'forbidden' ? 'لا تملك صلاحية الإضافة.' : 'تعذّر النشر.');
  }

  const input = (key: string, label: string, value: unknown, onChange: (v: string) => void, o: { unit?: string; numeric?: boolean; required?: boolean; hint?: string } = {}) => (
    <label className="field" key={key}>
      <span>{label}{o.unit ? ` (${o.unit})` : ''}{o.required ? ' *' : ''}</span>
      <input id={`pf-${key}`} className="input" dir={o.numeric ? 'ltr' : undefined} inputMode={o.numeric ? 'decimal' : undefined} value={asText(value)} onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!errOf(key)} aria-describedby={errOf(key) ? `pe-${key}` : undefined} />
      {o.hint && <small className="muted">{o.hint}</small>}
      {errOf(key) && <small id={`pe-${key}`} className="ferr">{errOf(key)}</small>}
    </label>
  );

  const attrField = (fd: FieldDef & { required: boolean }) => {
    const v = f.attributes?.[fd.key];
    const label = `${fd.label}${fd.required ? ' *' : ''}`;
    if (fd.kind === 'int' || fd.kind === 'decimal' || fd.kind === 'number_list' || fd.kind === 'text')
      return input(fd.key, fd.label, v, (x) => setAttr(fd.key, x), { unit: fd.unit, numeric: fd.kind !== 'text', required: fd.required, hint: fd.hint });
    const err = errOf(fd.key);
    if (fd.kind === 'multi') {
      const cur = Array.isArray(v) ? (v as string[]) : [];
      return (
        <fieldset className="fs field" key={fd.key} aria-invalid={!!err}>
          <legend>{label}</legend>
          <div className="seg" id={`pf-${fd.key}`} tabIndex={-1}>
            {fd.options!.map((o) => (
              <label key={o.value}><input type="checkbox" checked={cur.includes(o.value)} onChange={(e) => setAttr(fd.key, e.target.checked ? [...cur, o.value] : cur.filter((x) => x !== o.value))} />{o.label}</label>
            ))}
          </div>
          {err && <small className="ferr">{err}</small>}
        </fieldset>
      );
    }
    const options = fd.kind === 'bool' ? [{ value: 'true', label: 'يوجد' }, { value: 'false', label: 'لا يوجد' }] : fd.options!;
    return (
      <label className="field" key={fd.key}>
        <span>{label}</span>
        <select id={`pf-${fd.key}`} className="input" value={v === undefined || v === null ? '' : String(v)} aria-invalid={!!err}
          onChange={(e) => setAttr(fd.key, e.target.value === '' ? '' : fd.kind === 'bool' ? e.target.value === 'true' : e.target.value)}>
          <option value="">—</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {err && <small className="ferr">{err}</small>}
      </label>
    );
  };

  const byCategory = Object.entries(kinds().reduce<Record<string, { key: string; label: string }[]>>((acc, k) => { (acc[k.category] ??= []).push(k); return acc; }, {}));
  // أخطاء لا يظهر حقلها في الخطوة الحالية تُعرض في الملخص أسفل النموذج
  const visible = new Set(step === 0 ? ['deal', 'kind', 'city', 'district', 'location', 'area_sqm', 'price', 'rent_period', 'ad_license_no', 'deed_no'] : step === 1 ? fields.map((x) => x.key) : ['notes']);
  const stepErrs = errs.filter((e) => !visible.has(e.field ?? ''));

  return (
    <section className="panel stack" aria-label="إضافة عقار">
      <h2 style={{ fontSize: 20 }}>إضافة عقار</h2>
      <ol className="steps" aria-label="خطوات الإضافة">
        {STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : undefined}>{s}</li>)}
      </ol>

      {drafts.length > 0 && (
        <details>
          <summary>مسوداتك ({drafts.length})</summary>
          <ul style={{ margin: '8px 0 0', paddingInlineStart: 20 }}>
            {drafts.map((d) => (
              <li key={d.id} style={{ marginBottom: 6 }}>
                {d.kind_label ?? 'بلا نوع'}{d.deal ? ` · ${DEALS.find((x) => x.value === d.deal)?.label ?? ''}` : ''} <span className="muted">({new Date(d.updated_at).toLocaleDateString('ar-SA-u-nu-latn')})</span>{' '}
                <button type="button" className="btn line sm" style={{ color: 'var(--ink)', borderColor: '#8FA3C0' }} onClick={() => openDraft(d.id)}>متابعة</button>{' '}
                <button type="button" className="btn line sm" style={{ color: 'var(--red)', borderColor: '#E4A5A0' }} onClick={() => removeDraft(d.id)}>حذف</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {step === 0 && (
        <div className="stack">
          <fieldset className="fs field">
            <legend>نوع العملية *</legend>
            <div className="seg" id="pf-deal" tabIndex={-1}>
              {DEALS.map((d) => <label key={d.value}><input type="radio" name="deal" checked={f.deal === d.value} onChange={() => set('deal', d.value)} />{d.label}</label>)}
            </div>
            {errOf('deal') && <small className="ferr">{errOf('deal')}</small>}
          </fieldset>
          <div className="row">
            <label className="field">
              <span>نوع العقار *</span>
              <select id="pf-kind" className="input" value={f.kind as string} onChange={(e) => set('kind', e.target.value)} aria-invalid={!!errOf('kind')}>
                <option value="">اختر النوع</option>
                {byCategory.map(([cat, list]) => <optgroup key={cat} label={CATEGORY_AR[cat] ?? cat}>{list.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</optgroup>)}
              </select>
              {errOf('kind') && <small className="ferr">{errOf('kind')}</small>}
            </label>
            <label className="field">
              <span>المدينة *</span>
              <select id="pf-city" className="input" value={f.city_id as string} onChange={(e) => setF((p) => ({ ...p, city_id: e.target.value, district_id: '' }))} aria-invalid={!!errOf('city')}>
                <option value="">اختر المدينة</option>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
              </select>
              {errOf('city') && <small className="ferr">{errOf('city')}</small>}
            </label>
            <label className="field">
              <span>الحي *</span>
              <select id="pf-district" className="input" value={f.district_id as string} onChange={(e) => set('district_id', e.target.value)} aria-invalid={!!errOf('district')}>
                <option value="">اختر الحي</option>
                {cityDistricts.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
              </select>
              {errOf('district') && <small className="ferr">{errOf('district')}</small>}
            </label>
          </div>
          {input('location', 'الموقع / العنوان (اختياري)', f.location, (v) => set('location', v))}
          <div className="row">
            {input('area_sqm', 'المساحة', f.area_sqm, (v) => set('area_sqm', v), { unit: 'م²', numeric: true, required: true })}
            {input('price', f.deal === 'rent' ? 'الإيجار' : 'السعر', f.price, (v) => set('price', v), { unit: 'ريال', numeric: true, required: true })}
            {f.deal === 'rent' && (
              <label className="field">
                <span>مدة الإيجار *</span>
                <select id="pf-rent_period" className="input" value={f.rent_period as string} onChange={(e) => set('rent_period', e.target.value)} aria-invalid={!!errOf('rent_period')}>
                  <option value="">اختر</option>
                  {RENT_PERIODS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {errOf('rent_period') && <small className="ferr">{errOf('rent_period')}</small>}
              </label>
            )}
          </div>
          <div className="row">
            {input('ad_license_no', `${COMMON_ATTRS.ad_license_no.label} (عند انطباقه)`, f.ad_license_no, (v) => set('ad_license_no', v))}
            {input('deed_no', `${COMMON_ATTRS.deed_no.label} (عند انطباقه)`, f.deed_no, (v) => set('deed_no', v))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>حقول «{kindLabel}». المطلوب معلَّم بـ*، والباقي اختياري ولا يظهر في الوصف إن تُرك فارغًا.</p>
          <div className="row">{fields.map(attrField)}</div>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <label className="field">
            <span>ملاحظات إضافية (اختياري، نص حر لا يدخل الوصف المنظم)</span>
            <textarea id="pf-notes" className="input" rows={3} maxLength={2000} value={f.notes as string} onChange={(e) => set('notes', e.target.value)} />
          </label>
          <div className="preview" aria-live="polite">
            {!preview && <span className="muted">جارٍ تجهيز المعاينة…</span>}
            {preview && (
              <>
                <h3>{preview.description.title}</h3>
                {preview.description.sections.map((s) => (
                  <div key={s.key}><h4>{s.heading}</h4><ul>{s.lines.map((l) => <li key={l}>{l}</li>)}</ul></div>
                ))}
                {String(f.notes ?? '').trim() && <div><h4>ملاحظات إضافية</h4><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{String(f.notes).trim()}</p></div>}
              </>
            )}
          </div>
          {preview && preview.warnings.length > 0 && <div className="note"><ul style={{ margin: 0, paddingInlineStart: 20 }}>{preview.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul></div>}
        </div>
      )}

      <div aria-live="polite" className="stack" style={{ gap: 8 }}>
        {stepErrs.length > 0 && <div role="alert" className="note err"><b>يلزم تصحيح:</b><ul style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>{stepErrs.map((x, i) => <li key={i}>{x.message}</li>)}</ul></div>}
        {errs.length > 0 && stepErrs.length === 0 && <div role="alert" className="note err">يلزم تصحيح الحقول المعلَّمة أعلاه.</div>}
        {msg && <div className="note ok">{msg}</div>}
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        {step > 0 && <button type="button" className="btn line sm" style={{ color: 'var(--ink)', borderColor: '#8FA3C0' }} onClick={() => go(step - 1)}>رجوع</button>}
        {step < 2 && <button type="button" className="btn" onClick={() => go(step + 1)}>التالي</button>}
        {step === 2 && <button type="button" className="btn gold" disabled={busy || !preview} onClick={publish}>{busy ? 'جارٍ النشر…' : 'نشر العقار'}</button>}
        <button type="button" className="btn line sm" style={{ color: 'var(--ink)', borderColor: '#8FA3C0' }} disabled={busy} onClick={saveDraft}>حفظ كمسودة</button>
      </div>
    </section>
  );
}
