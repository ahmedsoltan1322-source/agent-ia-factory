import type { AgentTemplatePackage } from './ecosystemTemplate'
import { assertNoTemplateSecretLikeContent } from './templateSecretScan'

export const COMMUNITY_CATALOG_PROTOCOL = 'agent-ia-factory.catalog/0.1' as const
export const MAX_COMMUNITY_CATALOG_JSON_CHARS = 300_000
export const MAX_COMMUNITY_CATALOG_ENTRIES = 80

const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/u
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const SHA256_B64URL = /^[A-Za-z0-9_-]{43}$/u
const ED25519_PUBLIC_KEY_B64URL = /^[A-Za-z0-9_-]{43}$/u
const ED25519_SIGNATURE_B64URL = /^[A-Za-z0-9_-]{86}$/u
const COMMIT_SHA = /^[0-9a-f]{40}$/u
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]{1,120}$/u
const ALLOWED_TEMPLATE_LICENSES = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0'])

export interface CommunityCatalogEntry {
  kind: 'agent-template'
  templateId: string
  templateVersion: string
  templateDigest: string
  title: string
  summary: string
  licenseSpdx: string
  source: {
    repository: string
    commit: string
    path: string
  }
  tags: string[]
}

export interface CommunityCatalogPublisher {
  id: string
  displayName: string
  publicKey: string
  keyFingerprint: string
}

export interface CommunityCatalogContent {
  catalogId: string
  version: string
  name: string
  description: string
  entries: CommunityCatalogEntry[]
}

export interface CommunityCatalogPackage {
  schemaVersion: '0.1'
  packageType: 'community-catalog'
  protocol: typeof COMMUNITY_CATALOG_PROTOCOL
  publishedAt: string
  publisher: CommunityCatalogPublisher
  catalog: CommunityCatalogContent
  signature: {
    algorithm: 'Ed25519'
    value: string
  }
}

export interface VerifiedCommunityCatalog {
  package: CommunityCatalogPackage
  signatureVerified: true
  publisherFingerprint: string
}

type UnsignedCommunityCatalogPackage = Omit<CommunityCatalogPackage, 'signature'>

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

export function stableCommunityCatalogStringify(value: unknown): string {
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

export async function catalogPublisherFingerprint(publicKeyRaw: string): Promise<string> {
  if (!ED25519_PUBLIC_KEY_B64URL.test(publicKeyRaw)) throw new Error('CATALOG_PUBLISHER_PUBLIC_KEY_INVALID')
  const raw = fromBase64Url(publicKeyRaw, 'CATALOG_PUBLISHER_PUBLIC_KEY_INVALID')
  if (raw.byteLength !== 32) throw new Error('CATALOG_PUBLISHER_PUBLIC_KEY_INVALID')
  return sha256Base64Url(raw.buffer)
}

function validateGitHubRepository(raw: unknown): string {
  const value = safeText(raw, 240, 'CATALOG_SOURCE_REPOSITORY_INVALID')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('CATALOG_SOURCE_REPOSITORY_INVALID')
  }
  if (
    url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password ||
    url.search || url.hash || url.port
  ) throw new Error('CATALOG_SOURCE_REPOSITORY_INVALID')
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || segments.some((segment) => !SAFE_PATH_SEGMENT.test(segment))) {
    throw new Error('CATALOG_SOURCE_REPOSITORY_INVALID')
  }
  return `https://github.com/${segments[0]}/${segments[1]}`
}

function validateSourcePath(raw: unknown): string {
  const value = safeText(raw, 260, 'CATALOG_SOURCE_PATH_INVALID')
  if (value.startsWith('/') || value.includes('\\') || value.includes('//')) throw new Error('CATALOG_SOURCE_PATH_INVALID')
  const segments = value.split('/')
  if (
    segments.length < 1 || segments.length > 12 ||
    segments.some((segment) => segment === '.' || segment === '..' || !SAFE_PATH_SEGMENT.test(segment)) ||
    !value.endsWith('.agent-template.json')
  ) throw new Error('CATALOG_SOURCE_PATH_INVALID')
  return value
}

