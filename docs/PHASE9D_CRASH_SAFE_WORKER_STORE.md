# Phase 9D — Crash-Safe Durable Worker Store (تخزين العامل المتين ضد الانقطاع)

## الهدف

Phase 9D تكمل Self-Host Options (خيارات الاستضافة الذاتية) في Phase 9 بإزالة اعتماد Worker Idempotency (منع التكرار) على ذاكرة Process (العملية) فقط.

Phase 9C كانت تعيد نفس Receipt (الإيصال) ما دام نفس Worker Process حيًا. Phase 9D تضيف Durable Reservation + Durable Receipt (حجزًا وإيصالًا متينين) على القرص بحيث تبقى حالة Bundle معروفة بعد Restart (إعادة تشغيل العامل).

المسار:

`Signed Bundle → Atomic Reserve on Disk → Execute once automatically → Atomic Receipt Commit → Signed Response`

وعند Restart:

`Same Bundle → Durable Record → Completed? return same Receipt : Reserved? return Uncertain and DO NOT execute`

## القاعدة الأمنية الأساسية

Phase 9D لا تدعي Exactly-Once (تنفيذ مرة واحدة تمامًا) في جميع حالات الانقطاع.

بدل الادعاء الزائف تعتمد القاعدة التالية:

1. قبل تشغيل Reference Worker يجب إنشاء Durable Reservation (حجز متين) بنجاح.
2. إذا كان السجل `completed` تُعاد Receipt المحفوظة ولا تُنفذ المهمة من جديد.
3. إذا كان السجل `reserved` بلا Receipt، فالحالة غير محسومة: قد يكون العامل السابق نفّذ ثم تعطل قبل حفظ الإيصال.
4. لذلك Worker الجديد يُرجع `WORKER_SERVER_UNCERTAIN_EXECUTION` ولا يعيد التنفيذ تلقائيًا.
5. Corruption (تلف السجل)، Bundle Digest conflict (تعارض بصمة الحزمة)، أو فشل Durable Commit كلها Fail-Closed (تفشل بأمان).

هذا يحقق At-Most-Once Automatic Execution after durable reservation (عدم إعادة التنفيذ تلقائيًا بعد تسجيل الحجز) ويمنع Duplicate Side Effects (الآثار الخارجية المكررة) عندما نضيفها في مراحل لاحقة.

## Durable Record (السجل المتين)

الإصدار:

`agent-ia-factory.worker-store/0.1`

كل Bundle تملك ملفًا مستقلًا اسمه SHA-256 لـBundle ID بدل استخدام ID نفسه كمسار ملف. هذا يمنع Path Traversal (التلاعب بالمسار) ويحافظ على قابلية النقل بين أنظمة الملفات.

السجل يحفظ فقط:
- Bundle ID.
- Tenant ID.
- SHA-256 Body Digest الذي كان داخل Signed Request.
- Lease expiry.
- `reserved` أو `completed`.
- reservedAt.
- completedAt عند النجاح.
- Receipt body عند النجاح.

لا يحفظ Pairing Secret (سر الاقتران).

ملاحظة خصوصية: Receipt قد تحتوي Task/Output الخاصة بـRun، لذلك State Directory (مجلد الحالة) ملف حساس ويجب حمايته مثل Backup (النسخة الاحتياطية).

## Atomic Persistence (الحفظ الذرّي)

Reference Filesystem Store يستخدم Node standard library فقط:
- Directory mode المطلوب عند الإنشاء: `0700`.
- Record file mode: `0600`.
- Reservation تُنشأ بـexclusive create (`wx`) حتى لا يستطيع طلبان إنشاء الحجز نفسه في الوقت ذاته.
- Completion تكتب أولًا إلى Temporary File (ملف مؤقت) حصري.
- Temporary File يتم `fsync` له.
- ثم `rename` ذرّي فوق سجل reservation.
- ثم directory `fsync`.
- أي فشل أثناء commit لا يؤدي إلى اعتبار المهمة Completed.

لا Production Dependency جديدة.

## Bundle Binding (ربط الحزمة)

السجل مربوط بـ:
- Bundle ID.
- Tenant ID.
- Signed body SHA-256 digest.
- Lease expiry.

إذا وصل Bundle ID نفسه مع Body Digest مختلف، يرفض Store بـ`WORKER_STORE_BUNDLE_CONFLICT`.

إذا اختلف Lease لنفس Bundle، يرفض بـ`WORKER_STORE_LEASE_CONFLICT`.

لا يوجد Merge أو Guess (تخمين) عند التعارض.

## Crash Windows (نوافذ الانقطاع)

