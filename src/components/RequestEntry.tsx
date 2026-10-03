'use client';
import { useMemo, useState } from 'react';
import { kinds, RENT_PERIODS, type Issue } from '@/lib/property-schema';
import { criteriaFieldsFor, IMPORTANCE, PURPOSES, requestPayload, type RequestDescription } from '@/lib/request-schema';

type City = { id: string; name_ar: string };
type District = { id: string; city_id: string; name_ar: string };
type Crit = { value?: unknown; importance?: string };
const blank = () => ({ purpose: '', kinds: [] as string[], city_id: '', district_ids: [] as string[], district_importance: 'must', budget_min: '', budget_max: '', area_min: '', area_max: '', area_importance: 'preferred', rent_period: '', notes: '', criteria: {} as Record<string, Crit> });
const STEPS = ['الأساسيات', 'الشروط حسب النوع', 'المعاينة والحفظ'];
const line = { color: 'var(--ink)', borderColor: '#8FA3C0' } as const;

/**
 * طلب عقاري منظم: الحقول المشتركة، ثم شروط حسب الأنواع المختارة مع «شرط إلزامي / مفضّل / لا يهم»،
 * ثم معاينة الوصف المولَّد وحفظه. الملاحظات الحرة منفصلة ولا تدخل الوصف ولا المطابقة.
 */
