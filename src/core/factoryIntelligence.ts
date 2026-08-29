import {
  saveFactoryBlueprint,
  validateFactoryBlueprint,
  type FactoryAcceptanceTest,
  type FactoryBlueprint,
  type FactoryRolePlan,
  type FactoryValidationResult,
} from './factoryPlanner'
import type { ToolRisk } from './toolSdk'

export const FACTORY_INTELLIGENCE_SCHEMA_VERSION = '0.1' as const

const KNOWN_TOOLS: Record<string, { risk: ToolRisk; scopes: string[]; disposition: 'existing' }> = {
  'local.text.stats': { risk: 'read_only', scopes: ['text:read'], disposition: 'existing' },
  'local.memory.search': { risk: 'read_only', scopes: ['memory:read'], disposition: 'existing' },
  'local.memory.add': { risk: 'local_write', scopes: ['memory:write-local'], disposition: 'existing' },
  'local.memory.clear': { risk: 'delete', scopes: ['memory:delete'], disposition: 'existing' },
}

const REQUIRED_ACCEPTANCE: FactoryAcceptanceTest[] = [
  { id: 'zero-cost', title: 'Zero-Cost (التكلفة الصفرية)', description: 'كل الوكلاء والنماذج الإلزامية تبقى 0$.', required: true },
  { id: 'tools-denied', title: 'Tools Denied by Default', description: 'كل الأدوات المقترحة تبدأ غير مفعلة ولا تُمنح تلقائياً.', required: true },
  { id: 'reviewer-present', title: 'Reviewer Present', description: 'يوجد دور مراجعة/جودة مستقل قبل الاعتماد.', required: true },
  { id: 'workflow-valid', title: 'Workflow Valid', description: 'سير العمل يمر عبر DAG validator وحدود الخطوات والتسليمات.', required: true },
  { id: 'no-auto-run', title: 'No Auto-Run', description: 'التثبيت لا يبدأ أي Agent أو Tool أو MCP تلقائياً.', required: true },
]

const REVIEWER_PATTERN = /مراجع|مراجعة|جودة|اختبار|تدقيق|review|qa|tester|security/iu

export interface FactoryToolRequirement {
  schemaVersion: typeof FACTORY_INTELLIGENCE_SCHEMA_VERSION
  id: string
  blueprintId: string
  roleId: string
  roleName: string
  requestedToolId: string | null
  disposition: 'existing' | 'adapter_required' | 'no_tool_required'
  riskCeiling: Exclude<ToolRisk, 'financial'>
  scopes: string[]
  candidateAdapterIds: string[]
  monetaryCostUsd: 0
  automaticActivation: false
  humanApprovalRequiredBeforeActivation: true
  checks: string[]
}

export interface FactoryToolPlan {
  schemaVersion: typeof FACTORY_INTELLIGENCE_SCHEMA_VERSION
  blueprintId: string
  createdAt: string
  requirements: FactoryToolRequirement[]
  monetaryCostUsd: 0
  automaticCodeGeneration: false
  automaticActivation: false
  checks: string[]
}

export interface FactoryTestCasePlan {
  id: string
  title: string
  dimension: 'quality' | 'security' | 'reliability'
  target: 'blueprint' | 'role'
  roleId?: string
  required: true
  assertion: string
}

export interface FactoryTestPlan {
  schemaVersion: typeof FACTORY_INTELLIGENCE_SCHEMA_VERSION
  blueprintId: string
  createdAt: string
  cases: FactoryTestCasePlan[]
  monetaryCostUsd: 0
  automaticExecution: false
  checks: string[]
}

export interface FactoryRepairChange {
  code: string
  description: string
}

export interface FactoryRepairPreview {
  schemaVersion: typeof FACTORY_INTELLIGENCE_SCHEMA_VERSION
  blueprintId: string
  createdAt: string
  before: FactoryValidationResult
  after: FactoryValidationResult
  repairedBlueprint: FactoryBlueprint
  changes: FactoryRepairChange[]
  manualBlockers: string[]
  safeToApply: boolean
  monetaryCostUsd: 0
  automaticInstall: false
  automaticRun: false
}

function now(): string { return new Date().toISOString() }

