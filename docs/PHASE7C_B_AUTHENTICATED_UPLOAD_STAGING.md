# Phase 7C-B — Authenticated Ephemeral Upload Staging (تجهيز الرفع المؤقت الموثّق)

## الهدف
نقل Upload Capsule التي اجتازت Phase 7C-A من الهاتف إلى Self-Host Worker (العامل الذاتي) عبر HTTPS/HMAC، من دون رفعها إلى الموقع الهدف بعد.

## Phone Transport
- Endpoint يجب HTTPS origin فقط.
- Pairing Secret = نفس 32-byte Base64URL secret model المستخدم في Worker transport.
- HMAC-SHA256 يربط protocol + method + route + tenant + timestamp + nonce + body digest.
- Request وResponse كلاهما موقّعان.
- Nonce + timestamp ضد Replay.
- `credentials=omit`, `cache=no-store`, `redirect=error`, `referrer=no-referrer`.
- Timeout محدود؛ النتيجة تصبح Uncertain ولا يوجد Auto-Retry.
- Endpoint وSecret يبقيان في React memory فقط.

## Ephemeral Filesystem Store
- State directory `0700`.
- staged data file `0600`.
- filename على القرص مشتق من SHA-256 لـstageId، لا من اسم ملف المستخدم.
- SHA-256 للمحتوى يعاد التحقق منه عند stage وresolve.
- نفس Capsule ID + SHA تعيد نفس stageId.
- نفس الهوية بمحتوى مختلف ترفض Fail-Closed.
- max staged uploads = 32.
- Capsule expiry هي expiry الخاصة بالملف المؤقت؛ cleanup يحصل مع عمليات store اللاحقة.
- Authenticated delete endpoint متاح للحذف اليدوي المبكر.

## Server Boundary
- Reference Upload Stage Server يستمع فقط على `127.0.0.1`.
- التعريض البعيد يتطلب HTTPS reverse proxy موثوقًا.
- CORS = origin واحد exact؛ wildcard ممنوع.
- Rate limit + replay cache محدودان.
- Body limit محدود.
- لا file content في logs.

## ما لا تنفذه 7C-B
- لا Browser `setInputFiles`.
- لا submit للموقع الهدف.
- لا payment/auth/delete workflows.
- لا background upload.
- لا automatic retry.
- لا cloud provider إلزامي.

Phase 7C-C ستستهلك `stageId` داخل Browser Worker منفصل، وتنفذ `setInputFiles` + one-shot submit فقط بعد موافقة بشرية جديدة، ثم تحذف الملف المؤقت في finally path.

## Zero-Cost
- Production dependencies جديدة = 0.
- Mandatory additional spend = 0 USD.