function validateEntry(raw: CommunityCatalogEntry): CommunityCatalogEntry {
  if (!raw || typeof raw !== 'object') throw new Error('CATALOG_ENTRY_INVALID')
  exactKeys(raw, ['kind', 'templateId', 'templateVersion', 'templateDigest', 'title', 'summary', 'licenseSpdx', 'source', 'tags'], 'CATALOG_ENTRY_EXTRA_FIELD')
  if (raw.kind !== 'agent-template') throw new Error('CATALOG_ENTRY_KIND_UNSUPPORTED')
  const templateId = safeText(raw.templateId, 120, 'CATALOG_ENTRY_TEMPLATE_ID_INVALID')
  if (!SAFE_ID.test(templateId)) throw new Error('CATALOG_ENTRY_TEMPLATE_ID_INVALID')
  const templateVersion = safeText(raw.templateVersion, 32, 'CATALOG_ENTRY_VERSION_INVALID')
  if (!SEMVER.test(templateVersion)) throw new Error('CATALOG_ENTRY_VERSION_INVALID')
  const templateDigest = safeText(raw.templateDigest, 80, 'CATALOG_ENTRY_DIGEST_INVALID')
  if (!SHA256_B64URL.test(templateDigest)) throw new Error('CATALOG_ENTRY_DIGEST_INVALID')
  const title = safeText(raw.title, 160, 'CATALOG_ENTRY_TITLE_INVALID')
  const summary = safeOptionalText(raw.summary, 1_200, 'CATALOG_ENTRY_SUMMARY_INVALID')
  const licenseSpdx = safeText(raw.licenseSpdx, 40, 'CATALOG_ENTRY_LICENSE_INVALID')
  if (!ALLOWED_TEMPLATE_LICENSES.has(licenseSpdx)) throw new Error('CATALOG_ENTRY_LICENSE_NOT_ALLOWED')
  if (!raw.source || typeof raw.source !== 'object') throw new Error('CATALOG_ENTRY_SOURCE_INVALID')
  exactKeys(raw.source, ['repository', 'commit', 'path'], 'CATALOG_ENTRY_SOURCE_EXTRA_FIELD')
  const repository = validateGitHubRepository(raw.source.repository)
  const commit = safeText(raw.source.commit, 40, 'CATALOG_SOURCE_COMMIT_INVALID').toLowerCase()
  if (!COMMIT_SHA.test(commit)) throw new Error('CATALOG_SOURCE_COMMIT_INVALID')
  const path = validateSourcePath(raw.source.path)
  if (!Array.isArray(raw.tags) || raw.tags.length > 12) throw new Error('CATALOG_ENTRY_TAGS_INVALID')
  const tags = raw.tags.map((tag) => safeText(tag, 40, 'CATALOG_ENTRY_TAG_INVALID').toLowerCase())
  if (new Set(tags).size !== tags.length) throw new Error('CATALOG_ENTRY_TAG_DUPLICATE')
  return {
    kind: 'agent-template', templateId, templateVersion, templateDigest, title, summary, licenseSpdx,
    source: { repository, commit, path }, tags,
  }
}

