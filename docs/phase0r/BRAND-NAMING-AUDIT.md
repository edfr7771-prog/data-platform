# BRAND-NAMING-AUDIT: تدقيق كتابات الاسم في الحزمة

> **تنبيه صريح:** كُتب هذا التقرير **بعد** بناء المرحلة الأولى لا قبله كما اشترط الاتفاق (Phase 0)، وضُمّ إلى الحزمة في Phase 0R (3 أكتوبر 2026). نتاج فحص آلي لملفات الحزمة، باستثناء `node_modules` و`.next` و`.env` و`package-lock.json` وملفات الخطوط، **وباستثناء مجلد `docs/phase0r/` نفسه** لأنه ناتج التدقيق لا موضوعه.

## العدّ بالصيغة الحرفية (على الحزمة النهائية)
| الصيغة | الظهور |
|---|---|
| `TAMALAAN` | 11 |
| `tamaalann` | 5 |
| `tamalaan` / `Tamalaan` | 0 |
| `TAMAALANN` / `Tamaalann` | 0 |

## الأماكن
| الملف | الصيغ | عدد الأسطر |
|---|---|---|
| `.env.example` | TAMALAAN | 1 |
| `README.md` | TAMALAAN | 3 |
| `db/migrations/001_schema.sql` | TAMALAAN | 1 |
| `docs/PHASE-1-REPORT.md` | TAMALAAN, tamaalann | 3 |
| `package.json` | TAMALAAN | 1 |
| `scripts/test_otp_policy.ts` | tamaalann | 2 |
| `src/app/layout.tsx` | TAMALAAN | 1 |
| `src/app/page.tsx` | TAMALAAN | 1 |
| `src/components/Brand.tsx` | TAMALAAN | 1 |

## التصنيف
- **`TAMALAAN DATA`** (الاسم الظاهر): نصوص ظاهرة وتعليقات ووصف حزمة فقط. لا معرّف تقني.
- **`tamaalann`**: في `scripts/test_otp_policy.ts` سطران (9 و13): **بيانات اختبار** منقولة حرفيًا من «تم الآن» (مُوثَّقة في `PROVENANCE.md`)، ونصوص التوثيق التي تطلب قرارك. **ليست في كود التشغيل.**
- اسم الحزمة `re-data-platform` مؤقت ومحايد عمدًا. لا نطاق ولا مضيف ثابت في كود التشغيل (الرابط من `APP_URL`). لا اسم كوكي أو جدول أو متغير بيئة يحمل أيًّا من الصيغ.

## النتيجة والقرار المطلوب
الاسم الظاهر `TAMALAAN DATA` **يختلف في حروفه اللاتينية عن هويتك المعتمدة `tamaalann`**. لم يُنشأ أي نطاق أو حساب أو اسم حزمة نهائي. **القرار المطلوب منك:** اعتماد الكتابة اللاتينية الرسمية قبل أي نطاق أو حساب أو اسم حزمة.
