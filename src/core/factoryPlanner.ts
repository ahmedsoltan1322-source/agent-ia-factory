import { createDefaultAgent } from './createAgent'
import { deleteAgent, loadAgents, saveAgent } from './storage'
import {
  buildLinearTeamWorkflow,
  deleteWorkflow,
  saveWorkflow,
  validateWorkflowDefinition,
  type WorkflowDefinition,
} from './workflowEngine'
import type { AgentSpec, RuntimeAdapterId } from './types'

export type FactoryDomain = 'software' | 'research_content' | 'support' | 'business_ops' | 'general'
export type FactoryPlanStatus = 'draft' | 'validated' | 'installed'

export interface FactoryRolePlan {
  id: string
  name: string
  purpose: string
  instructions: string
  suggestedToolIds: string[]
}

export interface FactoryAcceptanceTest {
  id: string
  title: string
  description: string
  required: true
}

export interface FactoryBlueprint {
  schemaVersion: '0.1'
  id: string
  status: FactoryPlanStatus
  goal: string
  domain: FactoryDomain
  domainLabel: string
  runtimeAdapter: RuntimeAdapterId
  createdAt: string
  teamName: string
  roles: FactoryRolePlan[]
  acceptanceTests: FactoryAcceptanceTest[]
  workflow: {
    approvalBetweenAgents: true
    maxAgents: number
  }
  policy: {
    maxMonetarySpendUsd: 0
    allowPaidModels: false
    enableSuggestedToolsAutomatically: false
    automaticExecutionAfterInstall: false
    humanApprovalRequiredToInstall: true
  }
  checks: string[]
}

export interface FactoryValidationResult {
  valid: boolean
  checks: string[]
  violations: string[]
}

export interface FactoryInstallResult {
  blueprint: FactoryBlueprint
  agents: AgentSpec[]
  workflow: WorkflowDefinition
  allAgents: AgentSpec[]
  checks: string[]
}

export interface FactoryAuditRecord {
  id: string
  blueprintId: string
  action: 'planned' | 'validated' | 'installed' | 'install_failed'
  createdAt: string
  monetaryCostUsd: 0
  checks: string[]
  error?: string
}

interface DomainTemplate {
  domain: FactoryDomain
  label: string
  keywords: string[]
  roles: Array<{
    id: string
    name: string
    purpose: string
    instructions: string
    suggestedToolIds: string[]
  }>
}

const BLUEPRINT_STORAGE_KEY = 'agent-ia-factory.factory-blueprints.v1'
const FACTORY_AUDIT_KEY = 'agent-ia-factory.factory-audit.v1'
const MAX_BLUEPRINTS = 10
const MAX_AUDIT_RECORDS = 60
const MAX_GOAL_CHARS = 6_000
const MAX_ROLE_COUNT = 6
const MIN_ROLE_COUNT = 2
const REVIEWER_KEYWORDS = ['مراجع', 'جودة', 'اختبار', 'تدقيق', 'review', 'qa', 'tester', 'security']

const COMMON_SAFETY_INSTRUCTIONS = [
  'اعمل فقط ضمن الهدف المحدد لك ولا توسع النطاق من تلقاء نفسك.',
  'الإنفاق المالي الإلزامي يجب أن يبقى 0$. لا تقترح عملية مدفوعة كشرط للتنفيذ.',
  'لا تفعل أي Tool (أداة) أو MCP (بروتوكول سياق النموذج) تلقائياً. الأدوات المقترحة مجرد توصيات حتى يراجعها المستخدم.',
  'لا تنفذ كتابة خارجية أو حذفاً أو تغييراً أمنياً دون بوابة الصلاحيات والموافقة البشرية.',
  'مرر للوكيل التالي النتيجة العملية والأدلة اللازمة فقط، ولا تعرض سلسلة التفكير الخاصة.',
  'إذا كانت المعلومات غير كافية فاذكر النقص بوضوح ولا تختلق حقيقة.',
].join('\n')

