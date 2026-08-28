# Phase 3B — MCP Security Layer (طبقة أمان MCP)

## الهدف
إدخال MCP (Model Context Protocol — بروتوكول سياق النموذج) إلى Agent IA Factory دون فتح اتصال خارجي أو أسرار أو تنفيذ طرفية قبل اكتمال الحوكمة الأمنية.

## القاعدة الأساسية
MCP ليس مسار صلاحيات مستقلاً. كل MCP Tool (أداة MCP) تمر عبر نفس:

1. Tool Registry / MCP Registry (سجل الأدوات والخوادم).
2. Per-Agent Allowlist (قائمة سماح خاصة بكل وكيل).
3. Tool Risk (تصنيف الخطر).
4. Human Approval (الموافقة البشرية) عند الحاجة.
5. Max Tool Calls (الحد الأقصى للاستدعاءات).
6. Zero-Cost Gate (بوابة التكلفة الصفرية).
7. Audit Log (سجل التدقيق).

## ما يعمل في Phase 3B
- Local MCP Sandbox (مختبر MCP محلي) داخل المتصفح.
- `mcp.local-sandbox.echo`.
- `mcp.local-sandbox.normalize`.
- لا شبكة.
- لا Secret (سر).
- لا API Key (مفتاح واجهة).
- لا Terminal / stdio.
- لا دفع.

## ما هو ممنوع
### Streamable HTTP
موجود في نوع Descriptor (الوصف) فقط للمستقبل، لكنه يُمنع عند التنفيذ حالياً.

### stdio
موجود في النوع للمستقبل، لكنه ممنوع في Browser / Phone-Only Mode (المتصفح / وضع الهاتف فقط) في Phase 3B.

### External MCP Servers
أي خادم خارجي يُرفض حتى لو كان معروفاً أو مفتوح المصدر. لا توجد قائمة ثقة ضمنية.

## لماذا لا نثبت MCP SDK الآن؟
هذه المرحلة تثبت Security Contract (عقد الأمان) أولاً دون Dependency إنتاج جديدة. إضافة SDK رسمي لاحقاً تصبح Adapter (موصلاً) خلف هذا العقد، لا مصدراً للسياسات.

هذا يحقق:
- Vendor Independence (عدم الارتهان لمزود).
- أصغر Supply Chain (سلسلة توريد) ممكنة.
- إمكانية تبديل MCP Runtime لاحقاً.
- عدم السماح لمكتبة خارجية بتقرير الصلاحيات.

## شروط Phase 3C قبل تفعيل MCP خارجي
لا يسمح بـ Streamable HTTP قبل وجود جميع ما يلي:

- Server Identity (هوية الخادم) موثقة.
- Explicit Origin / Host Allowlist (قائمة سماح للأصل/المضيف).
- HTTPS only (HTTPS فقط).
- Redirect policy (سياسة إعادة التوجيه) مغلقة افتراضياً.
- Secret isolation (عزل الأسرار) وعدم تمريرها للنموذج.
- Per-server scopes (صلاحيات خاصة بكل خادم).
- Tool schema validation (فحص مخطط مدخلات الأدوات).
- Request / response size limits (حدود الحجم).
- Timeouts (مهلات زمنية).
- Rate limits (حدود معدل الاستدعاء).
- Human approval for external writes (موافقة بشرية للكتابة الخارجية).
- Full audit trail (سجل تدقيق كامل).
- License + security review للخادم نفسه.
- Kill Switch (زر إيقاف فوري).

## سياسة الفشل
Fail Closed (الفشل الآمن): إذا لم نعرف الخادم أو النقل أو الأداة أو الصلاحية أو نتيجة الفحص، فالقرار = Blocked (ممنوع).
