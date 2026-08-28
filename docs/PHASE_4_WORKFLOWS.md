# Phase 4A — Workflows & Multi-Agent (سير العمل وتعدد الوكلاء)

## الهدف
نقل Agent IA Factory من تشغيل Agent (وكيل) منفرد إلى Team (فريق) من الوكلاء مع Supervisor (مشرف)، Workers (عمال)، Handoffs (تسليمات)، وShared Team Memory (ذاكرة فريق مشتركة)، مع الحفاظ على الهاتف أولاً والتكلفة الإلزامية 0$.

## Team Model (نموذج الفريق)
كل فريق يحتوي على:
- Supervisor Agent واحد.
- من 1 إلى 6 Worker Agents.
- Workflow Mode: Sequential (تسلسلي) أو Parallel (متوازي).
- Shared Team Memory اختيارية.
- حد أقصى 12 خطوة.
- لا يسمح للمشرف أن يكون Worker في نفس الفريق في Phase 4A.

كل أعضاء الفريق يجب أن يحققوا:
- `maxMonetarySpendUsd = 0`.
- `allowPaid = false`.

أي عضو يخالف Zero-Cost Policy (سياسة التكلفة الصفرية) يمنع Workflow كاملاً.

## Sequential Workflow (سير العمل التسلسلي)
1. المهمة الأصلية تدخل للعامل الأول.
2. العامل ينتج نتيجة محلية.
3. النتيجة تتحول إلى Handoff (تسليم) محدود الحجم.
4. العامل التالي يرى المهمة + التسليم السابق + ذاكرة الفريق إن كانت مفعلة.
5. بعد العمال، Supervisor (المشرف) يستلم نتائجهم ويخرج Final Output (النتيجة النهائية).

## Parallel Workflow (سير العمل المتوازي)
كل Worker (عامل) يستلم المهمة الأصلية بصورة مستقلة، ثم Supervisor يجمع النتائج.

### Phone Safety (سلامة الهاتف)
إذا كان كل العمال يعملون بـLocal Demo الخفيف، يمكن التنفيذ فعلياً عبر `Promise.all`.

إذا كان أي عضو يستعمل Local Qwen/WebGPU:
- يبقى Workflow منطقياً Parallel، لأن العمال لا يعتمدون على مخرجات بعضهم.
- التنفيذ الفيزيائي يتحول إلى `queued_for_phone_safety` (طابور لحماية الهاتف).
- لا نشغّل أكثر من توليد WebGPU ثقيل في اللحظة نفسها على الهاتف.
- الهدف منع ضغط RAM/GPU وتعليق Safari أو فقدان صفحة PWA.

## Supervisor Agent (الوكيل المشرف)
المشرف:
- يستلم المهمة الأصلية.
- يستلم نتائج العمال بعد ضغطها ضمن حدود السياق.
- يجمع النتائج ويعالج التعارضات الواضحة.
- ينتج Final Output.

Phase 4A لا تعطي Supervisor صلاحية استدعاء Tools أو MCP تلقائياً.

## Handoffs (التسليمات)
التسليمات محلية ومحدودة:
- كل Handoff أقصى 1,600 حرف.
- الهدف تمرير خلاصة مفيدة بدون تضخيم السياق.
- تسجل هوية المرسل والمستقبل والتوقيت.

## Shared Team Memory (ذاكرة الفريق المشتركة)
- محفوظة في Browser localStorage (التخزين المحلي للمتصفح).
- أقصى 24 عنصراً لكل فريق.
- أقصى 40 عنصراً إجمالاً في المخزن الحالي.
- كل عنصر أقصى 1,200 حرف.
- سياق الذاكرة الداخل لكل Agent أقصى 6,000 حرف.
- سياق نتائج العمال الداخل للمشرف أقصى 8,000 حرف.
- يمكن مسح ذاكرة الفريق من الهاتف دون حذف الوكلاء.

هذه الذاكرة ليست Cloud Memory (ذاكرة سحابية) ولا ترفع البيانات إلى خدمة خارجية.

## Tool/MCP Isolation (عزل الأدوات وMCP)
في Phase 4A:
- Workflow Engine لا يستورد `toolSdk` لتنفيذ الأدوات.
- لا يستورد `mcpClient` لاستدعاء MCP.
- لا `executeBuiltinTool`.
- لا `callMcpTool`.
- Tool Center وMCP Center يظلان مسارين منفصلين مع Allowlist + Human Approval.

هذا الفصل مقصود. Auto Tool Planner (مخطط الأدوات التلقائي) مرحلة لاحقة ويجب أن يمر بنفس Security Gates الموجودة.

## Limits (الحدود)
- 24 فريقاً محفوظاً على الهاتف.
- 6 Workers لكل فريق.
- 12 خطوة كحد أقصى.
- 40 Workflow Runs محفوظة.
- مخرجات العامل تُضغط قبل Handoff أو دخول Supervisor Context.

## Failure Model (نموذج الفشل)
- Team invalid => Blocked.
- Agent بميزانية غير صفرية => Blocked.
- Worker واحد يفشل مع نجاح آخرين => Workflow قد يصبح Partial (جزئياً).
- Supervisor يفشل بعد نجاح Workers => تبقى نتائج العمال ظاهرة، وحالة Workflow تصبح Partial بدلاً من إخفاء العمل المنجز.
- Local Qwen غير محمل => Runtime نفسه يفشل بأمان ولا يتم التحول إلى API مدفوعة.

## Cost Policy (سياسة التكلفة)
كل Workflow Run يسجل:
- `monetaryCostUsd = 0`.
- لا API مدفوعة.
- لا Workflow SaaS.
- لا Dependency إنتاج جديدة في Phase 4A.

## ما لم نضفه بعد
- Auto Tool Planner.
- Dynamic Supervisor Planning (تخطيط ديناميكي كامل من المشرف).
- Agent-to-Agent A2A network protocol.
- Durable Cloud Jobs.
- Scheduled workflows.
- Visual React Flow canvas.

هذه ستدخل تدريجياً بعد ثبات النواة المحلية واختبارها على الهاتف.

## Acceptance Gates (بوابات القبول)
لا تُدمج Phase 4A إلا إذا نجح:
- Foundation validation.
- Phase 1 zero-cost validation.
- Phase 2 memory validation.
- Phase 3 tool security validation.
- MCP security validation.
- Capability Sandbox validation.
- Phase 4 workflow validation.
- TypeScript + Production Build.
- `npm audit --omit=dev --audit-level=high`.
