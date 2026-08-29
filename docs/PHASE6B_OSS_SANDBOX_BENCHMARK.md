# Phase 6B — OSS Static Sandbox Readiness Benchmark

## الهدف

إكمال بند `Sandbox Benchmark` الموجود في Roadmap (خارطة الطريق) دون كسر قاعدة Phase 6 الأساسية: **لا تشغيل لكود الطرف الثالث داخل المصنع**.

Phase 6B تحول Evidence (الأدلة) الناتجة من `OSS Candidate Deep Scan` إلى Benchmark (اختبار معياري) حتمي وقابل للمراجعة:

`Watchlist Candidate → Deep Static Scan Artifact v2 → NPM Audit Signal → Static Benchmark → Evidence / Limitations / Decision`

## تسمية دقيقة

هذه المرحلة هي:

**Static Sandbox Readiness Benchmark (اختبار جاهزية العزل الساكن)**

وليست:

**Execution Sandbox (عزل تنفيذ فعلي لكود المرشح)**

لذلك كل نتيجة تحمل دائماً:
- `executionSandboxPerformed = false`
- `candidateCodeExecuted = false`
- `integrationAllowed = false`
- `monetaryCostUsd = 0`

ولا يُسمح للواجهة أو التخزين بتغيير هذه القيم.

## Artifact v2

Workflow `.github/workflows/oss-candidate-scan.yml` ما زالت:
- anonymous HTTPS clone.
- no GitHub token passed to candidate.
- no submodules.
- LFS smudge disabled.
- symlinks disabled where supported + scanner skips them.
- لا `npm install`.
- لا lifecycle scripts.
- لا candidate build/test/run.
- لا pip/cargo/go project execution.

لكن `oss-static-report.json` أصبحت Schema v2 وتضيف Observations ساكنة:
- `sourceFilesObserved`.
- `testFilesObserved`.
- `ciConfigsObserved`.
- `readmeObserved`.

هذه **مشاهدات وجود** فقط. وجود Test Files أو CI لا يعني أنها نجحت، لأن Phase 6B لا تشغلها.

## NPM Audit Signal

`npm-audit-summary.json` يبقى فحص Registry دون Install:
- project npm config معزولة.
- official npm registry مثبتة.
- scripts ignored.
- no install.

إذا كان audit غير متاح، Benchmark لا تفترض الأمان؛ تسجل Limitation وتخفض القرار إلى WATCH في المسار المفضل.

إذا ظهر:
- High vulnerability > 0 → Hard Block / REJECT.
- Critical vulnerability > 0 → Hard Block / REJECT.

## Secret Signals

أي Heuristic Secret Signal (إشارة سر محتمل) في Artifact تصبح Hard Block وتؤدي إلى REJECT.

القيمة السرية نفسها لا تُخزن في التقرير؛ فقط file path + signal type كما في Phase 6.

## Scoring

الحد الأقصى 100:
- Isolation Evidence: 20.
- Static Coverage: 20.
- Security Signals: 30.
- Supply Chain / License: 20.
- Project Health: 10.

### Static Coverage

تستعمل فقط أدلة ساكنة:
- ملفات فُحصت.
- source files observed.
- manifests.
- license files.
- README.
- test files observed.
- CI configs observed.

### Project Health

تستفيد من Metadata الموجودة أصلًا في Candidate:
- maintenance score.
- repository health.
- adoption.
- test+CI presence.

ولا تستخدم Popularity (الشعبية) كبديل عن Security (الأمان).

## Decisions

Phase 6B تستعمل نفس Decision Vocabulary:
- `USE`
- `ADAPT`
- `STUDY`
- `WATCH`
- `REJECT`

لكن **USE مقفلة عمداً في Static-Only Mode**.

أفضل نتيجة ممكنة حالياً هي `ADAPT` إذا:
- لا Hard Blocks.
- Preferred license.
- npm audit متاحة وصالحة ولا High/Critical.
- Static coverage كافية.
- Total score مرتفعة.

`ADAPT` هنا تعني: مرشح قوي للتكييف/الربط بعد مراجعات إضافية. لا تعني Integration Permission.

### Fail Closed

- Secret signal → REJECT.
- High/Critical npm vulnerability → REJECT.
- archived/disabled repository → REJECT.
- unknown/unaccepted license → REJECT.
- review-required/restrictive license → STUDY.
- missing/failed npm audit → WATCH/STUDY حسب بقية الأدلة.
- insufficient static coverage → WATCH/STUDY.

## لماذا USE مقفلة؟

لأن Deep Static Scan لا تختبر سلوك الكود أثناء التنفيذ. الوصول إلى USE مستقبلاً يحتاج طبقة أقوى منفصلة، مثل:
- disposable execution environment.
- no secrets.
- no host mounts.
- strict CPU/RAM/time limits.
- default-deny network.
- syscall/process isolation.
- deterministic benchmark task.
- cleanup after run.
- human review of the exact pinned commit.

ولا نضيف هذه الطبقة قبل إثبات أن عزلها أقوى من المخاطر التي تدخلها.

## Phone UX

داخل OSS Harvester:
1. احفظ Candidate في Watchlist.
2. شغّل `OSS Candidate Deep Scan` يدويًا من GitHub Actions.
3. حمّل Artifact التي تحتوي:
   - `oss-static-report.json`
   - `npm-audit-summary.json`
4. استورد الملفين من الهاتف.
5. شغّل Static Benchmark.
6. راجع Score + Hard Blocks + Evidence + Limitations.
7. حفظ Evidence يحتاج Human Approval منفصلة.

الحفظ لا يفعّل Integration ولا Tool ولا Adapter.

## Storage

- نتائج Benchmark محلية في `localStorage`.
- حد أقصى 40 نتيجة.
- نتيجة واحدة حديثة لكل Repository في الحفظ الحالي.
- Save يحتاج Human Approval.
- Delete يحتاج Human Approval.

## Security Invariants

`ossBenchmark.ts` ممنوع أن يحتوي مسارًا لـ:
- `fetch`.
- XMLHttpRequest/WebSocket.
- MCP calls.
- Tool execution.
- Agent/Workflow installation.
- dynamic code execution.
- candidate commands.

Benchmark Engine تعالج JSON evidence فقط.

## الاختبارات

Smoke Test تثبت:
- clean preferred-license candidate → ADAPT، وليس USE.
- secret signal → REJECT.
- High/Critical vulnerability → REJECT.
- unavailable npm audit → WATCH، لا افتراض أمان.
- review/restrictive license → STUDY.
- unknown license → REJECT.
- report/candidate mismatch → reject.
- hidden fields / `integrationAllowed=true` injection → reject.
- Benchmark نفسها side-effect free.
- Save/Delete تحتاج Human Approval.
- لا Agent/Run/Workflow/Tool/Adapter side effects.

## التكلفة

Mandatory additional spend = **0 USD**.

لا Production Dependency جديدة مطلوبة في Phase 6B.
