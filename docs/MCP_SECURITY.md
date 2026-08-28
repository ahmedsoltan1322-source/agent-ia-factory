# MCP Client Security (أمان عميل MCP)

## الهدف

Phase 3 (المرحلة الثالثة) تضيف MCP Client (عميل MCP) بدون أن تجعل خوادم MCP طريقاً لتجاوز Tool Security Gate (بوابة أمان الأدوات).

المعيار المستهدف هو MCP `2026-07-28` عبر Streamable HTTP (نقل HTTP متدفق) وJSON-RPC 2.0.

## قواعد لا يمكن لخادم MCP تجاوزها

1. **Deny by Default (المنع افتراضياً)**
   - تسجيل الخادم لا يمنح أي Agent (وكيل) صلاحية.
   - كل أداة بعيدة تحصل على ID مستقل بالشكل `mcp:<serverId>:<toolName>`.
   - يجب أن تكون الأداة في `agent.toolPolicy.allowedTools` قبل أي `tools/call`.

2. **Mandatory Human Approval (موافقة بشرية إلزامية)**
   - كل `tools/call` بعيد يحتاج موافقة بشرية جديدة في كل مرة.
   - هذه القاعدة تطبق حتى لو كانت `approvalPolicy.externalWrite = allow`.
   - رفض المستخدم يعني أن الطلب لا يرسل إلى الخادم.

3. **Zero-Cost (التكلفة الصفرية)**
   - `monetaryCostUsd` المسجل داخلياً يظل `0`.
   - لا API مدفوعة ولا اشتراك MCP مدفوع مطلوب.
   - المصنع لا يستطيع ضمان أن خادماً خارجياً لا يفرض سعراً خارج النظام؛ لذلك لا نربط في هذه المرحلة أي خادم يتطلب حساب فوترة أو مفتاحاً مدفوعاً.

4. **HTTPS Only (HTTPS فقط)**
   - الخوادم البعيدة يجب أن تستخدم HTTPS.
   - HTTP مسموح فقط لـ localhost/loopback أثناء التطوير.
   - عناوين IPv4 للشبكات الخاصة محجوبة في النسخة الأولى لتقليل مخاطر الوصول إلى الشبكة الداخلية.
   - IPv6 البعيد مؤجل إلى مراجعة أمنية لاحقة.

5. **No URL Secrets (لا أسرار في الرابط)**
   - Username/Password داخل URL ممنوعان.
   - Query string وfragment ممنوعان في النسخة الأولى حتى لا تتحول الروابط إلى مخزن Tokens (رموز وصول).

6. **No Browser Credentials (لا اعتمادات المتصفح)**
   - الطلبات تستعمل `credentials: omit`.
   - Redirects (إعادة التوجيه) ممنوعة.
   - `referrerPolicy: no-referrer`.
   - `cache: no-store`.

7. **Authentication Deferred (المصادقة مؤجلة)**
   - OAuth/API tokens غير مدعومة بعد.
   - 401/403 يتحولان إلى خطأ واضح بدل طلب Secret من المستخدم ووضعه في localStorage.
   - المصادقة لا تدخل قبل Secrets Vault (خزنة أسرار) منفصلة ومشفرة ومراجعة أمنياً.

8. **Bounded Inputs/Outputs (حدود للمدخلات والمخرجات)**
   - Tool arguments يجب أن تكون JSON object.
   - المدخل محدود الحجم.
   - استجابة MCP محدودة الحجم.
   - المخرجات المعروضة تقص إلى حد آمن ولا ترندر HTML خاماً.

9. **No Automatic Model Tool Execution (لا تنفيذ أدوات تلقائياً من النموذج)**
   - Local AI (الذكاء المحلي) لا يستطيع استدعاء MCP مباشرة.
   - Discovery (اكتشاف الخادم) و`tools/list` يحتاجان فعل مستخدم صريحاً من الواجهة.
   - `tools/call` يحتاج Allowlist + Policy Gate + Human Approval.

10. **MRTR/Input Required (الجولات المتعددة/طلب مدخل)**
   - `input_required` لا يُجاب عليه آلياً في هذه النسخة.
   - إذا طلب الخادم مدخلاً إضافياً، يتوقف التنفيذ برسالة واضحة.
   - مرحلة لاحقة ستضيف UI (واجهة) مستقلة لجمع الرد من المستخدم وإعادة الطلب مع `requestState` دون تمرير القرار للنموذج.

## Transport (النقل)

كل طلب حديث يرسل:
- `MCP-Protocol-Version: 2026-07-28`
- `Mcp-Method`
- `Mcp-Name` عندما تكون العملية مرتبطة باسم Tool (أداة)
- `_meta['io.modelcontextprotocol/protocolVersion']`
- `_meta['io.modelcontextprotocol/clientInfo']`
- `_meta['io.modelcontextprotocol/clientCapabilities']`

العميل يدعم JSON responses وSSE `data:` responses بحدود حجم واضحة.

## ما لا تدعمه النسخة الحالية

- Stdio transport (نقل الطرفية) على الهاتف.
- OAuth أو API keys.
- Automatic tool execution.
- MCP Apps/UI rendering.
- Resources/Prompts كمصدر معرفة تلقائي.
- Subscriptions.
- Multi Round-Trip auto-fulfilment.
- Servers on private LAN.

هذه ليست نواقص مخفية؛ هي حدود أمنية مقصودة حتى نضيف كل قدرة خلف Gate (بوابة) واختبارات منفصلة.
