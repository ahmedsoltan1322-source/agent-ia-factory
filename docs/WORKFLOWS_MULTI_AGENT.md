# Phase 4 — Workflows & Multi-Agent (سير العمل وتعدد الوكلاء)

## الهدف

تشغيل عدة Agents (وكلاء) كفريق من الهاتف مع Supervisor Agent (وكيل مشرف)، Worker Agents (وكلاء عاملين)، Shared Team Memory (ذاكرة فريق مشتركة)، وHandoffs (تسليمات) واضحة، مع بقاء الحد المالي الإلزامي 0$.

## Workflow Definition (تعريف سير العمل)

كل Workflow يحتوي:
- `mode`: `sequential` أو `parallel`.
- Supervisor واحد.
- من Worker واحد إلى 4 Workers كحد أقصى للهاتف.
- سجل إنشاء محلي.

لا يمكن أن يكون Supervisor ضمن Workers في نفس Workflow.

## دورة التشغيل

1. التحقق من وجود كل Agents.
2. تمرير كل Agent عبر Zero-Cost Gate.
3. Supervisor ينشئ Planning (خطة) للمهمة.
4. Handoff من Supervisor لكل Worker.
5. كل Worker يستعمل:
   - المهمة الأصلية.
   - خطة المشرف.
   - ذاكرته/RAG المحلي الخاص به.
   - Shared Team Memory الخاصة بالـWorkflow.
6. نتيجة Worker الناجحة تدخل Team Memory ويُسجل Handoff إلى Supervisor.
7. Supervisor يجمع نتائج العمال في Final Synthesis (خلاصة نهائية).
8. كل Workflow Run يُحفظ محلياً بتكلفة مسجلة 0$.

## Sequential (التسلسلي)

Workers يعملون واحداً بعد الآخر. العامل اللاحق يستطيع رؤية Team Memory التي أضافها العمال السابقون، لذلك هذا الوضع مناسب عندما يعتمد كل جزء على ما قبله.

## Parallel (المتوازي)

### Local Demo

إذا كان كل Workers يستعملون Local Demo Runtime، يمكن جدولة تشغيل العمال بـ`Promise.all`، مع إعطائهم Shared Team Memory snapshot واحدة قبل مرحلة العمال.

### Qwen / WebGPU على الهاتف

لا نشغّل عدة Generations ثقيلة على WebGPU في نفس الوقت. إذا وُجد Worker واحد على الأقل يستعمل Local Qwen/WebGPU:
- كل العمال يأخذون نفس pre-worker Team Memory snapshot للمحافظة على معنى التوازي المنطقي.
- التنفيذ الفعلي للتوليد يُسلسل.
- Run يسجل `parallel-mobile-safe-serialized-gpu` بدلاً من ادعاء توازٍ رسومي حقيقي.

هذا قرار Mobile-Safety (أمان الهاتف) لتجنب ضغط الذاكرة/VRAM والانهيارات.

## Supervisor / Workers

- Supervisor هو Agent عادي من Agent Registry وليس نموذجاً خاصاً مغلقاً.
- Worker أيضاً Agent عادي، ويمكن أن تكون له Instructions وMemory مختلفة.
- هذا يسمح بتكوين فرق تخصصية لاحقاً دون كسر Agent Spec الأساسي.

## Shared Team Memory

- محلية في Browser storage.
- منفصلة حسب Workflow ID.
- الحد الحالي: 80 عنصراً لكل Workflow.
- كل عنصر يُقص إلى 3000 حرف.
- يمكن مسحها يدوياً.
- حذف Workflow يمسح Team Memory التابعة له لمنع orphaned memory (ذاكرة يتيمة).

Long-Term Memory الخاصة بكل Agent تبقى مستقلة عن Team Memory.

## Handoffs (التسليمات)

نسجل حالياً نوعين:
- `supervisor-to-worker`
- `worker-to-supervisor`

التسليم لا يمنح Tool Permission جديدة ولا يغير Approval Policy الخاصة بالوكيل المستقبل.

## Tool Safety

Phase 4 core لا تشغّل Tools تلقائياً أثناء التخطيط أو عمل العمال. Tool SDK/MCP/Sandbox تبقى متاحة في المصنع، لكن Automatic Tool Planner سيبقى خطوة منفصلة ويجب أن يمر عبر نفس Security Gate قبل أي تنفيذ.

## Zero-Cost

قبل Workflow Run يتم فحص Supervisor وكل Worker عبر `evaluateZeroCostGate`. أي Agent يخالف سياسة 0$ يجعل Workflow Fail-Closed ولا يبدأ الفريق.

`WorkflowRun.monetaryCostUsd` يساوي 0 صراحة.

## حدود الهاتف

- Workers: حتى 4.
- Workflow definitions: حتى 30.
- Workflow run history: حتى 40.
- Team memory: حتى 80 عنصراً لكل Workflow.
- Qwen/WebGPU concurrency الثقيلة: متسلسلة في وضع Parallel.

## معيار القبول

Phase 4 core لا تُدمج إلا بعد نجاح:
- جميع Validators السابقة من Phase 0 حتى Sandbox/MCP.
- Phase 4 validator.
- TypeScript + Production Build.
- Production dependency audit عند High أو أعلى.
