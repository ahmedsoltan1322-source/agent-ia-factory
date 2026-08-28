# Phase 7A — Safe Browser Agent (وكيل المتصفح الآمن)

## الهدف

إضافة Browser Agent (وكيل متصفح) حقيقي يستطيع قراءة صفحة عامة وتنفيذ خطوات مشاهدة محدودة، من غير تحويل المصنع إلى أداة قادرة على الإرسال أو الشراء أو الحذف تلقائياً.

Phase 7A هي **Read-Only Baseline (خط أساس للقراءة فقط)**:

`Plan → Review → Human Approval → Manual GitHub Workflow → Isolated Browser → Evidence`

لا يوجد تشغيل متصفح تلقائي من داخل التطبيق.

## Runtime (محرك التشغيل)

- `playwright-core` مثبت بالإصدار `1.62.1` فقط كـDev Dependency (تبعية تطوير/تشغيل CI).
- الترخيص upstream: Apache-2.0.
- لا يتم تنزيل Chromium من Playwright.
- يستخدم System Chrome/Chromium (متصفح النظام) الموجود أصلاً على GitHub Runner.
- إذا لم يوجد متصفح نظامي: Fail Closed (فشل مغلق)، ولا يبدأ تنزيل بديل.

## Browser Job (خطة المتصفح)

الأنواع المسموحة في Phase 7A:
- `read_text`: قراءة نص.
- `extract_links`: استخراج روابط.
- `follow_link`: متابعة رابط HTTPS داخل نفس Host Family فقط.
- `fill_preview`: تعديل DOM كمعاينة محلية دون Submit ودون dispatch لأحداث input/change.
- `screenshot`: لقطة شاشة محدودة.

الحد الأقصى: 10 Actions (إجراءات) لكل خطة.

## Human Approval (الموافقة البشرية)

هناك طبقتان:
1. الخطة في التطبيق يجب أن تحمل `approvedByHuman=true` قبل التصدير.
2. Workflow اليدوي يحتاج Input مستقل `approved=true`.

أي تعديل على الخطة في الواجهة يلغي الموافقة السابقة.

## Network Policy (سياسة الشبكة)

المسموح فقط:
- `GET`
- `HEAD`
- `OPTIONS`

الممنوع:
- `POST`
- `PUT`
- `PATCH`
- `DELETE`
- أي Method غير القائمة البيضاء.

كما تُمنع:
- HTTP غير المشفر.
- URL فيه username/password.
- localhost / `.local`.
- Raw IP hosts.
- Private / loopback / link-local / metadata ranges.
- Azure platform IP `168.63.129.16` إلا DNS فقط في Firewall.
- Top-level cross-site navigation.
- Query keys التي تبدو أسراراً مثل token/session/password.
- Mutating-looking GET URLs التي تحمل كلمات مثل delete/logout/pay/transfer/submit/confirm.

## WebSocket (قناة ثنائية الاتجاه)

`BrowserContext.routeWebSocket('**/*', handler)` تُثبت قبل إنشاء الصفحة.
الـhandler **لا يستدعي `connectToServer()`**، لذلك يبقى WebSocket محلياً ولا يتصل بالخادم.

## Downloads / Uploads / Secrets

- `acceptDownloads=false`.
- Upload Actions غير موجودة في Schema أصلاً.
- Submit Actions غير موجودة.
- Sensitive selectors مثل password/token/card/OTP ممنوعة.
- Preview values التي تبدو Secret/Card/Email/Phone/URL ممنوعة في هذه المرحلة.
- لا تُمرر GitHub Secrets أو Tokens إلى Browser Process.

## Process Isolation (عزل العملية)

Workflow ينشئ Linux User مستقل باسم `browserjob`.
التشغيل يتم عبر:

`sudo -u browserjob -H env -i ... node scripts/run-browser-job.mjs`

`env -i` يعني أن Browser Process لا يرث Environment Secrets الخاصة بالـRunner.

Chrome Sandbox يبقى مفعلاً؛ لا نستخدم `--no-sandbox`.

## Firewall (الجدار الناري)

`scripts/setup-browser-sandbox.sh` يطبق قواعد حسب UID (معرّف المستخدم):
- يسمح DNS فقط إلى resolvers المعرفة في runner.
- يمنع IPv4 private/loopback/link-local/metadata/documentation/multicast ranges.
- يمنع الوصول إلى Azure platform IP ما عدا DNS.
- يمنع IPv6 egress كاملاً للمستخدم المعزول في Phase 7A.

هذه الطبقة مستقلة عن فحص DNS داخل Node، لذلك DNS Rebinding إلى عنوان خاص لا يكفي لتجاوز الحماية.

## DNS Validation (فحص DNS)

قبل زيارة Host، `dns.lookup(..., {all:true})` يجب أن يرجع عناوين عامة فقط.
الـHost وDNS وFirewall جميعها طبقات مستقلة.

## Evidence (الأدلة)

التقرير يحتوي:
- Status.
- عدد الإجراءات.
- عدد Write Requests المحجوبة.
- Unsafe Network Requests المحجوبة.
- Popups المحجوبة.
- Monetary Cost = 0.

Artifacts تحتفظ بها GitHub Actions ليوم واحد فقط في Workflow اليدوي.

لا نطبع محتوى الصفحة في Step Summary.

## Smoke Test (اختبار تشغيل حقيقي)

CI يشغل خطة ثابتة على `https://example.com/`:
- قراءة `body`.
- Screenshot.
- نفس `setup-browser-sandbox.sh`.
- نفس `run-browser-job.mjs`.
- نفس Linux UID isolation.

ويفشل CI إذا:
- System Chrome غير موجود.
- Metadata IP أصبح قابلاً للوصول من المستخدم المعزول.
- التقرير لم ينتهِ `success`.
- `monetaryCostUsd != 0`.
- لم تُنفذ الإجراءات المتوقعة.

## Zero-Cost (التكلفة الصفرية)

- لا API مدفوعة.
- لا Browser SaaS (خدمة متصفح مدفوعة).
- لا تنزيل Browser منفصل في Workflow.
- GitHub Actions تستخدم الحصة الحالية فقط ولا يوجد شراء تلقائي.
- Mandatory additional spend (الإنفاق الإضافي الإلزامي): **0 USD**.

## ما لا تدعمه Phase 7A

- Login automation.
- كلمات مرور/OTP.
- إرسال نماذج.
- رسائل أو منشورات.
- شراء أو دفع أو تحويل.
- حذف أو تغيير إعدادات.
- رفع ملفات.
- تنزيل ملفات.
- Cross-site navigation.
- تشغيل متصفح تلقائي دون Human Approval.

أي قدرات Write (كتابة خارجية) مستقبلية يجب أن تدخل في مرحلة منفصلة مع Policy Engine (محرك سياسات)، Approval per Action (موافقة لكل إجراء)، ومجالات/أدوات محددة، وليس بتوسيع Phase 7A بصمت.
