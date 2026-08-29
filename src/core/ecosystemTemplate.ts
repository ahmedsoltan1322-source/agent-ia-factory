import {
  validateFactoryBlueprint,
  type FactoryAcceptanceTest,
  type FactoryBlueprint,
  type FactoryDomain,
  type FactoryRolePlan,
} from './factoryPlanner'
import { assertNoTemplateSecretLikeContent } from './templateSecretScan'
import type { RuntimeAdapterId } from './types'

export const AGENT_TEMPLATE_PROTOCOL = 'agent-ia-factory.template/0.1' as const
export const MAX_AGENT_TEMPLATE_JSON_CHARS = 160_000

const PACKAGE_ID = /^[A-Za-z0-9._:-]{1,120}$/u
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const TOOL_ID = /^[A-Za-z0-9._:-]{1,80}$/u
const SHA256_B64URL = /^[A-Za-z0-9_-]{43}$/u
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const DOMAINS: FactoryDomain[] = ['software', 'research_content', 'support', 'business_ops', 'general']
const RUNTIMES: RuntimeAdapterId[] = ['local-demo', 'local-qwen-webgpu']

export interface AgentTemplateContent {
  templateId: string
  version: string
  name: string
  description: string
  goal: string
  domain: FactoryDomain
  domainLabel: string
  runtimeAdapter: RuntimeAdapterId
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
}

export interface AgentTemplatePackage {
  schemaVersion: '0.1'
  packageType: 'agent-template'
  protocol: typeof AGENT_TEMPLATE_PROTOCOL
  exportedAt: string
  exporter: 'agent-ia-factory'
  template: AgentTemplateContent
  integrity: {
    algorithm: 'SHA-256'
    digest: string
  }
}

type UnsignedTemplatePackage = Omit<AgentTemplatePackage, 'integrity'>

function exactKeys(value: object, expected: string[], code: string): void {
  const keys = Object.keys(value).sort()
  const target = [...expected].sort()
  if (keys.length !== target.length || keys.some((key, index) => key !== target[index])) throw new Error(code)
}

function safeText(value: unknown, max: number, code: string): string {
  if (typeof value !== 'string') throw new Error(code)
  const clean = value.trim()
  if (!clean || clean.length > max || CONTROL.test(clean)) throw new Error(code)
  return clean
}

function safeOptionalText(value: unknown, max: number, code: string): string {
  if (typeof value !== 'string') throw new Error(code)
  const clean = value.trim()
  if (clean.length > max || CONTROL.test(clean)) throw new Error(code)
  return clean
}

function iso(value: unknown, code: string): string {
  if (typeof value !== 'string') throw new Error(code)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(code)
  return new Date(parsed).toISOString()
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]))
  }
  return value
}

export function stableTemplateStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function digestUnsigned(unsigned: UnsignedTemplatePackage): Promise<string> {
  const bytes = new TextEncoder().encode(stableTemplateStringify(unsigned))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return base64Url(new Uint8Array(digest))
}

function validateRole(raw: FactoryRolePlan): FactoryRolePlan {
  if (!raw || typeof raw !== 'object') throw new Error('TEMPLATE_ROLE_INVALID')
  exactKeys(raw, ['id', 'name', 'purpose', 'instructions', 'suggestedToolIds'], 'TEMPLATE_ROLE_EXTRA_FIELD')
  const id = safeText(raw.id, 80, 'TEMPLATE_ROLE_ID_INVALID')
  if (!PACKAGE_ID.test(id)) throw new Error('TEMPLATE_ROLE_ID_INVALID')
  const name = safeText(raw.name, 120, 'TEMPLATE_ROLE_NAME_INVALID')
  const purpose = safeText(raw.purpose, 800, 'TEMPLATE_ROLE_PURPOSE_INVALID')
  const instructions = safeText(raw.instructions, 4_000, 'TEMPLATE_ROLE_INSTRUCTIONS_INVALID')
  if (!Array.isArray(raw.suggestedToolIds) || raw.suggestedToolIds.length > 12) throw new Error('TEMPLATE_ROLE_TOOLS_INVALID')
  const suggestedToolIds = raw.suggestedToolIds.map((tool) => {
    if (typeof tool !== 'string' || !TOOL_ID.test(tool)) throw new Error('TEMPLATE_ROLE_TOOL_ID_INVALID')
    return tool
  })
  if (new Set(suggestedToolIds).size !== suggestedToolIds.length) throw new Error('TEMPLATE_ROLE_TOOL_DUPLICATE')
  return { id, name, purpose, instructions, suggestedToolIds }
}

