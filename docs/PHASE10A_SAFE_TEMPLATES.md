# Phase 10A — Agent Templates & Safe Import/Export (قوالب الوكلاء والاستيراد/التصدير الآمن)

## الهدف

Phase 10A تبدأ Ecosystem (النظام البيئي) بصيغة Template Package (حزمة قالب) محايدة يمكن تصديرها من Factory Blueprint ومشاركتها ثم استيرادها على جهاز آخر دون أن يصبح فتح الملف أو استيراده مسار تنفيذ.

المسار المقصود:

`Factory Blueprint → Template Package → SHA-256 Integrity → Import Preview → Blueprint Validation → Human-Approved Install`

ولا يوجد:

`Import → Auto Install → Auto Run`

## البروتوكول

الإصدار الأول:

`agent-ia-factory.template/0.1`

النوع:

`agent-template`

الحزمة تحتوي فقط على وصف قابل للنقل:
- Template ID.
- SemVer (إصدار القالب).
- الاسم والوصف.
- Goal (الهدف).
- Domain (المجال).
- Runtime Adapter من القائمة الصفرية الحالية فقط.
- Team Name.
- Roles (الأدوار).
- Suggested Tool IDs (أدوات مقترحة فقط).
- Acceptance Tests (اختبارات القبول).
- Workflow policy.
- Zero-Cost / Human-Approval policy.
- Export timestamp.
- SHA-256 integrity digest.

لا تحمل:
- Blueprint runtime ID القديم.
- `installed` state.
- Agent runtime IDs القديمة.
- Workflow runtime ID قديم.
- Run history.
- Memory/Knowledge content.
- Secrets/Tokens/Credentials.

## Integrity (سلامة المحتوى)

قبل Export، المصنع يبني Canonical JSON (JSON حتميًا مرتب المفاتيح) ثم يحسب SHA-256 على كل الحزمة ما عدا حقل Integrity نفسه.

Digest يُحفظ بصيغة Base64URL بطول SHA-256 المعروف.

عند Import:
1. فحص الحجم أولًا.
2. JSON parsing.
3. Exact-field validation لكل مستوى.
4. فحص الحدود والأنواع والسياسات.
5. إعادة حساب Canonical SHA-256.
6. المقارنة مع Digest المرفق.
7. عند اختلاف حرف واحد: `TEMPLATE_INTEGRITY_MISMATCH`.

ترتيب مفاتيح JSON لا يغير هوية المحتوى لأن Canonicalization ترتب المفاتيح قبل الحساب.

## Integrity ليست Publisher Trust

SHA-256 يجيب عن سؤال:

> هل هذا هو نفس المحتوى الذي حُسبت له هذه البصمة؟

ولا يجيب عن سؤال:

> من نشر هذا القالب وهل أثق به؟

لذلك Phase 10A **لا تعتبر القالب موثوقًا لمجرد نجاح SHA-256**.

Publisher Signature / Repository provenance / Community Trust ستأتي في مراحل Ecosystem لاحقة، وستبقى منفصلة عن Content Integrity.

## Exact Fields (الحقول المحددة فقط)

كل Object داخل الحزمة يملك Allowlist (قائمة سماح) للحقول.

حقول مثل:
- `autoRun`
- `token`
- `hiddenTool`
- `remoteEndpoint`
- أي property غير معرفة

تُرفض بدل تجاهلها.

السبب: تجاهل الحقول غير المعروفة قد يسمح اليوم بملف “آمن” ثم يصبح الحقل نفسه ذا معنى خطير في إصدار مستقبلي.

## Zero-Cost & Tool Safety

Package Policy يجب أن تكون حرفيًا:
- `maxMonetarySpendUsd = 0`
- `allowPaidModels = false`
- `enableSuggestedToolsAutomatically = false`
- `automaticExecutionAfterInstall = false`
- `humanApprovalRequiredToInstall = true`

Suggested Tool IDs تبقى **advisory only (اقتراحية فقط)**.

عند تحويل Template إلى Blueprint ثم Install:
- Agent Tools تبدأ `defaultAction=deny`.
- `allowedTools=[]`.
- Paid Models ممنوعة.
- max monetary spend = 0.
- Workflow لا يبدأ تلقائيًا.

أي Package تحاول تغيير هذه الحدود تُرفض قبل Integrity acceptance النهائي.

## Import Preview (معاينة الاستيراد)

اختيار الملف من الهاتف:
- لا يحفظ القالب تلقائيًا.
- لا ينشئ Agent.
- لا ينشئ Workflow.
- لا يشغّل Run.
- لا يفعل Tool/MCP.
- لا يجلب شيئًا من الشبكة.

بعد تحقق SHA-256 يظهر Preview يحتوي:
- الاسم والإصدار.
- Runtime.
- عدد الأدوار.
- Suggested Tools بوضوح أنها غير مفعلة.
- 0$ mandatory spend.

يوجد خيار بشري منفصل لحفظه كـVerified Blueprint فقط.

## Human-Approved Install

التثبيت يحتاج Checkbox صريح ثم زر Install.

الواجهة تستدعي `installFactoryBlueprint(blueprint, true)` الموجودة من Phase 5، وبالتالي تستفيد من نفس Compiler/Validator/Rollback.

`installFactoryBlueprint(..., false)` يبقى مرفوضًا بـ`FACTORY_HUMAN_APPROVAL_REQUIRED`.

بعد التثبيت:
- الوكلاء موجودون في Registry.
- Workflow موجود لكنه غير مشغّل.
- Tools غير مفعلة.
- لا Run يُنشأ تلقائيًا.

## Limits (الحدود)

- Maximum JSON size: 160,000 chars.
- Roles: 2–6.
- Suggested tools: ≤12 لكل Role.
- Role instructions: ≤4,000 chars.
- Acceptance tests: 5–10.
- Runtime: `local-demo` أو `local-qwen-webgpu` فقط.
- Package SemVer مطلوب.
- Control characters الخطرة في النصوص مرفوضة.

## ما لا تفعله Phase 10A

- لا Community Network Fetch.
- لا Marketplace install-by-URL.
- لا Publisher signatures بعد.
- لا Reputation score.
- لا Remote Plugin code داخل Template.
- لا Tool binaries أو JavaScript داخل Package.
- لا Auto-update للقوالب.
- لا Auto-install.
- لا Auto-run.

هذه الأشياء ستأتي كطبقات Ecosystem منفصلة حتى لا تصبح حزمة القالب قناة تنفيذ مخفية.

## Acceptance (القبول)

لا تُقبل Phase 10A إلا إذا نجحت:
1. Phase 0→10A validators + TypeScript + Production Build.
2. Phase 8 regression smoke.
3. Phase 9A/9B/9C/9D regression smoke.
4. إنشاء Template من Factory Blueprint صالح.
5. Canonical SHA-256 verification.
6. JSON key reordering يبقى صالحًا للمحتوى نفسه.
7. Content tampering يُرفض.
8. Top-level/nested extra-field injection يُرفض.
9. Paid policy injection يُرفض.
10. Automatic-tool policy injection يُرفض.
11. Import Preview لا يغير Storage ولا ينشئ Agent/Run.
12. Install without Human Approval يُرفض.
13. Human-approved install ينشئ Agents بTools denied و0$ ولا ينشئ Run.
14. Production dependency audit.
15. Full dependency audit.
16. Phase 7A real Chrome smoke on the same PR.
17. New production dependencies = 0.
18. Mandatory additional spend = 0 USD.