async function validateUnsigned(raw: UnsignedCommunityCatalogPackage): Promise<UnsignedCommunityCatalogPackage> {
  if (!raw || typeof raw !== 'object') throw new Error('CATALOG_PACKAGE_INVALID')
  exactKeys(raw, ['schemaVersion', 'packageType', 'protocol', 'publishedAt', 'publisher', 'catalog'], 'CATALOG_UNSIGNED_EXTRA_FIELD')
  if (raw.schemaVersion !== '0.1' || raw.packageType !== 'community-catalog' || raw.protocol !== COMMUNITY_CATALOG_PROTOCOL) {
    throw new Error('CATALOG_PROTOCOL_UNSUPPORTED')
  }
  if (!raw.publisher || typeof raw.publisher !== 'object') throw new Error('CATALOG_PUBLISHER_INVALID')
  exactKeys(raw.publisher, ['id', 'displayName', 'publicKey', 'keyFingerprint'], 'CATALOG_PUBLISHER_EXTRA_FIELD')
  const publisherId = safeText(raw.publisher.id, 120, 'CATALOG_PUBLISHER_ID_INVALID')
  if (!SAFE_ID.test(publisherId)) throw new Error('CATALOG_PUBLISHER_ID_INVALID')
  const displayName = safeText(raw.publisher.displayName, 120, 'CATALOG_PUBLISHER_NAME_INVALID')
  const publicKey = safeText(raw.publisher.publicKey, 80, 'CATALOG_PUBLISHER_PUBLIC_KEY_INVALID')
  if (!ED25519_PUBLIC_KEY_B64URL.test(publicKey)) throw new Error('CATALOG_PUBLISHER_PUBLIC_KEY_INVALID')
  const keyFingerprint = safeText(raw.publisher.keyFingerprint, 80, 'CATALOG_PUBLISHER_FINGERPRINT_INVALID')
  if (!SHA256_B64URL.test(keyFingerprint)) throw new Error('CATALOG_PUBLISHER_FINGERPRINT_INVALID')
  const expectedFingerprint = await catalogPublisherFingerprint(publicKey)
  if (keyFingerprint !== expectedFingerprint) throw new Error('CATALOG_PUBLISHER_FINGERPRINT_MISMATCH')

  if (!raw.catalog || typeof raw.catalog !== 'object') throw new Error('CATALOG_CONTENT_INVALID')
  exactKeys(raw.catalog, ['catalogId', 'version', 'name', 'description', 'entries'], 'CATALOG_CONTENT_EXTRA_FIELD')
  const catalogId = safeText(raw.catalog.catalogId, 120, 'CATALOG_ID_INVALID')
  if (!SAFE_ID.test(catalogId)) throw new Error('CATALOG_ID_INVALID')
  const version = safeText(raw.catalog.version, 32, 'CATALOG_VERSION_INVALID')
  if (!SEMVER.test(version)) throw new Error('CATALOG_VERSION_INVALID')
  const name = safeText(raw.catalog.name, 120, 'CATALOG_NAME_INVALID')
  const description = safeOptionalText(raw.catalog.description, 1_500, 'CATALOG_DESCRIPTION_INVALID')
  if (!Array.isArray(raw.catalog.entries) || raw.catalog.entries.length < 1 || raw.catalog.entries.length > MAX_COMMUNITY_CATALOG_ENTRIES) {
    throw new Error('CATALOG_ENTRY_COUNT_INVALID')
  }
  const entries = raw.catalog.entries.map(validateEntry)
  const identities = entries.map((entry) => `${entry.templateId}@${entry.templateVersion}`)
  if (new Set(identities).size !== identities.length) throw new Error('CATALOG_ENTRY_IDENTITY_DUPLICATE')
  const sourceCoordinates = entries.map((entry) => `${entry.source.repository}@${entry.source.commit}:${entry.source.path}`)
  if (new Set(sourceCoordinates).size !== sourceCoordinates.length) throw new Error('CATALOG_ENTRY_SOURCE_DUPLICATE')

  assertNoTemplateSecretLikeContent({
    publisher: { id: publisherId, displayName },
    catalog: {
      catalogId,
      version,
      name,
      description,
      entries: entries.map((entry) => ({
        kind: entry.kind,
        templateId: entry.templateId,
        templateVersion: entry.templateVersion,
        title: entry.title,
        summary: entry.summary,
        licenseSpdx: entry.licenseSpdx,
        source: entry.source,
        tags: entry.tags,
      })),
    },
  })

  return {
    schemaVersion: '0.1',
    packageType: 'community-catalog',
    protocol: COMMUNITY_CATALOG_PROTOCOL,
    publishedAt: iso(raw.publishedAt, 'CATALOG_PUBLISHED_AT_INVALID'),
    publisher: { id: publisherId, displayName, publicKey, keyFingerprint },
    catalog: { catalogId, version, name, description, entries },
  }
}

async function importEd25519PublicKey(raw: string): Promise<CryptoKey> {
  const keyBytes = fromBase64Url(raw, 'CATALOG_PUBLISHER_PUBLIC_KEY_INVALID')
  if (keyBytes.byteLength !== 32) throw new Error('CATALOG_PUBLISHER_PUBLIC_KEY_INVALID')
  return crypto.subtle.importKey('raw', keyBytes.buffer, { name: 'Ed25519' }, false, ['verify'])
}

