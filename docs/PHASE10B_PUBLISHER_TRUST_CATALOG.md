# Phase 10B — Publisher Trust & Community Catalog (ثقة الناشر والدليل المجتمعي)

## الهدف

Phase 10B تضيف طبقة Trust (ثقة) فوق Template Packages (حزم القوالب) من Phase 10A من دون تحويل Community Catalog (الدليل المجتمعي) إلى Marketplace ينفذ أو يثبت ملفات من الإنترنت.

المسار:

`Signed Catalog File → Ed25519 Verification → Publisher Fingerprint → Manual Trust Pin → Template Digest Match`

ولا يوجد:

`Catalog URL → Auto Fetch → Auto Trust → Auto Install → Auto Run`

## البروتوكول

الإصدار:

`agent-ia-factory.catalog/0.1`

الحزمة من نوع:

`community-catalog`

كل Catalog Package تحتوي:
- Published timestamp.
- Publisher ID وDisplay Name.
- Ed25519 Public Key.
- SHA-256 Fingerprint للمفتاح العام.
- Catalog ID وSemVer.
- Entries لقوالب `agent-template` فقط في 10B.
- Ed25519 Signature على Canonical JSON لكل المحتوى ما عدا حقل Signature نفسه.

لا يوجد داخل Package حقل `trusted` أو `approved` أو `install`.

## لماذا Ed25519

Ed25519 يعطي توقيعًا صغيرًا وثابت البنية ويمكن التحقق منه عبر WebCrypto (تشفير المتصفح) من دون Dependency خارجية.

Phase 10B لا تحفظ Private Key (المفتاح الخاص) ولا تنشئ خزنة مفاتيح. دالة إنشاء Catalog الموقّع تقبل `CryptoKeyPair` من المستدعي وتستعمل المفتاح الخاص في الذاكرة فقط. واجهة الهاتف الحالية Verification-First (للتحقق أولًا) ولا توفر إدارة مفتاح خاص.

## Signature Valid ليست Trusted Publisher

هذه هي القاعدة المركزية:

**توقيع Ed25519 صالح يثبت أن من يملك المفتاح الخاص المقابل وقّع هذا المحتوى؛ لا يثبت أن صاحب المفتاح شخص موثوق أو جهة حقيقية بعينها.**

لذلك:
- أي مهاجم يمكنه إنشاء Key Pair خاص به وتوقيع Catalog صالح.
- المصنع يعرضه `Untrusted` حتى لو كان التوقيع صحيحًا 100%.
- الثقة لا تأتي من Catalog نفسه.
- الثقة تحتاج Human Approval (موافقة بشرية) على Fingerprint بعد التحقق منها عبر قناة يثق بها المستخدم.

## Fingerprint Pinning (تثبيت البصمة)

Fingerprint = SHA-256 للـ32-byte Ed25519 Public Key ثم Base64URL.

Trust Store المحلي يحفظ فقط:
- Publisher ID.
- Display Name.
- Public Key.
- Fingerprint.
- وقت الثقة.
- `source=human-pinned`.

لا يحفظ:
- Private Key.
- Token.
- Password.
- API key.
- Catalog contents كاملة.

الثقة في `localStorage` هي إعداد محلي للـPWA وليست حماية ضد اختراق Origin (أصل الموقع) نفسه. إذا تم اختراق كود الموقع الموثوق، فكل إعداد محلي داخل ذلك الأصل يصبح ضمن نموذج الخطر. لذلك Code Integrity وCI وأمن الاستضافة تبقى طبقات منفصلة.

## Key Change / Rotation (تغيير المفتاح)

إذا ظهر Catalog جديد بنفس Publisher ID لكن Public Key/Fingerprint مختلفين:

`status = key-changed`

ولا يرث المفتاح الجديد ثقة القديم.

لا يمكن الاستبدال بمجرد Trust checkbox العادي. يلزم:
1. Human Approval للثقة.
2. إقرار صريح مستقل بأن المستخدم يوافق على Replace Existing Key.

بدون ذلك:

`PUBLISHER_KEY_CHANGE_REQUIRES_EXPLICIT_REPLACE`

لا Automatic Key Rotation في 10B.

## Revoke Trust (إلغاء الثقة)

إلغاء ثقة Publisher يحتاج Human Approval منفصلة.

إلغاء الثقة:
- لا يحذف Catalog.
- لا يحذف Template.
- لا يشغّل شيئًا.
- فقط يزيل البصمة من Trust Store المحلي.

## Community Catalog Entry

كل Entry في 10B هي `agent-template` فقط وتحتوي:
- Template ID.
- Template SemVer.
- Template SHA-256 Digest القادم من Phase 10A.
- Title/Summary.
- SPDX License.
- GitHub Repository root URL.
- Exact 40-hex Commit SHA.
- Relative source path منتهٍ بـ`.agent-template.json`.
- Tags محدودة.

## Publisher-Attested Provenance (مصدر يقر به الناشر)

الـRepository + Commit + Path مربوطة بتوقيع Publisher، لذلك لا يستطيع طرف تعديل هذه الإحداثيات بعد التوقيع من دون كسر Signature.

لكن Phase 10B **لا تدعي Independent GitHub Provenance Verification**:
- الـPWA لا تجلب Commit من GitHub تلقائيًا.
- لا تتحقق في 10B أن الملف موجود فعلًا في ذلك Commit.
- لا تعتبر GitHub username هوية قانونية أو شخصية مثبتة.

المعنى الدقيق هو:

