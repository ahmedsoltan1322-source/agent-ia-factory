# Phase 9C — Authenticated Transport (النقل الموثّق)

## الهدف

Phase 9C تضيف Transport Adapter (موصل نقل) اختياريًا بين Phone Control Plane (طبقة التحكم على الهاتف) وSelf-Host Worker (العامل ذاتي الاستضافة) من دون ربط المصنع بمزوّد سحابي محدد أو API مدفوعة.

المسار:

`Phone PWA → Human Click → HTTPS + HMAC Request → Reverse Proxy → 127.0.0.1 Worker → Signed Receipt → Phone Durable Queue`

لا يوجد Background Networking (شبكة في الخلفية) ولا Auto-Retry (إعادة تلقائية).

## Transport Protocol (بروتوكول النقل)

الإصدار:

`agent-ia-factory.transport/0.1`

المسار الوحيد في 9C:

`POST /v1/execute`

الهاتف يقبل فقط Base Endpoint (عنوانًا أساسيًا):
- `https://` إلزامي.
- لا Username/Password داخل URL.
- لا Query String.
- لا Fragment.
- لا Base Path إضافي.

الطلب يستخدم:
- `credentials: omit`.
- `cache: no-store`.
- `redirect: error`.
- `referrerPolicy: no-referrer`.
- Timeout محدود بحد أقصى 30 ثانية.

## Pairing Secret (سر الاقتران)

السر هو 32-byte random secret ممثلًا بصيغة Base64URL.

قواعده:
- لا يُكتب في GitHub.
- لا يدخل URL.
- لا يدخل Bundle/Receipt.
- لا يُحفظ في localStorage/sessionStorage/IndexedDB بواسطة Phase 9C.
- في الهاتف يبقى في React Memory (ذاكرة الواجهة) فقط حتى مسحه أو إغلاق/إعادة تحميل الصفحة.
- في الخادم يأتي فقط من `AGENT_IA_WORKER_SECRET_B64URL` Environment Variable (متغير البيئة).

يجب توليد السر بمصدر Random Cryptographic (عشوائية تشفيرية)، وليس كلمة مرور بشرية قصيرة.

## HMAC-SHA256 Authentication (المصادقة بالتوقيع)

كل Request (طلب) يوقع Canonical Message (رسالة معيارية) تحتوي:
- Protocol.
- REQUEST marker.
- HTTP method.
- Path.
- Tenant ID.
- Unix timestamp.
- 16-byte random Nonce (قيمة تستخدم مرة واحدة).
- SHA-256 body digest.

التوقيع: HMAC-SHA256 بالمفتاح المشترك 32-byte.

الخادم يتحقق من:
- Protocol.
- Tenant.
- Timestamp ضمن ±90 ثانية.
- Nonce format.
- Body digest.
- HMAC signature.
- Replay cache.

نفس Nonce لا يُقبل مرتين داخل نافذة Replay.

## Signed Responses (الردود الموقعة)

الرد نفسه موقّع HMAC-SHA256 ويربط:
- Protocol.
- RESPONSE marker.
- HTTP status.
- Path.
- Tenant ID.
- Timestamp.
- Request Nonce الأصلي.
- SHA-256 response body digest.

الهاتف لا يقبل Receipt حتى يتحقق أولًا من توقيع الرد ثم من Worker Protocol bindings الخاصة بـBundle/Job/Worker/Lease/Agent/Task.

HTTPS يبقى إلزاميًا رغم وجود HMAC، لأن HMAC ليس بديلًا عن TLS Confidentiality (سرية الاتصال) ولا عن Server Certificate Verification (التحقق من شهادة الخادم).

## Replay / Uncertain Result (إعادة الإرسال / النتيجة غير المحسومة)

قاعدة Phase 9C:

**لا Auto-Retry بعد أي Failure في النقل.**

السبب: قد ينفذ Worker الطلب ثم يضيع الرد، وإعادة Job جديدة قد تنتج تنفيذًا مكررًا.

بدل ذلك:
- الهاتف يحتفظ بنفس Portable Worker Bundle في Memory فقط.
- المستخدم يستطيع الضغط يدويًا على `Retry Same Bundle` ما دام Lease صالحًا.
- كل Retry يولد Nonce جديدًا وتوقيعًا جديدًا، لكنه يرسل نفس Bundle ID.
- Worker Server يحتفظ Receipt cache في الذاكرة لنفس Bundle ID حتى انتهاء Lease، ويعيد نفس Receipt بدل تنفيذها مرة ثانية أثناء حياة العملية الحالية.

حد مهم: Receipt cache في 9C **In-Memory (داخل الذاكرة)** وليست Durable عبر Restart (إعادة تشغيل الخادم). لذلك لا ندعي Exactly-Once (تنفيذ مرة واحدة تمامًا) عبر Crash/Restart. ولأن Reference Worker في 9C ما زال `local-demo` بلا Tools ولا External Writes، لا نفتح بعد Runtime ذات Side Effects (آثار خارجية). Durable server-side idempotency تأتي في مرحلة لاحقة قبل السماح بأعمال خارجية.