function requirementId(blueprintId: string, roleId: string, toolId: string | null, index: number): string {
  const raw = `${blueprintId}:${roleId}:${toolId ?? 'none'}:${index}`
  return `toolreq-${raw.replace(/[^A-Za-z0-9._:-]/gu, '-').slice(-90)}`
}

function inferUnknownTool(toolId: string): { risk: Exclude<ToolRisk, 'financial'>; scopes: string[]; candidateAdapterIds: string[] } {
  const value = toolId.toLowerCase()
  if (value.includes('delete') || value.includes('clear')) return { risk: 'delete', scopes: ['file:delete'], candidateAdapterIds: [] }
  if (value.includes('write') || value.includes('send') || value.includes('publish')) return { risk: 'external_write', scopes: ['external:write'], candidateAdapterIds: [] }
  if (value.includes('security') || value.includes('permission')) return { risk: 'security_change', scopes: ['security:change'], candidateAdapterIds: [] }
  if (value.includes('memory')) return { risk: 'read_only', scopes: ['memory:read'], candidateAdapterIds: [] }
  if (value.includes('text') || value.includes('stats')) return { risk: 'read_only', scopes: ['text:read'], candidateAdapterIds: ['adapter.local.text.stats'] }
  return { risk: 'read_only', scopes: ['text:read'], candidateAdapterIds: [] }
}

export function buildFactoryToolPlan(blueprint: FactoryBlueprint): FactoryToolPlan {
  const validation = validateFactoryBlueprint(blueprint)
  const requirements: FactoryToolRequirement[] = []

  for (const role of blueprint.roles) {
    const toolIds = [...new Set(role.suggestedToolIds)]
    if (toolIds.length === 0) {
      requirements.push({
        schemaVersion: FACTORY_INTELLIGENCE_SCHEMA_VERSION,
        id: requirementId(blueprint.id, role.id, null, requirements.length),
        blueprintId: blueprint.id,
        roleId: role.id,
        roleName: role.name,
        requestedToolId: null,
        disposition: 'no_tool_required',
        riskCeiling: 'read_only',
        scopes: [],
        candidateAdapterIds: [],
        monetaryCostUsd: 0,
        automaticActivation: false,
        humanApprovalRequiredBeforeActivation: true,
        checks: ['role currently needs no suggested tool', 'automatic activation: forbidden'],
      })
      continue
    }

    for (const toolId of toolIds) {
      const known = KNOWN_TOOLS[toolId]
      const inferred = known ?? inferUnknownTool(toolId)
      requirements.push({
        schemaVersion: FACTORY_INTELLIGENCE_SCHEMA_VERSION,
        id: requirementId(blueprint.id, role.id, toolId, requirements.length),
        blueprintId: blueprint.id,
        roleId: role.id,
        roleName: role.name,
        requestedToolId: toolId,
        disposition: known ? 'existing' : 'adapter_required',
        riskCeiling: inferred.risk as Exclude<ToolRisk, 'financial'>,
        scopes: [...inferred.scopes],
        candidateAdapterIds: known ? [] : [...('candidateAdapterIds' in inferred ? inferred.candidateAdapterIds : [])],
        monetaryCostUsd: 0,
        automaticActivation: false,
        humanApprovalRequiredBeforeActivation: true,
        checks: [
          known ? 'existing reviewed tool reference' : 'implementation missing: reviewed adapter required',
          'financial capability: absent',
          'automatic code generation: disabled',
          'automatic activation: forbidden',
        ],
      })
    }
  }

  return {
    schemaVersion: FACTORY_INTELLIGENCE_SCHEMA_VERSION,
    blueprintId: blueprint.id,
    createdAt: now(),
    requirements: requirements.slice(0, 48),
    monetaryCostUsd: 0,
    automaticCodeGeneration: false,
    automaticActivation: false,
    checks: [
      `blueprint valid: ${validation.valid}`,
      'tool builder output: proposal/data only',
      'unknown tools require reviewed adapter implementation',
      'mandatory monetary spend: 0 USD',
    ],
  }
}

