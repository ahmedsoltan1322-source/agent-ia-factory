# Phase 3 — Tool Sandboxing (عزل الأدوات)

## النطاق الحالي

هذه المرحلة تضيف Capability Sandbox (عزل صلاحيات وموارد) للأدوات المحلية المدمجة والموثوقة في Agent IA Factory.

هذا **ليس** OS Sandbox (عزل نظام تشغيل) ولا يسمح لنا بتشغيل JavaScript غير موثوق داخل نفس الصفحة ثم الادعاء أنه معزول. الأدوات غير الموثوقة مستقبلاً يجب أن تعمل داخل Worker/iframe أو بيئة أقوى مع قناة رسائل محدودة قبل قبولها.

## حدود التنفيذ

`TOOL_SANDBOX_LIMITS` الحالية:
- Maximum Input: 20,000 حرف.
- Maximum Output: 40,000 حرف.
- Execution Budget: 5,000 ms.

الخرج الأكبر يُقصّ مع علامة `OUTPUT_TRUNCATED_BY_TOOL_SANDBOX` لحماية الواجهة وسجل التشغيل من النمو غير المحدود.

## Capability Scopes (نطاقات الصلاحيات)

الأدوات المحلية المدمجة لا تنفذ إلا إذا كانت كل Scopes ضمن القائمة الحالية:
- `text:read`
- `memory:read`
- `memory:write-local`
- `memory:delete`

أي Scope جديدة، مثل network أو shell أو filesystem العام، تُرفض Fail-Closed (تفشل بالإغلاق) حتى نراجعها ونوسع السياسة صراحة.

## Defense in Depth (دفاع متعدد الطبقات)

التنفيذ المحلي يمر بهذا الترتيب:
1. Tool Registry موجود.
2. `maxToolCalls` لم يُتجاوز.
3. Tool داخل Agent Allowlist.
4. Financial risk ممنوع في وضع 0$.
5. Human Approval عند الحاجة.
6. Capability Sandbox يفحص Scopes وحجم Input.
7. ينفذ Built-in tool.
8. يحد Output ويسجل Sandbox checks في Tool Call Log.

## Timeout وحدوده

الـ5 ثوانٍ تُطبق بـPromise timeout على الأدوات المدمجة. هذا يمنع واجهة النظام من انتظار Promise معلقة بلا حد، لكنه لا يستطيع إيقاف synchronous JavaScript عالق ولا التراجع عن side-effect بدأ بالفعل.

لذلك:
- لا يدخل هذا المسار كود طرف ثالث غير موثوق.
- Built-in tools يجب أن تبقى صغيرة ومراجعة المصدر.
- Third-party tools المستقبلية تحتاج Isolated Runtime (بيئة تنفيذ معزولة) حقيقية قبل الدمج.

## MCP

MCP remote calls لا تمر داخل هذا الـlocal capability sandbox لأنها شبكة خارجية لها Transport Security Boundary مستقل في `MCP_SECURITY.md`. لكنها تمر عبر نفس Tool Security Gate: Trust + tool policy + Agent allowlist + risk + Human Approval + maxToolCalls.

## معيار إغلاق Phase 3

Phase 3 تعتبر مكتملة بعد نجاح:
- Tool SDK.
- MCP Client.
- MCP Security Gate.
- Permission Scopes.
- Built-in Capability Sandbox.
- جميع validators والبناء وproduction dependency audit.
