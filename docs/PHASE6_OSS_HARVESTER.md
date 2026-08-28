# Phase 6 — OSS Harvester (جامع المصادر المفتوحة)

## الهدف

تحويل البحث عن مشاريع GitHub المفتوحة المصدر إلى Pipeline (خط معالجة) منضبط:

`Discover → Score → Watchlist → Deep Static Scan → Manual Review → Future Integration Proposal`

لا توجد في Phase 6 أي خطوة Auto-Integration (دمج تلقائي).

## Discovery (الاكتشاف)

البحث يتم من تطبيق الهاتف فقط بعد ضغط المستخدم زر البحث:
- Public GitHub Search فقط.
- Origin ثابت: `https://api.github.com`.
- لا GitHub Token داخل المتصفح.
- لا `Authorization` أو Bearer credentials.
- `credentials: omit`.
- `redirect: error`.
- `cache: no-store`.
- `referrerPolicy: no-referrer`.
- Timeout = 10 ثوانٍ.
- Response حدها 2,000,000 bytes تقريباً.
- 12 نتيجة كحد أقصى لكل بحث.

Discovery تقرأ Metadata فقط ولا تنزّل Repository Code (كود المستودع).

## Preliminary Scoring (التقييم الأولي)

الدرجة القصوى 100 وتتكون من:
- License (الترخيص): 35.
- Maintenance (الصيانة/حداثة آخر Push): 25.
- Adoption (الانتشار بالنجوم والفروع): 15.
- Repository Health (صحة المستودع): 10.
- Relevance (صلة المشروع بعبارة البحث): 15.

هذه الدرجة **ليست Security Score نهائية**.

## License Gate (بوابة الترخيص)

Preferred (مفضل):
- MIT
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause

Review required (يحتاج مراجعة):
- ISC
- MPL-2.0
- LGPL
- GPL

Restrictive / study-only baseline:
- AGPL-3.0
- SSPL-1.0
- BUSL-1.1

License غير واضح أو `NOASSERTION` = REJECT في الاكتشاف الأولي حتى تحقق يدوي لاحق.

## Decisions (القرارات)

- USE: لا يصدر من Discovery وحده. يحتاج كل البوابات النهائية مستقبلاً.
- ADAPT: مناسب للاستفادة خلف Adapter (موصل) أو تكييف الفكرة.
- STUDY: للدراسة/المرجع فقط.
- WATCH: مرشح جيد للمراقبة والفحص الأعمق.
- REJECT: لا يدخل المسار الحالي.

كل Candidate (مرشح) مكتشف في هذه المرحلة يحمل دائماً:
- `deepScanStatus = pending`
- `integrationAllowed = false`

ولا يستطيع التطبيق قلب `integrationAllowed` إلى true تلقائياً.

## Watchlist (قائمة المراقبة)

- محلية في `localStorage`.
- حتى 60 مرشحاً.
- يمكن تصديرها JSON من الهاتف.
- الحفظ في Watchlist لا يعني قبول المشروع.

## Deep Static Scan (الفحص العميق الساكن)

Workflow: `.github/workflows/oss-candidate-scan.yml`

يُشغّل يدوياً فقط على Public Repository (مستودع عام) بصيغة `owner/name`.

### قواعد Zero-Trust (الثقة الصفرية)

النسخ يتم بـanonymous HTTPS (HTTPS مجهول) وليس `actions/checkout` على المرشح:
- لا GitHub Token يُمرر إلى المستودع الخارجي.
- `GIT_TERMINAL_PROMPT=0`.
- `credential.helper=` فارغ.
- shallow clone بعمق 1.
- no tags افتراضياً.
- no submodules.
- بعد الجلب يحذف `origin` ثم يحذف `.git` من نسخة المرشح.

### Symlink Protection (حماية الروابط الرمزية)

Repo غير موثوق قد يضع Symlink (رابطاً رمزياً) يشير إلى ملف خارج مجلد المرشح. لذلك:
- كل Symlink يتم تجاهله ولا يُقرأ.
- كل ملف عادي يُحل مساره ويجب أن يبقى داخل Candidate Root.
- `package.json` و`package-lock.json` لا يُستعملان في فحص npm إذا كان أي منهما Symlink.

الفحص لا ينفذ كود المرشح:
- لا `npm install`.
- لا npm scripts.
- لا `pip install`.
- لا build.
- لا tests.
- لا project executable.
- لا `cargo build`.
- لا `go run`.

### ما الذي يقرأه؟

- License/NOTICE/COPYING filenames.
- Dependency/build manifests.
- package.json metadata بدون تشغيل scripts.
- Heuristic Secret Signals (إشارات أسرار احتمالية) مع طباعة path + type فقط، وليس قيمة السر.
- إذا وُجد `package-lock.json` عادي وصغير ضمن الحدود: يسمح بـ`npm audit` فقط كفحص Registry دون Install ودون scripts.

الفحص محدود بـ6000 ملف، والملف المقروء للفحص الساكن ≤1MB. Package lock الخاص بـnpm يجب أن يكون ≤2MB قبل audit.

### NPM Audit Isolation (عزل فحص npm)

حتى `npm audit` لا يثق بإعدادات المرشح:
- `npm_config_userconfig=/dev/null`.
- `npm_config_globalconfig=/dev/null`.
- Registry مثبت إلى `https://registry.npmjs.org/`.
- `npm_config_ignore_scripts=true`.
- Timeout = 45 ثانية.
- لا Install ولا Lifecycle Script.

## Deep Scan Result (نتيجة الفحص)

التقرير Evidence (دليل مراجعة) فقط:
- لا يكتب إلى Agent Registry.
- لا يكتب Workflow.
- لا يفعّل Tool.
- لا يستدعي MCP.
- لا يدمج كوداً.
- لا يغيّر `integrationAllowed=false`.

حتى نجاح Deep Static Scan لا يكفي وحده لـUSE؛ ما زالت مراجعة الترخيص، النسخة المثبتة، Sandbox Test (اختبار العزل)، خطة Rollback (التراجع)، ومراجعة بشرية مطلوبة حسب نوع المشروع.

## التكلفة

- لا API مدفوعة.
- GitHub Search العام دون Token من التطبيق.
- GitHub Actions تستخدم حساب المشروع الحالي؛ لا يوجد شراء أو ترقية تلقائية من الكود.
- Mandatory additional spend (الإنفاق الإضافي الإلزامي): **0 USD**.
