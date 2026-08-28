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

Checkout:
- `persist-credentials: false`
- `fetch-depth: 1`
- `submodules: false`
- `lfs: false`

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
- إذا وُجد `package-lock.json`: يسمح بـ`npm audit` فقط كفحص Registry دون Install ودون scripts.

الفحص محدود بعدد ملفات وحجم قراءة، ولا يتبع submodules.

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