> الناشر صاحب المفتاح الموقّع يقر أن هذا Template Digest مرتبط بهذه الإحداثيات في GitHub.

Independent repository/content verification يمكن إضافتها لاحقًا كبوابة مستقلة دون تغيير نموذج الثقة الحالي.

## GitHub Source Safety

Repository يجب أن تكون:

`https://github.com/<owner>/<repo>`

وممنوع:
- HTTP.
- Credentials في URL.
- Query string.
- Fragment.
- Port مخصص.
- Host غير `github.com`.

Commit يجب أن يكون 40 hexadecimal chars.

Path:
- Relative فقط.
- لا `..` أو `.` segments.
- لا backslashes.
- لا `//`.
- بحد أقصى 12 segments.
- ينتهي بـ`.agent-template.json`.

## License Gate (بوابة الترخيص)

Catalog community entry لا تقبل في 10B إلا:
- MIT
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause
- CC0-1.0

AGPL/SSPL/BUSL/GPL وغير المصنفة لا تدخل Community Catalog baseline حتى لا يتحول الدليل إلى مسار يتجاوز سياسة التراخيص المحافظة للمصنع.

هذا ليس Legal Advice (استشارة قانونية)، بل Gate تشغيلية محافظة.

## Template Match (مطابقة القالب)

المستخدم يستطيع اختيار Template Package محليًا بعد تحميل Catalog.

المصنع يمرر الملف أولًا عبر Phase 10A validation ثم يطابق:
- Template ID.
- Version.
- SHA-256 Digest.

إذا تطابقت الثلاثة، يظهر Match.

**Match لا يعني Install.**

لا يتم:
- حفظ Agent.
- إنشاء Workflow.
- تشغيل Run.
- تفعيل Tool/MCP.
- تنزيل شيء من GitHub.

التثبيت يبقى في Template Exchange من Phase 10A وبموافقة بشرية مستقلة.

## Secret-like Content Gate (بوابة المحتوى الشبيه بالأسرار)

النصوص الوصفية الموقعة داخل Catalog تمر محليًا عبر نفس Defense-in-Depth (الحماية الإضافية) المستعملة في Phase 10A.

يشمل الفحص النصوص مثل:
- Publisher display name.
- Catalog name/description.
- Entry title/summary.
- Tags ومعلومات المصدر النصية.

ويستبعد عمدًا Public Key وSignature وSHA-256 Digest لأنها قيم تشفيرية عامة وليست Secrets.

إذا ظهر نمط معروف مثل Private Key أو `api_key=...` أو Token/Credential assignment، يُرفض إنشاء أو استيراد Catalog بـ`TEMPLATE_SECRET_LIKE_CONTENT` قبل الثقة أو المطابقة.

هذا الفحص **Defense-in-Depth** ولا يدعي اكتشاف كل سر ممكن، ولا يرسل المحتوى إلى شبكة أو خدمة خارجية.

## Limits (الحدود)

- Catalog JSON: 300,000 chars كحد أقصى.
- Entries: 1–80.
- Tags: حتى 12 لكل Entry.
- Public Key: Ed25519 raw 32 bytes/Base64URL.
- Signature: Ed25519 64 bytes/Base64URL.
- Trusted publishers local: حتى 32.
- New production dependencies: 0.
- Mandatory additional spend: 0 USD.

## Phone UX (واجهة الهاتف)

Community Catalog Center تعرض:
- Import Signed Catalog من ملف محلي.
- Signature status.
- Publisher ID/Name.
- Full Fingerprint مع عرض مختصر في البطاقة.
- Trust status: `untrusted / trusted / key-changed`.
- Explicit Trust checkbox.
- Explicit key-replacement checkbox عند تغير المفتاح.
- Explicit Revoke checkbox.
- Entries ومصدر GitHub الموقّع.
- Template file matching.

لا Background Fetch ولا Auto Install.

## Security Boundaries (حدود الأمان)

Phase 10B تتعمد منع:
- Trust self-assertion داخل Catalog.
- Automatic trust on valid signature.
- Automatic key rotation.
- Private-key persistence.
- Secret-like catalog metadata من المرور بصمت.
- Catalog network fetch.
- Install-by-URL.
- Template auto-download.
- Template auto-install.
- Agent auto-run.
- Tool/MCP activation.
- Paid API.

## Acceptance (القبول)

لا تُقبل Phase 10B إلا إذا نجحت:
1. Phase 0→10B validators + TypeScript + Production Build.
2. Phase 8 و9A/9B/9C/9D regression smoke.
3. Phase 10A template regression smoke.
4. Ed25519 signed catalog verification.
5. Canonical signing payload validation.
6. Public-key fingerprint binding.
7. Self-signed attacker catalog remains `untrusted`.
8. Pin without Human Approval rejected.
9. Human-approved pin produces `trusted`.
10. Private signing key absent from localStorage.
11. Same Publisher ID + new key => `key-changed`.
12. Key replacement without explicit replace approval rejected.
13. Explicit key replacement succeeds and old key loses trusted status.
14. Trust revocation requires approval.
15. Catalog content tampering rejected.
16. Hidden `trusted` field rejected.
17. Unsafe/non-GitHub source URL rejected.
18. Path traversal rejected.
19. Non-baseline license such as AGPL rejected.
20. Secret-like metadata داخل Catalog تُرفض محليًا.
21. Phase 10A Template digest match succeeds without install/run side effects.
22. Production dependency audit.
23. Full dependency audit.
24. Phase 7A real Chrome smoke on the same PR.
25. New production dependencies = 0.
26. Mandatory additional spend = 0 USD.
