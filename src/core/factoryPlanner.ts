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
export type FactoryPlanStatus = 'validated' | 'installed'

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
  schemaVersion: '0.2'
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
    maxAgents: 6
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
  roles: FactoryRolePlan[]
}

const BLUEPRINTS_KEY = 'agent-ia-factory.factory-blueprints.v2'
const AUDIT_KEY = 'agent-ia-factory.factory-audit.v2'
const MAX_BLUEPRINTS = 12
const MAX_AUDIT = 60
const MAX_GOAL_CHARS = 6_000
const MAX_ROLE_COUNT = 6
const MIN_ROLE_COUNT = 2
const REVIEWER_PATTERN = /مراجع|مراجعة|جودة|اختبار|تدقيق|review|qa|tester|security/iu

const COMMON_SAFETY = [
  'اعمل فقط داخل الهدف والدور المحددين لك.',
  'الإنفاق المالي الإلزامي = 0$، ولا تجعل خدمة مدفوعة شرطاً للتنفيذ.',
  'لا تفعل Tool (أداة) أو MCP تلقائياً؛ أي أداة مقترحة تبقى غير مفعلة حتى يراجعها المستخدم.',
  'لا تنفذ كتابة خارجية أو حذفاً أو تغييراً أمنياً دون بوابة الصلاحيات والموافقة البشرية.',
  'مرر النتائج العملية والأدلة فقط، ولا تعرض سلسلة التفكير الخاصة.',
  'إذا نقصت المعلومات فاذكر النقص ولا تختلق حقيقة.',
].join('\n')

