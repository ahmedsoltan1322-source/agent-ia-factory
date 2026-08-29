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

const marketplace = await import(new URL('../src/core/toolMarketplace.ts', import.meta.url).href)
const trust = await import(new URL('../src/core/publisherTrust.ts', import.meta.url).href)
const storage = await import(new URL('../src/core/storage.ts', import.meta.url).href)

const source = {
  repository: 'https://github.com/example/agent-tools',
  commit: 'b'.repeat(40),
  path: 'tools/text-stats.agent-tool.json',
}

const manifest = {
  toolId: 'community.text.stats',
  version: '1.0.0',
  name: 'Community Text Stats',
  description: 'A data-only signed marketplace manifest for a local text adapter.',
  licenseSpdx: 'MIT',
  risk: 'read_only',
  scopes: ['text:read'],
  inputHint: 'Enter local text.',
  implementation: {
    kind: 'registered-adapter',
    adapterId: 'adapter.local.text.stats',
    adapterApiVersion: '0.1',
  },
  policy: {
    maxMonetarySpendUsd: 0,
    automaticRegistration: false,
    automaticActivation: false,
    automaticExecution: false,
    humanApprovalRequiredToRegister: true,
    humanApprovalRequiredToActivate: true,
  },
  source,
}

const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const pkg = await marketplace.createSignedToolPackage({
  publisherId: 'publisher.example.tools',
  publisherDisplayName: 'Example Tool Publisher',
  tool: manifest,
}, keyPair, '2026-08-29T16:00:00.000Z')

assert.equal(pkg.protocol, marketplace.TOOL_PACKAGE_PROTOCOL)
assert.equal(pkg.signature.algorithm, 'Ed25519')
assert.equal(pkg.signature.value.length, 86)
assert.equal(pkg.publisher.publicKey.length, 43)
assert.equal(pkg.publisher.keyFingerprint.length, 43)
assert.equal(pkg.tool.policy.maxMonetarySpendUsd, 0)
assert.equal(pkg.tool.policy.automaticActivation, false)
assert.equal(pkg.tool.policy.automaticExecution, false)
assert.equal(Object.hasOwn(pkg, 'activated'), false)

const raw = marketplace.exportSignedToolPackage(pkg)
const beforeImport = localStorage.snapshot()
const verified = await marketplace.importSignedToolPackage(raw)
assert.equal(verified.signatureVerified, true)
assert.equal(verified.publisherFingerprint, pkg.publisher.keyFingerprint)
assert.equal(verified.package.tool.toolId, manifest.toolId)
assert.deepEqual(localStorage.snapshot(), beforeImport)
assert.equal(storage.loadAgents().length, 0)
assert.equal(storage.loadRuns().length, 0)

let preview = await marketplace.previewMarketplaceTool(verified)
assert.equal(preview.trustStatus, 'untrusted')
assert.equal(preview.alreadyRegistered, false)

await assert.rejects(
  () => marketplace.registerMarketplaceToolDisabled(verified, true),
  /TOOL_PUBLISHER_TRUST_REQUIRED/,
)
assert.equal(marketplace.loadRegisteredMarketplaceTools().length, 0)

const identity = {
  signatureVerified: true,
  publisher: {
    id: pkg.publisher.id,
    displayName: pkg.publisher.displayName,
    publicKey: pkg.publisher.publicKey,
    keyFingerprint: pkg.publisher.keyFingerprint,
  },
}
assert.equal(trust.getVerifiedPublisherIdentityTrustStatus(identity).status, 'untrusted')
assert.throws(
  () => trust.pinVerifiedPublisherIdentityTrust(identity, false),
  /PUBLISHER_TRUST_HUMAN_APPROVAL_REQUIRED/,
)
trust.pinVerifiedPublisherIdentityTrust(identity, true)
assert.equal(trust.getVerifiedPublisherIdentityTrustStatus(identity).status, 'trusted')

const privateKeyBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
const privateKeyBase64 = Buffer.from(privateKeyBytes).toString('base64')
const trustStorageRaw = JSON.stringify(localStorage.snapshot())
assert.ok(!trustStorageRaw.includes(privateKeyBase64))
assert.ok(!trustStorageRaw.includes('privateKey'))

await assert.rejects(
  () => marketplace.registerMarketplaceToolDisabled(verified, false),
  /TOOL_REGISTRATION_HUMAN_APPROVAL_REQUIRED/,
)
const registered = await marketplace.registerMarketplaceToolDisabled(verified, true)
assert.equal(registered.registrationStatus, 'disabled')
assert.equal(registered.activationAllowed, false)
assert.equal(registered.monetaryCostUsd, 0)
assert.equal(registered.adapterId, manifest.implementation.adapterId)
assert.equal(marketplace.loadRegisteredMarketplaceTools().length, 1)
assert.equal(storage.loadAgents().length, 0)
assert.equal(storage.loadRuns().length, 0)

let eligibility = marketplace.evaluateMarketplaceActivationEligibility(registered, [registered.adapterId], false)
assert.equal(eligibility.status, 'blocked')
eligibility = marketplace.evaluateMarketplaceActivationEligibility(registered, [], true)
assert.equal(eligibility.status, 'blocked')
eligibility = marketplace.evaluateMarketplaceActivationEligibility(registered, [registered.adapterId], true)
assert.equal(eligibility.status, 'eligible-for-phase10d')
assert.equal(marketplace.loadRegisteredMarketplaceTools()[0].activationAllowed, false)
assert.equal(storage.loadAgents().length, 0)
assert.equal(storage.loadRuns().length, 0)

