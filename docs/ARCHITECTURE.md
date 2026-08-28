# Architecture (المعمارية)

## الهدف

Agent IA Factory (مصنع وكلاء الذكاء الاصطناعي) ليس Agent Framework (إطار وكلاء) واحداً، بل **Control Plane (طبقة تحكم)** فوق مجموعة قابلة للاستبدال من Runtimes (محركات تشغيل)، Models (نماذج)، Tools (أدوات)، Memory Backends (أنظمة ذاكرة)، وExecution Environments (بيئات تنفيذ).

## القاعدة الذهبية

كل مكوّن خارجي يدخل خلف Interface (واجهة) أو Adapter (موصل). لا نسمح لكود التطبيق أن يعتمد مباشرة على مزوّد واحد إذا كان يمكن تجنّب ذلك.

## الطبقات

### 1. Mobile PWA (تطبيق ويب للهاتف)
واجهة عربية أولاً، تعمل من Safari/Chrome، قابلة للإضافة للشاشة الرئيسية، وتوفر:
- إنشاء Agent (وكيل).
- تعديل التعليمات.
- اختيار الأدوات والصلاحيات.
- تشغيل وإيقاف الوكلاء.
- متابعة النتائج والسجلات.
- الموافقة على الأفعال الحساسة.
- إدارة Teams (فرق الوكلاء).

### 2. Factory Control Plane (طبقة تحكم المصنع)
مسؤولة عن:
- Agent Registry (سجل الوكلاء).
- Versioning (إدارة النسخ).
- Configuration (الإعدادات).
- Permissions (الصلاحيات).
- Budgets (الميزانيات).
- Deployment States (حالات التشغيل).
- Audit Log (سجل التدقيق).

### 3. Agent Core (نواة الوكيل)
تعريف موحد للوكيل لا يعتمد على Framework (إطار عمل) بعينه. كل Agent يمتلك:
- Identity (هوية).
- Instructions (تعليمات).
- Model Policy (سياسة اختيار النموذج).
- Tool Policy (سياسة الأدوات).
- Memory Policy (سياسة الذاكرة).
- Approval Policy (سياسة الموافقات).
- Resource Limits (حدود الموارد).
- Evaluation Profile (ملف التقييم).

### 4. Runtime Adapters (موصلات محركات التشغيل)
المرشحون الأوائل:
- Pydantic AI (بايدانتك للذكاء الاصطناعي).
- LangGraph (لانغ غراف).
- OpenAI Agents SDK (حزمة وكلاء أوبن أي آي) كموصل اختياري، وليس تبعية إلزامية.
- Microsoft Agent Framework (إطار وكلاء مايكروسوفت) كموصل اختياري.

لا Runtime (محرك تشغيل) يصبح نقطة فشل وحيدة.

### 5. Model Router (موجّه النماذج)
يختار النموذج حسب:
- Zero-Cost Policy (سياسة التكلفة الصفرية).
- الجهاز المتاح.
- حجم المهمة.
- الخصوصية.
- زمن الاستجابة.
- جودة النموذج.

الأولوية الحالية:
1. Local/Open Model (نموذج محلي أو مفتوح).
2. Free-Tier Provider (مزود بحصة مجانية آمنة).
3. Paid Provider (مزود مدفوع) = معطل افتراضياً في الوضع الحالي.

### 6. Tool Layer (طبقة الأدوات)
كل Tool (أداة) تُعرّف بعقد موحد:
- اسم ووصف.
- Input Schema (مخطط المدخلات).
- Output Schema (مخطط المخرجات).
- Permissions (الصلاحيات).
- Risk Level (درجة الخطورة).
- Timeout (مهلة التنفيذ).
- Network Policy (سياسة الشبكة).

MCP (بروتوكول سياق النموذج) معيار رئيسي، لكن كل MCP Server (خادم MCP) يمر عبر Security Gate (بوابة أمنية).

### 7. Workflow Engine (محرك سير العمل)
يدعم:
- Sequential (تسلسلي).
- Parallel (متوازي).
- Supervisor/Workers (مشرف/عمال).
- Event Driven (مدفوع بالأحداث).
- Human-in-the-Loop (إنسان داخل الحلقة).
- Retry/Resume (إعادة المحاولة والاستئناف).

### 8. Memory Layer (طبقة الذاكرة)
أنواع الذاكرة:
- Session Memory (ذاكرة الجلسة).
- Long-Term Memory (ذاكرة طويلة الأمد).
- Shared Team Memory (ذاكرة فريق مشتركة).
- Private Agent Memory (ذاكرة وكيل خاصة).

يجب أن تكون الذاكرة قابلة للتصدير والحذف، ولا يُسمح بتخزين Secret (سر) داخلها كنص عادي.

### 9. Policy Engine (محرك السياسات)
سياسات حتمية قدر الإمكان، منها:
- أقل صلاحيات.
- حظر الدفع التلقائي.
- حظر حذف الموارد دون تفويض.
- حظر إرسال أسرار للنماذج.
- Human Approval (موافقة بشرية) للأفعال عالية الخطورة.

### 10. Sandbox (بيئة العزل)
أي Code Execution (تشغيل كود)، Browser Automation (أتمتة متصفح)، أو Tool (أداة) غير موثوقة يجب أن تعمل في بيئة معزولة بحدود CPU/RAM/وقت/شبكة/ملفات.

### 11. Evaluation (التقييم)
كل Agent يمر قبل Production (الإنتاج) عبر:
- Functional Tests (اختبارات وظيفية).
- Security Tests (اختبارات أمنية).
- Tool-Use Tests (اختبارات استخدام الأدوات).
- Failure Recovery (استعادة بعد الفشل).
- Cost Test (اختبار التكلفة).
- Regression Tests (اختبارات عدم التراجع).

### 12. Observability (المراقبة)
كل Run (تشغيل) يسجل على الأقل:
- run_id
- agent_id
- model/provider
- tools called
- start/end time
- success/failure
- approvals
- resource usage
- monetary cost estimate
- evaluation result

## حدود Phase 1 (المرحلة الأولى)

أول نسخة عاملة يجب أن تنفذ فقط ما يلي بإتقان:
1. إنشاء Agent من الهاتف.
2. حفظ Agent Spec (مواصفات الوكيل).
3. تشغيل Agent واحد عبر Runtime Adapter واحد.
4. ربط Tool (أداة) تجريبية آمنة.
5. سجل تشغيل واضح.
6. Human Approval (موافقة بشرية) لأداة حساسة تجريبية.
7. إثبات أن التكلفة الإلزامية = 0$.

لا نضيف تعقيد Multi-Agent (متعدد الوكلاء) قبل نجاح هذه النواة.