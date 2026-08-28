# Phase 3 — MCP Client Security (أمان عميل MCP)

## الهدف

إضافة MCP Client (عميل بروتوكول سياق النموذج) إلى تطبيق الهاتف دون تحويل أي URL خارجي إلى مصدر صلاحيات تلقائي. MCP يمر فوق نفس Tool Security Gate (بوابة أمان الأدوات) الموجودة للأدوات المحلية.

## SDK (الحزمة الرسمية)

- Package: `@modelcontextprotocol/client`.
- Version: `2.0.0` مثبتة بالضبط أثناء هذه المرحلة.
- License: MIT حسب manifest الرسمي للمشروع.
- Transport المستخدم: `StreamableHTTPClientTransport` فقط.
- ممنوع استيراد `@modelcontextprotocol/client/stdio` في PWA لأن stdio مخصص لبيئات process/Node وليس تطبيق الهاتف.

## Browser / PWA (المتصفح / تطبيق الويب)

MCP SDK معزول داخل `src/vendor/mcpVendor.ts` ويُحمّل عبر Dynamic Import (تحميل ديناميكي) فقط عندما يضغط المستخدم Discovery أو Call. لذلك:
- فتح التطبيق لا يحمّل MCP SDK.
- تثبيت PWA لا يخزن MCP vendor chunk مسبقاً.
- `vite.config.ts` يستبعد `mcpVendor-*.js` من Workbox precache.

## Trust Gate (بوابة الثقة)

إضافة MCP Server URL إلى Registry (السجل) لا تجري أي اتصال.

كل خادم جديد يبدأ:
- `trusted: false`
- `toolPolicies: {}`

لا Discovery ولا Call قبل منح Trust صريح من المستخدم.

## URL Security (أمان العنوان)

النسخة الحالية تقبل:
- `https:` فقط.

وترفض:
- HTTP العادي.
- username/password داخل URL.
- query string (`?...`) حتى لا تتحول إلى مكان لتسريب Tokens أو أسرار.
- fragment (`#...`).
- localhost و`.local` وعناوين IPv4 الخاصة/link-local/loopback وIPv6 literal في هذه المرحلة.
- عنوان أطول من 2000 حرف.

الوصول إلى LAN (الشبكة المحلية) أو IPv6 سيضاف لاحقاً فقط داخل وضع Self-Host/LAN (استضافة ذاتية/شبكة محلية) صريح وبمراجعة أمان منفصلة.

## Network Boundary (حدود الشبكة)

طلبات MCP تستخدم:
- `credentials: 'omit'` لمنع إرسال Cookies تلقائياً.
- `redirect: 'error'` لمنع اتباع Redirect خارجي تلقائياً.
- `referrerPolicy: 'no-referrer'` حتى لا يرسل المتصفح عنوان الصفحة الحالية.
- `mode: 'cors'` لإبقاء سياسة CORS الخاصة بالمتصفح فعالة.
- `cache: 'no-store'`.
- Timeout محلي 10 ثوانٍ يغطي الاتصال وقراءة Response Body (جسم الاستجابة)، لا وصول Headers فقط.
- Response Stream (تدفق الاستجابة) محدود بـ **1,500,000 bytes**؛ يتوقف الاتصال فور تجاوز الحد لحماية ذاكرة الهاتف.
- Arguments (المعاملات) محدودة بـ32,000 حرف بعد JSON serialization.
- SSE reconnection retries = 0 في هذه المرحلة.
- لا OAuth Provider ولا Bearer Token في النسخة الأولى.
- `onInsufficientScope: 'throw'` و`maxStepUpRetries: 0` لمنع توسيع صلاحيات تفاعلي تلقائي.

الهدف من هذه القيود هو جعل أول نسخة قابلة للتنبؤ على الهاتف قبل إضافة OAuth لاحقاً داخل تدفق موافقة مستقل.

## Discovery لا يعني Permission (الاكتشاف لا يعني الصلاحية)

عند `listTools()`:
1. تحفظ أسماء ووصف الأدوات محلياً.
2. كل Tool جديدة تأخذ افتراضياً:
   - `risk: external_write`
   - `enabled: false`
3. المستخدم يراجع Risk Classification (تصنيف الخطر).
4. المستخدم يفعّل Tool على Server Policy.
5. المستخدم يضيف Tool إلى Allowlist الخاصة بالـAgent المختار.

أي خطوة ناقصة = Call ممنوع.

## MCP Tool Call Gate (بوابة استدعاء أداة MCP)

قبل إرسال أي `callTool` إلى الخادم:
1. Server يجب أن يكون Trusted.
2. Tool يجب أن تكون enabled في MCP policy.
3. Synthetic Tool ID بالشكل `mcp:<serverId>:<toolName>` يجب أن يكون داخل `agent.toolPolicy.allowedTools`.
4. `maxToolCalls` يجب ألا يُتجاوز.
5. Financial risk ممنوع لأن حد الإنفاق 0$.
6. Tool Security Gate المركزي يستطيع منع الاستدعاء حسب Risk/Policy.
7. **كل استدعاء بعيد يحتاج موافقة بشرية جديدة** حتى لو صنفت الأداة Read Only (قراءة فقط)، لأن مجرد إرسال Arguments إلى خادم خارجي قد يكشف بيانات.
8. فقط بعد نجاح البوابات والموافقة البشرية الصريحة يُفتح الاتصال ويرسل Call.

تصنيف Read Only يبقى مفيداً لتوصيف طبيعة الأداة وتقييمها، لكنه لا يلغي موافقة الشبكة في Phase 3.

## Audit (التدقيق)

كل Call مكتمل أو محجوب بعد الطلب يُسجل محلياً لكل Agent مع:
- Server ID وURL.
- Tool name.
- Arguments JSON.
- الحالة.
- هل كانت هناك Human Approval.
- Security checks.
- output/error.
- monetaryCostUsd = 0.

## قيود مقصودة حالياً

- لا Auto Tool Planner بعد.
- لا OAuth ولا Tokens بعد.
- لا stdio.
- لا WebSocket transport.
- لا خوادم HTTP غير مشفرة.
- لا LAN/private network MCP في النسخة الحالية.
- CORS (سياسة المتصفح) قد تمنع بعض MCP servers، وهذا لا يتم تجاوزه بحيلة Proxy مدفوعة أو غير موثوقة.
- MCP Call يدوي في الواجهة حالياً؛ لاحقاً Tool Planner سيقترح calls لكن نفس Security Gate والموافقة البشرية سيبقيان الحكم النهائي.

## بوابات الدمج

لا تُدمج هذه المرحلة إلا مع نجاح:
- Phase 0 validation.
- Phase 1 validation.
- Phase 2 validation.
- Phase 3 Tool Security validation.
- MCP validation.
- TypeScript + Production Build.
- `npm audit --omit=dev --audit-level=high`.
