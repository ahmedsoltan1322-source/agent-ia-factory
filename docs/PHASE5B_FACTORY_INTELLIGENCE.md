# Phase 5B — Factory Intelligence (ذكاء المصنع)

## الهدف

إغلاق البنود الناقصة من Phase 5 بطريقة حتمية وقابلة للتدقيق قبل إضافة أي LLM Planner أعلى:

- Tool Builder (باني الأدوات) على شكل Requirements/Adapter Proposals فقط.
- Test Builder (باني الاختبارات) على شكل Test Plan محلية.
- Auto-Repair (الإصلاح التلقائي) للـBlueprint فقط، عبر Preview ثم Human Approval.

المبدأ يبقى: **We build the factory, not another agent.**

## Tool Builder

`buildFactoryToolPlan` يقرأ Blueprint الموجودة ويحوّل Suggested Tools إلى Tool Requirements:

- Built-in reviewed tool معروف → `existing`.
- Tool غير معروف → `adapter_required`.
- لا Tool مطلوبة → `no_tool_required`.

كل Requirement تحمل:
- Risk ceiling.
- Permission scopes.
- Candidate reviewed adapter IDs إن وُجدت.
- `monetaryCostUsd = 0`.
- `automaticActivation = false`.
- Human approval مطلوبة قبل أي Activation مستقبلية.

### ما لا يفعله Tool Builder

- لا يولد JavaScript أو Python تنفيذيًا.
- لا يستدعي `executeBuiltinTool`.
- لا يستدعي MCP.
- لا يسجل Tool في Marketplace.
- لا يفعّل Adapter.
- لا يغير Agent allowlist.
- لا شبكة ولا API مدفوعة.

إذا لم توجد Adapter مفحوصة، يبقى الناتج Requirement فقط ولا يتم اختراع تنفيذ.

## Test Builder

`buildFactoryTestPlan` يبني حالات اختبار محلية تغطي:
- Quality (الجودة).
- Security (الأمان).
- Reliability (الاعتمادية).

ويضيف حالات لكل Role، لكن لا يشغّل Agent أو Workflow أو Tool. الناتج Plan قابلة للمراجعة فقط مع `automaticExecution = false`.

## Auto-Repair

المسار:

`Blueprint → Repair Preview → Human Approval → Recompute/Bind → Save repaired Blueprint`

### Repair Preview

`buildFactoryRepairPreview` بلا آثار جانبية. الإصلاحات المسموح بها حاليًا محدودة وواضحة:
- استعادة سياسة 0$.
- منع Paid Models.
- منع Auto Tool Enable.
- منع Auto Run.
- استعادة Human Approval للتثبيت.
- استعادة Workflow approval-between-agents وmaxAgents=6.
- إزالة تكرار Suggested Tool IDs.
- إزالة تكرار Role IDs بطريقة حتمية.
- إضافة Reviewer مستقل إذا كان مفقودًا ويوجد مكان ضمن حد 6 Roles.
- استعادة Acceptance Tests الأساسية.

لا يتم إصلاح تغييرات جوهرية غامضة في Instructions تلقائيًا؛ إذا بقيت Violation تصبح `manualBlockers` ويكون `safeToApply = false`.

### Apply Repair

`applyFactoryRepair`:
- يرفض بدون Human Approval.
- يرفض Blueprint مثبتة.
- يعيد حساب Repair Preview من Original Blueprint.
- يرفض Preview معدلة أو قديمة.
- يرفض إذا بقيت Manual Blockers.
- يعيد Validation بعد الإصلاح.
- يحفظ Blueprint فقط.

لا Agent creation، لا Workflow install، لا Tool/MCP activation، ولا Run.

## Local Qwen

Phase 5B لا تجعل Local Qwen سلطة على Blueprint. أي LLM Planner مستقبلي سيكون Assistant (مساعد اقتراح) فقط؛ Deterministic Validator (المحقق الحتمي) سيبقى صاحب القرار، ولن يستطيع LLM تثبيت أو منح صلاحيات بنفسه.

## Phone UX

داخل Factory Center تظهر ثلاثة أزرار مستقلة:
- Build Tool Plan.
- Build Test Plan.
- Preview Auto-Repair.

تطبيق Repair يحتاج Checkbox موافقة منفصل يصرح بوضوح أن الموافقة لا تشمل Install/Run/Tool activation.

## Security Invariants

- Mandatory additional spend = 0 USD.
- No network in Factory Intelligence core.
- No external code execution.
- No automatic Tool/MCP calls.
- No automatic Agent/Workflow installation.
- No automatic execution.
- Repair Preview is side-effect free.
- Human Approval required to apply repair.
- Installed Blueprints are immutable to Auto-Repair.
- Existing Phase 10 Tool Marketplace/Adapter gates remain authoritative for real Tool activation.

## الاختبارات

Phase 5B smoke يثبت:
- Tool Plan لا تغير Storage.
- Unknown Tool لا تُنفذ؛ تُصنف `adapter_required`.
- External-write risk لا تُخفّض إلى read-only.
- Test Plan تشمل Quality/Security/Reliability بلا Execution.
- Repair Preview لا تغير Storage.
- Apply بدون موافقة يُرفض.
- Tampered/Stale Preview تُرفض.
- Repair تعيد Zero-Cost/No-Auto/Reviewer/Workflow invariants.
- Agents/Runs/Workflows/Tool Calls تبقى بلا آثار جانبية أثناء التخطيط/الإصلاح.