const templates: DomainTemplate[] = [
  {
    domain: 'software',
    label: 'برمجة وتطوير برمجيات',
    keywords: ['تطبيق', 'موقع', 'برمجة', 'كود', 'شفرة', 'github', 'api', 'software', 'code', 'app', 'website', 'backend', 'frontend'],
    roles: [
      { id: 'architect', name: 'مهندس الحل', purpose: 'تحويل الهدف إلى معمارية ونطاق واضح.', instructions: 'حلل المتطلبات والمكونات والحدود والتبعيات والمخاطر ومعايير النجاح.', suggestedToolIds: ['local.memory.search'] },
      { id: 'builder', name: 'وكيل التنفيذ', purpose: 'تحويل المعمارية إلى تنفيذ قابل للاختبار.', instructions: 'ابنِ الحل بأبسط بنية تحقق المتطلبات، وتجنب التبعيات غير الضرورية.', suggestedToolIds: ['local.memory.search', 'local.memory.add'] },
      { id: 'tester', name: 'وكيل الاختبارات والجودة', purpose: 'محاولة كسر التنفيذ واكتشاف حالات الحافة.', instructions: 'صمم اختبارات قبول ورجوع وحالات فشل، ولا تعتبر النجاح ثابتاً بلا دليل.', suggestedToolIds: ['local.text.stats', 'local.memory.search'] },
      { id: 'security-reviewer', name: 'المراجع الأمني النهائي', purpose: 'فحص الأمن والخصوصية والصلاحيات قبل الاعتماد.', instructions: 'راجع الأسرار والصلاحيات والإدخال غير الموثوق وحدود الموارد والتبعيات، وارفض النتيجة عند وجود خطر مرتفع.', suggestedToolIds: ['local.memory.search'] },
    ],
  },
  {
    domain: 'research_content',
    label: 'بحث ومحتوى وتحليل',
    keywords: ['بحث', 'تقرير', 'مقال', 'محتوى', 'منشور', 'تلخيص', 'تحليل', 'مصادر', 'research', 'report', 'article', 'content', 'summary'],
    roles: [
      { id: 'researcher', name: 'وكيل البحث', purpose: 'تفكيك السؤال وجمع الحقائق والأدلة المتاحة.', instructions: 'افصل الحقائق عن الاستنتاجات وسجل مواطن عدم اليقين ولا تختلق مصدراً.', suggestedToolIds: ['local.memory.search'] },
      { id: 'analyst', name: 'وكيل التحليل والصياغة', purpose: 'تحويل الأدلة إلى نتيجة واضحة ومتماسكة.', instructions: 'رتب الأدلة واكتب استنتاجات يدعمها الدليل فقط، وأظهر التعارض إن وجد.', suggestedToolIds: ['local.text.stats', 'local.memory.search'] },
      { id: 'reviewer', name: 'وكيل المراجعة والتدقيق', purpose: 'فحص الدقة والاتساق والاكتمال.', instructions: 'دقق الادعاءات المهمة واكشف المبالغة والتكرار والنقص قبل التسليم.', suggestedToolIds: ['local.memory.search'] },
    ],
  },
  {
    domain: 'support',
    label: 'خدمة عملاء ودعم',
    keywords: ['دعم', 'عملاء', 'زبائن', 'شكاوى', 'تذاكر', 'ردود', 'support', 'customer', 'ticket', 'complaint', 'inbox'],
    roles: [
      { id: 'triage', name: 'وكيل فرز الطلبات', purpose: 'تصنيف الطلب وتحديد الأولوية والمعلومات الناقصة.', instructions: 'صنف الطلب دون إجراء خارجي وحدد المسار المناسب والتصعيد المطلوب.', suggestedToolIds: ['local.memory.search'] },
      { id: 'responder', name: 'وكيل إعداد الرد', purpose: 'إعداد مسودة دقيقة وفق المعرفة والسياسات.', instructions: 'اكتب مسودة فقط ولا ترسل شيئاً ولا تعد بما لا تدعمه المعلومات.', suggestedToolIds: ['local.memory.search', 'local.text.stats'] },
      { id: 'qa-reviewer', name: 'وكيل جودة الردود', purpose: 'فحص الرد قبل أي إرسال مستقبلي.', instructions: 'راجع الصحة والنبرة والسياسات والخصوصية، وأبقِ الإرسال الخارجي خلف موافقة بشرية.', suggestedToolIds: ['local.memory.search'] },
    ],
  },
  {
    domain: 'business_ops',
    label: 'أعمال وعمليات وإدارة',
    keywords: ['مشروع', 'إدارة', 'خطة', 'عمليات', 'مبيعات', 'تسويق', 'شركة', 'workflow', 'business', 'operations', 'sales', 'marketing'],
    roles: [
      { id: 'planner', name: 'وكيل التخطيط', purpose: 'تحويل الهدف إلى مراحل ونتائج قابلة للقياس.', instructions: 'حدد الأولويات والتبعيات والمقاييس دون افتراض ميزانية أو خدمة مدفوعة.', suggestedToolIds: ['local.memory.search'] },
      { id: 'operator', name: 'وكيل العمليات', purpose: 'تحويل الخطة إلى إجراءات وقوالب وقوائم تحقق.', instructions: 'جهز التنفيذ دون إرسال أو نشر أو شراء أو تغيير حساب خارجي تلقائياً.', suggestedToolIds: ['local.memory.search', 'local.memory.add'] },
      { id: 'reviewer', name: 'وكيل مراجعة العمليات', purpose: 'فحص المخاطر والاكتمال قبل الاعتماد.', instructions: 'راجع القابلية للتنفيذ والمخاطر ونقاط الفشل ومعايير القياس.', suggestedToolIds: ['local.memory.search'] },
    ],
  },
  {
    domain: 'general',
    label: 'فريق عام متعدد الأدوار',
    keywords: [],
    roles: [
      { id: 'planner', name: 'وكيل التخطيط', purpose: 'تفكيك الهدف إلى مراحل واضحة.', instructions: 'حدد النطاق والمدخلات والمخرجات والافتراضات.', suggestedToolIds: ['local.memory.search'] },
      { id: 'worker', name: 'وكيل التنفيذ', purpose: 'تنفيذ الجزء العملي من الخطة.', instructions: 'نفذ المطلوب بدقة وبأقل تعقيد ممكن.', suggestedToolIds: ['local.memory.search'] },
      { id: 'reviewer', name: 'وكيل المراجعة والجودة', purpose: 'مراجعة النتيجة قبل التسليم.', instructions: 'ابحث عن الأخطاء والنقص والتناقض وارفض الاعتماد بلا دليل كاف.', suggestedToolIds: ['local.memory.search'] },
    ],
  },
]

function now(): string { return new Date().toISOString() }
function id(prefix: string): string { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
function clean(value: string, max: number): string { return value.replace(/\u0000/gu, '').trim().slice(0, max) }

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function writeArray<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function audit(blueprintId: string, action: FactoryAuditRecord['action'], checks: string[], error?: string): void {
  const record: FactoryAuditRecord = { id: id('factory-audit'), blueprintId, action, createdAt: now(), monetaryCostUsd: 0, checks, error }
  writeArray(AUDIT_KEY, [record, ...readArray<FactoryAuditRecord>(AUDIT_KEY)].slice(0, MAX_AUDIT))
}

function chooseTemplate(goal: string): DomainTemplate {
  const haystack = goal.toLowerCase()
  let best = templates[templates.length - 1]
  let bestScore = 0
  for (const template of templates) {
    if (template.domain === 'general') continue
    const score = template.keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword.toLowerCase()) ? 1 : 0), 0)
    if (score > bestScore) {
      best = template
      bestScore = score
    }
  }
  return best
}

