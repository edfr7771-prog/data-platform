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

## الطلبات المنظمة والمطابقة (`request:read` / `request:write`)
| المسار | الوصف |
|---|---|
| `GET /api/requests?page&pageSize` | طلبات المؤسسة |
| `POST /api/requests` | `purpose (buy\|rent\|investment), kinds[], city\|city_id, budget_max` إلزامية؛ `district_ids[], district_importance (must\|preferred), budget_min, area_min, area_max, area_importance, rent_period (للاستئجار), criteria {field: {value, importance: must\|preferred\|any}}, notes`. يعيد الطلب مع `description` و`ignored` |
| `POST /api/requests/preview` | نفس المدخلات بلا حفظ: `{description, ignored}` |
| `GET/PATCH/DELETE /api/requests/{id}` | قراءة / تعديل (دمج ثم إعادة تحقق ووصف) / حذف ناعم |
| `GET /api/requests/{id}/matches` | `{considered, total_eligible, excluded:{kind,deal,city,district,budget,area,criterion}, matches:[{property_id, score, reasons[], …}]}`، وتُحفظ لقطة في `matches` |

## التحليلات والخريطة والمقارنة (`analytics:read`؛ بيانات المؤسسة وحدها)
| المسار | الوصف |
|---|---|
| `GET /api/analytics/prices?market=sale\|rent&kind` | `{unit, overall, districts[], trend[]}`؛ كل ملخص `{n, sufficient, median, p25, p75, min, max}` والوسيط `null` إذا `n<3` |
| `GET /api/analytics/districts` | لكل حي: العروض حسب العملية، الطلبات المفتوحة، `demand_supply`، وسيطا البيع والإيجار، أكثر الأنواع |
| `GET /api/properties/{id}/estimate` | `{estimate: {ok:true, level, n, estimate, low, high, comparables} \| {ok:false, reason:"insufficient_data", n_district, n_city}}` |
| `GET /api/map?deal&kind&request_id` | `{bounds, start, offers[], requests[], districts[], heat:{cols,rows,cells}, matching}` |
| `GET /api/compare?ids=a,b[,c,d]` | 2 إلى 4 عقارات؛ 400 `need_2_to_4`، و404 لعقار مؤسسة أخرى |

## الاستيراد
| المسار | الإجراء | الوصف |
|---|---|---|
| `POST /api/imports` (حقل `file`) | `import:run` | يعيد معاينة وتصنيفًا؛ لا يُدخل شيئًا |
| `GET /api/imports/{id}?status&limit` | `import:run` | صفوف الاستيراد |
| `PATCH /api/imports/{id}` `{mapping:{field:colIndex}}` | `import:run` | إعادة التصنيف بتطابق جديد (الأصل لا يُمسّ) |
| `POST /api/imports/{id}/approve` `{include_review?}` | `import:run` | يُدخل ويعيد التقرير؛ مرة واحدة فقط (409 بعدها) |

## أخرى
`GET /api/audit?action=` (`audit:read`، مدير المؤسسة) · `GET /api/health` (عام): `{ok, db, app_url, otp_dev_display, registration_open}`.

## الـCRM (Phase 3؛ مؤسسة صاحب الجلسة فقط)
الإجراءات: `crm:read` (مدير المؤسسة، المحلل، الوسيط، الموظف، المشاهد؛ **لا** المستثمر ولا الطالب لأن بيانات العملاء شخصية)، و`crm:write` (مدير المؤسسة، المحلل، الوسيط، الموظف)، و`crm:manage` (مدير المؤسسة: القنوات والمراحل والدمج). أي معرّف من مؤسسة أخرى = 404.

