import { assertNoTemplateSecretLikeContent } from './templateSecretScan'
import {
  getVerifiedPublisherIdentityTrustStatus,
  type PublisherTrustStatus,
  type VerifiedPublisherIdentity,
} from './publisherTrust'
import type { ToolRisk } from './toolSdk'

export const TOOL_PACKAGE_PROTOCOL = 'agent-ia-factory.tool-package/0.1' as const
export const MAX_TOOL_PACKAGE_JSON_CHARS = 120_000
export const MAX_MARKETPLACE_TOOLS = 60

const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/u
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const SHA256_B64URL = /^[A-Za-z0-9_-]{43}$/u
const ED25519_PUBLIC_KEY_B64URL = /^[A-Za-z0-9_-]{43}$/u
const ED25519_SIGNATURE_B64URL = /^[A-Za-z0-9_-]{86}$/u
const COMMIT_SHA = /^[0-9a-f]{40}$/u
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]{1,120}$/u
const REGISTRY_KEY = 'agent-ia-factory.tool-marketplace.v1'

const ALLOWED_LICENSES = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0'])
const ALLOWED_RISKS: Exclude<ToolRisk, 'financial'>[] = ['read_only', 'local_write', 'external_write', 'delete', 'security_change']
const RISK_RANK: Record<Exclude<ToolRisk, 'financial'>, number> = {
  read_only: 0,
  local_write: 1,
  external_write: 2,
  delete: 3,
  security_change: 4,
}
const SCOPE_MIN_RISK: Record<string, Exclude<ToolRisk, 'financial'>> = {
  'text:read': 'read_only',
  'memory:read': 'read_only',
  'file:read': 'read_only',
  'browser:read': 'read_only',
  'network:read': 'read_only',
  'memory:write-local': 'local_write',
  'file:write-local': 'local_write',
  'external:write': 'external_write',
  'network:write': 'external_write',
  'memory:delete': 'delete',
  'file:delete': 'delete',
  'security:change': 'security_change',
}

export interface ToolPackagePublisher {
  id: string
  displayName: string
  publicKey: string
  keyFingerprint: string
}

export interface ToolPackageManifest {
  toolId: string
  version: string
  name: string
  description: string
  licenseSpdx: string
  risk: Exclude<ToolRisk, 'financial'>
  scopes: string[]
  inputHint: string
  implementation: {
    kind: 'registered-adapter'
    adapterId: string
    adapterApiVersion: '0.1'
  }
  policy: {
    maxMonetarySpendUsd: 0
    automaticRegistration: false
    automaticActivation: false
    automaticExecution: false
    humanApprovalRequiredToRegister: true
    humanApprovalRequiredToActivate: true
  }
  source: {
    repository: string
    commit: string
    path: string
  }
}

export interface SignedToolPackage {
  schemaVersion: '0.1'
  packageType: 'tool-package'
  protocol: typeof TOOL_PACKAGE_PROTOCOL
  publishedAt: string
  publisher: ToolPackagePublisher
  tool: ToolPackageManifest
  signature: {
    algorithm: 'Ed25519'
    value: string
  }
}

type UnsignedToolPackage = Omit<SignedToolPackage, 'signature'>

export interface VerifiedToolPackage {
  package: SignedToolPackage
  signatureVerified: true
  publisherFingerprint: string
  packageDigest: string
}

export interface RegisteredMarketplaceTool {
  schemaVersion: '0.1'
  packageDigest: string
  toolId: string
  toolVersion: string
  name: string
  risk: Exclude<ToolRisk, 'financial'>
  scopes: string[]
  publisherId: string
  publisherFingerprint: string
  adapterId: string
  registeredAt: string
  registrationStatus: 'disabled'
  activationAllowed: false
  monetaryCostUsd: 0
}

export interface MarketplaceToolPreview {
  verified: VerifiedToolPackage
  trustStatus: PublisherTrustStatus
  alreadyRegistered: boolean
}

export interface MarketplaceActivationEligibility {
  status: 'blocked' | 'eligible-for-phase10d'
  reason: string
  checks: string[]
}

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

export function stableToolPackageStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string, code: string): Uint8Array<ArrayBuffer> {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    throw new Error(code)
  }
}

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).slice().buffer
}