function validateAcceptance(raw: FactoryAcceptanceTest): FactoryAcceptanceTest {
  if (!raw || typeof raw !== 'object') throw new Error('TEMPLATE_ACCEPTANCE_INVALID')
  exactKeys(raw, ['id', 'title', 'description', 'required'], 'TEMPLATE_ACCEPTANCE_EXTRA_FIELD')
  const id = safeText(raw.id, 80, 'TEMPLATE_ACCEPTANCE_ID_INVALID')
  if (!PACKAGE_ID.test(id)) throw new Error('TEMPLATE_ACCEPTANCE_ID_INVALID')
  if (raw.required !== true) throw new Error('TEMPLATE_ACCEPTANCE_REQUIRED')
  return {
    id,
    title: safeText(raw.title, 160, 'TEMPLATE_ACCEPTANCE_TITLE_INVALID'),
    description: safeText(raw.description, 1_000, 'TEMPLATE_ACCEPTANCE_DESCRIPTION_INVALID'),
    required: true,
  }
}

function validateContent(raw: AgentTemplateContent): AgentTemplateContent {
  if (!raw || typeof raw !== 'object') throw new Error('TEMPLATE_CONTENT_INVALID')
  exactKeys(raw, [
    'templateId', 'version', 'name', 'description', 'goal', 'domain', 'domainLabel', 'runtimeAdapter',
    'teamName', 'roles', 'acceptanceTests', 'workflow', 'policy',
  ], 'TEMPLATE_CONTENT_EXTRA_FIELD')

  const templateId = safeText(raw.templateId, 120, 'TEMPLATE_ID_INVALID')
  if (!PACKAGE_ID.test(templateId)) throw new Error('TEMPLATE_ID_INVALID')
  const version = safeText(raw.version, 32, 'TEMPLATE_VERSION_INVALID')
  if (!SEMVER.test(version)) throw new Error('TEMPLATE_VERSION_INVALID')
  const name = safeText(raw.name, 120, 'TEMPLATE_NAME_INVALID')
  const description = safeOptionalText(raw.description, 1_500, 'TEMPLATE_DESCRIPTION_INVALID')
  const goal = safeText(raw.goal, 6_000, 'TEMPLATE_GOAL_INVALID')
  if (!DOMAINS.includes(raw.domain)) throw new Error('TEMPLATE_DOMAIN_INVALID')
  const domain = raw.domain
  const domainLabel = safeText(raw.domainLabel, 120, 'TEMPLATE_DOMAIN_LABEL_INVALID')
  if (!RUNTIMES.includes(raw.runtimeAdapter)) throw new Error('TEMPLATE_RUNTIME_INVALID')
  const runtimeAdapter = raw.runtimeAdapter
  const teamName = safeText(raw.teamName, 100, 'TEMPLATE_TEAM_NAME_INVALID')

  if (!Array.isArray(raw.roles) || raw.roles.length < 2 || raw.roles.length > 6) throw new Error('TEMPLATE_ROLE_COUNT_INVALID')
  const roles = raw.roles.map(validateRole)
  if (new Set(roles.map((role) => role.id)).size !== roles.length) throw new Error('TEMPLATE_ROLE_ID_DUPLICATE')

  if (!Array.isArray(raw.acceptanceTests) || raw.acceptanceTests.length < 5 || raw.acceptanceTests.length > 10) {
    throw new Error('TEMPLATE_ACCEPTANCE_COUNT_INVALID')
  }
  const acceptanceTests = raw.acceptanceTests.map(validateAcceptance)
  if (new Set(acceptanceTests.map((test) => test.id)).size !== acceptanceTests.length) throw new Error('TEMPLATE_ACCEPTANCE_ID_DUPLICATE')

  if (!raw.workflow || typeof raw.workflow !== 'object') throw new Error('TEMPLATE_WORKFLOW_INVALID')
  exactKeys(raw.workflow, ['approvalBetweenAgents', 'maxAgents'], 'TEMPLATE_WORKFLOW_EXTRA_FIELD')
  if (raw.workflow.approvalBetweenAgents !== true || raw.workflow.maxAgents !== 6) throw new Error('TEMPLATE_WORKFLOW_POLICY_INVALID')

  if (!raw.policy || typeof raw.policy !== 'object') throw new Error('TEMPLATE_POLICY_INVALID')
  exactKeys(raw.policy, [
    'maxMonetarySpendUsd', 'allowPaidModels', 'enableSuggestedToolsAutomatically',
    'automaticExecutionAfterInstall', 'humanApprovalRequiredToInstall',
  ], 'TEMPLATE_POLICY_EXTRA_FIELD')
  if (
    raw.policy.maxMonetarySpendUsd !== 0 || raw.policy.allowPaidModels !== false ||
    raw.policy.enableSuggestedToolsAutomatically !== false || raw.policy.automaticExecutionAfterInstall !== false ||
    raw.policy.humanApprovalRequiredToInstall !== true
  ) throw new Error('TEMPLATE_ZERO_COST_POLICY_INVALID')

  return {
    templateId,
    version,
    name,
    description,
    goal,
    domain,
    domainLabel,
    runtimeAdapter,
    teamName,
    roles,
    acceptanceTests,
    workflow: { approvalBetweenAgents: true, maxAgents: 6 },
    policy: {
      maxMonetarySpendUsd: 0,
      allowPaidModels: false,
      enableSuggestedToolsAutomatically: false,
      automaticExecutionAfterInstall: false,
      humanApprovalRequiredToInstall: true,
    },
  }
}