| المسار | الإجراء | الوصف |
|---|---|---|
| `GET /api/contacts?q&city_id&status&owner_id(\|none)&stage&source&contacted_after&contacted_before&follow_up_due=1&has_request=1&has_match=1&page&pageSize` | `crm:read` | بحث بالاسم أو الجوال أو البريد على كل مدن المؤسسة |
| `POST /api/contacts` | `crm:write` | `name` و(`phone` أو `email`)؛ `type, city_id, district_ids, owner_id, status, notes, next_follow_up_at`. 201 جديد، أو 200 `{deduplicated:true, matched_by:["phone"\|"email"]}` إن طابق عميلًا موجودًا (تُملأ الحقول الفارغة فقط)، أو 409 `identifier_conflict` إن كان الجوال لعميل والبريد لآخر (لا دمج تلقائي) |
| `GET/PATCH /api/contacts/{id}` | قراءة / كتابة | الملف الموحد: `contact, sources[], requests[], matches[], opportunities[], tasks[], messages[], stages[], suggestions{provider:"rules", items[]}, duplicates[]`. `PATCH` 409 `identifier_taken` |
| `GET /api/contacts/{id}/timeline?limit&before` | `crm:read` | الخط الزمني (ترقيم بالوقت) |
| `POST /api/contacts/{id}/calls` | `crm:write` | تسجيل مكالمة يدويًا: `direction (in\|out), outcome (answered\|no_answer\|busy\|callback\|wrong_number), occurred_at, notes, next_step, follow_up_at` (يُنشئ مهمة متابعة) |
| `POST /api/contacts/{id}/notes` `{note}` | `crm:write` | ملاحظة في الخط الزمني |
| `POST /api/contacts/{id}/merge` `{into}` | `crm:manage` | دمج يدوي لملف في آخر (لا دمج تلقائي أبدًا) |
| `POST /api/contacts/import` (حقل `file`) | `crm:write` | معاينة CSV: كل صف `new\|update\|duplicate\|invalid` مع أسبابه؛ لا إدخال |
| `GET /api/contacts/import/{id}` · `POST /api/contacts/import/{id}/approve` | `crm:write` | الموافقة مرة واحدة (409 بعدها)، وتقرير `{created, updated, skipped, problems[]}` |
| `GET /api/opportunities?owner_id&include_closed=1` · `POST /api/opportunities` | قراءة / كتابة | لوحة الـPipeline: `stages[{…, opportunities[]}]` |
| `GET/PATCH /api/opportunities/{id}` `{stage_key\|stage_id, note}` | قراءة / كتابة | نقل بين المراحل مع سجل `opportunity_stage_history`؛ المرحلة `won/lost` تغلق الفرصة |
| `GET /api/crm/stages?archived=1` · `POST /api/crm/stages` `{label}` · `PATCH /api/crm/stages/{id}` `{label\|position\|archived}` | قراءة / `crm:manage` | مراحل قابلة للتوسعة؛ لا أرشفة لمرحلة فيها فرص مفتوحة (409) |
| `PATCH /api/matches/{id}` `{status}` | `crm:write` | حالة متابعة المطابقة: `new, reviewed, sent, interested, not_interested, viewing, negotiation, closed, rejected` (جديد، تمت المراجعة، أُرسل للعميل، مهتم، غير مهتم، موعد معاينة، تفاوض، مغلق، مرفوض). لا يغيّر خوارزمية المطابقة |
| `GET /api/tasks?view=today\|overdue\|upcoming\|done&assignee=me\|all\|{id}&customer_id` · `POST /api/tasks` · `PATCH /api/tasks/{id}` | قراءة / كتابة | العروض بتوقيت الرياض، مع `counts` |
| `GET /api/notifications?unread=1&limit` · `POST /api/notifications/{id}/read` · `POST /api/notifications/read-all` | `crm:read` | تنبيهات داخلية للمستخدم نفسه فقط |
| `POST /api/crm/sweep` | `crm:write` | فحص استحقاق المتابعات والمهام المتأخرة (يجري تلقائيًا أيضًا عند فتح التنبيهات، مرة في الدقيقة لكل منشأة) |
| `GET /api/org/members` | `crm:read` | أعضاء المؤسسة (للإسناد) |
| `GET /api/channels` · `PUT /api/channels/{whatsapp\|email\|web}` | قراءة / `crm:manage` | حالة القنوات الصادقة `connected\|not_connected\|needs_configuration\|error` مع السبب، و`outbound:"disabled"` دائمًا. `PUT`: `{external_id}` (phone_number_id لواتساب، أو عنوان البريد)، أو `{}` لتوليد مفتاح نموذج الويب |

## القنوات الواردة (بلا جلسة؛ `guardWebhook` = حد معدل فقط، والمصادقة بالتوقيع)
| المسار | الوصف |
|---|---|
| `GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token&hub.challenge` | مصافحة Meta؛ يطابق `WHATSAPP_VERIFY_TOKEN` من البيئة |
| `POST /api/webhooks/whatsapp` | جسم WhatsApp Cloud API، وترويسة `X-Hub-Signature-256: sha256=<HMAC(WHATSAPP_APP_SECRET, raw body)>`. 503 `channel_disabled` بلا أسرار مضبوطة، و401 `bad_signature`، و400 لجسم غير صالح. كل رسالة تُعالج مرة واحدة (`channel_events` فريد على المعرّف الخارجي) |
| `POST /api/webhooks/email` | `{message_id, from, to, subject, text, date}`، وترويسة `X-Inbound-Signature: sha256=<HMAC(EMAIL_INBOUND_SECRET, raw body)>` |
| `POST /api/enquiries/public` | `guardPublic`: `{form_key, name, phone\|email, message, consent:true, property_id?, request_id?}`. ينشئ العميل أو يربطه، ويضيف حدثًا وفرصة وتنبيهًا. صفحة النموذج: `/enquire/{form_key}` |