async function sha256Base64Url(data: ArrayBuffer): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
}

async function publisherFingerprint(publicKeyRaw: string): Promise<string> {
  if (!ED25519_PUBLIC_KEY_B64URL.test(publicKeyRaw)) throw new Error('TOOL_PUBLISHER_PUBLIC_KEY_INVALID')
  const raw = fromBase64Url(publicKeyRaw, 'TOOL_PUBLISHER_PUBLIC_KEY_INVALID')
  if (raw.byteLength !== 32) throw new Error('TOOL_PUBLISHER_PUBLIC_KEY_INVALID')
  return sha256Base64Url(raw.buffer)
}

function validateGitHubRepository(raw: unknown): string {
  const value = safeText(raw, 240, 'TOOL_SOURCE_REPOSITORY_INVALID')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('TOOL_SOURCE_REPOSITORY_INVALID')
  }
  if (
    url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password ||
    url.search || url.hash || url.port
  ) throw new Error('TOOL_SOURCE_REPOSITORY_INVALID')
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || segments.some((segment) => !SAFE_PATH_SEGMENT.test(segment))) {
    throw new Error('TOOL_SOURCE_REPOSITORY_INVALID')
  }
  return `https://github.com/${segments[0]}/${segments[1]}`
}

function validateSourcePath(raw: unknown): string {
  const value = safeText(raw, 260, 'TOOL_SOURCE_PATH_INVALID')
  if (value.startsWith('/') || value.includes('\\') || value.includes('//')) throw new Error('TOOL_SOURCE_PATH_INVALID')
  const segments = value.split('/')
  if (
    segments.length < 1 || segments.length > 12 ||
    segments.some((segment) => segment === '.' || segment === '..' || !SAFE_PATH_SEGMENT.test(segment)) ||
    !value.endsWith('.agent-tool.json')
  ) throw new Error('TOOL_SOURCE_PATH_INVALID')
  return value
}

