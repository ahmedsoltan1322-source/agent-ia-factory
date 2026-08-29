import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../')
      const extensionless = !/\.[A-Za-z0-9]+$/u.test(specifier)
      if (relative && extensionless && context.parentURL?.startsWith('file:')) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL)
        if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
      }
      throw error
    }
  },
})

class MemoryStorage {
  #map = new Map()
  get length() { return this.#map.size }
  clear() { this.#map.clear() }
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null }
  key(index) { return [...this.#map.keys()][index] ?? null }
  removeItem(key) { this.#map.delete(key) }
  setItem(key, value) { this.#map.set(String(key), String(value)) }
  snapshot() { return [...this.#map.entries()].sort(([a], [b]) => a.localeCompare(b)) }
}

globalThis.localStorage = new MemoryStorage()

const factory = await import(new URL('../src/core/factoryPlanner.ts', import.meta.url).href)
const ecosystem = await import(new URL('../src/core/ecosystemTemplate.ts', import.meta.url).href)
const catalogCore = await import(new URL('../src/core/communityCatalog.ts', import.meta.url).href)
const trustCore = await import(new URL('../src/core/publisherTrust.ts', import.meta.url).href)
const storage = await import(new URL('../src/core/storage.ts', import.meta.url).href)

const blueprint = factory.planAgentFactory('ابن فريقاً محلياً لمراجعة تطبيق آمن', 'local-demo')
const template = await ecosystem.createAgentTemplatePackage(blueprint, {
  templateId: 'template.community.security-review',
  version: '1.0.0',
  name: 'Security Review Team',
  description: 'Community template smoke fixture.',
}, '2026-08-29T15:20:00.000Z')
assert.equal(storage.loadAgents().length, 0)
assert.equal(storage.loadRuns().length, 0)

const source = {
  repository: 'https://github.com/example/community-templates',
  commit: 'a'.repeat(40),
  path: 'templates/security-review.agent-template.json',
}
const entry = {
  kind: 'agent-template',
  templateId: template.template.templateId,
  templateVersion: template.template.version,
  templateDigest: template.integrity.digest,
  title: template.template.name,
  summary: 'Signed catalog entry for a zero-cost template.',
  licenseSpdx: 'MIT',
  source,
  tags: ['security', 'review'],
}

const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const catalog = await catalogCore.createSignedCommunityCatalogPackage({
  publisherId: 'publisher.example.security',
  publisherDisplayName: 'Example Security Publisher',
  catalogId: 'catalog.example.security',
  version: '1.0.0',
  name: 'Example Community Catalog',
  description: 'Signed data-only catalog.',
  entries: [entry],
}, keyPair, '2026-08-29T15:21:00.000Z')

assert.equal(catalog.protocol, catalogCore.COMMUNITY_CATALOG_PROTOCOL)
assert.equal(catalog.signature.algorithm, 'Ed25519')
assert.equal(catalog.signature.value.length, 86)
assert.equal(catalog.publisher.publicKey.length, 43)
assert.equal(catalog.publisher.keyFingerprint.length, 43)
assert.equal(Object.hasOwn(catalog, 'trusted'), false)

const raw = catalogCore.exportCommunityCatalogPackage(catalog)
assert.ok(raw.length < catalogCore.MAX_COMMUNITY_CATALOG_JSON_CHARS)
const beforeImport = localStorage.snapshot()
const verified = await catalogCore.importCommunityCatalogPackage(raw)
assert.equal(verified.signatureVerified, true)
assert.equal(verified.publisherFingerprint, catalog.publisher.keyFingerprint)
assert.deepEqual(localStorage.snapshot(), beforeImport)

let trust = await trustCore.getCatalogPublisherTrustStatus(catalog)
assert.equal(trust.status, 'untrusted')
assert.equal(trust.trustedRecord, null)
assert.equal(trustCore.loadTrustedPublishers().length, 0)

await assert.rejects(
  () => trustCore.pinCatalogPublisherTrust(catalog, false),
  /PUBLISHER_TRUST_HUMAN_APPROVAL_REQUIRED/,
)
assert.equal(trustCore.loadTrustedPublishers().length, 0)

trust = await trustCore.pinCatalogPublisherTrust(catalog, true)
assert.equal(trust.status, 'trusted')
assert.equal(trustCore.loadTrustedPublishers().length, 1)
assert.equal(trust.trustedRecord?.source, 'human-pinned')

const privateKeyBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
const privateKeyBase64 = Buffer.from(privateKeyBytes).toString('base64')
const trustStorageRaw = JSON.stringify(localStorage.snapshot())
assert.ok(!trustStorageRaw.includes(privateKeyBase64))
assert.ok(trustStorageRaw.includes(catalog.publisher.publicKey))
assert.ok(!trustStorageRaw.includes('privateKey'))

const matched = catalogCore.matchTemplatePackageToCatalog(template, catalog)
assert.ok(matched)
assert.equal(matched.templateDigest, template.integrity.digest)
assert.equal(matched.source.commit, 'a'.repeat(40))
assert.equal(storage.loadAgents().length, 0)
assert.equal(storage.loadRuns().length, 0)

const tampered = JSON.parse(raw)
tampered.catalog.entries[0].summary = 'mutated after signature'
await assert.rejects(
  () => catalogCore.importCommunityCatalogPackage(JSON.stringify(tampered)),
  /CATALOG_SIGNATURE_INVALID/,
)

const hiddenTrust = JSON.parse(raw)
hiddenTrust.trusted = true
await assert.rejects(
  () => catalogCore.importCommunityCatalogPackage(JSON.stringify(hiddenTrust)),
  /CATALOG_PACKAGE_EXTRA_FIELD/,
)

const attackerPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const attackerCatalog = await catalogCore.createSignedCommunityCatalogPackage({
  publisherId: 'publisher.attacker.selfsigned',
  publisherDisplayName: 'Self Signed Attacker',
  catalogId: 'catalog.attacker',
  name: 'Self Signed Catalog',
  entries: [entry],
}, attackerPair, '2026-08-29T15:22:00.000Z')
const attackerVerified = await catalogCore.verifyCommunityCatalogPackage(attackerCatalog)
assert.equal(attackerVerified.signatureVerified, true)
const attackerTrust = await trustCore.getCatalogPublisherTrustStatus(attackerCatalog)
assert.equal(attackerTrust.status, 'untrusted')

const rotatedPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const rotatedCatalog = await catalogCore.createSignedCommunityCatalogPackage({
  publisherId: catalog.publisher.id,
  publisherDisplayName: catalog.publisher.displayName,
  catalogId: catalog.catalog.catalogId,
  version: '1.1.0',
  name: catalog.catalog.name,
  entries: [entry],
}, rotatedPair, '2026-08-29T15:23:00.000Z')
const rotatedStatus = await trustCore.getCatalogPublisherTrustStatus(rotatedCatalog)
assert.equal(rotatedStatus.status, 'key-changed')
assert.notEqual(rotatedCatalog.publisher.keyFingerprint, catalog.publisher.keyFingerprint)
await assert.rejects(
  () => trustCore.pinCatalogPublisherTrust(rotatedCatalog, true, false),
  /PUBLISHER_KEY_CHANGE_REQUIRES_EXPLICIT_REPLACE/,
)
const replaced = await trustCore.pinCatalogPublisherTrust(rotatedCatalog, true, true)
assert.equal(replaced.status, 'trusted')
assert.equal(trustCore.loadTrustedPublishers()[0].fingerprint, rotatedCatalog.publisher.keyFingerprint)
const oldAfterRotation = await trustCore.getCatalogPublisherTrustStatus(catalog)
assert.equal(oldAfterRotation.status, 'key-changed')

assert.throws(
  () => trustCore.revokePublisherTrust(rotatedCatalog.publisher.id, false),
  /PUBLISHER_TRUST_REVOKE_APPROVAL_REQUIRED/,
)
trustCore.revokePublisherTrust(rotatedCatalog.publisher.id, true)
assert.equal((await trustCore.getCatalogPublisherTrustStatus(rotatedCatalog)).status, 'untrusted')

await assert.rejects(
  () => catalogCore.createSignedCommunityCatalogPackage({
    publisherId: 'publisher.bad.license',
    publisherDisplayName: 'Bad License',
    catalogId: 'catalog.bad.license',
    name: 'Bad License Catalog',
    entries: [{ ...entry, licenseSpdx: 'AGPL-3.0' }],
  }, keyPair),
  /CATALOG_ENTRY_LICENSE_NOT_ALLOWED/,
)

await assert.rejects(
  () => catalogCore.createSignedCommunityCatalogPackage({
    publisherId: 'publisher.bad.repo',
    publisherDisplayName: 'Bad Repo',
    catalogId: 'catalog.bad.repo',
    name: 'Bad Repo Catalog',
    entries: [{ ...entry, source: { ...source, repository: 'https://github.com/example/community-templates?token=x' } }],
  }, keyPair),
  /CATALOG_SOURCE_REPOSITORY_INVALID/,
)

await assert.rejects(
  () => catalogCore.createSignedCommunityCatalogPackage({
    publisherId: 'publisher.bad.path',
    publisherDisplayName: 'Bad Path',
    catalogId: 'catalog.bad.path',
    name: 'Bad Path Catalog',
    entries: [{ ...entry, source: { ...source, path: '../escape.agent-template.json' } }],
  }, keyPair),
  /CATALOG_SOURCE_PATH_INVALID/,
)

await assert.rejects(
  () => catalogCore.createSignedCommunityCatalogPackage({
    publisherId: 'publisher.secret.metadata',
    publisherDisplayName: 'Secret Metadata',
    catalogId: 'catalog.secret.metadata',
    name: 'Secret Metadata Catalog',
    entries: [{ ...entry, summary: 'api_key = ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890' }],
  }, keyPair),
  /TEMPLATE_SECRET_LIKE_CONTENT/,
)

const mismatchedTemplate = structuredClone(template)
mismatchedTemplate.integrity.digest = 'A'.repeat(43)
assert.equal(catalogCore.matchTemplatePackageToCatalog(mismatchedTemplate, catalog), null)

console.log('Phase 10B publisher trust + community catalog smoke: PASS')
console.log('Ed25519 signed catalog verification: PASS')
console.log('Self-signed valid catalog remains untrusted until manual pin: PASS')
console.log('Human-pinned publisher fingerprint: PASS')
console.log('Private signing key never stored in localStorage: PASS')
console.log('Publisher key change requires explicit replacement: PASS')
console.log('Catalog tampering + hidden trust field: rejected')
console.log('AGPL / unsafe repository URL / path traversal: rejected')
console.log('Secret-like content in signed catalog metadata: rejected locally')
console.log('Template digest matching: data-only, no install/run side effects')
console.log('Mandatory additional spend: 0 USD')