function acceptanceTests(domain: FactoryDomain): FactoryAcceptanceTest[] {
  const tests: FactoryAcceptanceTest[] = [
    { id: 'zero-cost', title: 'Zero-Cost (التكلفة الصفرية)', description: 'كل الوكلاء والنماذج الإلزامية تبقى 0$.', required: true },
    { id: 'tools-denied', title: 'Tools Denied by Default', description: 'كل الأدوات المقترحة تبدأ غير مفعلة ولا تُمنح تلقائياً.', required: true },
    { id: 'reviewer-present', title: 'Reviewer Present', description: 'يوجد دور مراجعة/جودة مستقل قبل الاعتماد.', required: true },
    { id: 'workflow-valid', title: 'Workflow Valid', description: 'سير العمل يمر عبر DAG validator وحدود الخطوات والتسليمات.', required: true },
    { id: 'no-auto-run', title: 'No Auto-Run', description: 'التثبيت لا يبدأ أي Agent أو Tool أو MCP تلقائياً.', required: true },
  ]
  if (domain === 'software') tests.push({ id: 'software-security', title: 'Security Review', description: 'مراجعة أمنية مطلوبة قبل اعتبار التنفيذ جاهزاً.', required: true })
  if (domain === 'research_content') tests.push({ id: 'evidence-review', title: 'Evidence Review', description: 'النتيجة النهائية تراجع الأدلة وعدم اليقين.', required: true })
  return tests
}

export function validateFactoryBlueprint(blueprint: FactoryBlueprint): FactoryValidationResult {
  const violations: string[] = []
  const checks: string[] = []
  if (blueprint.schemaVersion !== '0.2') violations.push('FACTORY_SCHEMA_UNSUPPORTED')
  if (!clean(blueprint.goal, MAX_GOAL_CHARS)) violations.push('FACTORY_GOAL_REQUIRED')
  if (blueprint.roles.length < MIN_ROLE_COUNT || blueprint.roles.length > MAX_ROLE_COUNT) violations.push('FACTORY_ROLE_COUNT_INVALID')
  if (!blueprint.roles.some((role) => REVIEWER_PATTERN.test(`${role.id} ${role.name} ${role.purpose}`))) violations.push('FACTORY_REVIEWER_REQUIRED')
  if (blueprint.policy.maxMonetarySpendUsd !== 0 || blueprint.policy.allowPaidModels !== false) violations.push('FACTORY_ZERO_COST_VIOLATION')
  if (blueprint.policy.enableSuggestedToolsAutomatically !== false) violations.push('FACTORY_AUTO_TOOL_FORBIDDEN')
  if (blueprint.policy.automaticExecutionAfterInstall !== false) violations.push('FACTORY_AUTO_RUN_FORBIDDEN')
  if (blueprint.policy.humanApprovalRequiredToInstall !== true) violations.push('FACTORY_INSTALL_APPROVAL_REQUIRED')
  if (!['local-demo', 'local-qwen-webgpu'].includes(blueprint.runtimeAdapter)) violations.push('FACTORY_RUNTIME_FORBIDDEN')
  if (blueprint.roles.some((role) => role.instructions.length > 4_000 || role.suggestedToolIds.length > 12)) violations.push('FACTORY_ROLE_LIMIT_EXCEEDED')
  checks.push('factory blueprint schema: 0.2')
  checks.push('reviewer/QA role: required')
  checks.push('suggested tools: advisory only')
  checks.push('automatic execution after install: disabled')
  checks.push('human approval to install: required')
  checks.push('mandatory monetary spend: 0 USD')
  return { valid: violations.length === 0, checks, violations }
}

