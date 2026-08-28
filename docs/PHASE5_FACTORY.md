# Phase 5 — Agent Factory (مصنع الوكلاء)

## الهدف

تحويل Agent IA Factory من منصة تنشئ Agent يدوياً إلى **مصنع فرق**:

`Goal (الهدف) → Blueprint (المخطط) → Validation (الفحص) → Human Approval (موافقة بشرية) → Agents + Workflow (وكلاء + سير عمل)`

النسخة الأولى في Phase 5 حتمية ومحلية بالكامل. لا تحتاج API مدفوعة، ولا ترسل Goal إلى شبكة، ولا تستعمل LLM كي تقرر الصلاحيات.

## Deterministic Planner (مخطط حتمي)

`factoryPlanner.ts` يصنف Goal محلياً عبر قواعد وكلمات مفتاحية إلى:
- Software (برمجة وتطوير).
- Research & Content (بحث ومحتوى).
- Support (خدمة عملاء ودعم).
- Business Operations (أعمال وعمليات).
- General (عام).

كل Domain (مجال) يملك Role Templates (قوالب أدوار) محددة مسبقاً ومراجعة أمنياً.

الهدف ليس الادعاء أن القواعد البسيطة أذكى من LLM؛ الهدف بناء **Baseline (خط أساس) موثوق ومجاني وقابل للاختبار**. لاحقاً يمكن إضافة Local AI Planner كاقتراح اختياري، لكن نفس Validator (الفاحص) يبقى الحكم النهائي.

## Blueprint (المخطط)

المخطط يحتوي:
- Goal الأصلي بحد أقصى 6,000 حرف.
- Domain المكتشف.
- Runtime محلي فقط.
- 2–6 Roles (أدوار).
- Purpose + Instructions لكل Agent.
- Suggested Tool IDs (أدوات مقترحة) كمعلومات فقط.
- Acceptance Tests (اختبارات قبول).
- Workflow Policy.
- Zero-Cost / Paid Model / Auto-Tool / Auto-Run policies.

## Reviewer Required (مراجع إلزامي)

كل Blueprint يجب أن يحتوي دور مراجعة/جودة/اختبار مستقل. إذا لم يوجد Reviewer (مراجع) يفشل Validator.

فريق البرمجة الافتراضي مثلاً:
1. مهندس الحل.
2. وكيل التنفيذ البرمجي.
3. وكيل الاختبارات والجودة.
4. المراجع الأمني النهائي.

## Acceptance Tests (اختبارات القبول)

كل مخطط يحتوي على الأقل:
1. `zero-cost`: كل Agent بحد إنفاق 0$ ونماذج مدفوعة ممنوعة.
2. `tools-denied`: الأدوات تبدأ Deny-by-Default (ممنوعة افتراضياً).
3. `reviewer-present`: مراجع مستقل موجود.
4. `workflow-valid`: Workflow DAG صالح مع موافقات بين التسليمات.
5. `no-auto-run`: تركيب الفريق لا يبدأ التشغيل تلقائياً.

تضاف اختبارات متخصصة حسب Domain، مثل testing/security لفريق البرمجة أو evidence review لفريق البحث.

## Suggested Tools ≠ Permissions (الأدوات المقترحة ليست صلاحيات)

قد يقترح Role أدوات محلية مفيدة مثل:
- `local.memory.search`
- `local.memory.add`
- `local.text.stats`

لكن `enableSuggestedToolsAutomatically = false` دائماً في هذه المرحلة.

عند Compile (تحويل المخطط إلى Agent Specs):
- `createDefaultAgent()` هو المصدر الإلزامي لكل Agent.
- `toolPolicy.defaultAction = deny`.
- `allowedTools = []`.
- `financial = deny`.
- `allowPaid = false`.
- `modelPolicy.mode = local_only`.
- `maxMonetarySpendUsd = 0`.
- Evaluation قبل Production مطلوبة.

المستخدم يذهب لاحقاً إلى Tool Center إذا أراد تفعيل أداة يدوياً.

## Human Approval Before Install (موافقة بشرية قبل التثبيت)