function roleTestCases(role: FactoryRolePlan): FactoryTestCasePlan[] {
  const cases: FactoryTestCasePlan[] = [
    {
      id: `role-${role.id}-scope`.slice(0, 100),
      title: `${role.name}: scope discipline`,
      dimension: 'quality',
      target: 'role',
      roleId: role.id,
      required: true,
      assertion: 'Role purpose and instructions are non-empty and bounded.',
    },
    {
      id: `role-${role.id}-tools`.slice(0, 100),
      title: `${role.name}: tool safety`,
      dimension: 'security',
      target: 'role',
      roleId: role.id,
      required: true,
      assertion: 'Suggested tools remain advisory and never become allowedTools automatically.',
    },
  ]
  return cases
}

export function buildFactoryTestPlan(blueprint: FactoryBlueprint): FactoryTestPlan {
  const cases: FactoryTestCasePlan[] = [
    { id: 'factory-zero-cost', title: 'Zero-cost policy', dimension: 'security', target: 'blueprint', required: true, assertion: 'maxMonetarySpendUsd=0 and allowPaidModels=false.' },
    { id: 'factory-no-auto-tools', title: 'No automatic tools', dimension: 'security', target: 'blueprint', required: true, assertion: 'enableSuggestedToolsAutomatically=false.' },
    { id: 'factory-no-auto-run', title: 'No automatic run', dimension: 'security', target: 'blueprint', required: true, assertion: 'automaticExecutionAfterInstall=false.' },
    { id: 'factory-reviewer', title: 'Independent reviewer', dimension: 'quality', target: 'blueprint', required: true, assertion: 'At least one reviewer/QA/security role exists.' },
    { id: 'factory-install-approval', title: 'Install approval', dimension: 'security', target: 'blueprint', required: true, assertion: 'humanApprovalRequiredToInstall=true.' },
    { id: 'factory-workflow', title: 'Workflow contract', dimension: 'reliability', target: 'blueprint', required: true, assertion: 'approvalBetweenAgents=true and maxAgents=6.' },
  ]
  for (const role of blueprint.roles) cases.push(...roleTestCases(role))
  return {
    schemaVersion: FACTORY_INTELLIGENCE_SCHEMA_VERSION,
    blueprintId: blueprint.id,
    createdAt: now(),
    cases: cases.slice(0, 24),
    monetaryCostUsd: 0,
    automaticExecution: false,
    checks: [
      'test builder is deterministic and local',
      'test plan does not execute agents/tools/MCP',
      'security + quality + reliability represented',
      'mandatory monetary spend: 0 USD',
    ],
  }
}

function uniqueRoleIds(roles: FactoryRolePlan[], changes: FactoryRepairChange[]): FactoryRolePlan[] {
  const seen = new Map<string, number>()
  return roles.map((role) => {
    const count = seen.get(role.id) ?? 0
    seen.set(role.id, count + 1)
    if (count === 0) return role
    const nextId = `${role.id}-${count + 1}`.slice(0, 80)
    changes.push({ code: 'ROLE_ID_DEDUPED', description: `Role ID ${role.id} renamed to ${nextId}.` })
    return { ...role, id: nextId }
  })
}

