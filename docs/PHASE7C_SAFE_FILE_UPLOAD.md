# Phase 7C-A — Safe File Staging (تجهيز الملف الآمن)

## الهدف
تجهيز ملف Upload على الهاتف بطريقة Fail-Closed قبل أي Network أو Browser action.

## ما تنفذه 7C-A
- اختيار ملف محلي من الهاتف.
- الأنواع الحالية: TXT / CSV / JSON فقط.
- الحد الأقصى: 32 KB.
- UTF-8 فقط.
- JSON يجب أن يكون صالحًا.
- SHA-256 على bytes الأصلية.
- Upload Capsule مؤقتة صلاحيتها 10 دقائق.
- Exact-field validation (منع الحقول المخفية).

## Content Gate (بوابة المحتوى)
يرفض محليًا:
- Private keys / API keys / Bearer tokens / password-like assignments.
- Payment وidentity-like data مثل card/IBAN/SWIFT/routing/SSN.
- البريد الإلكتروني وأرقام الهاتف في هذا baseline.
- NUL/binary content.
- الملفات التنفيذية أو المضغوطة أو Office macros وغيرها، لأنها ليست ضمن allowlist أصلًا.

## حدود المرحلة
7C-A ليست Upload فعلية:
- لا `fetch`.
- لا WebSocket.
- لا Self-Host Worker request.
- لا GitHub event payload للملف.
- لا Browser `setInputFiles`.
- لا localStorage/sessionStorage للCapsule.
- لا background sync.

المرحلة التالية 7C-B ستنقل Capsule عبر Authenticated Self-Host Worker Transport (النقل الموثق للعامل الذاتي)، ثم تجعل Browser Upload نفسها وراء موافقة مستقلة ومسار حذف مؤقت Fail-Closed.

## Privacy / Lifetime
- Capsule تبقى في React memory فقط في 7C-A.
- صلاحيتها 10 دقائق.
- لا Logs تحتوي محتوى الملف.
- الملف العام غير الحساس فقط هو baseline الحالي.

## Zero-Cost
- Production dependencies جديدة = 0.
- Mandatory additional spend = 0 USD.
