# Phase 7B — Safe Browser Actions (إجراءات المتصفح الآمنة)

## الهدف
ترقية Phase 7A من القراءة فقط إلى كتابة محدودة قابلة للتدقيق، من دون فتح متصفح عام الصلاحيات.

## الفصل عن 7A
- Phase 7A تبقى Read-Only كما هي.
- Phase 7B لها Plan/Executor/Workflow مستقلون.
- لا تعديل يجعل 7A تسمح POST.

## Safe Form Submit
- GET/HEAD/OPTIONS مسموحة كالمعتاد.
- POST فقط أثناء `submit_form` مصرح به.
- كل Submit يفتح One-Shot Permit لطلب POST واحد فقط.
- نفس host family فقط.
- expected path prefix إلزامي.
- Body <= 16,000 chars.
- Password/Token/Card/OTP/Auth/Payment fields والبيانات الشبيهة بالأسرار ممنوعة.
- PUT/PATCH/DELETE ممنوعة دائمًا.
- المسارات المالية أو تغييرات الحساب الحساسة ممنوعة.

## Download
- Download يبدأ من GET آمن لنفس الموقع.
- الأنواع الحالية: PDF/TXT/CSV/JSON/PNG/JPG/JPEG/WEBP فقط.
- الحد الأقصى 5 MB.
- لا Auto-Open ولا تنفيذ للملف.
- Evidence retention مؤقتة عبر GitHub Actions.

## Upload
Upload غير مدعوم في 7B. `workflow_dispatch` لا يوفّر File Upload مناسبًا للهاتف، ولن ندّعي Capability غير موجودة. سيأتي Upload في طبقة لاحقة بمدخل ملفات واضح ومفحوص.

## Human Approval
1. الخطة نفسها يجب `approvedByHuman=true`.
2. GitHub Workflow تطلب `approved=true` مرة ثانية.
3. أي تعديل للخطة يسحب الموافقة الأولى.

## Network / Process Isolation
- System Chrome فقط.
- Linux UID معزول.
- env نظيفة بلا GitHub Token.
- DNS + TCP/443 فقط؛ UDP وIPv6 outbound محجوبان حسب Sandbox 7A.
- private/metadata ranges محجوبة.
- WebSocket لا تتصل بالخادم.

## حدود مقصودة
- لا شراء أو دفع أو تحويل مالي.
- لا تغيير Password أو تعطيل حساب أو حذف حساب.
- لا Secrets أو Credentials.
- لا Background execution أو Auto-Retry.
- Mandatory additional spend = 0 USD.