`installFactoryBlueprint(blueprint, approvedByHuman)` يرفض مباشرة إذا لم تكن الموافقة `true`.

واجهة الهاتف تعرض:
- الفريق المقترح.
- دور كل Agent.
- تعليمات كل Agent.
- الأدوات المقترحة غير المفعلة.
- اختبارات القبول.
- Pre-Install Validation (فحص ما قبل التثبيت).

بعدها Checkbox صريح ثم زر:
`Approve & Build Team (موافقة وإنشاء الفريق)`.

## Pre-Install Compilation (بناء تجريبي قبل الحفظ)

قبل كتابة أي شيء في Local Storage:
1. يُفحص Blueprint.
2. تُبنى كل Agent Specs في الذاكرة.
3. يُفحص كل Agent:
   - ID فريد.
   - 0$.
   - local-only.
   - paid=false.
   - allowedTools فارغة.
   - financial deny.
   - eval/security gates موجودة.
4. يُبنى Workflow في الذاكرة عبر `buildLinearTeamWorkflow`.
5. يمر Workflow عبر `validateWorkflowDefinition`.

فقط بعد نجاح كل ذلك يبدأ الحفظ.

## Rollback (التراجع)

إذا فشل التخزين أثناء تركيب الفريق:
- يحذف Factory أفضل-effort كل Agents أنشأها في العملية.
- إذا كان Workflow حفظ بالفعل يحذفه.
- يسجل `install_failed` في Factory Audit إن أمكن.

هذا يقلل احتمال ترك Half-Installed Team (فريق مركب جزئياً).

## No Automatic Run (لا تشغيل تلقائي)

نجاح Install يعني فقط:
- Agent Specs محفوظة.
- Workflow محفوظ.
- واجهة Agents وWorkflow تتحدث.

ولا يعني:
- لا Model Run.
- لا Tool Call.
- لا MCP Call.
- لا Network Request.
- لا Message/Email/Post.

المستخدم هو من يذهب إلى Team Workflow ويضغط New Team Run.

## Runtime (محرك التشغيل)

يمكن Blueprint اختيار:
- `local-demo`.
- `local-qwen-webgpu`.

إذا اختير Qwen قبل تنزيل النموذج يمكن تثبيت الفريق، لكن التشغيل يبقى غير جاهز حتى تنزيل Local AI يدوياً من بطاقة النموذج.

لا Runtime خارجي أو مدفوع مقبول في Phase 5 Foundation.

## Factory Audit (تدقيق المصنع)

يسجل محلياً:
- `planned`
- `validated`
- `installed`
- `install_failed`

وكل سجل يحمل `monetaryCostUsd = 0` وفحوص السياسة. السجل نفسه لا يرسل إلى شبكة.

## ما لم ندخله بعد

- LLM planner يغير الصلاحيات.
- Auto Tool Enable.
- Auto Run بعد التركيب.
- Auto Deployment.
- API مدفوعة.
- Team marketplace.
- Self-modifying security policies.

## المرحلة التالية داخل Phase 5

بعد ثبات هذا Foundation يمكن إضافة **Local Blueprint Assistant (مساعد مخطط محلي)** باستعمال Qwen الموجود بالفعل لتحسين أسماء الأدوار والتعليمات، لكن:
- ناتجه اقتراح فقط.
- deterministic validator يعيد فحصه.
- لا يستطيع تغيير 0$ أو الصلاحيات أو تفعيل أدوات.
- المستخدم يراجع Blueprint قبل التثبيت دائماً.

## شروط الدمج

- جميع Phase 0–4 / MCP / Sandbox validators تبقى خضراء.
- Phase 5 validator جديد يثبت:
  - لا network/tool/MCP execution في planner.
  - Human Approval إلزامية.
  - `createDefaultAgent` مستعمل.
  - compiled allowedTools فارغة.
  - 0$ / paid=false.
  - Workflow يمر بالفاحص.
  - Auto Run ممنوع.
  - FactoryCenter مربوط بالواجهة.
- TypeScript + Production Build.
- Production npm audit High/Critical.
- لا Production Dependency جديدة في Phase 5 Foundation.