export function planAgentFactory(rawGoal: string, runtimeAdapter: RuntimeAdapterId = 'local-demo'): FactoryBlueprint {
  const goal = clean(rawGoal, MAX_GOAL_CHARS)
  if (!goal) throw new Error('FACTORY_GOAL_REQUIRED')
  if (!['local-demo', 'local-qwen-webgpu'].includes(runtimeAdapter)) throw new Error('FACTORY_RUNTIME_FORBIDDEN')
  const template = chooseTemplate(goal)
  const roles = template.roles.slice(0, MAX_ROLE_COUNT).map((role) => ({
    ...role,
    instructions: `${role.instructions}\n\n${COMMON_SAFETY}`,
    suggestedToolIds: [...new Set(role.suggestedToolIds)].slice(0, 12),
  }))
  const blueprint: FactoryBlueprint = {
    schemaVersion: '0.2',
    id: id('blueprint'),
    status: 'validated',
    goal,
    domain: template.domain,
    domainLabel: template.label,
    runtimeAdapter,
    createdAt: now(),
    teamName: clean(`فريق: ${goal}`, 100),
    roles,
    acceptanceTests: acceptanceTests(template.domain),
    workflow: { approvalBetweenAgents: true, maxAgents: 6 },
    policy: {
      maxMonetarySpendUsd: 0,
      allowPaidModels: false,
      enableSuggestedToolsAutomatically: false,
      automaticExecutionAfterInstall: false,
      humanApprovalRequiredToInstall: true,
    },
    checks: [],
  }
  const validation = validateFactoryBlueprint(blueprint)
  if (!validation.valid) throw new Error(validation.violations.join('|'))
  blueprint.checks = validation.checks
  saveFactoryBlueprint(blueprint)
  audit(blueprint.id, 'planned', validation.checks)
  audit(blueprint.id, 'validated', validation.checks)
  return blueprint
}

function compileBlueprint(blueprint: FactoryBlueprint): { agents: AgentSpec[]; workflow: WorkflowDefinition; checks: string[] } {
  const validation = validateFactoryBlueprint(blueprint)
  if (!validation.valid) throw new Error(validation.violations.join('|'))
  const agents = blueprint.roles.map((role) => {
    const agent = createDefaultAgent(role.name, role.instructions, blueprint.runtimeAdapter)
    return {
      ...agent,
      description: role.purpose,
      modelPolicy: { mode: 'local_only' as const, allowPaid: false as const },
      toolPolicy: { defaultAction: 'deny' as const, allowedTools: [] },
      approvalPolicy: { externalWrite: 'ask' as const, delete: 'ask' as const, financial: 'deny' as const, securityChange: 'ask' as const },
      budgetPolicy: { ...agent.budgetPolicy, maxMonetarySpendUsd: 0 as const },
      evaluationPolicy: { ...agent.evaluationPolicy, requiredBeforeProduction: true as const, securityTestsRequired: true },
    }
  })
  const workflow = buildLinearTeamWorkflow(blueprint.teamName, agents.map((agent) => agent.id), true)
  const workflowChecks = validateWorkflowDefinition(workflow)
  return { agents, workflow, checks: [...validation.checks, ...workflowChecks, 'compiled agents: tools denied by default', 'installation does not auto-run workflow'] }
}

export function previewFactoryInstall(blueprint: FactoryBlueprint): FactoryInstallResult {
  const compiled = compileBlueprint(blueprint)
  return { blueprint, ...compiled, allAgents: loadAgents() }
}

export function installFactoryBlueprint(blueprint: FactoryBlueprint, approvedByHuman: boolean): FactoryInstallResult {
  if (!approvedByHuman) throw new Error('FACTORY_HUMAN_APPROVAL_REQUIRED')
  if (blueprint.status === 'installed') throw new Error('FACTORY_BLUEPRINT_ALREADY_INSTALLED')
  const compiled = compileBlueprint(blueprint)
  const createdAgentIds: string[] = []
  let workflowSaved = false
  try {
    let allAgents = loadAgents()
    for (const agent of compiled.agents) {
      allAgents = saveAgent(agent)
      createdAgentIds.push(agent.id)
    }
    saveWorkflow(compiled.workflow)
    workflowSaved = true
    const installed: FactoryBlueprint = { ...blueprint, status: 'installed', checks: compiled.checks }
    saveFactoryBlueprint(installed)
    audit(installed.id, 'installed', compiled.checks)
    return { blueprint: installed, agents: compiled.agents, workflow: compiled.workflow, allAgents, checks: compiled.checks }
  } catch (error) {
    for (const agentId of createdAgentIds) deleteAgent(agentId)
    if (workflowSaved) deleteWorkflow(compiled.workflow.id)
    audit(blueprint.id, 'install_failed', compiled.checks, error instanceof Error ? error.message : String(error))
    throw error
  }
}

export function loadFactoryBlueprints(): FactoryBlueprint[] {
  return readArray<FactoryBlueprint>(BLUEPRINTS_KEY).slice(0, MAX_BLUEPRINTS)
}

export function saveFactoryBlueprint(blueprint: FactoryBlueprint): FactoryBlueprint[] {
  const next = [blueprint, ...loadFactoryBlueprints().filter((item) => item.id !== blueprint.id)].slice(0, MAX_BLUEPRINTS)
  writeArray(BLUEPRINTS_KEY, next)
  return next
}

export function loadFactoryAudit(): FactoryAuditRecord[] {
  return readArray<FactoryAuditRecord>(AUDIT_KEY).slice(0, MAX_AUDIT)
}
