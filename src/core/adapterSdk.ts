import type { ToolPackageManifest } from './toolMarketplace'
import type { ToolDefinition, ToolExecutionContext, ToolRisk } from './toolSdk'

export const ADAPTER_SDK_API_VERSION = '0.1' as const

export type AdapterKind = 'tool' | 'model' | 'memory' | 'browser' | 'deployment'
export type AdapterNetworkMode = 'none' | 'read_only' | 'write'

export interface AdapterDescriptor {
  id: string
  kind: AdapterKind
  version: string
  apiVersion: typeof ADAPTER_SDK_API_VERSION
  name: string
  description: string
  capabilities: string[]
  networkMode: AdapterNetworkMode
  secretAccess: false
  monetaryCostUsd: 0
  source: 'factory-static-reviewed'
}

export interface ToolAdapterDefinition {
  descriptor: AdapterDescriptor & { kind: 'tool' }
  supportedToolIds: string[]
  supportedScopes: string[]
  maximumRisk: Exclude<ToolRisk, 'financial'>
  maxInputChars: number
  execute: (context: ToolExecutionContext, input: string) => Promise<string> | string
}

export interface ToolAdapterCompatibility {
  compatible: true
  adapter: ToolAdapterDefinition
  checks: string[]
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/u
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const RISK_RANK: Record<Exclude<ToolRisk, 'financial'>, number> = {
  read_only: 0,
  local_write: 1,
  external_write: 2,
  delete: 3,
  security_change: 4,
}

const STATIC_TOOL_ADAPTERS: ToolAdapterDefinition[] = [
  {
    descriptor: {
      id: 'adapter.local.text.stats',
      kind: 'tool',
      version: '1.0.0',
      apiVersion: ADAPTER_SDK_API_VERSION,
      name: 'Local Text Stats Adapter (موصل إحصاء النص المحلي)',
      description: 'Static reviewed adapter that computes text statistics locally with no network or secret access.',
      capabilities: ['tool:text-stats', 'sandbox:local-capability-v1'],
      networkMode: 'none',
      secretAccess: false,
      monetaryCostUsd: 0,
      source: 'factory-static-reviewed',
    },
    supportedToolIds: ['community.text.stats'],
    supportedScopes: ['text:read'],
    maximumRisk: 'read_only',
    maxInputChars: 20_000,
    execute: (_context, input) => {
      const text = input.trim()
      const words = text ? text.split(/\s+/u).length : 0
      const lines = text ? text.split(/\r?\n/u).length : 0
      return `characters=${text.length}; words=${words}; lines=${lines}`
    },
  },
]

function validateDescriptor(descriptor: AdapterDescriptor): void {
  if (!SAFE_ID.test(descriptor.id)) throw new Error('ADAPTER_ID_INVALID')
  if (!SEMVER.test(descriptor.version)) throw new Error('ADAPTER_VERSION_INVALID')
  if (descriptor.apiVersion !== ADAPTER_SDK_API_VERSION) throw new Error('ADAPTER_API_VERSION_UNSUPPORTED')
  if (!descriptor.name.trim() || descriptor.name.length > 160) throw new Error('ADAPTER_NAME_INVALID')
  if (!descriptor.description.trim() || descriptor.description.length > 1_500) throw new Error('ADAPTER_DESCRIPTION_INVALID')
  if (!Array.isArray(descriptor.capabilities) || descriptor.capabilities.length < 1 || descriptor.capabilities.length > 16) {
    throw new Error('ADAPTER_CAPABILITIES_INVALID')
  }
  if (descriptor.secretAccess !== false) throw new Error('ADAPTER_SECRET_ACCESS_FORBIDDEN')
  if (descriptor.monetaryCostUsd !== 0) throw new Error('ADAPTER_NONZERO_COST_FORBIDDEN')
  if (descriptor.source !== 'factory-static-reviewed') throw new Error('ADAPTER_SOURCE_UNTRUSTED')
}

function validateStaticRegistry(): void {
  const ids = new Set<string>()
  for (const adapter of STATIC_TOOL_ADAPTERS) {
    validateDescriptor(adapter.descriptor)
    if (adapter.descriptor.kind !== 'tool') throw new Error('ADAPTER_KIND_INVALID')
    if (ids.has(adapter.descriptor.id)) throw new Error('ADAPTER_ID_DUPLICATE')
    ids.add(adapter.descriptor.id)
    if (adapter.supportedToolIds.length < 1 || adapter.supportedToolIds.some((id) => !SAFE_ID.test(id))) throw new Error('ADAPTER_TOOL_IDS_INVALID')
    if (new Set(adapter.supportedToolIds).size !== adapter.supportedToolIds.length) throw new Error('ADAPTER_TOOL_ID_DUPLICATE')
    if (adapter.supportedScopes.length < 1 || new Set(adapter.supportedScopes).size !== adapter.supportedScopes.length) throw new Error('ADAPTER_SCOPES_INVALID')
    if (!Number.isInteger(adapter.maxInputChars) || adapter.maxInputChars < 1 || adapter.maxInputChars > 20_000) throw new Error('ADAPTER_INPUT_LIMIT_INVALID')
    if (adapter.descriptor.networkMode !== 'none') throw new Error('PHASE10D_REFERENCE_ADAPTER_NETWORK_FORBIDDEN')
  }
}

validateStaticRegistry()

export function listAdapterDescriptors(): AdapterDescriptor[] {
  return STATIC_TOOL_ADAPTERS.map((adapter) => ({ ...adapter.descriptor, capabilities: [...adapter.descriptor.capabilities] }))
}

export function listStaticToolAdapters(): ToolAdapterDefinition[] {
  return STATIC_TOOL_ADAPTERS.map((adapter) => ({
    ...adapter,
    descriptor: { ...adapter.descriptor, capabilities: [...adapter.descriptor.capabilities] },
    supportedToolIds: [...adapter.supportedToolIds],
    supportedScopes: [...adapter.supportedScopes],
  }))
}

export function getStaticToolAdapter(adapterId: string): ToolAdapterDefinition | null {
  return STATIC_TOOL_ADAPTERS.find((adapter) => adapter.descriptor.id === adapterId) ?? null
}

export function validateToolAdapterCompatibility(manifest: ToolPackageManifest): ToolAdapterCompatibility {
  const adapter = getStaticToolAdapter(manifest.implementation.adapterId)
  if (!adapter) throw new Error('ADAPTER_NOT_REGISTERED')
  const checks = [
    `adapter id: ${adapter.descriptor.id}`,
    `adapter api version: ${adapter.descriptor.apiVersion}`,
    `adapter network mode: ${adapter.descriptor.networkMode}`,
    `adapter secret access: ${adapter.descriptor.secretAccess}`,
    `adapter monetary cost: ${adapter.descriptor.monetaryCostUsd} USD`,
  ]
  if (manifest.implementation.adapterApiVersion !== adapter.descriptor.apiVersion) throw new Error('ADAPTER_API_VERSION_MISMATCH')
  if (!adapter.supportedToolIds.includes(manifest.toolId)) throw new Error('ADAPTER_TOOL_ID_UNSUPPORTED')
  if (manifest.scopes.some((scope) => !adapter.supportedScopes.includes(scope))) throw new Error('ADAPTER_SCOPE_UNSUPPORTED')
  if (RISK_RANK[manifest.risk] > RISK_RANK[adapter.maximumRisk]) throw new Error('ADAPTER_RISK_EXCEEDS_REVIEWED_CEILING')
  if (adapter.descriptor.networkMode !== 'none') throw new Error('PHASE10D_REFERENCE_ADAPTER_NETWORK_FORBIDDEN')
  if (adapter.descriptor.secretAccess !== false) throw new Error('ADAPTER_SECRET_ACCESS_FORBIDDEN')
  if (adapter.descriptor.monetaryCostUsd !== 0) throw new Error('ADAPTER_NONZERO_COST_FORBIDDEN')
  return {
    compatible: true,
    adapter,
    checks: [
      ...checks,
      'tool id compatibility: verified',
      'scope compatibility: verified',
      'risk ceiling: verified',
      'static factory review source: verified',
    ],
  }
}

export function buildAdapterBackedToolDefinition(
  manifest: ToolPackageManifest,
  adapter: ToolAdapterDefinition,
): ToolDefinition {
  validateToolAdapterCompatibility(manifest)
  if (manifest.implementation.adapterId !== adapter.descriptor.id) throw new Error('ADAPTER_ID_MISMATCH')
  return {
    id: manifest.toolId,
    name: manifest.name,
    description: manifest.description || adapter.descriptor.description,
    risk: manifest.risk,
    scopes: [...manifest.scopes],
    inputHint: manifest.inputHint,
    execute: async (context, input) => {
      if (input.length > adapter.maxInputChars) throw new Error('ADAPTER_INPUT_TOO_LARGE')
      return adapter.execute(context, input)
    },
  }
}
