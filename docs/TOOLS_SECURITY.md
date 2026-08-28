# Phase 3 — Tool SDK & Security (حزمة الأدوات والأمان)

## الهدف

بناء طبقة أدوات يمكن أن يستعملها Agent (الوكيل) لاحقاً دون تحويل الوكيل إلى برنامج يملك صلاحيات مفتوحة. القاعدة الأساسية هي Deny by Default (المنع افتراضياً) مع Allowlist (قائمة سماح) ونطاقات صلاحيات وموافقة بشرية عند المخاطر الأعلى.

## Tool Definition (تعريف الأداة)

كل أداة تصف:
- `id`: معرف ثابت.
- `name` و`description`.
- `risk`: درجة/نوع الخطر.
- `scopes`: نطاقات الصلاحيات المطلوبة.
- `inputHint`: وصف المدخل.
- `execute`: المنفذ الفعلي.

## مستويات الخطر

- `read_only`: قراءة محلية فقط.
- `local_write`: كتابة على الجهاز فقط.
- `external_write`: كتابة خارج الجهاز؛ تتبع `approvalPolicy.externalWrite`.
- `delete`: حذف؛ يتبع `approvalPolicy.delete`.
- `financial`: ممنوع في وضع Zero-Cost لأن الحد المالي 0$.
- `security_change`: تغيير أمني؛ يتبع `approvalPolicy.securityChange`.

## Security Gate (بوابة الأمان)

قبل التنفيذ يجب أن تنجح بالترتيب:
1. `maxToolCalls` لم يُتجاوز.
2. الأداة موجودة في `agent.toolPolicy.allowedTools`.
3. الأدوات المالية تُمنع طالما `maxMonetarySpendUsd = 0`.
4. سياسة الموافقة الخاصة بنوع الخطر تسمح أو تطلب Human Approval.
5. عند `ask` لا ينفذ شيء حتى تصل موافقة بشرية صريحة.

## Built-in Local Tools (الأدوات المحلية الأولى)

### `local.text.stats`
- Read-only.
- يحسب الحروف والكلمات والأسطر محلياً.
- لا شبكة.

### `local.memory.search`
- Read-only.
- يبحث داخل Memory/Knowledge المحلي للوكيل.
- لا Vector DB خارجية.

### `local.memory.add`
- Local write.
- يضيف Long-Term Memory على الجهاز.

### `local.memory.clear`
- Delete risk.
- يتطلب أن تكون الأداة في Allowlist.
- يتطلب Human Approval لأن سياسة الحذف الافتراضية `ask`.
- يتطلب أيضاً نص التأكيد `DELETE` قبل الحذف.

## Tool Call Log (سجل الأدوات)

كل تنفيذ مكتمل أو محجوب يسجل محلياً:
- Agent ID.
- Tool ID.
- الحالة.
- هل أعطى الإنسان الموافقة.
- `callIndex`.
- التكلفة، وهي 0$ في هذه المرحلة.
- Security checks.
- النتيجة أو الخطأ.

## ما لا نسمح به بعد

- لا Automatic Tool Planner (مخطط أدوات تلقائي) داخل النموذج بعد.
- لا Network Tool (أداة شبكة) افتراضية.
- لا Shell/Terminal (طرفية) ولا تنفيذ أوامر نظام.
- لا File System عام خارج الملفات التي يختارها المستخدم عبر واجهة المتصفح.
- لا MCP Server خارجي قبل MCP Security Gate مستقل.

الفصل بين Model Run وTool Execution مقصود: نثبت الأمن أولاً، ثم نسمح للـAgent باقتراح Tool Calls، ثم نتحقق منها عبر نفس البوابة قبل التنفيذ.

## المرحلة التالية داخل Phase 3

بعد نجاح هذا الأساس:
1. نراجع MCP TypeScript SDK الحالي وترخيصه وثغراته.
2. نضيف MCP Server Descriptor (وصف خادم) وAllowlist للنطاقات/الأدوات.
3. نسمح فقط بTransport (نقل) مدعوم وآمن في بيئة المتصفح.
4. كل MCP Tool يمر عبر نفس Tool Security Gate.
5. لا يتم الاتصال بخادم MCP عشوائي بمجرد إدخال URL؛ يلزم Trust/Approval (ثقة/موافقة) صريحة.