function unsignedFromRaw(raw: AgentTemplatePackage): UnsignedTemplatePackage {
  if (!raw || typeof raw !== 'object') throw new Error('TEMPLATE_PACKAGE_INVALID')
  exactKeys(raw, ['schemaVersion', 'packageType', 'protocol', 'exportedAt', 'exporter', 'template', 'integrity'], 'TEMPLATE_PACKAGE_EXTRA_FIELD')
  if (raw.schemaVersion !== '0.1' || raw.packageType !== 'agent-template' || raw.protocol !== AGENT_TEMPLATE_PROTOCOL) {
    throw new Error('TEMPLATE_PACKAGE_PROTOCOL_UNSUPPORTED')
  }
  if (raw.exporter !== 'agent-ia-factory') throw new Error('TEMPLATE_EXPORTER_INVALID')
  return {
    schemaVersion: '0.1',
    packageType: 'agent-template',
    protocol: AGENT_TEMPLATE_PROTOCOL,
    exportedAt: iso(raw.exportedAt, 'TEMPLATE_EXPORTED_AT_INVALID'),
    exporter: 'agent-ia-factory',
    template: validateContent(raw.template),
  }
}

export async function validateAgentTemplatePackage(raw: AgentTemplatePackage): Promise<AgentTemplatePackage> {
  const unsigned = unsignedFromRaw(raw)
  assertNoTemplateSecretLikeContent(unsigned.template)
  if (!raw.integrity || typeof raw.integrity !== 'object') throw new Error('TEMPLATE_INTEGRITY_INVALID')
  exactKeys(raw.integrity, ['algorithm', 'digest'], 'TEMPLATE_INTEGRITY_EXTRA_FIELD')
  if (raw.integrity.algorithm !== 'SHA-256' || typeof raw.integrity.digest !== 'string' || !SHA256_B64URL.test(raw.integrity.digest)) {
    throw new Error('TEMPLATE_INTEGRITY_INVALID')
  }
  const expected = await digestUnsigned(unsigned)
  if (expected !== raw.integrity.digest) throw new Error('TEMPLATE_INTEGRITY_MISMATCH')
  const safe: AgentTemplatePackage = { ...unsigned, integrity: { algorithm: 'SHA-256', digest: expected } }
  if (stableTemplateStringify(safe).length > MAX_AGENT_TEMPLATE_JSON_CHARS) throw new Error('TEMPLATE_PACKAGE_SIZE_LIMIT')
  return safe
}