### قبل Durable Reservation
لم يبدأ التنفيذ. يمكن للعميل المحاولة لاحقًا وفق قواعد Transport (النقل).

### بعد Reservation وقبل Execution
السجل يبقى `reserved`. بعد Restart لا نعرف آليًا إن بدأ التنفيذ أم لا، لذلك لا نعيد التنفيذ.

### أثناء Execution
إذا انطفأ العامل، السجل يبقى `reserved`. بعد Restart = Uncertain، لا إعادة تنفيذ.

### بعد Execution وقبل Durable Receipt Commit
هذه أخطر نافذة: التنفيذ ربما تم لكن الإيصال لم يُحفظ. لذلك السجل يبقى `reserved` ويمنع إعادة التنفيذ.

### بعد Durable Receipt Commit وقبل HTTP Response
العميل قد لا يرى الرد، لكنه يستطيع Retry Same Bundle يدويًا. العامل بعد Restart يعيد نفس Receipt من القرص.

## Garbage Collection (تنظيف السجلات)

- السجلات مرتبطة بعمر Lease.
- السجل المنتهي يمكن حذفه عند عمليات Store لاحقة.
- الحد الأقصى الحالي: 1000 سجل حي.
- تجاوز الحد يفشل بأمان بدل نمو القرص بلا حد.
- الملفات غير المطابقة لاسم Record الرسمي لا تُعامل كسجلات صالحة.
- سجل رسمي تالف لا يتم تجاهله؛ Store يرفض العمل Fail-Closed حتى يُراجع التخزين.

## Reference Worker Server

`scripts/worker-server.mjs` أصبح يتطلب:

`AGENT_IA_WORKER_STATE_DIR`

إضافة إلى متغيرات Phase 9C:
- `AGENT_IA_WORKER_SECRET_B64URL`
- `AGENT_IA_ALLOWED_ORIGIN`
- `AGENT_IA_TENANT_ID`
- `AGENT_IA_LISTEN_PORT`
- `AGENT_IA_MAX_REQUESTS_PER_MINUTE`

الخادم المرجعي لن يبدأ دون State Directory صريح.

يبقى:
- bound إلى `127.0.0.1` فقط.
- يحتاج HTTPS Reverse Proxy للتعرض البعيد.
- HMAC/Nonce/Replay/CORS من Phase 9C كما هي.
- Reference Runtime = `local-demo` فقط.
- Remote Tools/Browser/LLM side effects ما زالت ممنوعة.

## Security Boundary (حد الأمان)

Phase 9D لا تضيف:
- Cloud database.
- Redis.
- PostgreSQL requirement.
- Managed queue.
- Paid storage.
- Remote tool execution.
- Automatic recovery that guesses execution state.
- Secret persistence.

Filesystem Store هو Reference Adapter (موصل مرجعي) فقط. Contract في Server Core يسمح لاحقًا باستبداله بـSQLite/PostgreSQL أو Store آخر دون تغيير Phone Transport.

## Acceptance (القبول)

لا تُقبل Phase 9D إلا إذا نجحت:
1. Phase 0→9D validators + TypeScript + Production Build.
2. Phase 8 regression smoke.
3. Phase 9A durable queue smoke.
4. Phase 9B portable worker smoke.
5. Phase 9C authenticated transport smoke.
6. Durable reservation قبل execution.
7. Atomic completed receipt persistence.
8. Full Node Worker Server restart على نفس State Directory.
9. Same Bundle بعد Restart يعيد نفس Receipt ونفس Run ID.
10. Reserved-without-Receipt بعد simulated crash يُرفض كـUncertain ولا يُنفذ.
11. Bundle digest conflict rejection.
12. Corrupt record rejection Fail-Closed.
13. Record permission test = `0600` على Linux CI.
14. Pairing Secret غير موجود في durable record.
15. Production dependency audit.
16. Full dependency audit.
17. Phase 7A real Chrome smoke on the same PR.
18. New production dependencies = 0.
19. Mandatory additional spend = 0 USD.

## ما لا تدعيه Phase 9D

- لا Exactly-Once مطلق عبر كل أنواع الأعطال.
- لا نحدد تلقائيًا هل `reserved` نفذ فعليًا قبل Crash؛ لذلك الحالة Uncertain.
- لا Multi-tenant shared database بعد؛ Worker config ما زالت Tenant واحدة.
- لا Side-Effecting Remote Runtime بعد.
- لا Managed Cloud مطلوب.

هذه الحدود مقصودة. عند الشك لا نعيد التنفيذ، لأن منع الفعل المكرر أهم من ادعاء نجاح غير مثبت.