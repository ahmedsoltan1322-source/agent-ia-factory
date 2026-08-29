import {
  getStaticToolAdapter,
  validateToolAdapterCompatibility,
} from './adapterSdk'
import {
  loadRegisteredMarketplaceTools,
  verifySignedToolPackage,
  type VerifiedToolPackage,
} from './toolMarketplace'
import { executeToolDefinition, type ToolCallRecord, type ToolDefinition, type ToolGateResult, type ToolRisk } from './toolSdk'
import type { AgentSpec } from './types'

export const ADAPTER_ACTIVATION_SCHEMA_VERSION = '0.1' as const
export const MAX_ACTIVE_MARKETPLACE_TOOLS = 32

const ACTIVATION_KEY = 'agent-ia-factory.adapter-activations.v1'
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/u
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const SHA256_B64URL = /^[A-Za-z0-9_-]{43}$/u
const ALLOWED_RISKS: Exclude<ToolRisk, 'financial'>[] = ['read_only', 'local_write', 'external_write', 'delete', 'security_change']
const ALLOWED_SCOPES = new Set([
  'text:read', 'memory:read', 'file:read', 'browser:read', 'network:read',
  'memory:write-local', 'file:write-local', 'external:write', 'network:write',
  'memory:delete', 'file:delete', 'security:change',
])
const MAX_AGENT_ADAPTER_TOOLS = 12

export interface ActivatedMarketplaceTool {
  schemaVersion: typeof ADAPTER_ACTIVATION_SCHEMA_VERSION
  packageDigest: string
  toolId: string
  toolVersion: string
  name: string
  description: string
  inputHint: string
  risk: Exclude<ToolRisk, 'financial'>
  scopes: string[]
  publisherId: string
  publisherFingerprint: string
  adapterId: string
  adapterVersion: string
  activatedAt: string
  activationStatus: 'active'
  monetaryCostUsd: 0
}

function now(): string { return new Date().toISOString() }

function validateActivation(raw: ActivatedMarketplaceTool): ActivatedMarketplaceTool | null {
  if (!raw || typeof raw !== 'object') return null
  const expected = [
    'schemaVersion', 'packageDigest', 'toolId', 'toolVersion', 'name', 'description', 'inputHint', 'risk', 'scopes',
    'publisherId', 'publisherFingerprint', 'adapterId', 'adapterVersion', 'activatedAt', 'activationStatus', 'monetaryCostUsd',
  ].sort()
  const keys = Object.keys(raw).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null
  if (raw.schemaVersion !== ADAPTER_ACTIVATION_SCHEMA_VERSION || raw.activationStatus !== 'active' || raw.monetaryCostUsd !== 0) return null
  if (!SHA256_B64URL.test(raw.packageDigest) || !SAFE_ID.test(raw.toolId) || !SEMVER.test(raw.toolVersion)) return null
  if (!raw.name.trim() || raw.name.length > 120 || raw.description.length > 1_500 || raw.inputHint.length > 800) return null
  if (!ALLOWED_RISKS.includes(raw.risk)) return null
  if (!Array.isArray(raw.scopes) || raw.scopes.length < 1 || raw.scopes.length > 8 || raw.scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) return null
  if (new Set(raw.scopes).size !== raw.scopes.length) return null
  if (!SAFE_ID.test(raw.publisherId) || !SHA256_B64URL.test(raw.publisherFingerprint)) return null
  if (!SAFE_ID.test(raw.adapterId) || !SEMVER.test(raw.adapterVersion)) return null
  const activated = Date.parse(raw.activatedAt)
  if (!Number.isFinite(activated)) return null

  const adapter = getStaticToolAdapter(raw.adapterId)
  if (!adapter) return null
  if (adapter.descriptor.version !== raw.adapterVersion || adapter.descriptor.monetaryCostUsd !== 0 || adapter.descriptor.secretAccess !== false) return null
  if (!adapter.supportedToolIds.includes(raw.toolId)) return null
  if (raw.scopes.some((scope) => !adapter.supportedScopes.includes(scope))) return null

  return {
    ...raw,
    name: raw.name.trim(),
    scopes: [...raw.scopes],
    activatedAt: new Date(activated).toISOString(),
  }
}

