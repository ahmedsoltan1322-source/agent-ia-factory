# Phase 4B — Supervisor Teams (فرق بإشراف وكيل)

## لماذا Phase 4B؟
Phase 4A المندمجة عبر PR #14 وفرت DAG Workflows (سير عمل شبكي)، Checkpoints (نقاط حفظ)، Resume (استئناف)، وHuman Approval Nodes (عقد موافقة بشرية). Phase 4B لا تستبدلها؛ بل تضيف نمطاً آخر مكملاً للمهام التي تستفيد من عدة Workers (عمال) مستقلين ثم Supervisor (مشرف) يجمع النتائج.

## النمط الجديد
كل Supervisor Team يحتوي على:
- Supervisor Agent واحد.
- 1–6 Worker Agents.
- Sequential أو Parallel execution mode.
- Shared Team Memory اختيارية.
- كل عضو يجب أن يملك `maxMonetarySpendUsd = 0` و`allowPaid = false`.

## Parallel Fan-out / Fan-in (التفرع والتجميع المتوازي)
في Parallel:
1. كل Worker يستلم المهمة الأصلية بصورة مستقلة.
2. العمال لا يستلمون مخرجات بعضهم أثناء Fan-out.
3. بعد انتهاء العمال، النتائج المحدودة الحجم تتجمع عند Supervisor.
4. Supervisor يخرج Final Output.

هذا يختلف عن DAG التسلسلي الموجود، ويعطي المصنع نمط بحث/مراجعة متعدد الآراء دون حذف Checkpoint workflow.

## Phone Safety (سلامة الهاتف)
تشغيل عدة توليدات Qwen/WebGPU في اللحظة نفسها على هاتف واحد قد يضغط GPU/RAM والمتصفح.

لذلك:
- إذا كان جميع Workers على Local Demo الخفيف: التنفيذ Parallel فعلي عبر `Promise.all`.
- إذا وجد Worker واحد على `local-qwen-webgpu`: يبقى التفرع منطقياً Parallel، لكن التنفيذ الفيزيائي يتحول إلى `queued_for_phone_safety`.
- Supervisor يعمل بعد اكتمال Workers، لذلك لا يتزامن مع Fan-out.

هذا قرار معماري متعمد؛ الجودة والاستقرار أهم من ادعاء توازٍ قد يعلق Safari.

## Shared Team Memory (ذاكرة الفريق المشتركة)
- Local Storage فقط.
- أقصى 24 عنصراً لكل Team.
- 120 عنصراً إجمالاً لكل Supervisor Teams في المخزن الحالي.
- كل عنصر <=1,200 حرف.
- Shared context <=5,000 حرف.
- Worker result داخل Supervisor context <=1,400 حرف لكل Worker.
- Supervisor evidence context <=8,000 حرف.
- يمكن مسح الذاكرة من الواجهة.

لا ترفع هذه الذاكرة إلى Cloud API ولا Memory SaaS.

## Handoffs (التسليمات)
- كل Worker ينتج Handoff صريحاً إلى Supervisor.
- أقصى Handoff =1,600 حرف.
- ننقل Output (المخرجات) فقط، لا Private Chain-of-Thought (سلسلة التفكير الخاصة).

في Sequential mode يستطيع Worker التالي رؤية تسليم Worker السابق، ثم Supervisor يرى نتائج الفريق.

## Security Inheritance (وراثة الأمان)
Phase 4B تستعمل `executeWorkflowAgent` الموجودة في Phase 4، ثم تضيف فحوصاً أخرى:
- أي Agent Run بتكلفة غير صفرية => فشل/منع.
- أي `toolCalls !== 0` => فشل/منع.
- Team Orchestrator لا يستورد `toolSdk` ولا `mcpClient`.
- لا `executeBuiltinTool`.
- لا `callMcpTool`.
- لا Tool Planner تلقائي.
- لا MCP Call تلقائي.

Tool Center / MCP Center تبقيان المسارين الوحيدين الحاليين، مع Allowlist + Human Approval + Sandbox + Kill Switch.

## Failure Containment (احتواء الفشل)
- Team غير صالح => Blocked قبل التنفيذ.
- Worker fail => النتيجة لا تُخفى؛ يمكن أن يصبح Team Run `partial`.
- Supervisor fail مع نجاح Workers => الحالة `partial` وتحفظ نتائج العمال.
- Qwen غير محمل => Runtime المحلي يفشل بأمان؛ لا Fallback إلى API مدفوعة.

## Storage Limits (حدود التخزين)
- 20 Supervisor Teams محفوظة.
- 20 Team Runs محفوظة في السجل الحالي.
- حذف Team يحذف ذاكرته وسجل تشغيله الخاصين.

## Cost (التكلفة)
- `monetaryCostUsd = 0` لكل Team Run.
- لا Production Dependency جديدة.
- لا Workflow SaaS.
- لا API مدفوعة.

## العلاقة مع Phase 4A/DAG
نحتفظ بالنمطين:

### DAG Workflow
مناسب لـ:
- ترتيب حتمي للعقد.
- Checkpoint/Resume.
- Human Approval بين المراحل.
- سير عمل قابل للاستئناف.

### Supervisor Team
مناسب لـ:
- عدة باحثين/مراجعين مستقلين.
- Parallel fan-out.
- Supervisor synthesis.
- Shared Team Memory.

لاحقاً يمكن دمج Supervisor Team كـWorkflow Node خاصة داخل DAG بعد نجاح اختبارات الموثوقية.

## Acceptance Gates (بوابات القبول)
لا تندمج Phase 4B إلا بعد نجاح:
- جميع Phase 0–4A validators.
- MCP validator.
- Sandbox validator.
- Phase 4B validator.
- TypeScript + Production Build.
- `npm audit --omit=dev --audit-level=high`.
