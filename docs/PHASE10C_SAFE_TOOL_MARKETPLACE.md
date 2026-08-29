# Phase 10C — Safe Tool Marketplace Architecture (معمارية سوق الأدوات الآمن)

## الهدف

Phase 10C تضيف Tool Marketplace (سوق أدوات) فوق Tool SDK وCapability Sandbox الموجودين، لكن **لا تسمح بتنزيل JavaScript من الإنترنت أو تشغيل كود Marketplace مباشرة**.

المسار المقصود:

`Signed Tool Package → Signature Verification → Publisher Trust → Human Registration → Disabled Registry`

ولا يوجد في 10C:

`Marketplace → Auto Download Code → Auto Install → Auto Activate → Auto Run`

## البروتوكول

`agent-ia-factory.tool-package/0.1`

كل Tool Package تحتوي:
- Publisher ID/Display Name.
- Ed25519 Public Key + SHA-256 Fingerprint.
- Tool ID + SemVer.
- Name/Description/Input Hint.
- SPDX License.
- Declared Risk.
- Requested Scopes.
- Registered Adapter ID فقط، لا executable source.
- GitHub source coordinates pinned to exact 40-hex Commit SHA.
- Zero-cost / no-auto policy.
- Ed25519 signature على Canonical JSON.

## Data-only Tool Manifest

Phase 10C لا تقبل داخل الحزمة:
- JavaScript source.
- WASM bytes.
- Shell commands.
- npm/pip package install instructions.
- arbitrary URL execution.
- executable code strings.
- secrets/tokens/passwords.

`implementation.kind` الوحيد في 10C:

`registered-adapter`

والـAdapter ID مجرد Reference (مرجع). لا يعني أن Adapter موجود أو موثوق أو قابل للتشغيل.

## Risk / Scope Binding

Risk levels المقبولة:
- `read_only`
- `local_write`
- `external_write`
- `delete`
- `security_change`

`financial` مرفوضة في Baseline لأن Mandatory Monetary Spend = 0 USD.

كل Scope لها Minimum Risk. مثال:
- `text:read` → read_only.
- `memory:write-local` → local_write.
- `network:write` → external_write.
- `memory:delete` → delete.
- `security:change` → security_change.

إذا أعلن Tool Risk أقل من Scope المطلوبة:

`TOOL_RISK_UNDERSTATED_FOR_SCOPE`

ولا تُقبل الحزمة.

## Publisher Trust

Phase 10C تعيد استعمال Trust Store من Phase 10B بدل إنشاء مخزن ثقة ثانٍ.

تم تعميم Publisher Trust بحيث تستقبل `VerifiedPublisherIdentity` بعد التحقق التشفيري من نوع الحزمة.

القواعد تبقى:
- Signature صالح لا يعني Trusted.
- Trust يحتاج Human Pin للبصمة.
- Private Key لا تُحفظ.
- Same Publisher ID + different key => `key-changed`.
- الاستبدال يحتاج Approval صريحة إضافية.

## Registration

Tool Package لا تدخل Marketplace Registry إلا إذا:
1. Signature verified.
2. Publisher status = `trusted`.
3. Human Registration Approval = true.
4. Package policy = zero-cost + no automatic registration/activation/execution.

بعد التسجيل Record تكون دائمًا:
- `registrationStatus = disabled`
- `activationAllowed = false`
- `monetaryCostUsd = 0`

Registration لا تعدل:
- Agent `allowedTools`.
- Tool SDK built-in registry.
- MCP registry.
- Workflow.
- Run Log.
- Browser Agent.

## Activation

**لا Runtime Activation في Phase 10C.**

يوجد فقط `evaluateMarketplaceActivationEligibility` لاختبار ما إذا كان Tool يمكن أن يصبح مرشحًا لمرحلة لاحقة.

حتى عند:
- Human Activation Approval = true.
- Adapter ID موجود في قائمة Adapter مفحوصة.

النتيجة هي:

`eligible-for-phase10d`

ولا يتم تغيير `activationAllowed=false` ولا تنفيذ Tool.

Phase 10D — Plugin/Adapter SDK ستبني Activation Bridge منفصلة تمر عبر:
- Adapter schema/version validation.
- capability mapping.
- Sandbox compatibility.
- explicit human activation.
- Agent allowlist assignment.
- existing `evaluateToolGate` at call time.

## License Gate

Baseline Tool Marketplace تقبل فقط:
- MIT
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause
- CC0-1.0

ولا تقبل baseline:
- AGPL
- SSPL
- BUSL
- GPL
- unclear licenses

هذه Operational Safety Gate وليست استشارة قانونية.

## GitHub Source Binding

Source يجب أن تكون:

`https://github.com/<owner>/<repo>`

مع:
- Exact 40-char Commit SHA.
- Relative path فقط.
- path ينتهي بـ`.agent-tool.json`.
- لا query/fragment/credentials/custom port.
- لا path traversal.

Phase 10C لا Fetch تلقائيًا من هذا المصدر. الإحداثيات Publisher-attested وموقعة فقط.

## Secret-like Metadata Gate

يُعاد استعمال Local Secret-like Scanner من Phase 10A على:
- Tool name.
- Description.
- Input hint.
- Publisher display metadata.
- Manifest text fields.

Private keys / GitHub tokens / AWS keys / bearer tokens / common credential assignments تُرفض قبل التوقيع أو الاستيراد.

هذا Defense-in-Depth وليس ادعاء اكتشاف كل Secret ممكن.

## Phone UX

واجهة الهاتف تسمح بـ:
- Import Signed Tool Package من ملف محلي.
- Signature verification.
- عرض Tool/Risk/Scopes/Adapter/License.
- عرض Publisher Fingerprint وTrust Status.
- Manual Publisher Trust.
- Explicit key replacement عند `key-changed`.
- Explicit registration approval.
- Register Disabled Tool.
- Remove Registry Record بموافقة منفصلة.

ولا تحتوي على:
- Activate button.
- Run button.
- Install-by-URL.
- background fetch.
- code download.

## Security Boundary

Phase 10C تمنع:
- arbitrary third-party code execution.
- auto-registration.
- auto-activation.
- auto-run.
- agent allowlist mutation.
- hidden Tool SDK registration.
- financial tools.
- paid API.
- secret persistence.
- untrusted-publisher registration.
- risk understatement.

## Acceptance

لا تُقبل Phase 10C إلا إذا نجحت:
1. Phase 0→10C validators + TypeScript + production build.
2. Phase 8 / 9A / 9B / 9C / 9D regressions.
3. Phase 10A template regression.
4. Phase 10B publisher/catalog regression.
5. Ed25519 Tool Package signature verification.
6. Publisher trust required before registration.
7. Pin without approval rejected.
8. Register without approval rejected.
9. Approved registration produces `disabled` + `activationAllowed=false`.
10. No Agent/Run side effects after import/register.
11. Financial risk rejected.
12. Risk-understated-for-scope rejected.
13. Unsafe license rejected.
14. Unsafe GitHub URL/path traversal rejected.
15. Secret-like metadata rejected.
16. Package tampering rejected.
17. Hidden activation field rejected.
18. Key change remains fail-closed.
19. Activation eligibility does not activate or mutate registry state.
20. Production dependency audit.
21. Full dependency audit.
22. Phase 7A real Chrome smoke on same PR.
23. New production dependencies = 0.
24. Mandatory additional spend = 0 USD.