export function buildFactoryRepairPreview(blueprint: FactoryBlueprint): FactoryRepairPreview {
  if (blueprint.status === 'installed') throw new Error('FACTORY_REPAIR_INSTALLED_BLUEPRINT_FORBIDDEN')
  const before = validateFactoryBlueprint(blueprint)
  const changes: FactoryRepairChange[] = []
  const manualBlockers: string[] = []

  let roles = uniqueRoleIds(blueprint.roles.map((role) => {
    const tools = [...new Set(role.suggestedToolIds)].slice(0, 12)
    if (tools.length !== role.suggestedToolIds.length) {
      changes.push({ code: 'ROLE_TOOLS_NORMALIZED', description: `Suggested tools normalized for role ${role.id}.` })
    }
    return { ...role, suggestedToolIds: tools }
  }), changes)

  if (!roles.some((role) => REVIEWER_PATTERN.test(`${role.id} ${role.name} ${role.purpose}`))) {
    if (roles.length < 6) {
      roles = [...roles, {
        id: 'factory-reviewer',
        name: 'وكيل المراجعة والجودة',
        purpose: 'مراجعة النتيجة والمخاطر والأدلة قبل الاعتماد.',
        instructions: 'راجع الدقة والجودة والأمان. لا تعتمد نتيجة بلا دليل ولا تفعل Tool أو MCP تلقائياً.',
        suggestedToolIds: ['local.memory.search'],
      }]
      changes.push({ code: 'REVIEWER_ADDED', description: 'Added an independent reviewer role.' })
    } else {
      manualBlockers.push('FACTORY_REVIEWER_REQUIRED_AND_ROLE_LIMIT_REACHED')
    }
  }

  const acceptanceById = new Map(blueprint.acceptanceTests.map((test) => [test.id, test]))
  for (const required of REQUIRED_ACCEPTANCE) {
    if (!acceptanceById.has(required.id)) {
      acceptanceById.set(required.id, required)
      changes.push({ code: 'ACCEPTANCE_TEST_RESTORED', description: `Restored acceptance test ${required.id}.` })
    }
  }

  const repaired: FactoryBlueprint = {
    ...blueprint,
    status: 'validated',
    roles,
    acceptanceTests: [...acceptanceById.values()].slice(0, 10),
    workflow: { approvalBetweenAgents: true, maxAgents: 6 },
    policy: {
      maxMonetarySpendUsd: 0,
      allowPaidModels: false,
      enableSuggestedToolsAutomatically: false,
      automaticExecutionAfterInstall: false,
      humanApprovalRequiredToInstall: true,
    },
  }

  if (JSON.stringify(repaired.workflow) !== JSON.stringify(blueprint.workflow)) changes.push({ code: 'WORKFLOW_POLICY_REPAIRED', description: 'Restored approval-between-agents and maxAgents=6.' })
  if (JSON.stringify(repaired.policy) !== JSON.stringify(blueprint.policy)) changes.push({ code: 'ZERO_COST_POLICY_REPAIRED', description: 'Restored zero-cost, no-auto-tool, no-auto-run and install-approval policy.' })

  const after = validateFactoryBlueprint(repaired)
  for (const violation of after.violations) if (!manualBlockers.includes(violation)) manualBlockers.push(violation)
  repaired.checks = after.checks

  return {
    schemaVersion: FACTORY_INTELLIGENCE_SCHEMA_VERSION,
    blueprintId: blueprint.id,
    createdAt: now(),
    before,
    after,
    repairedBlueprint: repaired,
    changes,
    manualBlockers,
    safeToApply: after.valid && manualBlockers.length === 0,
    monetaryCostUsd: 0,
    automaticInstall: false,
    automaticRun: false,
  }
}

function stableRepairShape(preview: FactoryRepairPreview): string {
  return JSON.stringify({
    blueprintId: preview.blueprintId,
    repairedBlueprint: preview.repairedBlueprint,
    changes: preview.changes,
    manualBlockers: preview.manualBlockers,
    safeToApply: preview.safeToApply,
  })
}

export function applyFactoryRepair(
  originalBlueprint: FactoryBlueprint,
  preview: FactoryRepairPreview,
  approvedByHuman: boolean,
): FactoryBlueprint {
  if (!approvedByHuman) throw new Error('FACTORY_REPAIR_HUMAN_APPROVAL_REQUIRED')
  if (originalBlueprint.status === 'installed') throw new Error('FACTORY_REPAIR_INSTALLED_BLUEPRINT_FORBIDDEN')
  if (preview.blueprintId !== originalBlueprint.id) throw new Error('FACTORY_REPAIR_BLUEPRINT_MISMATCH')
  const recomputed = buildFactoryRepairPreview(originalBlueprint)
  if (stableRepairShape(recomputed) !== stableRepairShape(preview)) throw new Error('FACTORY_REPAIR_PREVIEW_TAMPERED_OR_STALE')
  if (!recomputed.safeToApply) throw new Error('FACTORY_REPAIR_MANUAL_REVIEW_REQUIRED')
  const validation = validateFactoryBlueprint(recomputed.repairedBlueprint)
  if (!validation.valid) throw new Error('FACTORY_REPAIR_RESULT_INVALID')
  const repaired = { ...recomputed.repairedBlueprint, checks: [...validation.checks, 'factory repair: human approved'] }
  saveFactoryBlueprint(repaired)
  return repaired
}
