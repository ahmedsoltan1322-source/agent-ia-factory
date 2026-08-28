# Phase 4 — Workflows & Multi-Agent (سير العمل وتعدد الوكلاء)

## الهدف

إضافة Workflow Engine (محرك سير عمل) محلي للهاتف يسمح بربط أكثر من Agent (وكيل) مع Handoffs (تسليمات)، Checkpoints (نقاط حفظ)، وHuman Approval Nodes (عقد موافقة بشرية) دون فتح Tool Planner تلقائي أو أي تكلفة إلزامية.

## DAG فقط

Workflow Definition (تعريف سير العمل) في هذه المرحلة هو Directed Acyclic Graph — DAG (رسم موجّه بلا دورات):
- Node (عقدة): `agent` أو `approval` أو `end`.
- Agent Node لها Edge واحدة من نوع `success`.
- Approval Node لها Edge واحدة من نوع `approved`.
- End Node لا تملك Edge خارجة.
- Self-edge ممنوعة.
- أي Cycle (دورة) ممنوعة.
- كل Node يجب أن تكون Reachable (قابلة للوصول) من Entry Node.

هذا يجعل التنفيذ محدوداً وقابلاً للتدقيق ويمنع Loop (حلقة) غير منتهية على الهاتف.

## Multi-Agent Handoff (التسليم بين الوكلاء)

كل Agent يحصل على:
1. Original Task (المهمة الأصلية) بحد أقصى 8,000 حرف.
2. Previous Agent Output (نتيجة الوكيل السابق) بحد Handoff يصل إلى 8,000 حرف، والافتراضي 6,000.
3. تعليماته الأصلية الموجودة في Agent Spec (مواصفات الوكيل).

لا ننقل Private Chain-of-Thought (سلسلة التفكير الخاصة). المنقول هو Output (المخرج) العملي فقط.

## Human Approval Nodes (عقد الموافقة البشرية)

عند الوصول إلى Approval Node:
- يتوقف Workflow فوراً.
- تحفظ حالة `waiting_approval` محلياً.
- يظهر آخر Handoff للمستخدم.
- Approve (موافقة) تنقل التنفيذ إلى العقدة التالية.
- Deny (رفض) يجعل التشغيل `blocked` وينهيه.

لا يوجد Auto-Approve (موافقة تلقائية) في Phase 4 foundation.

## Checkpoints & Resume (نقاط الحفظ والاستئناف)

يُحفظ Workflow Run محلياً:
- عند الإنشاء.
- عند دخول حالة running.
- بعد كل Agent Node ناجحة.
- عند التوقف للموافقة.
- بعد قرار الموافقة أو الرفض.
- عند النجاح أو الفشل أو المنع.

إذا أُغلقت الصفحة بعد Checkpoint يمكن استئناف Run من `currentNodeId` المحفوظ.

إذا انقطع التطبيق أثناء تنفيذ Agent Node قبل Checkpoint النهائية، يمكن إعادة نفس العقدة عند Resume. هذا At-Least-Once (مرة واحدة على الأقل) وليس Exactly-Once. لذلك Phase 4 foundation **تمنع Automatic Tool Calls** أثناء Workflow؛ إعادة عقدة نموذج محلي لا يجب أن تعيد Side Effect خارجي.

## Resource Limits (حدود الموارد)

- أقصى Workflows محفوظة: 20.
- أقصى Runs محفوظة: 12.
- أقصى Nodes: 40.
- أقصى Edges: 60.
- أقصى Steps في Run: 24.
- أقصى Agents في Team Builder: 6.
- Original Input: 8,000 حرف.
- Stored step input/output: 6,000 حرف لكل حقل.
- Handoff: حتى 8,000 حرف.

## Zero-Cost & Tool Safety (التكلفة الصفرية وأمان الأدوات)

كل Agent Run داخل Workflow يجب أن يحقق:
- `monetaryCostUsd === 0`.
- `toolCalls === 0` في Phase 4 foundation.
- Runtime محلي فقط (`local-demo` أو `local-qwen-webgpu`).

إذا ظهر Run بتكلفة غير صفرية أو Tool Call تلقائي:
- Workflow يتوقف Fail-Closed (يفشل بأمان).
- لا ينتقل إلى Agent التالية.

Tool Center وMCP Center يظلان متاحين للمستخدم يدوياً خارج التنفيذ التلقائي.

## Memory / RAG (الذاكرة والاسترجاع)

كل Agent Node تستطيع قراءة Local Long-Term Memory / Knowledge Retrieval الخاصة بذلك Agent فقط عبر `retrieveLocalContext`.

لا ندمج Session Memory الخاصة بواجهة Agent أخرى تلقائياً. Handoff الصريح في Workflow هو قناة التواصل بين الوكلاء.

## ما لم ندخله بعد

- Visual arbitrary DAG editor (محرر DAG بصري كامل).
- Conditional branching مبني على LLM.
- Parallel nodes (عقد متوازية).
- Automatic Tool Planner.
- External scheduler/triggers.
- A2A network protocol.

هذه القدرات ستدخل تدريجياً بعد تثبيت Checkpoint/Approval/DAG core واختبارها على الهاتف.

## شروط القبول

Phase 4 foundation لا تدمج إلا إذا نجحت:
- جميع Validators السابقة Phase 0–3 + MCP + Sandbox.
- Phase 4 Workflow validator.
- TypeScript Build.
- Production Build.
- Production dependency audit عند High/Critical.
- لا Dependency إنتاج جديدة بسبب Workflow Engine.