const DOMAIN_TEMPLATES: DomainTemplate[] = [
  {
    domain: 'software',
    label: 'برمجة وتطوير برمجيات',
    keywords: [
      'تطبيق', 'موقع', 'برمجة', 'برنامج', 'كود', 'شفرة', 'github', 'ويب', 'اندرويد', 'آيفون', 'ios', 'android',
      'app', 'website', 'software', 'code', 'coding', 'developer', 'api', 'frontend', 'backend', 'database', 'deploy',
    ],
    roles: [
      {
        id: 'architect',
        name: 'مهندس الحل',
        purpose: 'تحويل الهدف إلى معمارية ونطاق واضح قبل كتابة التنفيذ.',
        instructions: 'حلل المطلوب إلى مكونات وحدود وواجهات وتدفقات بيانات. حدد المخاطر والافتراضات ومعايير النجاح. لا تكتب ميزات غير مطلوبة.',
        suggestedToolIds: ['local.memory.search'],
      },
      {
        id: 'builder',
        name: 'وكيل التنفيذ البرمجي',
        purpose: 'تحويل المعمارية إلى تنفيذ عملي قابل للاختبار.',
        instructions: 'ابنِ الحل بأبسط بنية تحقق المتطلبات. حافظ على الفصل بين المكونات، وتجنب التبعيات غير الضرورية، واكتب مخرجات قابلة للمراجعة والاختبار.',
        suggestedToolIds: ['local.memory.search', 'local.memory.add'],
      },
      {
        id: 'tester',
        name: 'وكيل الاختبارات والجودة',
        purpose: 'محاولة كسر التنفيذ والتحقق من حالات النجاح والفشل والحواف.',
        instructions: 'صمم اختبارات قبول، وحالات حافة، واختبارات رجوع. لا تعتبر النجاح ثابتاً بلا دليل. أرجع قائمة واضحة بالأخطاء وخطوات إعادة إنتاجها.',
        suggestedToolIds: ['local.text.stats', 'local.memory.search'],
      },
      {
        id: 'security-reviewer',
        name: 'المراجع الأمني النهائي',
        purpose: 'مراجعة الأمن والخصوصية والصلاحيات قبل اعتماد النتيجة.',
        instructions: 'راجع التهديدات، الأسرار، الصلاحيات، الإدخال غير الموثوق، حدود الموارد، والتبعيات. ارفض الاعتماد عند وجود ثغرة عالية أو مسار يتجاوز الموافقة.',
        suggestedToolIds: ['local.memory.search'],
      },
    ],
  },
  {
    domain: 'research_content',
    label: 'بحث ومحتوى وتحليل',
    keywords: [
      'بحث', 'تقرير', 'مقال', 'محتوى', 'منشور', 'كتابة', 'تلخيص', 'تحليل', 'مصادر', 'دراسة', 'مقارنة', 'موضوع',
      'research', 'report', 'article', 'content', 'write', 'writer', 'summary', 'analysis', 'sources', 'compare',
    ],
    roles: [
      {
        id: 'researcher',
        name: 'وكيل البحث',
        purpose: 'تفكيك السؤال وجمع الحقائق والأدلة المتاحة داخل مصادر المصنع.',
        instructions: 'حدد أسئلة البحث، وافصل الحقائق عن الاستنتاجات، وسجل الأدلة ومواطن عدم اليقين. لا تخترع مصدراً أو رقماً.',
        suggestedToolIds: ['local.memory.search'],
      },
      {
        id: 'analyst-writer',
        name: 'وكيل التحليل والصياغة',
        purpose: 'تحويل مخرجات البحث إلى نتيجة مفهومة ومتماسكة ومناسبة للهدف.',
        instructions: 'رتب الأدلة، استخرج الاستنتاجات التي يدعمها الدليل، واكتب بوضوح. إذا تعارضت الأدلة فاعرض التعارض ولا تخفه.',
        suggestedToolIds: ['local.text.stats', 'local.memory.search'],
      },
      {
        id: 'reviewer',
        name: 'وكيل المراجعة والتدقيق',
        purpose: 'فحص الدقة والاتساق والاكتمال قبل التسليم.',
        instructions: 'دقق كل ادعاء مهم مقابل المواد المتاحة، وابحث عن المبالغة والتكرار والنقص. أعد النتيجة فقط إذا اجتازت معايير القبول.',
        suggestedToolIds: ['local.memory.search'],
      },
    ],
  },
  {
    domain: 'support',
    label: 'خدمة عملاء ودعم',
    keywords: [
      'دعم', 'عملاء', 'زبائن', 'خدمة العملاء', 'رسائل العملاء', 'تذاكر', 'استفسارات', 'شكاوى', 'ردود',
      'support', 'customer', 'customers', 'ticket', 'tickets', 'complaint', 'reply', 'inbox',
    ],
    roles: [
      {
        id: 'triage',
        name: 'وكيل فرز الطلبات',
        purpose: 'تصنيف الطلب وتحديد الأولوية والمعلومات الناقصة ومسار المعالجة.',
        instructions: 'صنف الطلب دون اتخاذ إجراء خارجي. حدد هل يحتاج معلومات إضافية أو تصعيداً أو رداً مباشراً، وسجل سبب التصنيف باختصار.',
        suggestedToolIds: ['local.memory.search'],
      },
      {
        id: 'responder',
        name: 'وكيل إعداد الرد',
        purpose: 'إعداد جواب مناسب ودقيق اعتماداً على السياسات والمعرفة المتاحة.',
        instructions: 'اكتب مسودة الرد فقط. لا ترسل رسالة ولا تعد العميل بما لا تدعمه المعلومات. وضح القيود والخطوة التالية.',
        suggestedToolIds: ['local.memory.search', 'local.text.stats'],
      },
      {
        id: 'qa-reviewer',
        name: 'وكيل جودة الردود',
        purpose: 'فحص الرد قبل أي إرسال خارجي مستقبلي.',
        instructions: 'راجع صحة الرد ونبرته والتزامه بالسياسات وعدم كشف بيانات أو أسرار. أي إرسال خارجي يبقى خارج هذه المرحلة ويحتاج موافقة بشرية.',
        suggestedToolIds: ['local.memory.search'],
      },
    ],
  },
  {
    domain: 'business_ops',
    label: 'أعمال وعمليات وإدارة',
    keywords: [
      'مشروع', 'إدارة', 'خطة', 'عملية', 'عمليات', 'مبيعات', 'تسويق', 'ميزانية', 'شركة', 'مهمة', 'جدول', 'إنتاجية',
      'business', 'operations', 'project', 'plan', 'sales', 'marketing', 'budget', 'company', 'workflow', 'admin',
    ],
    roles: [
      {
        id: 'planner',
        name: 'وكيل التخطيط',
        purpose: 'تحويل الهدف التجاري إلى مراحل ونتائج قابلة للقياس ضمن الموارد المتاحة.',
        instructions: 'حدد الأولويات والتبعيات ومقاييس النجاح. لا تفترض ميزانية مالية ولا خدمة مدفوعة. افصل ما يمكن تنفيذه محلياً عما يحتاج موافقة أو مورداً خارجياً.',
        suggestedToolIds: ['local.memory.search'],
      },
      {
        id: 'operator',
        name: 'وكيل العمليات',
        purpose: 'إعداد خطوات التنفيذ والمواد المطلوبة دون تنفيذ عمليات خارجية تلقائياً.',
        instructions: 'حوّل الخطة إلى إجراءات وقوالب وقوائم تحقق. لا ترسل ولا تنشر ولا تشتري ولا تغير حساباً خارجياً تلقائياً.',
        suggestedToolIds: ['local.memory.search', 'local.memory.add'],
      },
      {
        id: 'reviewer',
        name: 'وكيل مراجعة العمليات',
        purpose: 'التحقق من الجدوى والقيود والمخاطر قبل الاعتماد.',
        instructions: 'اختبر الخطة ضد القيود والتكلفة الصفرية والفشل المحتمل. أبرز ما يحتاج قراراً بشرياً، وارفض أي خطوة مالية أو عالية الخطر غير مصرح بها.',
        suggestedToolIds: ['local.memory.search'],
      },
    ],
  },
  {
    domain: 'general',
    label: 'هدف عام',
    keywords: [],
    roles: [
      {
        id: 'planner',
        name: 'وكيل التخطيط',
        purpose: 'فهم الهدف وتقسيمه إلى مهام ومعايير نجاح واضحة.',
        instructions: 'لخص المطلوب وحدد المدخلات والمخرجات والقيود. قسم العمل إلى خطوات قابلة للفحص ولا توسع النطاق من نفسك.',
        suggestedToolIds: ['local.memory.search'],
      },
      {
        id: 'specialist',
        name: 'وكيل التنفيذ المتخصص',
        purpose: 'تنفيذ الجزء الرئيسي من المهمة اعتماداً على التخطيط والمعرفة المتاحة.',
        instructions: 'نفذ المهمة المحددة عملياً، واستند إلى المعلومات المتاحة فقط، وبيّن أي افتراض أو نقص يمنع نتيجة موثوقة.',
        suggestedToolIds: ['local.memory.search'],
      },
      {
        id: 'reviewer',
        name: 'وكيل المراجعة النهائية',
        purpose: 'فحص النتيجة مقابل الهدف ومعايير القبول قبل التسليم.',
        instructions: 'راجع الاكتمال والدقة والالتزام بالقيود. لا تعتمد النتيجة إذا لم تجتز الاختبارات المطلوبة.',
        suggestedToolIds: ['local.memory.search'],
      },
    ],
  },
]