export async function verifyCommunityCatalogPackage(raw: CommunityCatalogPackage): Promise<VerifiedCommunityCatalog> {
  if (!raw || typeof raw !== 'object') throw new Error('CATALOG_PACKAGE_INVALID')
  exactKeys(raw, ['schemaVersion', 'packageType', 'protocol', 'publishedAt', 'publisher', 'catalog', 'signature'], 'CATALOG_PACKAGE_EXTRA_FIELD')
  const unsigned = await validateUnsigned({
    schemaVersion: raw.schemaVersion,
    packageType: raw.packageType,
    protocol: raw.protocol,
    publishedAt: raw.publishedAt,
    publisher: raw.publisher,
    catalog: raw.catalog,
  })
  if (!raw.signature || typeof raw.signature !== 'object') throw new Error('CATALOG_SIGNATURE_INVALID')
  exactKeys(raw.signature, ['algorithm', 'value'], 'CATALOG_SIGNATURE_EXTRA_FIELD')
  if (raw.signature.algorithm !== 'Ed25519' || typeof raw.signature.value !== 'string' || !ED25519_SIGNATURE_B64URL.test(raw.signature.value)) {
    throw new Error('CATALOG_SIGNATURE_INVALID')
  }
  const signature = fromBase64Url(raw.signature.value, 'CATALOG_SIGNATURE_INVALID')
  if (signature.byteLength !== 64) throw new Error('CATALOG_SIGNATURE_INVALID')
  const key = await importEd25519PublicKey(unsigned.publisher.publicKey)
  const valid = await crypto.subtle.verify({ name: 'Ed25519' }, key, signature.buffer, bytes(stableCommunityCatalogStringify(unsigned)))
  if (!valid) throw new Error('CATALOG_SIGNATURE_INVALID')
  const safe: CommunityCatalogPackage = { ...unsigned, signature: { algorithm: 'Ed25519', value: raw.signature.value } }
  if (stableCommunityCatalogStringify(safe).length > MAX_COMMUNITY_CATALOG_JSON_CHARS) throw new Error('CATALOG_PACKAGE_SIZE_LIMIT')
  return { package: safe, signatureVerified: true, publisherFingerprint: unsigned.publisher.keyFingerprint }
}

export async function importCommunityCatalogPackage(raw: string): Promise<VerifiedCommunityCatalog> {
  if (!raw || raw.length > MAX_COMMUNITY_CATALOG_JSON_CHARS) throw new Error('CATALOG_IMPORT_SIZE_LIMIT')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('CATALOG_JSON_INVALID')
  }
  return verifyCommunityCatalogPackage(parsed as CommunityCatalogPackage)
}

export async function createSignedCommunityCatalogPackage(
  input: {
    publisherId: string
    publisherDisplayName: string
    catalogId: string
    version?: string
    name: string
    description?: string
    entries: CommunityCatalogEntry[]
  },
  keyPair: CryptoKeyPair,
  publishedAt = new Date().toISOString(),
): Promise<CommunityCatalogPackage> {
  if (!keyPair?.publicKey || !keyPair?.privateKey) throw new Error('CATALOG_SIGNING_KEYPAIR_REQUIRED')
  const publicRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  if (publicRaw.byteLength !== 32) throw new Error('CATALOG_SIGNING_PUBLIC_KEY_INVALID')
  const publicKey = base64Url(new Uint8Array(publicRaw))
  const keyFingerprint = await catalogPublisherFingerprint(publicKey)
  const unsigned = await validateUnsigned({
    schemaVersion: '0.1',
    packageType: 'community-catalog',
    protocol: COMMUNITY_CATALOG_PROTOCOL,
    publishedAt,
    publisher: { id: input.publisherId, displayName: input.publisherDisplayName, publicKey, keyFingerprint },
    catalog: {
      catalogId: input.catalogId,
      version: input.version ?? '1.0.0',
      name: input.name,
      description: input.description ?? '',
      entries: input.entries,
    },
  })
  const signatureBuffer = await crypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, bytes(stableCommunityCatalogStringify(unsigned)))
  const pkg: CommunityCatalogPackage = { ...unsigned, signature: { algorithm: 'Ed25519', value: base64Url(new Uint8Array(signatureBuffer)) } }
  return (await verifyCommunityCatalogPackage(pkg)).package
}

export function exportCommunityCatalogPackage(pkg: CommunityCatalogPackage): string {
  return JSON.stringify(pkg, null, 2)
}

export function matchTemplatePackageToCatalog(
  templatePackage: AgentTemplatePackage,
  catalog: CommunityCatalogPackage,
): CommunityCatalogEntry | null {
  const templateId = templatePackage.template.templateId
  const version = templatePackage.template.version
  const digest = templatePackage.integrity.digest
  return catalog.catalog.entries.find((entry) => (
    entry.templateId === templateId && entry.templateVersion === version && entry.templateDigest === digest
  )) ?? null
}
