# Phase 9A — Deployment & Scale (النشر والتوسع)

## الهدف

Phase 9A تبني Deployment Foundation (أساس النشر) من دون تحويل Agent IA Factory إلى خدمة مدفوعة أو إضافة خادم إلزامي.

الوضع الحالي:

`Phone PWA → Local Durable Queue → Human Start → Lease/Retry Evidence → Local Backup`

هذه مرحلة **Phone-Local Baseline (خط أساس محلي على الهاتف)** وليست ادعاء Multi-Tenant Runtime (تشغيل متعدد المستخدمين) كامل.

## Durable Jobs (المهام القابلة للاستئناف)

كل Job تحمل:
- `tenantId` صريحًا.
- `idempotencyKey` لمنع التكرار.
- State Machine (آلة حالات): `pending → leased → succeeded` أو `retry_wait / failed / cancelled`.
- Attempts (المحاولات) محدودة: افتراضيًا 3 وبحد أقصى 5.
- Lease (حجز) بمدة محدودة وToken (رمز حجز) يجب مطابقته عند الإغلاق.
- Expired Lease (حجز منتهي) يُستعاد بصورة حتمية إلى Retry أو Failed.
- `requiresHumanStart=true` دائمًا في Phase 9A.
- `monetaryCostUsd=0` دائمًا.

لا يوجد Auto-Execution (تشغيل تلقائي) للـAgent أو Workflow في 9A. Queue تحفظ نية التشغيل وحالته بحيث لا تضيع عند Refresh (إعادة تحميل الصفحة)، لكن بدء التنفيذ الفعلي يبقى خطوة بشرية منفصلة.

## Idempotency (منع التكرار)

الزوج:

`tenantId + idempotencyKey`

يمنع إنشاء Job ثانية لنفس الطلب غير الملغى. هذا مهم عند إعادة الضغط أو إعادة تحميل الهاتف.

## Tenant Boundary (حدود مساحة المستخدم)

- الوضع الحالي يستخدم `local-owner` فقط.
- كل Job وRate Event (حدث حد استخدام) تحمل Tenant ID.
- Claim (الحجز) لا يستطيع أخذ Job من Tenant أخرى.
- هذا يجعل Data Model (نموذج البيانات) جاهزًا لفصل المستخدمين لاحقًا.

لكن Phase 9A **لا تدّعي** وجود Authentication/Multi-Tenant Server فعلي. ذلك يحتاج Worker/Server Adapter (موصل عامل/خادم) في مرحلة لاحقة.

## Rate Limits (حدود الاستخدام)

الحدود المحلية الافتراضية:
- Enqueue: 20 Job خلال 5 دقائق لكل Tenant.
- Claim: 10 عمليات حجز في الدقيقة لكل Tenant.

عند تجاوز الحد يتم Fail Closed (فشل مغلق) مع `retryAfterMs`، ولا يبدأ مسار بديل خفي.

## Backup / Restore (نسخ احتياطي / استعادة)

Backup المحلي:
- يقرأ فقط مفاتيح `agent-ia-factory.*`.
- يستبعد أي Storage Key (مفتاح تخزين) يحتوي اسمًا مثل secret/token/password/credential/authorization/cookie/sessionid.
- حد أقصى 100 Entry (مدخل).
- حد أقصى 750,000 حرف لكل قيمة.
- حد أقصى 4,000,000 حرف للنسخة.
- لا Upload (رفع) ولا Sync (مزامنة) تلقائي.

الـExport (التصدير) يستطيع أرشفة مفاتيح المصنع المسموحة، ولذلك قد يحتوي Agents/Memory/Knowledge/Logs ويجب معاملته كملف حساس.

أما Restore (الاستعادة) في Phase 9A فهي **Conservative Restore (استعادة محافظة)**:
- الوضع الافتراضي Merge (دمج).
- لا تُحقن كل قيم Backup في `localStorage` لمجرد أن اسم المفتاح يبدأ بـ`agent-ia-factory.*`.
- تُستعاد تلقائيًا فقط مفاتيح Deployment المعروفة: Durable Jobs وRate Events.
- يتم JSON Parse ثم Schema/Invariant Validation لكل Job/Event قبل الكتابة.
- أي بيانات أرشيفية أخرى تبقى داخل ملف Backup فقط إلى أن تملك وحدتها Restore Validator (فاحص استعادة) خاصًا بها.

هذا يمنع Backup معدلًا من حقن Agent/Policy غير متحقق منه في وحدات أقدم لا تملك Validation كاملًا عند القراءة.

## Storage Adapter Boundary (حد موصل التخزين)

`deploymentEngine.ts` Pure (حتمي بلا تخزين أو شبكة).

`deploymentStorage.ts` هو Phone Adapter (موصل الهاتف) الحالي باستخدام `localStorage` بحدود صغيرة.

هذا يسمح لاحقًا بإضافة Self-Host Adapter (موصل استضافة ذاتية) مثل SQLite/PostgreSQL/Queue مفتوحة المصدر من دون تغيير قواعد:
- Idempotency.
- Lease.
- Retry.
- Rate Limit.
- Tenant Isolation.
- Zero-Cost policy.

## Security (الأمان)

Phase 9A تمنع داخل Engine:
- Network primitives (بدائيات الشبكة).
- MCP/Tool execution (تنفيذ MCP/الأدوات).
- Browser execution (تشغيل المتصفح).
- Paid execution (تنفيذ مدفوع).

وتمثل Queue كـControl Plane (طبقة تحكم) فقط في هذه المرحلة.

## Acceptance (القبول)

لا تُقبل Phase 9A إلا إذا نجحت:
1. Phase 0→9A validators.
2. TypeScript + Production Build.
3. Durable Queue Smoke Test حقيقي على Node 24.
4. Idempotency test.
5. Tenant isolation test.
6. Lease token + retry test.
7. Expired lease recovery test.
8. Rate-limit fail-closed test.
9. Production dependency audit.
10. Full dependency audit.
11. Phase 7A real Chrome smoke على نفس PR.
12. Mandatory additional spend = 0 USD.

## ما لا تدعيه 9A

- لا Multi-Tenant server فعلي بعد.
- لا background worker دائم على الهاتف.
- لا High Availability (توفر عالٍ).
- لا Database cluster (عنقود قاعدة بيانات).
- لا Auto-Deployment (نشر تلقائي).
- لا Full Factory Restore لكل الوحدات قبل إضافة Validators خاصة بها.

هذه القدرات تُضاف عبر Replaceable Adapters (موصلات قابلة للاستبدال) مع بقاء Core (النواة) محايدة ومجانية افتراضيًا.
