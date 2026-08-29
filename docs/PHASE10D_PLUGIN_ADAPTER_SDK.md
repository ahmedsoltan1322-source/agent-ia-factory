# Phase 10D — Plugin/Adapter SDK (حزمة تطوير الإضافات والموصلات)

## الهدف

Phase 10D تكمل Ecosystem (النظام البيئي) ببناء Adapter SDK (حزمة موصلات) تربط Tool Packages من Phase 10C بRuntime (محرك التشغيل) **من دون تنزيل أو تشغيل كود طرف ثالث من Marketplace**.

المسار:

`Signed Tool Package → Trusted Publisher → Disabled Marketplace Registration → Static Reviewed Adapter → Human Activation → Human Agent Allowlist → Existing Tool Gate → Capability Sandbox → Tool Call Log`

لا يوجد:

`Marketplace Code → Dynamic Import → Runtime Execution`

## Adapter SDK Protocol

الإصدار:

`ADAPTER_SDK_API_VERSION = 0.1`

أنواع Adapter المعرفة في Contract (العقد):
- tool
- model
- memory
- browser
- deployment

Phase 10D baseline تفعل Tool Adapter واحدة فقط end-to-end. الأنواع الأخرى موجودة كNeutral Contract (عقد محايد) ليتم توسيعها لاحقًا من دون تغيير فلسفة المصنع.

## Static Reviewed Adapter Registry

Adapter لا تدخل من JSON أو URL أو npm package.

Registry في 10D مدمجة في كود المصنع ومراجعة عبر CI.

كل Adapter Descriptor يحمل:
- ID ثابت.
- Kind.
- SemVer.
- Adapter API version.
- Capabilities.
- Network mode.
- Secret access.
- Monetary cost.
- `source=factory-static-reviewed`.

Reference Adapter الأولى:

`adapter.local.text.stats`

خصائصها:
- kind=tool
- network=none
- secretAccess=false
- cost=0
- supported Tool ID = `community.text.stats`
- supported scope = `text:read`
- maximum risk = `read_only`
- input limit ≤ 20,000 chars

## Why no Dynamic Plugin Code

Tool Marketplace Package هي Data Manifest فقط.

Phase 10D لا تستعمل:
- dynamic `import()` من URL.
- eval.
- new Function.
- npm install.
- pip install.
- shell child process.
- WebAssembly من Marketplace.
- remote JavaScript.

إذا أضاف المصنع Adapter جديدة مستقبلًا، تدخل كمصدر مصنع معروف + Review + Tests + Sandbox policy، ثم تصبح ID صالحة للحزم.

## Compatibility Gate

Tool Package لا ترتبط بـAdapter إلا إذا:
- Adapter ID موجودة.
- Adapter API version مطابقة.
- Tool ID موجود ضمن supportedToolIds.
- كل Scope ضمن supportedScopes.
- Tool Risk لا تتجاوز reviewed risk ceiling.
- Adapter cost = 0.
- secretAccess=false.
- Reference Adapter network=none.

أي mismatch = Fail Closed.

## Activation Registry

Phase 10C Marketplace Registry تبقى كما هي:
- registrationStatus=disabled
- activationAllowed=false

Phase 10D لا تغير هذا Record.

بدل ذلك تنشئ Activation Registry منفصلة:

`agent-ia-factory.adapter-activations.v1`

Activation Record تحتوي:
- Tool/package identity.
- Publisher fingerprint.
- Adapter ID/version.
- Risk/scopes.
- activationStatus=active.
- monetaryCostUsd=0.

هذا يفصل Provenance/Marketplace Registration عن Runtime Activation.

## Three Approval Layers

### 1. Adapter Activation Approval

لا Activation بدون:

`ADAPTER_ACTIVATION_HUMAN_APPROVAL_REQUIRED`

### 2. Agent Allowlist Approval

حتى Tool Active لا يستطيع Agent استعمالها.

يلزم إقرار مستقل لإضافة Tool ID إلى:

`agent.toolPolicy.allowedTools`

ولا يوجد auto-assignment.

### 3. Per-call Approval

عند كل Tool Call يعود القرار إلى `evaluateToolGate` الموجود منذ Phase 3.

Risk التي Policy الخاصة بالوكيل تجعلها `ask` تتطلب Human Approval جديدة للاستدعاء نفسه.

إذن Approval للتفعيل لا تتحول إلى إذن دائم للتنفيذ.

## Existing Security Path Reuse

Phase 10D لا تبني Executor جديدًا يتجاوز Tool SDK.

تم إضافة `executeToolDefinition` كدالة عامة داخل Tool SDK، ثم:
- Built-in Tools تستخدمها.
- Adapter-backed Tools تستخدمها.

وبالتالي كلا المسارين يمران عبر:
- maxToolCalls.
- Agent Tool Allowlist.
- Financial block.
- Approval policy.
- `executeBuiltinInCapabilitySandbox`.
- input/output/time bounds.
- ToolSandboxError handling.
- Tool Call Log.
- monetaryCostUsd=0.

## Deactivation

Deactivation تحتاج Human Approval منفصلة.

إذا بقي Tool ID قديم في Agent Allowlist بعد Deactivation:
- لا تصبح Tool قابلة للتنفيذ.
- لا يوجد fallback إلى Marketplace package أو arbitrary code.
- stale allowlist وحدها ليست capability.

ويستطيع المستخدم إزالة Tool من Agent Allowlist بموافقة منفصلة أيضًا.

## Phone UX

Adapter SDK Center تعرض:
- Static Reviewed Adapter Registry.
- Import Tool Package محلية.
- هل يوجد Disabled Marketplace Registration مطابق.
- Explicit Activation checkbox.
- Activated Adapter Tools.
- Explicit Add to Agent checkbox.
- Explicit Remove from Agent checkbox.
- Explicit Deactivate checkbox.
- Manual Adapter Tool Call console.
- Per-call approval panel عند الحاجة.

## Zero-Cost Boundary

- Adapter descriptor cost=0.
- Activation record cost=0.
- Tool Call record cost=0.
- financial tools غير مدعومة في 10C/10D baseline.
- لا Managed Plugin Service.
- لا Paid Registry.
- لا API مدفوعة.

## Acceptance

Phase 10D لا تُقبل إلا إذا نجحت:
1. Phase 0→10D validators + TypeScript + production build.
2. Phase 8/9A/9B/9C/9D regressions.
3. Phase 10A/10B/10C regressions.
4. Static adapter registry validation.
5. Adapter API/version validation.
6. Unsupported Tool ID rejection.
7. Unsupported scope rejection.
8. Risk ceiling rejection.
9. Activation without Marketplace registration rejected.
10. Activation without Human Approval rejected.
11. Activation leaves Phase 10C registry disabled.
12. Agent allowlist assignment without approval rejected.
13. Tool Call before allowlist blocked.
14. Adapter Tool Call after allowlist succeeds through existing gate+sandbox+audit.
15. Deactivation without approval rejected.
16. Deactivated Tool cannot execute successfully even if stale allowlist remains.
17. Built-in Tool SDK regression remains successful.
18. Private signing key absent from storage.
19. Production dependency audit.
20. Full dependency audit.
21. Phase 7A real Chrome smoke on same PR.
22. New production dependencies = 0.
23. Mandatory additional spend = 0 USD.
