# واجهة API (Phase 1 + الإدخال المنظم من Phase 2)

كل الطلبات JSON ما عدا رفع الملف (`multipart/form-data`). الطلبات التي تغيّر الحالة تمر بفحص CSRF (متصفح: `Sec-Fetch-Site: same-origin`؛ عميل غير متصفحي: `Origin` بمضيف المنصة). الاستجابات: `{ ok: true, ... }` أو `{ ok: false, error: "code" }`. لا تُخزَّن الاستجابات (`Cache-Control: no-store`).

## المصادقة
| الطريقة والمسار | الحارس | الوصف |
|---|---|---|
| `POST /api/auth/otp/start` | عام | `{mode:"register", name, email, phone, consent:true, marketing?}` أو `{mode:"login", email, phone, channel:"email"\|"sms", consent:true}` → `{challengeId, devCode?}` (`devCode` محليًا فقط) |
| `POST /api/auth/otp/verify` | عام | `{challengeId, code}` → ينشئ الجلسة ويعيد `{complete, next}` |
| `POST /api/auth/complete` | جلسة | `{kind:"phone"\|"email", value}` يرسل رمز القناة الناقصة، ثم يُثبَت عبر `verify` |
| `POST /api/auth/logout` | جلسة | ينهي الجلسة |
| `GET /api/auth/me` | جلسة | المستخدم وحالة الاكتمال |
أخطاء: `consent, email, phone, name, registration_closed(503), channel_unavailable(503), rate_limited/daily_limit/locked(429), delivery_failed(502), invalid(400), expired(410), too_many(429), taken(409)`.

## العقارات (مؤسسة صاحب الجلسة فقط)
| المسار | الإجراء | ملاحظات |
|---|---|---|
| `GET /api/properties?page&pageSize(≤100)&type&deal&district_id&kind` | `property:read` | ترقيم. `deal`: `sale\|rent\|investment`، و`kind` مفتاح النوع التفصيلي |
| `POST /api/properties` | `property:write` | الحقول: `type, deal, area_sqm, price` إلزامية؛ `usage, district\|district_id, city, location, lat, lng, age_years, rooms, street_width_m, facades, status, external_ref, notes`. 201 مع `warnings` و`fixes`، أو 400 `validation` مع `errors` |
| `POST /api/properties` (منظم) | `property:write` | بوجود `kind`: `deal, kind, city\|city_id, district\|district_id, area_sqm, price` إلزامية، و`rent_period` في الإيجار، و`attributes` حسب النوع (انظر `src/lib/property-schema.ts`)، و`ad_license_no, deed_no, location, lat, lng, notes` اختيارية، و`draft_id` لحذف المسودة عند النشر. يعيد العقار مع `kind, attributes, description` |
| `POST /api/properties/preview` | `property:write` | نفس مدخلات الإنشاء المنظم، بلا كتابة: `{description:{title, sections, text}, warnings, fixes, ignored}` أو 400 `validation` |
| `GET/PATCH/DELETE /api/properties/{id}` | قراءة / كتابة / حذف | حذف ناعم. عقار مؤسسة أخرى = 404. في العقار المنظم يدمج `PATCH` الحقول (`attributes` جزئية، و`null` تحذف الحقل) ثم يعيد التحقق وتوليد الوصف |
| `GET /api/properties/export` | `property:export` | CSV محصَّن، ويُسجَّل في التدقيق |

## مسودات الإدخال المنظم (صاحبها وحده داخل مؤسسته، `property:write`)
| المسار | الوصف |
|---|---|
| `GET /api/property-drafts` | مسوداتي (حتى 50) |
| `POST /api/property-drafts` `{data}` | حفظ مسودة ناقصة؛ تُنظَّف المفاتيح وتُقص النصوص. 409 `draft_limit` بعد 50 |
| `GET/PUT/DELETE /api/property-drafts/{id}` | قراءة / تحديث `{data}` / حذف. مسودة غيري = 404 |

## الاستيراد
| المسار | الإجراء | الوصف |
|---|---|---|
| `POST /api/imports` (حقل `file`) | `import:run` | يعيد معاينة وتصنيفًا؛ لا يُدخل شيئًا |
| `GET /api/imports/{id}?status&limit` | `import:run` | صفوف الاستيراد |
| `PATCH /api/imports/{id}` `{mapping:{field:colIndex}}` | `import:run` | إعادة التصنيف بتطابق جديد (الأصل لا يُمسّ) |
| `POST /api/imports/{id}/approve` `{include_review?}` | `import:run` | يُدخل ويعيد التقرير؛ مرة واحدة فقط (409 بعدها) |

## أخرى
`GET /api/audit?action=` (`audit:read`، مدير المؤسسة) · `GET /api/health` (عام): `{ok, db, app_url, otp_dev_display, registration_open}`.
