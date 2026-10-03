# تم الآن لذكاء البيانات العقارية | TAMALAAN DATA

**منصة SaaS سعودية لتحليل البيانات العقارية بعلوم البيانات والذكاء الاصطناعي. الحالة: المرحلة الأولى (Phase 1) مكتملة، والمرحلة الثانية قيد التنفيذ (انظر `PROGRESS.md`).**
> الاسم الظاهر الحالي: «تم الآن لذكاء البيانات العقارية | TAMALAAN DATA». **لا تُنشأ نطاقات أو حسابات أو أسماء حزم نهائية** قبل اعتماد الكتابة اللاتينية الرسمية (انظر `docs/PHASE-1-REPORT.md`، قسم القرارات). اسم الحزمة التقني الحالي `re-data-platform` مؤقت.

## ما يعمل في المرحلة الأولى (مُختبَر)
| الوظيفة | الحالة |
|---|---|
| تسجيل: اسم + بريد + جوال، بتوثيق رمزين (بريد ثم جوال) | يعمل |
| دخول بالبريد والجوال معًا ثم رمز واحد لقناة موثَّقة (بلا كلمات مرور) | يعمل |
| مؤسسة مستقلة لكل مسجِّل، عزل كامل بين المؤسسات في الخلفية | يعمل |
| صلاحيات الأدوار (RBAC) مفروضة في الخلفية: 8 أدوار | يعمل |
| العقارات: إضافة/قراءة/تعديل/حذف ناعم، سعر المتر تلقائي، تاريخ أسعار | يعمل |
| استيراد CSV: معاينة، تخمين أعمدة، تنظيف، كشف تكرار، موافقة، تقرير | يعمل |
| **Phase 2:** إدخال عقاري منظم لـ25 نوعًا بحقول تتغير بالنوع، تحقق لكل نوع، وصف تلقائي بلا اختلاق، معاينة قبل النشر، ومسودات | يعمل |
| **Phase 2:** طلبات منظمة (شراء/استئجار/استثمار) بشروط إلزامية أو مفضّلة، ومطابقة ذكية مفسَّرة من البيانات المنظمة | يعمل |
| **Phase 2:** ذكاء سعري وتقدير قيمة من المقارنات، وتحليلات أحياء، وخريطة جدة (عروض، طلبات، أسعار، كثافة، مطابقة)، ومقارنة عقارات | يعمل |
| تصدير CSV محصَّن من حقن الصيغ | يعمل |
| سجل تدقيق للعمليات الحساسة (داخل معاملة العملية نفسها) | يعمل |
| واجهة عربية RTL، جوال أولًا، اختُبرت على 8 مقاسات مع axe | يعمل |

## ما لم يُبنَ بعد (صراحةً)
استيراد Excel (xlsx) · الواجهة الإنجليزية LTR · PWA · خلفية شوارع للخريطة (قرار مزوّد معلّق) · CRM ومستشار الذكاء الاصطناعي (Phase 3) · التقارير والمؤشر والأكاديمية والباقات ولوحة الإدارة (Phase 4) · دعوة أعضاء المؤسسة (الأدوار غير مدير المؤسسة تُسند حاليًا من القاعدة فقط) · تصدير/حذف بيانات الحساب · تنظيف دوري لرموز التحقق.
**أي خدمة خارجية غير مربوطة فعليًا:** البريد (SMTP) ومزوّد الرسائل (SMS) لم يُختبرا أمام مزوّد حقيقي (لا مزوّد محدد بعد). التسجيل العام يبقى مغلقًا (`registration_open=false`) حتى يُربطا.

## التشغيل المحلي
المتطلبات: Node.js 22، وPostgreSQL 16.
```bash
npm ci
cp .env.example .env          # ثم عدّله: DATABASE_URL وAPP_SECRET (openssl rand -hex 32)
# للتجربة المحلية فقط: OTP_DEV_SHOW=true  (تظهر رموز التحقق على الصفحة، ويُتجاهل تلقائيًا على أي رابط غير محلي)
npm run migrate
npm run build && npm start     # http://localhost:3000
```

## الفحوص
```bash
npm run typecheck
npm run test:unit              # 400 فحص (سياسة الرموز، قواعد الاستيراد، الإدخال المنظم، الطلبات والمطابقة والتحليلات، الصلاحيات، بنية الحراس، سلامة الحزمة)
# التكاملي: خادم يعمل + قاعدة فارغة + ADMIN_IDENTIFIERS=admin@test.local + OTP_DEV_SHOW=true
DATABASE_URL=... TEST_APP_URL=http://localhost:3000 npm run test:integration   # 175 فحصًا عبر HTTP
npm audit                      # 0 ثغرات وقت التسليم
```

## الوثائق
`docs/PHASE-1-REPORT.md` (تقرير التسليم والقرارات المنتظرة) · `docs/ARCHITECTURE.md` · `docs/API.md` · `docs/SECURITY.md` · `docs/SECURITY-DEPENDENCIES.md` · `docs/SAUDI-DEPLOYMENT.md`

---

# TAMALAAN DATA (English summary)

A Saudi real-estate data and AI SaaS platform. **Status: Phase 1 of 4.** Working and tested: dual-verified registration (email + SMS codes, no passwords), two-field login with a single code, per-organization tenant isolation, backend RBAC (8 roles), property CRUD with automatic price per m², CSV import wizard (preview, cleaning, duplicate detection, approval, final report), formula-injection-safe CSV export, in-transaction audit log, RTL Arabic UI tested at 8 viewport widths with axe.

**Not built yet:** Excel (xlsx) import, English LTR UI, PWA, analytics/maps (Phase 2), matching/CRM/AI assistant (Phase 3), reports/index/academy/plans/admin (Phase 4), member invitations, account export/delete. **SMTP and SMS adapters are untested against real providers**; public registration stays closed until both are configured.

Quick start: Node 22 + PostgreSQL 16 → `npm ci && cp .env.example .env && npm run migrate && npm run build && npm start`. Dev OTP display works on localhost only and is ignored on any non-local `APP_URL`. Demo numbers on the landing page are static and labelled "demo data".
