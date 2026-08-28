# Agent IA Factory (مصنع وكلاء الذكاء الاصطناعي)

> **We build the factory, not another agent. (نحن نبني المصنع، لا وكيلاً آخر فقط.)**

Agent IA Factory (مصنع وكلاء الذكاء الاصطناعي) مشروع طويل الأمد لبناء منصة **Mobile-First (الهاتف أولاً)** و**Zero-Cost-First (المجاني أولاً)** لإنشاء وتجهيز وربط واختبار ومراقبة وتشغيل وكلاء الذكاء الاصطناعي من الهاتف، مع الاستفادة القصوى من **Open Source (المصادر المفتوحة)** دون ربط المشروع بمزوّد واحد.

## المبادئ الأساسية

1. **Phone-Only Friendly (مناسب للهاتف فقط):** الاستعمال والإدارة اليومية يجب أن تكون ممكنة من الهاتف.
2. **Zero-Cost-First (المجاني أولاً):** لا خدمة مدفوعة إلزامية لتشغيل النسخة الأساسية.
3. **No Vendor Lock-in (لا ارتهان لمزوّد واحد):** كل Model (نموذج) أو Framework (إطار عمل) أو Tool (أداة) يجب أن يكون قابلاً للاستبدال عبر Adapter (موصل).
4. **Open Source First (المصادر المفتوحة أولاً):** نعطي الأولوية لتراخيص MIT وApache-2.0 وBSD وما يماثلها.
5. **Secure by Default (الأمان افتراضياً):** أقل صلاحيات، لا أسرار في Git، وتشغيل الأدوات الخطرة داخل Sandbox (بيئة معزولة).
6. **Human Approval (موافقة بشرية):** الأفعال الحساسة يمكن أن تتطلب موافقة المستخدم قبل التنفيذ.
7. **Observable (قابل للمراقبة):** كل Run (تشغيل) له سجل واضح للمدخلات والأدوات والنتائج والأخطاء والتكلفة.
8. **Test Before Trust (اختبر قبل أن تثق):** لا مكوّن ولا Agent (وكيل) يدخل Production (الإنتاج) قبل Evals (اختبارات تقييم) وفحص أمني.

## المعمارية المختصرة

```text
Mobile PWA (تطبيق ويب للهاتف)
        |
Factory Control Plane (لوحة تحكم المصنع)
        |
Agent Builder (منشئ الوكلاء)
        |
Agent Core (نواة الوكيل)
  |-- Model Router (موجّه النماذج)
  |-- Tool / MCP Layer (طبقة الأدوات وMCP)
  |-- Memory Layer (طبقة الذاكرة)
  |-- Workflow Engine (محرك سير العمل)
  |-- Policy Engine (محرك السياسات)
  |-- Sandbox (بيئة العزل)
  |-- Evaluation (التقييم)
  `-- Observability (المراقبة)
```

## الملفات الأساسية

- `docs/ARCHITECTURE.md` — Architecture (المعمارية).
- `docs/SECURITY_MODEL.md` — Security Model (نموذج الأمان).
- `docs/ZERO_COST_POLICY.md` — Zero-Cost Policy (سياسة التكلفة الصفرية).
- `docs/PHONE_ONLY_MODE.md` — Phone-Only Mode (وضع الهاتف فقط).
- `docs/ROADMAP.md` — Roadmap (خارطة الطريق).
- `docs/PHASE_0_ACCEPTANCE.md` — شروط قبول Phase 0 (المرحلة صفر).
- `schemas/agent-spec.schema.json` — Agent Specification (مواصفات الوكيل).
- `catalog/OSS_CATALOG.yaml` — Open Source Catalog (دليل المصادر المفتوحة).

## الحالة الحالية

**Phase 0 — Foundation (المرحلة صفر — الأساس): قيد البناء.**

الهدف من هذه المرحلة هو تثبيت القواعد قبل كتابة Runtime (محرك التشغيل): المعمارية، الأمن، التكلفة، مواصفات الوكيل، ودليل المشاريع المفتوحة المصدر.