function validateManifest(raw: ToolPackageManifest): ToolPackageManifest {
  if (!raw || typeof raw !== 'object') throw new Error('TOOL_MANIFEST_INVALID')
  exactKeys(raw, [
    'toolId', 'version', 'name', 'description', 'licenseSpdx', 'risk', 'scopes', 'inputHint',
    'implementation', 'policy', 'source',
  ], 'TOOL_MANIFEST_EXTRA_FIELD')

  const toolId = safeText(raw.toolId, 120, 'TOOL_ID_INVALID')
  if (!SAFE_ID.test(toolId)) throw new Error('TOOL_ID_INVALID')
  const version = safeText(raw.version, 32, 'TOOL_VERSION_INVALID')
  if (!SEMVER.test(version)) throw new Error('TOOL_VERSION_INVALID')
  const name = safeText(raw.name, 120, 'TOOL_NAME_INVALID')
  const description = safeOptionalText(raw.description, 1_500, 'TOOL_DESCRIPTION_INVALID')
  const licenseSpdx = safeText(raw.licenseSpdx, 40, 'TOOL_LICENSE_INVALID')
  if (!ALLOWED_LICENSES.has(licenseSpdx)) throw new Error('TOOL_LICENSE_NOT_ALLOWED')
  if (!ALLOWED_RISKS.includes(raw.risk)) throw new Error('TOOL_RISK_INVALID')
  const risk = raw.risk

  if (!Array.isArray(raw.scopes) || raw.scopes.length < 1 || raw.scopes.length > 8) throw new Error('TOOL_SCOPES_INVALID')
  const scopes = raw.scopes.map((scope) => {
    const safe = safeText(scope, 80, 'TOOL_SCOPE_INVALID')
    if (!(safe in SCOPE_MIN_RISK)) throw new Error('TOOL_SCOPE_NOT_ALLOWED')
    return safe
  })
  if (new Set(scopes).size !== scopes.length) throw new Error('TOOL_SCOPE_DUPLICATE')
  for (const scope of scopes) {
    if (RISK_RANK[risk] < RISK_RANK[SCOPE_MIN_RISK[scope]]) throw new Error('TOOL_RISK_UNDERSTATED_FOR_SCOPE')
  }

  const inputHint = safeOptionalText(raw.inputHint, 800, 'TOOL_INPUT_HINT_INVALID')

  if (!raw.implementation || typeof raw.implementation !== 'object') throw new Error('TOOL_IMPLEMENTATION_INVALID')
  exactKeys(raw.implementation, ['kind', 'adapterId', 'adapterApiVersion'], 'TOOL_IMPLEMENTATION_EXTRA_FIELD')
  if (raw.implementation.kind !== 'registered-adapter' || raw.implementation.adapterApiVersion !== '0.1') {
    throw new Error('TOOL_IMPLEMENTATION_UNSUPPORTED')
  }
  const adapterId = safeText(raw.implementation.adapterId, 120, 'TOOL_ADAPTER_ID_INVALID')
  if (!SAFE_ID.test(adapterId)) throw new Error('TOOL_ADAPTER_ID_INVALID')

  if (!raw.policy || typeof raw.policy !== 'object') throw new Error('TOOL_POLICY_INVALID')
  exactKeys(raw.policy, [
    'maxMonetarySpendUsd', 'automaticRegistration', 'automaticActivation', 'automaticExecution',
    'humanApprovalRequiredToRegister', 'humanApprovalRequiredToActivate',
  ], 'TOOL_POLICY_EXTRA_FIELD')
  if (
    raw.policy.maxMonetarySpendUsd !== 0 || raw.policy.automaticRegistration !== false ||
    raw.policy.automaticActivation !== false || raw.policy.automaticExecution !== false ||
    raw.policy.humanApprovalRequiredToRegister !== true || raw.policy.humanApprovalRequiredToActivate !== true
  ) throw new Error('TOOL_ZERO_COST_POLICY_INVALID')

  if (!raw.source || typeof raw.source !== 'object') throw new Error('TOOL_SOURCE_INVALID')
  exactKeys(raw.source, ['repository', 'commit', 'path'], 'TOOL_SOURCE_EXTRA_FIELD')
  const repository = validateGitHubRepository(raw.source.repository)
  const commit = safeText(raw.source.commit, 40, 'TOOL_SOURCE_COMMIT_INVALID').toLowerCase()
  if (!COMMIT_SHA.test(commit)) throw new Error('TOOL_SOURCE_COMMIT_INVALID')
  const path = validateSourcePath(raw.source.path)

  const safe: ToolPackageManifest = {
    toolId,
    version,
    name,
    description,
    licenseSpdx,
    risk,
    scopes,
    inputHint,
    implementation: { kind: 'registered-adapter', adapterId, adapterApiVersion: '0.1' },
    policy: {
      maxMonetarySpendUsd: 0,
      automaticRegistration: false,
      automaticActivation: false,
      automaticExecution: false,
      humanApprovalRequiredToRegister: true,
      humanApprovalRequiredToActivate: true,
    },
    source: { repository, commit, path },
  }
  assertNoTemplateSecretLikeContent(safe)
  return safe
}