function now(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function cleanText(value: string, limit: number): string {
  return value.replace(/\u0000/gu, '').trim().slice(0, limit)
}

function normalizeForDetection(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[ًٌٍَُِّْـ]/gu, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function scoreDomain(goal: string, template: DomainTemplate): number {
  const normalized = normalizeForDetection(goal)
  let score = 0
  for (const keyword of template.keywords) {
    const normalizedKeyword = normalizeForDetection(keyword)
    if (!normalizedKeyword) continue
    if (normalized.includes(normalizedKeyword)) score += normalizedKeyword.includes(' ') ? 4 : 2
  }
  return score
}

function chooseDomain(goal: string): DomainTemplate {
  const candidates = DOMAIN_TEMPLATES.filter((template) => template.domain !== 'general')
    .map((template) => ({ template, score: scoreDomain(goal, template) }))
    .sort((a, b) => b.score - a.score)
  return candidates[0]?.score > 0 ? candidates[0].template : DOMAIN_TEMPLATES.find((item) => item.domain === 'general')!
}

function buildRoleInstructions(role: DomainTemplate['roles'][number], goal: string): string {
  return [
    `الهدف العام للفريق: ${cleanText(goal, 2_000)}`,
    '',
    `دورك: ${role.name}`,
    `مسؤوليتك: ${role.purpose}`,
    '',
    'طريقة العمل:',
    role.instructions,
    '',
    'قواعد أمان إلزامية:',
    COMMON_SAFETY_INSTRUCTIONS,
  ].join('\n').slice(0, 5_000)
}

function acceptanceTests(domain: FactoryDomain): FactoryAcceptanceTest[] {
  const tests: FactoryAcceptanceTest[] = [
    {
      id: 'zero-cost',
      title: 'Zero-Cost Gate (بوابة التكلفة الصفرية)',
      description: 'كل Agent يجب أن يمنع النماذج المدفوعة ويملك maxMonetarySpendUsd = 0.',
      required: true,
    },
    {
      id: 'tools-denied',
      title: 'Tools Deny-by-Default (الأدوات ممنوعة افتراضياً)',
      description: 'كل Agent جديد يبدأ allowedTools فارغة؛ الاقتراحات لا تتحول إلى صلاحيات تلقائياً.',
      required: true,
    },
    {
      id: 'reviewer-present',
      title: 'Independent Review (مراجعة مستقلة)',
      description: 'الفريق يحتوي دور مراجعة/جودة واضحاً قبل نهاية Workflow.',
      required: true,
    },
    {
      id: 'workflow-valid',
      title: 'Workflow Validation (صلاحية سير العمل)',
      description: 'يجب أن يكون DAG صالحاً بلا دورات مع Human Approval بين تسليمات الوكلاء.',
      required: true,
    },
    {
      id: 'no-auto-run',
      title: 'No Automatic Execution (لا تشغيل تلقائي)',
      description: 'تثبيت الفريق لا يبدأ أي Agent Run أو Tool Call تلقائياً.',
      required: true,
    },
  ]

  if (domain === 'software') {
    tests.push({
      id: 'software-test-role',
      title: 'Testing Role (دور اختبار)',
      description: 'فريق البرمجة يجب أن يحتوي دور اختبار وجودة بالإضافة إلى مراجعة أمنية.',
      required: true,
    })
  }

  if (domain === 'research_content') {
    tests.push({
      id: 'evidence-review',
      title: 'Evidence Review (مراجعة الأدلة)',
      description: 'توجد مرحلة تفصل جمع الحقائق عن الصياغة ثم تدقق الادعاءات قبل التسليم.',
      required: true,
    })
  }

  return tests
}

function readStoredBlueprints(): FactoryBlueprint[] {
  try {
    const raw = localStorage.getItem(BLUEPRINT_STORAGE_KEY)
    const value = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value as FactoryBlueprint[] : []
  } catch {
    return []
  }
}

function writeStoredBlueprints(value: FactoryBlueprint[]): void {
  localStorage.setItem(BLUEPRINT_STORAGE_KEY, JSON.stringify(value.slice(0, MAX_BLUEPRINTS)))
}

function readAudit(): FactoryAuditRecord[] {
  try {
    const raw = localStorage.getItem(FACTORY_AUDIT_KEY)
    const value = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value as FactoryAuditRecord[] : []
  } catch {
    return []
  }
}

function appendAudit(record: FactoryAuditRecord): void {
  try {
    localStorage.setItem(FACTORY_AUDIT_KEY, JSON.stringify([record, ...readAudit()].slice(0, MAX_AUDIT_RECORDS)))
  } catch {
    // Audit persistence failure must never relax install safety; core install validation still runs synchronously.
  }
}

function audit(blueprintId: string, action: FactoryAuditRecord['action'], checks: string[], error?: string): void {
  appendAudit({
    id: newId('factory-audit'),
    blueprintId,
    action,
    createdAt: now(),
    monetaryCostUsd: 0,
    checks: checks.slice(0, 80),
    error: error?.slice(0, 1_000),
  })
}

export function loadFactoryBlueprints(): FactoryBlueprint[] {
  return readStoredBlueprints().slice(0, MAX_BLUEPRINTS)
}

export function loadFactoryAudit(): FactoryAuditRecord[] {
  return readAudit().slice(0, MAX_AUDIT_RECORDS)
}

export function planAgentFactory(goalInput: string, runtimeAdapter: RuntimeAdapterId = 'local-demo'): FactoryBlueprint {
  const goal = cleanText(goalInput, MAX_GOAL_CHARS)
  if (!goal) throw new Error('FACTORY_GOAL_REQUIRED')
  if (!['local-demo', 'local-qwen-webgpu'].includes(runtimeAdapter)) throw new Error('FACTORY_RUNTIME_FORBIDDEN')

  const template = chooseDomain(goal)
  const roles: FactoryRolePlan[] = template.roles.slice(0, MAX_ROLE_COUNT).map((role) => ({
    id: role.id,
    name: role.name,
    purpose: role.purpose,
    instructions: buildRoleInstructions(role, goal),
    suggestedToolIds: [...role.suggestedToolIds],
  }))

  const blueprint: FactoryBlueprint = {
    schemaVersion: '0.1',
    id: newId('blueprint'),
    status: 'draft',
    goal,
    domain: template.domain,
    domainLabel: template.label,
    runtimeAdapter,
    createdAt: now(),
    teamName: `فريق — ${goal.slice(0, 72)}`,
    roles,
    acceptanceTests: acceptanceTests(template.domain),
    workflow: {
      approvalBetweenAgents: true,
      maxAgents: MAX_ROLE_COUNT,
    },
    policy: {
      maxMonetarySpendUsd: 0,
      allowPaidModels: false,
      enableSuggestedToolsAutomatically: false,
      automaticExecutionAfterInstall: false,
      humanApprovalRequiredToInstall: true,
    },
    checks: [
      'planner mode: deterministic local rules',
      `detected domain: ${template.domain}`,
      `proposed agents: ${roles.length}`,
      'suggested tools: advisory only',
      'automatic tool permissions: disabled',
      'automatic execution after install: disabled',
      'human approval before install: required',
      'mandatory monetary spend: 0 USD',
    ],
  }

  const validation = validateFactoryBlueprint(blueprint)
  if (!validation.valid) throw new Error(`FACTORY_BLUEPRINT_INVALID:${validation.violations.join('|')}`)
  blueprint.status = 'validated'
  blueprint.checks = [...blueprint.checks, ...validation.checks]
  writeStoredBlueprints([blueprint, ...loadFactoryBlueprints().filter((item) => item.id !== blueprint.id)])
  audit(blueprint.id, 'planned', blueprint.checks)
  audit(blueprint.id, 'validated', validation.checks)
  return blueprint
}

function containsReviewerRole(blueprint: FactoryBlueprint): boolean {
  return blueprint.roles.some((role) => {
    const haystack = normalizeForDetection(`${role.id} ${role.name} ${role.purpose}`)
    return REVIEWER_KEYWORDS.some((keyword) => haystack.includes(normalizeForDetection(keyword)))
  })
}

export function validateFactoryBlueprint(blueprint: FactoryBlueprint): FactoryValidationResult {
  const checks: string[] = []
  const violations: string[] = []

  if (blueprint.schemaVersion !== '0.1') violations.push('unsupported blueprint schema')
  if (!cleanText(blueprint.goal, MAX_GOAL_CHARS)) violations.push('goal is required')
  if (blueprint.goal.length > MAX_GOAL_CHARS) violations.push('goal too large')
  if (blueprint.roles.length < MIN_ROLE_COUNT || blueprint.roles.length > MAX_ROLE_COUNT) violations.push('role count out of bounds')

  const roleIds = new Set<string>()
  for (const role of blueprint.roles) {
    if (!/^[A-Za-z0-9._:-]{1,80}$/u.test(role.id)) violations.push(`unsafe role id: ${role.id}`)
    if (roleIds.has(role.id)) violations.push(`duplicate role id: ${role.id}`)
    roleIds.add(role.id)
    if (!role.name.trim()) violations.push(`role name missing: ${role.id}`)
    if (!role.purpose.trim()) violations.push(`role purpose missing: ${role.id}`)
    if (role.instructions.trim().length < 80) violations.push(`role instructions too short: ${role.id}`)
    if (role.instructions.length > 5_000) violations.push(`role instructions too large: ${role.id}`)
    if (role.suggestedToolIds.length > 8) violations.push(`too many suggested tools: ${role.id}`)
    if (new Set(role.suggestedToolIds).size !== role.suggestedToolIds.length) violations.push(`duplicate suggested tool: ${role.id}`)
  }

  if (!containsReviewerRole(blueprint)) violations.push('independent reviewer role missing')
  if (blueprint.policy.maxMonetarySpendUsd !== 0) violations.push('non-zero blueprint spend forbidden')
  if (blueprint.policy.allowPaidModels !== false) violations.push('paid models must remain forbidden')
  if (blueprint.policy.enableSuggestedToolsAutomatically !== false) violations.push('automatic tool enabling forbidden')
  if (blueprint.policy.automaticExecutionAfterInstall !== false) violations.push('automatic post-install execution forbidden')
  if (blueprint.policy.humanApprovalRequiredToInstall !== true) violations.push('human install approval required')
  if (blueprint.workflow.approvalBetweenAgents !== true) violations.push('handoff approval must be enabled in Phase 5 foundation')
  if (blueprint.runtimeAdapter !== 'local-demo' && blueprint.runtimeAdapter !== 'local-qwen-webgpu') violations.push('non-local runtime forbidden')

  const requiredAcceptanceIds = ['zero-cost', 'tools-denied', 'reviewer-present', 'workflow-valid', 'no-auto-run']
  for (const id of requiredAcceptanceIds) {
    if (!blueprint.acceptanceTests.some((test) => test.id === id && test.required === true)) {
      violations.push(`required acceptance test missing: ${id}`)
    }
  }

  checks.push(`role count: ${blueprint.roles.length}/${MAX_ROLE_COUNT}`)
  checks.push('reviewer role: present')
  checks.push('runtime policy: local only')
  checks.push('paid models: forbidden')
  checks.push('suggested tools: not auto-enabled')
  checks.push('automatic run after install: forbidden')
  checks.push('human approval before install: required')
  checks.push('handoff approval: required')
  checks.push('mandatory monetary spend: 0 USD')
  checks.push(`acceptance tests: ${blueprint.acceptanceTests.length}`)

  return { valid: violations.length === 0, checks, violations }
}

function compileAgents(blueprint: FactoryBlueprint): AgentSpec[] {
  return blueprint.roles.map((role) => {
    const agent = createDefaultAgent(role.name, role.instructions, blueprint.runtimeAdapter)
    agent.description = `${role.purpose} · أنشأه Agent Factory (مصنع الوكلاء) من Blueprint ${blueprint.id}.`
    agent.memoryPolicy = {
      ...agent.memoryPolicy,
      longTerm: true,
      shared: false,
    }
    return agent
  })
}

function validateCompiledAgents(agents: AgentSpec[]): string[] {
  const checks: string[] = []
  const ids = new Set<string>()
  for (const agent of agents) {
    if (ids.has(agent.id)) throw new Error('FACTORY_DUPLICATE_COMPILED_AGENT_ID')
    ids.add(agent.id)
    if (agent.budgetPolicy.maxMonetarySpendUsd !== 0) throw new Error('FACTORY_COMPILED_AGENT_NONZERO_COST')
    if (agent.modelPolicy.allowPaid !== false || agent.modelPolicy.mode !== 'local_only') throw new Error('FACTORY_COMPILED_AGENT_PAID_MODEL_POLICY')
    if (agent.toolPolicy.defaultAction !== 'deny') throw new Error('FACTORY_COMPILED_AGENT_TOOL_DEFAULT_NOT_DENY')
    if (agent.toolPolicy.allowedTools.length !== 0) throw new Error('FACTORY_COMPILED_AGENT_HAS_AUTO_TOOLS')
    if (agent.approvalPolicy.financial !== 'deny') throw new Error('FACTORY_COMPILED_AGENT_FINANCIAL_NOT_DENIED')
    if (!agent.evaluationPolicy.requiredBeforeProduction || !agent.evaluationPolicy.securityTestsRequired) {
      throw new Error('FACTORY_COMPILED_AGENT_EVAL_GATE_MISSING')
    }
  }
  checks.push(`compiled agents: ${agents.length}`)
  checks.push('compiled agent ids: unique')
  checks.push('compiled runtimes: local-only')
  checks.push('compiled paid models: forbidden')
  checks.push('compiled tool allowlists: empty')
  checks.push('compiled financial actions: denied')
  checks.push('compiled production eval gate: required')
  checks.push('compiled mandatory spend: 0 USD')
  return checks
}

function updateStoredBlueprint(blueprint: FactoryBlueprint): void {
  writeStoredBlueprints([blueprint, ...loadFactoryBlueprints().filter((item) => item.id !== blueprint.id)])
}

export function previewFactoryInstall(blueprint: FactoryBlueprint): {
  agents: AgentSpec[]
  workflow: WorkflowDefinition
  checks: string[]
} {
  const validation = validateFactoryBlueprint(blueprint)
  if (!validation.valid) throw new Error(`FACTORY_BLUEPRINT_INVALID:${validation.violations.join('|')}`)

  const agents = compileAgents(blueprint)
  const agentChecks = validateCompiledAgents(agents)
  const workflow = buildLinearTeamWorkflow(blueprint.teamName, agents.map((agent) => agent.id), true)
  const workflowChecks = validateWorkflowDefinition(workflow)

  return {
    agents,
    workflow,
    checks: [...validation.checks, ...agentChecks, ...workflowChecks, 'preview only: nothing persisted', 'preview only: no agent run executed'],
  }
}

export function installFactoryBlueprint(blueprint: FactoryBlueprint, approvedByHuman: boolean): FactoryInstallResult {
  if (!approvedByHuman) throw new Error('FACTORY_HUMAN_APPROVAL_REQUIRED')
  if (blueprint.status === 'installed') throw new Error('FACTORY_BLUEPRINT_ALREADY_INSTALLED')

  const preview = previewFactoryInstall(blueprint)
  const createdAgentIds: string[] = []
  let savedWorkflowId: string | null = null

  try {
    // Persist only after the full team + workflow has passed in-memory validation.
    for (const agent of preview.agents) {
      saveAgent(agent)
      createdAgentIds.push(agent.id)
    }
    saveWorkflow(preview.workflow)
    savedWorkflowId = preview.workflow.id

    const installedBlueprint: FactoryBlueprint = {
      ...blueprint,
      status: 'installed',
      checks: [
        ...blueprint.checks,
        ...preview.checks,
        'human install approval: granted',
        'agents persisted: yes',
        'workflow persisted: yes',
        'suggested tools enabled: no',
        'automatic team run started: no',
        'mandatory monetary spend: 0 USD',
      ],
    }
    updateStoredBlueprint(installedBlueprint)
    audit(installedBlueprint.id, 'installed', installedBlueprint.checks)

    return {
      blueprint: installedBlueprint,
      agents: preview.agents,
      workflow: preview.workflow,
      allAgents: loadAgents(),
      checks: installedBlueprint.checks,
    }
  } catch (error) {
    // Best-effort rollback: do not intentionally leave a half-installed factory team.
    for (const agentId of createdAgentIds) {
      try {
        deleteAgent(agentId)
      } catch {
        // Continue rollback of remaining objects.
      }
    }
    if (savedWorkflowId) {
      try {
        deleteWorkflow(savedWorkflowId)
      } catch {
        // The original install error is reported below.
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    audit(blueprint.id, 'install_failed', preview.checks, message)
    throw error
  }
}
