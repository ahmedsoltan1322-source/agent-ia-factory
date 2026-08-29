# Phase 9B — Self-Host Worker Foundation (أساس العامل ذاتي الاستضافة)

## الهدف

Phase 9B تفصل Control Plane (طبقة التحكم) الموجودة في الهاتف عن Worker Plane (طبقة العامل) عبر Protocol (بروتوكول) محايد وقابل للاستبدال، من دون فرض Cloud (سحابة) أو خادم مدفوع.

المسار المرجعي الحالي:

`Phone PWA → Manual Worker Bundle → Reference Node Worker → Manual Worker Receipt → Durable Queue`

هذا **Offline File Transport (نقل يدوي بملف)** لإثبات الحدود والبروتوكول end-to-end، وليس Network Authentication (مصادقة شبكية) ولا خدمة خلفية دائمة.

## Worker Protocol (بروتوكول العامل)

الإصدار الحالي:

`agent-ia-factory.worker/0.1`

الـReference Worker (العامل المرجعي):
- Worker ID: `portable-node-worker`.
- Transport: `offline-file` فقط.
- Runtime Adapter: `local-demo` فقط.
- Concurrency: Job واحدة.
- `allowPaid=false`.
- `maxMonetarySpendUsd=0`.
- `automaticNetwork=false`.
- `automaticToolExecution=false`.
- `requiresHumanTransfer=true`.

أي تغيير في هذه الحدود يُرفض Fail-Closed (بفشل آمن).

## Portable Worker Bundle (حزمة العامل القابلة للنقل)

الحزمة تحتوي فقط على Projection (إسقاط) صريح للحقول اللازمة:
- Worker Manifest.
- Durable Job المحجوزة.
- Agent Spec المنظفة.
- Lease Token المؤقت.
- تاريخ إنشاء وانتهاء مربوطان مباشرة بالـLease.

قواعد القبول:
- Job يجب أن تكون `agent_run`.
- Job يجب أن تكون `leased`.
- Worker ID في Lease يجب أن يطابق Manifest.
- Tenant ID يجب أن يطابق في كل الطبقات.
- Agent ID يجب أن يطابق Payload.
- Runtime يجب أن يكون `local-demo` في Reference Worker.
- Tool allowlist يجب أن تكون فارغة وDefault Action = deny.
- أي Monetary Cost غير 0 مرفوضة.
- Extra Fields (حقول إضافية) في Envelope/Manifest مرفوضة بدل تجاهلها.
- Bundle منتهية الصلاحية مرفوضة.

Bundle ملف حساس لأنه يحمل Task وLease Token. لا يُرفع تلقائيًا ولا يُزامن.

## Reference Worker (العامل المرجعي)

`scripts/run-reference-worker.mjs`

هو CLI (مشغّل سطر أوامر) بلا Production Dependency جديدة. يقرأ Bundle من ملف محلي، يتحقق منها، ثم يشغّل `LocalDemoRuntimeAdapter` ويكتب Worker Receipt.

الهدف منه إثبات Worker Execution Path (مسار تنفيذ العامل) فعليًا من البداية للنهاية، مع التصريح الواضح أن `local-demo` Runtime حتمي وتجريبي ولا يدّعي أنه LLM.

Reference Worker لا يستعمل:
- `fetch`.
- WebSocket.
- MCP.
- Browser Automation.
- Tool Execution.
- Paid API.
- Credentials.

## Worker Receipt (إيصال العامل)

Receipt تحتوي:
- Bundle ID.
- Tenant ID.
- Worker ID.
- Job ID.
- Lease Token.
- Run Record (سجل التشغيل).
- `monetaryCostUsd=0`.
- `automaticNetworkUsed=false`.
- `automaticToolExecutionUsed=false`.

عند الاستيراد من الهاتف تُطابق مع Durable Job الحالية:
- Tenant.
- Worker.
- Job.
- Lease Token.
- Agent ID.
- Task.

ثم فقط يتم إغلاق Lease وتسجيل Run محليًا.

## Lease Expiry (انتهاء الحجز)

Phase 9B تشدد قاعدة مهمة للتوزيع:
- Completion (إغلاق المهمة) بعد انتهاء Lease يُرفض حتى لو كان Token صحيحًا.
- Heartbeat/Renewal (نبضة/تجديد) متاح داخل Core مع نفس Token.
- Renewal لا يزيد Attempts.
- Renewal بعد انتهاء Lease يُرفض.
- مدة كل Lease/Renewal تبقى محدودة بحد أقصى 5 دقائق.

Offline File Transport لا يرسل Heartbeat تلقائيًا. لذلك Bundle المرجعية يجب أن تُنفذ وتُستورد قبل انتهاء Lease. Network Worker اللاحق سيستعمل Heartbeat عبر Transport Adapter منفصل.

## Phone-First UX (تجربة الهاتف أولًا)

من واجهة Phase 9B:
1. المستخدم ينشئ Durable Job في Phase 9A.
2. زر Prepare Worker Bundle يفحص Job التالية قبل Claim.
3. إذا كانت Workflow أو Agent غير متوافق، لا يتم Claim أي شيء.
4. إذا كانت متوافقة، تُحجز لـ`portable-node-worker` حتى 5 دقائق ويُنزل ملف Bundle يدويًا.
5. Worker خارجي ينتج Receipt.
6. المستخدم يستورد Receipt يدويًا.
7. الهاتف يرفض Receipt إذا انتهى Lease أو اختلفت الهوية أو السياسات.

لا يوجد Background Worker دائم داخل iPhone في 9B.

## Security Boundary (حد الأمان)

Offline File Transport ليس Authentication (مصادقة). امتلاك Bundle يعني امتلاك Lease Token المؤقت. لذلك:
- Bundle وReceipt ملفات حساسة.
- النقل يدوي فقط.
- لا URL يحتوي Token.
- لا GitHub Secret.
- لا تخزين Credentials في المشروع.
- لا Auto Upload.

Phase 9C ستضيف Transport/Auth Adapter (موصل النقل والمصادقة) منفصلًا، بحيث يبقى Worker Protocol نفسه محايدًا وقابلًا للاستبدال.

## Acceptance (معايير القبول)

Phase 9B لا تُقبل إلا إذا نجحت:
1. Phase 0→9B validators.
2. TypeScript + Production Build.
3. Phase 8 regression smoke.
4. Phase 9A durable queue smoke.
5. Worker Bundle schema tests.
6. Extra-field rejection tests.
7. Reference Worker `local-demo` execution.
8. Worker Receipt binding tests.
9. Expired-lease completion rejection.
10. Heartbeat renewal + expired-heartbeat rejection.
11. CLI file Bundle → Receipt end-to-end test.
12. Production dependency audit.
13. Full dependency audit.
14. Phase 7A real Chrome smoke على نفس PR.
15. New production dependencies = 0.
16. Mandatory additional spend = 0 USD.

## ما لا تدعيه Phase 9B

- لا Public Server فعلي.
- لا HTTPS API للعامل بعد.
- لا Authentication شبكية بعد.
- لا Worker دائم على الهاتف.
- لا Local LLM على Node Worker بعد.
- لا Workflow Worker بعد.
- لا High Availability.

هذه القدرات تأتي في Adapters لاحقة من دون كسر Zero-Cost Core أو ربط المصنع بمزوّد واحد.