async function validateUnsigned(raw: UnsignedToolPackage): Promise<UnsignedToolPackage> {
  if (!raw || typeof raw !== 'object') throw new Error('TOOL_PACKAGE_INVALID')
  exactKeys(raw, ['schemaVersion', 'packageType', 'protocol', 'publishedAt', 'publisher', 'tool'], 'TOOL_UNSIGNED_EXTRA_FIELD')
  if (raw.schemaVersion !== '0.1' || raw.packageType !== 'tool-package' || raw.protocol !== TOOL_PACKAGE_PROTOCOL) {
    throw new Error('TOOL_PROTOCOL_UNSUPPORTED')
  }

  if (!raw.publisher || typeof raw.publisher !== 'object') throw new Error('TOOL_PUBLISHER_INVALID')
  exactKeys(raw.publisher, ['id', 'displayName', 'publicKey', 'keyFingerprint'], 'TOOL_PUBLISHER_EXTRA_FIELD')
  const publisherId = safeText(raw.publisher.id, 120, 'TOOL_PUBLISHER_ID_INVALID')
  if (!SAFE_ID.test(publisherId)) throw new Error('TOOL_PUBLISHER_ID_INVALID')
  const displayName = safeText(raw.publisher.displayName, 120, 'TOOL_PUBLISHER_NAME_INVALID')
  const publicKey = safeText(raw.publisher.publicKey, 80, 'TOOL_PUBLISHER_PUBLIC_KEY_INVALID')
  if (!ED25519_PUBLIC_KEY_B64URL.test(publicKey)) throw new Error('TOOL_PUBLISHER_PUBLIC_KEY_INVALID')
  const keyFingerprint = safeText(raw.publisher.keyFingerprint, 80, 'TOOL_PUBLISHER_FINGERPRINT_INVALID')
  if (!SHA256_B64URL.test(keyFingerprint)) throw new Error('TOOL_PUBLISHER_FINGERPRINT_INVALID')
  if (keyFingerprint !== await publisherFingerprint(publicKey)) throw new Error('TOOL_PUBLISHER_FINGERPRINT_MISMATCH')

  const tool = validateManifest(raw.tool)
  const safe: UnsignedToolPackage = {
    schemaVersion: '0.1',
    packageType: 'tool-package',
    protocol: TOOL_PACKAGE_PROTOCOL,
    publishedAt: iso(raw.publishedAt, 'TOOL_PUBLISHED_AT_INVALID'),
    publisher: { id: publisherId, displayName, publicKey, keyFingerprint },
    tool,
  }
  assertNoTemplateSecretLikeContent({
    publisherId,
    displayName,
    tool: { name: tool.name, description: tool.description, inputHint: tool.inputHint },
  })
  return safe
}

async function importPublicKey(raw: string): Promise<CryptoKey> {
  const keyBytes = fromBase64Url(raw, 'TOOL_PUBLISHER_PUBLIC_KEY_INVALID')
  if (keyBytes.byteLength !== 32) throw new Error('TOOL_PUBLISHER_PUBLIC_KEY_INVALID')
  return crypto.subtle.importKey('raw', keyBytes.buffer, { name: 'Ed25519' }, false, ['verify'])
}

export async function verifySignedToolPackage(raw: SignedToolPackage): Promise<VerifiedToolPackage> {
  if (!raw || typeof raw !== 'object') throw new Error('TOOL_PACKAGE_INVALID')
  exactKeys(raw, ['schemaVersion', 'packageType', 'protocol', 'publishedAt', 'publisher', 'tool', 'signature'], 'TOOL_PACKAGE_EXTRA_FIELD')
  const unsigned = await validateUnsigned({
    schemaVersion: raw.schemaVersion,
    packageType: raw.packageType,
    protocol: raw.protocol,
    publishedAt: raw.publishedAt,
    publisher: raw.publisher,
    tool: raw.tool,
  })
  if (!raw.signature || typeof raw.signature !== 'object') throw new Error('TOOL_SIGNATURE_INVALID')
  exactKeys(raw.signature, ['algorithm', 'value'], 'TOOL_SIGNATURE_EXTRA_FIELD')
  if (raw.signature.algorithm !== 'Ed25519' || typeof raw.signature.value !== 'string' || !ED25519_SIGNATURE_B64URL.test(raw.signature.value)) {
    throw new Error('TOOL_SIGNATURE_INVALID')
  }
  const signature = fromBase64Url(raw.signature.value, 'TOOL_SIGNATURE_INVALID')
  if (signature.byteLength !== 64) throw new Error('TOOL_SIGNATURE_INVALID')
  const key = await importPublicKey(unsigned.publisher.publicKey)
  const valid = await crypto.subtle.verify({ name: 'Ed25519' }, key, signature.buffer, bytes(stableToolPackageStringify(unsigned)))
  if (!valid) throw new Error('TOOL_SIGNATURE_INVALID')
  const safe: SignedToolPackage = { ...unsigned, signature: { algorithm: 'Ed25519', value: raw.signature.value } }
  const serialized = stableToolPackageStringify(safe)
  if (serialized.length > MAX_TOOL_PACKAGE_JSON_CHARS) throw new Error('TOOL_PACKAGE_SIZE_LIMIT')
  return {
    package: safe,
    signatureVerified: true,
    publisherFingerprint: safe.publisher.keyFingerprint,
    packageDigest: await sha256Base64Url(bytes(serialized)),
  }
}