export function RequestEntry({ cities, districts, onSaved }: { cities: City[]; districts: District[]; onSaved: () => void }) {
  const [f, setF] = useState(() => ({ ...blank(), city_id: cities.length === 1 ? cities[0].id : '' }));
  const [step, setStep] = useState(0);
  const [errs, setErrs] = useState<Issue[]>([]);
  const [preview, setPreview] = useState<RequestDescription | null>(null);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const fields = useMemo(() => criteriaFieldsFor(f.kinds), [f.kinds]);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const setCrit = (k: string, patch: Crit) => setF((p) => ({ ...p, criteria: { ...p.criteria, [k]: { importance: 'preferred', ...p.criteria[k], ...patch } } }));
  const errOf = (k: string) => errs.find((e) => e.field === k)?.message;
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  async function post(path: string) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestPayload(f)) });
    return r.json().catch(() => ({}));
  }
  async function go(next: number) {
    setMsg('');
    if (next > step) {
      // التحقق من الخادم نفسه (نفس دالة الحفظ)؛ الخطوة الأولى تعرض أخطاء الحقول المشتركة فقط
      const d = await post('/api/requests/preview');
      const own = new Set(fields.map((x) => x.key));
      const e: Issue[] = d.ok ? [] : (d.errors ?? []).filter((x: Issue) => (step === 0 ? !own.has(x.field ?? '') : true));
      setErrs(e);
      if (e.length) return;
      if (next === 2) setPreview(d.description);
    } else setErrs([]);
    setStep(next);
  }
  async function save() {
    setBusy(true); setMsg('');
    const d = await post('/api/requests'); setBusy(false);
    if (d.ok) { setF({ ...blank(), city_id: f.city_id }); setStep(0); setPreview(null); setMsg('حُفظ الطلب. افتح «المطابقات» لرؤية العروض المناسبة.'); onSaved(); }
    else if (d.errors) setErrs(d.errors); else setMsg(d.error === 'forbidden' ? 'لا تملك صلاحية إضافة الطلبات.' : 'تعذّر الحفظ.');
  }

  const num = (k: keyof ReturnType<typeof blank>, label: string, unit?: string, required = false) => (
    <label className="field">
      <span>{label}{unit ? ` (${unit})` : ''}{required ? ' *' : ''}</span>
      <input id={`rq-${k}`} className="input" dir="ltr" inputMode="decimal" value={String(f[k] ?? '')} onChange={(e) => set(k, e.target.value)} aria-invalid={!!errOf(k)} />
      {errOf(k) && <small className="ferr">{errOf(k)}</small>}
    </label>
  );
  const importanceSelect = (id: string, value: string, onChange: (v: string) => void, withAny = true) => (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="الأهمية">
      {IMPORTANCE.filter((o) => withAny || o.value !== 'any').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const cityDistricts = districts.filter((d) => !f.city_id || d.city_id === f.city_id);

  return (
    <section className="panel stack" aria-label="إضافة طلب">
      <h2 style={{ fontSize: 20 }}>إضافة طلب</h2>
      <ol className="steps" aria-label="خطوات الطلب">{STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : undefined}>{s}</li>)}</ol>

      {step === 0 && (
        <div className="stack">
          <fieldset className="fs field">
            <legend>الغرض *</legend>
            <div className="seg">{PURPOSES.map((p) => <label key={p.value}><input type="radio" name="purpose" checked={f.purpose === p.value} onChange={() => set('purpose', p.value)} />{p.label}</label>)}</div>
            {errOf('purpose') && <small className="ferr">{errOf('purpose')}</small>}
          </fieldset>
          <fieldset className="fs field">
            <legend>نوع العقار المطلوب * (يمكن أكثر من نوع)</legend>
            <div className="seg">{kinds().map((k) => <label key={k.key}><input type="checkbox" checked={f.kinds.includes(k.key)} onChange={() => set('kinds', toggle(f.kinds, k.key))} />{k.label}</label>)}</div>
            {errOf('kinds') && <small className="ferr">{errOf('kinds')}</small>}
          </fieldset>
          <div className="row">
            <label className="field"><span>المدينة *</span>
              <select className="input" value={f.city_id} onChange={(e) => setF((p) => ({ ...p, city_id: e.target.value, district_ids: [] }))} aria-invalid={!!errOf('city')}>
                <option value="">اختر المدينة</option>{cities.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
              </select>{errOf('city') && <small className="ferr">{errOf('city')}</small>}
            </label>
            <label className="field"><span>أهمية الحي</span>{importanceSelect('rq-district_importance', f.district_importance, (v) => set('district_importance', v), false)}</label>
          </div>
          <fieldset className="fs field">
            <legend>الأحياء (اختياري)</legend>
            <div className="seg">{cityDistricts.map((d) => <label key={d.id}><input type="checkbox" checked={f.district_ids.includes(d.id)} onChange={() => set('district_ids', toggle(f.district_ids, d.id))} />{d.name_ar}</label>)}</div>
            {errOf('district_ids') && <small className="ferr">{errOf('district_ids')}</small>}
          </fieldset>
          <div className="row">
            {num('budget_min', 'الميزانية من', 'ريال')}
            {num('budget_max', 'الميزانية حتى', 'ريال', true)}
            {f.purpose === 'rent' && (
              <label className="field"><span>مدة الإيجار *</span>
                <select id="rq-rent_period" className="input" value={f.rent_period} onChange={(e) => set('rent_period', e.target.value)} aria-invalid={!!errOf('rent_period')}>
                  <option value="">اختر</option>{RENT_PERIODS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>{errOf('rent_period') && <small className="ferr">{errOf('rent_period')}</small>}
              </label>
            )}
          </div>
          <div className="row">
            {num('area_min', 'المساحة من', 'م²')}
            {num('area_max', 'المساحة حتى', 'م²')}
            <label className="field"><span>أهمية المساحة</span>{importanceSelect('rq-area_importance', f.area_importance, (v) => set('area_importance', v), false)}</label>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>حدد ما يهمك فقط. «لا يهم» لا يُحفظ ولا يؤثر في المطابقة. «شرط إلزامي» يستبعد أي عرض لا يحققه أو لا يذكره.</p>
          {fields.map((fd) => {
            const c = f.criteria[fd.key] ?? {}, imp = String(c.importance ?? 'any');
            const valueInput = fd.op === 'min' || fd.op === 'max'
              ? <input id={`rq-c-${fd.key}`} className="input" dir="ltr" inputMode="decimal" value={String(c.value ?? '')} onChange={(e) => setCrit(fd.key, { value: e.target.value })} aria-label={`${fd.label} ${fd.op === 'min' ? 'الحد الأدنى' : 'الحد الأقصى'}`} />
              : fd.op === 'is'
                ? <select id={`rq-c-${fd.key}`} className="input" value={c.value === undefined ? '' : String(c.value)} onChange={(e) => setCrit(fd.key, { value: e.target.value === '' ? undefined : e.target.value === 'true' })} aria-label={fd.label}><option value="">—</option><option value="true">يوجد</option><option value="false">لا يوجد</option></select>
                : <div className="seg" id={`rq-c-${fd.key}`}>{fd.options!.map((o) => { const cur = Array.isArray(c.value) ? (c.value as string[]) : []; return <label key={o.value}><input type="checkbox" checked={cur.includes(o.value)} onChange={() => setCrit(fd.key, { value: toggle(cur, o.value) })} />{o.label}</label>; })}</div>;
            return (
              <fieldset key={fd.key} className="fs field" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                <legend>{fd.label}{fd.unit ? ` (${fd.unit})` : ''}{fd.op === 'min' ? ': على الأقل' : fd.op === 'max' ? ': كحد أقصى' : fd.op === 'in' ? ': أيٌّ من' : fd.op === 'has' ? ': يشمل' : ''}</legend>
                <div className="row">
                  <div className="field" style={{ flex: '2 1 240px' }}>{valueInput}</div>
                  <div className="field" style={{ flex: '1 1 160px' }}>{importanceSelect(`rq-i-${fd.key}`, imp, (v) => setCrit(fd.key, { importance: v }))}</div>
                </div>
                {errOf(fd.key) && <small className="ferr">{errOf(fd.key)}</small>}
              </fieldset>
            );
          })}
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <label className="field"><span>ملاحظات إضافية (اختياري، نص حر لا يدخل الوصف ولا المطابقة)</span>
            <textarea className="input" rows={3} maxLength={2000} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
          <div className="preview" aria-live="polite">
            {preview && <><h3>{preview.title}</h3>{preview.sections.map((s) => <div key={s.key}><h4>{s.heading}</h4><ul>{s.lines.map((l) => <li key={l}>{l}</li>)}</ul></div>)}</>}
            {f.notes.trim() && <div><h4>ملاحظات إضافية</h4><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{f.notes.trim()}</p></div>}
          </div>
        </div>
      )}

      <div aria-live="polite" className="stack" style={{ gap: 8 }}>
        {errs.length > 0 && <div role="alert" className="note err"><b>يلزم تصحيح:</b><ul style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>{errs.map((x, i) => <li key={i}>{x.message}</li>)}</ul></div>}
        {msg && <div className="note ok">{msg}</div>}
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        {step > 0 && <button type="button" className="btn line sm" style={line} onClick={() => go(step - 1)}>رجوع</button>}
        {step < 2 && <button type="button" className="btn" onClick={() => go(step + 1)}>التالي</button>}
        {step === 2 && <button type="button" className="btn gold" disabled={busy} onClick={save}>{busy ? 'جارٍ الحفظ…' : 'حفظ الطلب'}</button>}
      </div>
    </section>
  );
}