function readActivations(): ActivatedMarketplaceTool[] {
  try {
    const raw = localStorage.getItem(ACTIVATION_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    const valid = parsed.map((item) => validateActivation(item as ActivatedMarketplaceTool)).filter(Boolean) as ActivatedMarketplaceTool[]
    const unique = new Map<string, ActivatedMarketplaceTool>()
    for (const item of valid) if (!unique.has(item.toolId)) unique.set(item.toolId, item)
    return [...unique.values()].slice(0, MAX_ACTIVE_MARKETPLACE_TOOLS)
  } catch {
    return []
  }
}

function writeActivations(items: ActivatedMarketplaceTool[]): void {
  localStorage.setItem(ACTIVATION_KEY, JSON.stringify(items.slice(0, MAX_ACTIVE_MARKETPLACE_TOOLS)))
}

export function loadActivatedMarketplaceTools(): ActivatedMarketplaceTool[] {
  return readActivations()
}

export async function activateMarketplaceToolAdapter(
  verified: VerifiedToolPackage,
  approvedByHuman: boolean,
): Promise<ActivatedMarketplaceTool> {
  if (!approvedByHuman) throw new Error('ADAPTER_ACTIVATION_HUMAN_APPROVAL_REQUIRED')
  const reverified = await verifySignedToolPackage(verified.package)
  const registration = loadRegisteredMarketplaceTools().find((item) => item.packageDigest === reverified.packageDigest)
  if (!registration) throw new Error('ADAPTER_ACTIVATION_MARKETPLACE_REGISTRATION_REQUIRED')
  if (registration.registrationStatus !== 'disabled' || registration.activationAllowed !== false || registration.monetaryCostUsd !== 0) {
    throw new Error('ADAPTER_ACTIVATION_MARKETPLACE_INVARIANT_FAILED')
  }
  if (
    registration.toolId !== reverified.package.tool.toolId ||
    registration.toolVersion !== reverified.package.tool.version ||
    registration.adapterId !== reverified.package.tool.implementation.adapterId ||
    registration.publisherFingerprint !== reverified.publisherFingerprint
  ) throw new Error('ADAPTER_ACTIVATION_PACKAGE_REGISTRY_MISMATCH')

  const compatibility = validateToolAdapterCompatibility(reverified.package.tool)
  const manifest = reverified.package.tool
  const activation: ActivatedMarketplaceTool = {
    schemaVersion: ADAPTER_ACTIVATION_SCHEMA_VERSION,
    packageDigest: reverified.packageDigest,
    toolId: manifest.toolId,
    toolVersion: manifest.version,
    name: manifest.name,
    description: manifest.description,
    inputHint: manifest.inputHint,
    risk: manifest.risk,
    scopes: [...manifest.scopes],
    publisherId: reverified.package.publisher.id,
    publisherFingerprint: reverified.publisherFingerprint,
    adapterId: compatibility.adapter.descriptor.id,
    adapterVersion: compatibility.adapter.descriptor.version,
    activatedAt: now(),
    activationStatus: 'active',
    monetaryCostUsd: 0,
  }
  const safe = validateActivation(activation)
  if (!safe) throw new Error('ADAPTER_ACTIVATION_RECORD_INVALID')
  const next = [safe, ...readActivations().filter((item) => item.toolId !== safe.toolId)].slice(0, MAX_ACTIVE_MARKETPLACE_TOOLS)
  writeActivations(next)
  return safe
}

export function deactivateMarketplaceToolAdapter(toolId: string, approvedByHuman: boolean): ActivatedMarketplaceTool[] {
  if (!approvedByHuman) throw new Error('ADAPTER_DEACTIVATION_HUMAN_APPROVAL_REQUIRED')
  if (!SAFE_ID.test(toolId)) throw new Error('ADAPTER_TOOL_ID_INVALID')
  const next = readActivations().filter((item) => item.toolId !== toolId)
  writeActivations(next)
  return next
}

export function assignActivatedMarketplaceToolToAgent(
  agent: AgentSpec,
  toolId: string,
  approvedByHuman: boolean,
): AgentSpec {
  if (!approvedByHuman) throw new Error('ADAPTER_AGENT_ALLOWLIST_APPROVAL_REQUIRED')
  const activation = readActivations().find((item) => item.toolId === toolId)
  if (!activation) throw new Error('ADAPTER_TOOL_NOT_ACTIVE')
  if (agent.toolPolicy.allowedTools.includes(toolId)) return agent
  const adapterToolCount = agent.toolPolicy.allowedTools.filter((id) => readActivations().some((item) => item.toolId === id)).length
  if (adapterToolCount >= MAX_AGENT_ADAPTER_TOOLS) throw new Error('ADAPTER_AGENT_TOOL_LIMIT_REACHED')
  return {
    ...agent,
    toolPolicy: {
      ...agent.toolPolicy,
      allowedTools: [...agent.toolPolicy.allowedTools, toolId],
    },
  }
}

export function removeActivatedMarketplaceToolFromAgent(
  agent: AgentSpec,
  toolId: string,
  approvedByHuman: boolean,
): AgentSpec {
  if (!approvedByHuman) throw new Error('ADAPTER_AGENT_ALLOWLIST_REMOVE_APPROVAL_REQUIRED')
  return {
    ...agent,
    toolPolicy: {
      ...agent.toolPolicy,
      allowedTools: agent.toolPolicy.allowedTools.filter((id) => id !== toolId),
    },
  }
}

function buildActivatedToolDefinition(activation: ActivatedMarketplaceTool): ToolDefinition {
  const adapter = getStaticToolAdapter(activation.adapterId)
  if (!adapter) throw new Error('ADAPTER_NOT_REGISTERED')
  if (adapter.descriptor.version !== activation.adapterVersion) throw new Error('ADAPTER_VERSION_MISMATCH')
  if (!adapter.supportedToolIds.includes(activation.toolId)) throw new Error('ADAPTER_TOOL_ID_UNSUPPORTED')
  if (activation.scopes.some((scope) => !adapter.supportedScopes.includes(scope))) throw new Error('ADAPTER_SCOPE_UNSUPPORTED')
  return {
    id: activation.toolId,
    name: activation.name,
    description: activation.description || adapter.descriptor.description,
    risk: activation.risk,
    scopes: [...activation.scopes],
    inputHint: activation.inputHint,
    execute: async (context, input) => {
      if (input.length > adapter.maxInputChars) throw new Error('ADAPTER_INPUT_TOO_LARGE')
      return adapter.execute(context, input)
    },
  }
}

export async function executeActivatedMarketplaceTool(
  agent: AgentSpec,
  toolId: string,
  input: string,
  approvedByHuman = false,
  callIndex = 0,
): Promise<{ record: ToolCallRecord; gate: ToolGateResult }> {
  const activation = readActivations().find((item) => item.toolId === toolId)
  if (!activation) {
    const tool: ToolDefinition = {
      id: toolId,
      name: toolId,
      description: 'Missing activated adapter tool.',
      risk: 'read_only',
      scopes: ['text:read'],
      inputHint: '',
      execute: () => { throw new Error('ADAPTER_TOOL_NOT_ACTIVE') },
    }
    return executeToolDefinition(agent, tool, input, approvedByHuman, callIndex, 'adapter tool execution blocked: not active')
  }
  const tool = buildActivatedToolDefinition(activation)
  return executeToolDefinition(agent, tool, input, approvedByHuman, callIndex, 'adapter-backed marketplace tool execution')
}