export async function importSignedToolPackage(raw: string): Promise<VerifiedToolPackage> {
  if (!raw || raw.length > MAX_TOOL_PACKAGE_JSON_CHARS) throw new Error('TOOL_IMPORT_SIZE_LIMIT')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('TOOL_JSON_INVALID')
  }
  return verifySignedToolPackage(parsed as SignedToolPackage)
}

export async function createSignedToolPackage(
  input: {
    publisherId: string
    publisherDisplayName: string
    tool: ToolPackageManifest
  },
  keyPair: CryptoKeyPair,
  publishedAt = new Date().toISOString(),
): Promise<SignedToolPackage> {
  if (!keyPair?.publicKey || !keyPair?.privateKey) throw new Error('TOOL_SIGNING_KEYPAIR_REQUIRED')
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  if (publicBytes.byteLength !== 32) throw new Error('TOOL_SIGNING_PUBLIC_KEY_INVALID')
  const publicKey = base64Url(publicBytes)
  const keyFingerprint = await publisherFingerprint(publicKey)
  const unsigned = await validateUnsigned({
    schemaVersion: '0.1',
    packageType: 'tool-package',
    protocol: TOOL_PACKAGE_PROTOCOL,
    publishedAt,
    publisher: {
      id: input.publisherId,
      displayName: input.publisherDisplayName,
      publicKey,
      keyFingerprint,
    },
    tool: input.tool,
  })
  const signatureBytes = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, bytes(stableToolPackageStringify(unsigned))))
  if (signatureBytes.byteLength !== 64) throw new Error('TOOL_SIGNATURE_INVALID')
  const pkg: SignedToolPackage = { ...unsigned, signature: { algorithm: 'Ed25519', value: base64Url(signatureBytes) } }
  if (stableToolPackageStringify(pkg).length > MAX_TOOL_PACKAGE_JSON_CHARS) throw new Error('TOOL_PACKAGE_SIZE_LIMIT')
  return pkg
}

export function exportSignedToolPackage(pkg: SignedToolPackage): string {
  return `${JSON.stringify(pkg, null, 2)}\n`
}

function identityForTool(verified: VerifiedToolPackage): VerifiedPublisherIdentity {
  return {
    signatureVerified: true,
    publisher: {
      id: verified.package.publisher.id,
      displayName: verified.package.publisher.displayName,
      publicKey: verified.package.publisher.publicKey,
      keyFingerprint: verified.package.publisher.keyFingerprint,
    },
  }
}

function validateRegistryRecord(raw: RegisteredMarketplaceTool): RegisteredMarketplaceTool | null {
  if (!raw || typeof raw !== 'object') return null
  const expected = [
    'schemaVersion', 'packageDigest', 'toolId', 'toolVersion', 'name', 'risk', 'scopes', 'publisherId',
    'publisherFingerprint', 'adapterId', 'registeredAt', 'registrationStatus', 'activationAllowed', 'monetaryCostUsd',
  ].sort()
  const keys = Object.keys(raw).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null
  if (raw.schemaVersion !== '0.1' || raw.registrationStatus !== 'disabled' || raw.activationAllowed !== false || raw.monetaryCostUsd !== 0) return null
  if (!SHA256_B64URL.test(raw.packageDigest) || !SAFE_ID.test(raw.toolId) || !SEMVER.test(raw.toolVersion)) return null
  if (!raw.name.trim() || raw.name.length > 120 || !ALLOWED_RISKS.includes(raw.risk)) return null
  if (!Array.isArray(raw.scopes) || raw.scopes.length < 1 || raw.scopes.some((scope) => !(scope in SCOPE_MIN_RISK))) return null
  if (!SAFE_ID.test(raw.publisherId) || !SHA256_B64URL.test(raw.publisherFingerprint) || !SAFE_ID.test(raw.adapterId)) return null
  if (!Number.isFinite(Date.parse(raw.registeredAt))) return null
  return {
    ...raw,
    name: raw.name.trim(),
    registeredAt: new Date(raw.registeredAt).toISOString(),
    scopes: [...raw.scopes],
  }
}