## CORS (سياسة الأصل)

الخادم يتطلب `AGENT_IA_ALLOWED_ORIGIN` كـHTTPS Origin واحد صريح.

- لا `*`.
- Origin يجب أن يطابق بالضبط في OPTIONS وPOST.
- الطلب من Origin مختلف يُرفض قبل التنفيذ.

## Worker Server (خادم العامل)

`scripts/worker-server.mjs`:
- Node 24.
- Production Dependencies جديدة = 0.
- يستمع فقط على `127.0.0.1`.
- Default port = 8787.
- لا يدعم Public HTTP مباشرة.
- Remote exposure يتطلب HTTPS Reverse Proxy موثوقًا أمامه.
- Request body محدود بحجم Worker Bundle.
- Header count محدود.
- Request timeout محدود.
- Rate limit افتراضي: 10 طلبات موثقة في الدقيقة.
- Replay nonces محدودة ومؤقتة.
- Receipt cache محدودة ومؤقتة.

Environment Variables:
- `AGENT_IA_WORKER_SECRET_B64URL` — إلزامي.
- `AGENT_IA_ALLOWED_ORIGIN` — إلزامي.
- `AGENT_IA_TENANT_ID` — افتراضي `local-owner`.
- `AGENT_IA_LISTEN_PORT` — افتراضي `8787`.
- `AGENT_IA_MAX_REQUESTS_PER_MINUTE` — اختياري، 1..60.

الخادم لا يطبع Secret أو Task أو Output في Logs (السجلات).

## Reverse Proxy (الوكيل العكسي)

Phase 9C لا تفرض Nginx/Caddy/Cloudflare أو أي مزوّد.

العقد المطلوب فقط:
- HTTPS certificate صالح يثق به Safari.
- Forward إلى `127.0.0.1:<port>`.
- حفظ `Origin` وHeaders الخاصة بـ`x-agent-ia-*`.
- عدم كتابة Pairing Secret لأنه لا يمر أصلًا كقيمة مستقلة؛ فقط HMAC signature تمر في Headers.
- Body size/timeout ينبغي ألا يتجاوز حدود Worker نفسها.

هذا يحافظ على Vendor Neutrality (حياد المزوّد).

## Phone UX (واجهة الهاتف)

Phase 9C تضيف:
- Endpoint input.
- Pairing Secret password input.
- `Send Next Job` — هو وحده الذي يبدأ الاتصال.
- `Retry Same Bundle` — يدوي فقط عند نتيجة غير محسومة.
- `Clear Secret` — يمسح السر من React State.

قبل Claim:
- Endpoint يُتحقق منه.
- Secret يُتحقق من طوله وصيغته.
- Job التالية يجب أن تكون `agent_run`.
- Agent يجب أن تكون `local-demo` و0$ وTools مغلقة.

إذا فشل Preflight لا يتم Claim أي Job.

## Security Limits (حدود الأمان)

Phase 9C تمنع عمدًا:
- HTTP من الهاتف.
- Credentials في URL.
- Query/Fragment في Endpoint.
- Redirect following.
- Cookies/Credentials.
- Referrer leaking.
- Background networking.
- Automatic retries.
- Wildcard CORS.
- Public bind على `0.0.0.0` للخادم المرجعي.
- Secrets في GitHub أو storage المحلي.
- Remote Tool execution.
- Paid APIs.

## Acceptance (القبول)

لا تُقبل Phase 9C إلا إذا نجحت:
1. Phase 0→9C validators + TypeScript + Production Build.
2. Phase 8 regression smoke.
3. Phase 9A durable queue smoke.
4. Phase 9B worker Bundle/Receipt smoke.
5. HMAC request signature + verification.
6. Signed response verification.
7. Body tamper rejection.
8. Timestamp skew rejection.
9. Replay nonce rejection.
10. Same Bundle manual retry returns same cached Receipt داخل نفس Worker process.
11. Exact CORS origin and wildcard rejection.
12. Real Node worker server loopback test on `127.0.0.1`.
13. Server logs do not contain secret/task content.
14. Production dependency audit.
15. Full dependency audit.
16. Phase 7A real Chrome smoke on the same PR.
17. New production dependencies = 0.
18. Mandatory additional spend = 0 USD.

## ما لا تدعيه Phase 9C

- لا Exactly-Once عبر Server Restart بعد.
- لا Durable remote receipt cache بعد.
- لا Multi-Tenant authentication service فعلي بعد؛ Tenant واحد لكل Worker config.
- لا Remote LLM runtime بعد.
- لا Remote Tool/Browser execution بعد.
- لا Managed Cloud مطلوب أو مدمج.

هذه الحدود مقصودة حتى يظل المسار Fail-Closed (يفشل بأمان) قبل إضافة أي Side Effects خارجية.