export async function createAgentTemplatePackage(
  blueprint: FactoryBlueprint,
  metadata: { templateId: string; version?: string; name: string; description?: string },
  exportedAt = new Date().toISOString(),
): Promise<AgentTemplatePackage> {
  const validation = validateFactoryBlueprint(blueprint)
  if (!validation.valid) throw new Error(`TEMPLATE_SOURCE_BLUEPRINT_INVALID:${validation.violations.join(',')}`)
  const template = validateContent({
    templateId: metadata.templateId,
    version: metadata.version ?? '1.0.0',
    name: metadata.name,
    description: metadata.description ?? '',
    goal: blueprint.goal,
    domain: blueprint.domain,
    domainLabel: blueprint.domainLabel,
    runtimeAdapter: blueprint.runtimeAdapter,
    teamName: blueprint.teamName,
    roles: blueprint.roles,
    acceptanceTests: blueprint.acceptanceTests,
    workflow: blueprint.workflow,
    policy: blueprint.policy,
  })
  assertNoTemplateSecretLikeContent(template)
  const unsigned: UnsignedTemplatePackage = {
    schemaVersion: '0.1',
    packageType: 'agent-template',
    protocol: AGENT_TEMPLATE_PROTOCOL,
    exportedAt: iso(exportedAt, 'TEMPLATE_EXPORTED_AT_INVALID'),
    exporter: 'agent-ia-factory',
    template,
  }
  const digest = await digestUnsigned(unsigned)
  return validateAgentTemplatePackage({ ...unsigned, integrity: { algorithm: 'SHA-256', digest } })
}

export function exportAgentTemplatePackage(pkg: AgentTemplatePackage): string {
  return JSON.stringify(pkg, null, 2)
}

export async function importAgentTemplatePackage(raw: string): Promise<AgentTemplatePackage> {
  if (!raw || raw.length > MAX_AGENT_TEMPLATE_JSON_CHARS) throw new Error('TEMPLATE_IMPORT_SIZE_LIMIT')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('TEMPLATE_JSON_INVALID')
  }
  return validateAgentTemplatePackage(parsed as AgentTemplatePackage)
}

export function templatePackageToBlueprint(pkg: AgentTemplatePackage, createdAt = new Date().toISOString()): FactoryBlueprint {
  const template = validateContent(pkg.template)
  assertNoTemplateSecretLikeContent(template)
  const blueprint: FactoryBlueprint = {
    schemaVersion: '0.2',
    id: `blueprint-import-${crypto.randomUUID()}`,
    status: 'validated',
    goal: template.goal,
    domain: template.domain,
    domainLabel: template.domainLabel,
    runtimeAdapter: template.runtimeAdapter,
    createdAt: iso(createdAt, 'TEMPLATE_BLUEPRINT_TIME_INVALID'),
    teamName: template.teamName,
    roles: template.roles.map((role) => ({ ...role, suggestedToolIds: [...role.suggestedToolIds] })),
    acceptanceTests: template.acceptanceTests.map((test) => ({ ...test })),
    workflow: { ...template.workflow },
    policy: { ...template.policy },
    checks: [],
  }
  const validation = validateFactoryBlueprint(blueprint)
  if (!validation.valid) throw new Error(`TEMPLATE_BLUEPRINT_INVALID:${validation.violations.join(',')}`)
  return { ...blueprint, checks: [...validation.checks, 'template integrity: SHA-256 verified', 'template secret-like scan: passed locally', 'template import: no automatic install or execution'] }
}