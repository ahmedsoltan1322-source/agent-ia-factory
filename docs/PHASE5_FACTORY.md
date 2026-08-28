# Phase 5 — Agent Factory (مصنع الوكلاء)

## الهدف

تحويل Goal (هدف) مكتوب بالعربية إلى Blueprint (مخطط) فريق قابل للمراجعة، ثم إنشاء Agents (وكلاء) وWorkflow (سير عمل) فقط بعد Human Approval (موافقة بشرية) صريحة.

## Planner (المخطط)

النسخة الحالية Deterministic + Local (حتمية ومحلية):
- لا API مدفوع.
- لا إرسال للهدف إلى خادم خارجي.
- لا تشغيل Agent أثناء التخطيط.
- لا Tool/MCP أثناء التخطيط.
- تصنيف تقريبي للهدف إلى: software / research-content / support / business-ops / general.
- 2–6 أدوار فقط.
- Reviewer/QA (مراجع/جودة) إلزامي في كل Blueprint.

## Blueprint Policy (سياسة المخطط)

ثوابت لا يجوز تجاوزها:
- `maxMonetarySpendUsd = 0`.
- `allowPaidModels = false`.
- `enableSuggestedToolsAutomatically = false`.
- `automaticExecutionAfterInstall = false`.
- `humanApprovalRequiredToInstall = true`.
- الأدوات المقترحة Advisory Only (اقتراح فقط).

## Safe Compilation (التحويل الآمن)

قبل التثبيت:
1. كل دور يتحول إلى Agent عبر `createDefaultAgent`.
2. Runtime يبقى محليًا فقط.
3. `allowedTools = []` لكل Agent جديد.
4. Tool default = deny.
5. Financial actions = deny.
6. Evaluation/Security gates تبقى مطلوبة.
7. Workflow يبنى عبر `buildLinearTeamWorkflow`.
8. Workflow يمر عبر `validateWorkflowDefinition`.
9. Approval بين الوكلاء مفعلة في هذا baseline.

## Human Approval (الموافقة البشرية)

لا يسمح `installFactoryBlueprint` بالتثبيت إلا إذا `approvedByHuman === true`.

الموافقة تعني فقط:
- حفظ الوكلاء محليًا.
- حفظ Workflow محليًا.

ولا تعني:
- تشغيل الوكلاء.
- تشغيل Workflow.
- تفعيل Tool.
- استدعاء MCP.
- إرسال/حذف/شراء/نشر.

## Rollback (التراجع)

إذا فشل التثبيت في المنتصف، يحاول المصنع حذف Agents التي أنشأها في نفس العملية وحذف Workflow إن تم حفظه، ثم يسجل `install_failed` في Factory Audit.

## Audit (التدقيق)

يسجل محليًا:
- planned.
- validated.
- installed.
- install_failed.

وكل سجل يحمل `monetaryCostUsd = 0`.

## Phase 4B compatibility

Phase 5 لا تستبدل DAG Workflows ولا Supervisor Teams. هي طبقة إنشاء فوق البنية الحالية. بعد التثبيت يستطيع المستخدم اختيار تشغيل الـWorkflow أو تكوين Supervisor Team يدويًا، لكن لا يحدث أي تشغيل تلقائي.

## حدود مقصودة

- لا LLM planner بعد.
- لا Auto Tool Builder بعد.
- لا Auto Repair loop بعد.
- لا تنفيذ تلقائي بعد التثبيت.

هذه الحدود مقصودة لتثبيت Baseline قابل للاختبار قبل إضافة ذكاء تخطيط أعلى في Phase 5B.