preview = await marketplace.previewMarketplaceTool(verified)
assert.equal(preview.trustStatus, 'trusted')
assert.equal(preview.alreadyRegistered, true)

const tampered = JSON.parse(raw)
tampered.tool.description = 'mutated after signing'
await assert.rejects(
  () => marketplace.importSignedToolPackage(JSON.stringify(tampered)),
  /TOOL_SIGNATURE_INVALID/,
)

const hiddenActivation = JSON.parse(raw)
hiddenActivation.activationAllowed = true
await assert.rejects(
  () => marketplace.importSignedToolPackage(JSON.stringify(hiddenActivation)),
  /TOOL_PACKAGE_EXTRA_FIELD/,
)

await assert.rejects(
  () => marketplace.createSignedToolPackage({
    publisherId: 'publisher.bad.financial',
    publisherDisplayName: 'Bad Financial Tool',
    tool: { ...manifest, toolId: 'bad.financial', risk: 'financial' },
  }, keyPair),
  /TOOL_RISK_INVALID/,
)

await assert.rejects(
  () => marketplace.createSignedToolPackage({
    publisherId: 'publisher.bad.scope',
    publisherDisplayName: 'Bad Scope Tool',
    tool: { ...manifest, toolId: 'bad.scope', risk: 'read_only', scopes: ['network:write'] },
  }, keyPair),
  /TOOL_RISK_UNDERSTATED_FOR_SCOPE/,
)

await assert.rejects(
  () => marketplace.createSignedToolPackage({
    publisherId: 'publisher.bad.license',
    publisherDisplayName: 'Bad License Tool',
    tool: { ...manifest, toolId: 'bad.license', licenseSpdx: 'AGPL-3.0' },
  }, keyPair),
  /TOOL_LICENSE_NOT_ALLOWED/,
)

await assert.rejects(
  () => marketplace.createSignedToolPackage({
    publisherId: 'publisher.bad.repo',
    publisherDisplayName: 'Bad Repo Tool',
    tool: { ...manifest, toolId: 'bad.repo', source: { ...source, repository: 'https://github.com/example/agent-tools?token=x' } },
  }, keyPair),
  /TOOL_SOURCE_REPOSITORY_INVALID/,
)

await assert.rejects(
  () => marketplace.createSignedToolPackage({
    publisherId: 'publisher.bad.path',
    publisherDisplayName: 'Bad Path Tool',
    tool: { ...manifest, toolId: 'bad.path', source: { ...source, path: '../escape.agent-tool.json' } },
  }, keyPair),
  /TOOL_SOURCE_PATH_INVALID/,
)

await assert.rejects(
  () => marketplace.createSignedToolPackage({
    publisherId: 'publisher.secret.tool',
    publisherDisplayName: 'Secret Tool',
    tool: { ...manifest, toolId: 'bad.secret', description: 'api_key=ABCDEFGHIJKLMNOPQRSTUVWX' },
  }, keyPair),
  /TEMPLATE_SECRET_LIKE_CONTENT/,
)

const rotatedPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const rotatedPackage = await marketplace.createSignedToolPackage({
  publisherId: pkg.publisher.id,
  publisherDisplayName: pkg.publisher.displayName,
  tool: { ...manifest, version: '1.1.0' },
}, rotatedPair, '2026-08-29T16:01:00.000Z')
const rotatedVerified = await marketplace.verifySignedToolPackage(rotatedPackage)
const rotatedIdentity = {
  signatureVerified: true,
  publisher: {
    id: rotatedPackage.publisher.id,
    displayName: rotatedPackage.publisher.displayName,
    publicKey: rotatedPackage.publisher.publicKey,
    keyFingerprint: rotatedPackage.publisher.keyFingerprint,
  },
}
assert.equal(trust.getVerifiedPublisherIdentityTrustStatus(rotatedIdentity).status, 'key-changed')
assert.notEqual(rotatedVerified.publisherFingerprint, verified.publisherFingerprint)
assert.throws(
  () => trust.pinVerifiedPublisherIdentityTrust(rotatedIdentity, true, false),
  /PUBLISHER_KEY_CHANGE_REQUIRES_EXPLICIT_REPLACE/,
)

assert.throws(
  () => marketplace.removeMarketplaceTool(registered.packageDigest, false),
  /TOOL_REGISTRY_REMOVE_APPROVAL_REQUIRED/,
)
marketplace.removeMarketplaceTool(registered.packageDigest, true)
assert.equal(marketplace.loadRegisteredMarketplaceTools().length, 0)

console.log('Phase 10C safe tool marketplace smoke: PASS')
console.log('Ed25519 signed tool package verification: PASS')
console.log('Publisher trust required before registration: PASS')
console.log('Human-approved registration creates disabled-only record: PASS')
console.log('No Agent allowlist mutation / no Run side effects: PASS')
console.log('Financial risk + understated scope + unsafe license/source: rejected')
console.log('Secret-like metadata + tamper + hidden activation: rejected')
console.log('Key change: fail-closed until explicit replacement')
console.log('Activation bridge: absent; eligibility only for Phase 10D')
console.log('Mandatory additional spend: 0 USD')