function readRegistry(): RegisteredMarketplaceTool[] {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    const valid = parsed.map((item) => validateRegistryRecord(item as RegisteredMarketplaceTool)).filter(Boolean) as RegisteredMarketplaceTool[]
    const unique = new Map<string, RegisteredMarketplaceTool>()
    for (const item of valid) if (!unique.has(item.packageDigest)) unique.set(item.packageDigest, item)
    return [...unique.values()].slice(0, MAX_MARKETPLACE_TOOLS)
  } catch {
    return []
  }
}

function writeRegistry(items: RegisteredMarketplaceTool[]): void {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(items.slice(0, MAX_MARKETPLACE_TOOLS)))
}

export function loadRegisteredMarketplaceTools(): RegisteredMarketplaceTool[] {
  return readRegistry()
}

export async function previewMarketplaceTool(verified: VerifiedToolPackage): Promise<MarketplaceToolPreview> {
  const reverified = await verifySignedToolPackage(verified.package)
  const trust = getVerifiedPublisherIdentityTrustStatus(identityForTool(reverified))
  return {
    verified: reverified,
    trustStatus: trust.status,
    alreadyRegistered: readRegistry().some((item) => item.packageDigest === reverified.packageDigest),
  }
}

export async function registerMarketplaceToolDisabled(
  verified: VerifiedToolPackage,
  approvedByHuman: boolean,
): Promise<RegisteredMarketplaceTool> {
  if (!approvedByHuman) throw new Error('TOOL_REGISTRATION_HUMAN_APPROVAL_REQUIRED')
  const reverified = await verifySignedToolPackage(verified.package)
  const trust = getVerifiedPublisherIdentityTrustStatus(identityForTool(reverified))
  if (trust.status !== 'trusted') throw new Error('TOOL_PUBLISHER_TRUST_REQUIRED')
  const manifest = reverified.package.tool
  const record: RegisteredMarketplaceTool = {
    schemaVersion: '0.1',
    packageDigest: reverified.packageDigest,
    toolId: manifest.toolId,
    toolVersion: manifest.version,
    name: manifest.name,
    risk: manifest.risk,
    scopes: [...manifest.scopes],
    publisherId: reverified.package.publisher.id,
    publisherFingerprint: reverified.publisherFingerprint,
    adapterId: manifest.implementation.adapterId,
    registeredAt: new Date().toISOString(),
    registrationStatus: 'disabled',
    activationAllowed: false,
    monetaryCostUsd: 0,
  }
  const next = [record, ...readRegistry().filter((item) => item.packageDigest !== record.packageDigest)].slice(0, MAX_MARKETPLACE_TOOLS)
  writeRegistry(next)
  return record
}

export function removeMarketplaceTool(packageDigest: string, approvedByHuman: boolean): RegisteredMarketplaceTool[] {
  if (!approvedByHuman) throw new Error('TOOL_REGISTRY_REMOVE_APPROVAL_REQUIRED')
  if (!SHA256_B64URL.test(packageDigest)) throw new Error('TOOL_REGISTRY_DIGEST_INVALID')
  const next = readRegistry().filter((item) => item.packageDigest !== packageDigest)
  writeRegistry(next)
  return next
}

export function evaluateMarketplaceActivationEligibility(
  record: RegisteredMarketplaceTool,
  availableAdapterIds: string[],
  approvedByHuman: boolean,
): MarketplaceActivationEligibility {
  const checks = [
    `registration status: ${record.registrationStatus}`,
    `activationAllowed flag: ${record.activationAllowed}`,
    `monetary cost: ${record.monetaryCostUsd} USD`,
    `adapter id: ${record.adapterId}`,
  ]
  if (record.registrationStatus !== 'disabled' || record.activationAllowed !== false || record.monetaryCostUsd !== 0) {
    return { status: 'blocked', reason: 'Marketplace registry invariant failed.', checks }
  }
  if (!approvedByHuman) return { status: 'blocked', reason: 'Separate human activation approval is required.', checks }
  if (!availableAdapterIds.includes(record.adapterId)) return { status: 'blocked', reason: 'A verified local adapter is not registered.', checks }
  return {
    status: 'eligible-for-phase10d',
    reason: 'Package is eligible for a future Adapter SDK activation bridge; Phase 10C still performs no activation.',
    checks: [...checks, 'human activation approval: present', 'verified adapter id: present', 'runtime activation: deferred to Phase 10D'],
  }
}
