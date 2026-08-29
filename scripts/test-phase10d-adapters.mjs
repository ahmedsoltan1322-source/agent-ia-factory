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

const adapterSdk = await import(new URL('../src/core/adapterSdk.ts', import.meta.url).href)
const activation = await import(new URL('../src/core/adapterActivation.ts', import.meta.url).href)
const marketplace = await import(new URL('../src/core/toolMarketplace.ts', import.meta.url).href)
const trust = await import(new URL('../src/core/publisherTrust.ts', import.meta.url).href)
const toolSdk = await import(new URL('../src/core/toolSdk.ts', import.meta.url).href)
const createAgent = await import(new URL('../src/core/createAgent.ts', import.meta.url).href)

const descriptors = adapterSdk.listAdapterDescriptors()
assert.ok(descriptors.some((item) => item.id === 'adapter.local.text.stats'))
const descriptor = descriptors.find((item) => item.id === 'adapter.local.text.stats')
assert.equal(descriptor.kind, 'tool')
assert.equal(descriptor.apiVersion, adapterSdk.ADAPTER_SDK_API_VERSION)
assert.equal(descriptor.networkMode, 'none')
assert.equal(descriptor.secretAccess, false)
assert.equal(descriptor.monetaryCostUsd, 0)
assert.equal(descriptor.source, 'factory-static-reviewed')

const source = {
  repository: 'https://github.com/example/agent-tools',
  commit: 'c'.repeat(40),
  path: 'tools/text-stats.agent-tool.json',
}
const manifest = {
  toolId: 'community.text.stats',
  version: '1.0.0',
  name: 'Community Text Stats',
  description: 'Reviewed adapter-backed text statistics tool.',
  licenseSpdx: 'MIT',
  risk: 'read_only',
  scopes: ['text:read'],
  inputHint: 'Enter text.',
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

const compatibility = adapterSdk.validateToolAdapterCompatibility(manifest)
assert.equal(compatibility.compatible, true)
assert.equal(compatibility.adapter.descriptor.id, manifest.implementation.adapterId)
assert.ok(compatibility.checks.includes('scope compatibility: verified'))

assert.throws(
  () => adapterSdk.validateToolAdapterCompatibility({ ...manifest, toolId: 'community.fake.stats' }),
  /ADAPTER_TOOL_ID_UNSUPPORTED/,
)
assert.throws(
  () => adapterSdk.validateToolAdapterCompatibility({ ...manifest, scopes: ['network:read'] }),
  /ADAPTER_SCOPE_UNSUPPORTED/,
)
assert.throws(
  () => adapterSdk.validateToolAdapterCompatibility({ ...manifest, risk: 'local_write' }),
  /ADAPTER_RISK_EXCEEDS_REVIEWED_CEILING/,
)

const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const pkg = await marketplace.createSignedToolPackage({
  publisherId: 'publisher.example.adapters',
  publisherDisplayName: 'Example Adapter Publisher',
  tool: manifest,
}, keyPair, '2026-08-29T17:00:00.000Z')
const verified = await marketplace.verifySignedToolPackage(pkg)

await assert.rejects(
  () => activation.activateMarketplaceToolAdapter(verified, true),
  /ADAPTER_ACTIVATION_MARKETPLACE_REGISTRATION_REQUIRED/,
)

const identity = {
  signatureVerified: true,
  publisher: {
    id: pkg.publisher.id,
    displayName: pkg.publisher.displayName,
    publicKey: pkg.publisher.publicKey,
    keyFingerprint: pkg.publisher.keyFingerprint,
  },
}
trust.pinVerifiedPublisherIdentityTrust(identity, true)
const marketplaceRecord = await marketplace.registerMarketplaceToolDisabled(verified, true)
assert.equal(marketplaceRecord.registrationStatus, 'disabled')
assert.equal(marketplaceRecord.activationAllowed, false)

await assert.rejects(
  () => activation.activateMarketplaceToolAdapter(verified, false),
  /ADAPTER_ACTIVATION_HUMAN_APPROVAL_REQUIRED/,
)
const active = await activation.activateMarketplaceToolAdapter(verified, true)
assert.equal(active.activationStatus, 'active')
assert.equal(active.monetaryCostUsd, 0)
assert.equal(active.adapterId, 'adapter.local.text.stats')
assert.equal(activation.loadActivatedMarketplaceTools().length, 1)
assert.equal(marketplace.loadRegisteredMarketplaceTools()[0].registrationStatus, 'disabled')
assert.equal(marketplace.loadRegisteredMarketplaceTools()[0].activationAllowed, false)

let agent = createAgent.createDefaultAgent('Adapter test agent', 'Test reviewed adapter tools safely.', 'local-demo')
assert.equal(agent.toolPolicy.allowedTools.length, 0)

let beforeAllowlist = await activation.executeActivatedMarketplaceTool(agent, active.toolId, 'one two')
assert.equal(beforeAllowlist.gate.status, 'blocked')
assert.equal(beforeAllowlist.record.status, 'blocked')
assert.match(beforeAllowlist.record.error, /not in agent\.toolPolicy\.allowedTools/)

assert.throws(
  () => activation.assignActivatedMarketplaceToolToAgent(agent, active.toolId, false),
  /ADAPTER_AGENT_ALLOWLIST_APPROVAL_REQUIRED/,
)
agent = activation.assignActivatedMarketplaceToolToAgent(agent, active.toolId, true)
assert.deepEqual(agent.toolPolicy.allowedTools, [active.toolId])

const executed = await activation.executeActivatedMarketplaceTool(agent, active.toolId, 'one two\nthree')
assert.equal(executed.gate.status, 'allowed')
assert.equal(executed.record.status, 'success')
assert.equal(executed.record.monetaryCostUsd, 0)
assert.equal(executed.record.output, 'characters=13; words=3; lines=2')
assert.ok(executed.record.checks.includes('tool allowlist: allowed'))
assert.ok(executed.record.checks.some((check) => check.includes('capability sandbox')))
assert.ok(executed.record.checks.includes('adapter-backed marketplace tool execution: completed inside capability sandbox'))
assert.ok(toolSdk.loadToolCallLog(agent.id).some((record) => record.toolId === active.toolId && record.status === 'success'))

assert.throws(
  () => activation.removeActivatedMarketplaceToolFromAgent(agent, active.toolId, false),
  /ADAPTER_AGENT_ALLOWLIST_REMOVE_APPROVAL_REQUIRED/,
)
const agentWithoutTool = activation.removeActivatedMarketplaceToolFromAgent(agent, active.toolId, true)
assert.equal(agentWithoutTool.toolPolicy.allowedTools.includes(active.toolId), false)

assert.throws(
  () => activation.deactivateMarketplaceToolAdapter(active.toolId, false),
  /ADAPTER_DEACTIVATION_HUMAN_APPROVAL_REQUIRED/,
)
activation.deactivateMarketplaceToolAdapter(active.toolId, true)
assert.equal(activation.loadActivatedMarketplaceTools().length, 0)

const staleAllowlistAttempt = await activation.executeActivatedMarketplaceTool(agent, active.toolId, 'one two')
assert.notEqual(staleAllowlistAttempt.record.status, 'success')
assert.equal(staleAllowlistAttempt.record.monetaryCostUsd, 0)

const builtinAgent = { ...agent, toolPolicy: { ...agent.toolPolicy, allowedTools: ['local.text.stats'] } }
const builtinRegression = await toolSdk.executeBuiltinTool(builtinAgent, 'local.text.stats', 'alpha beta')
assert.equal(builtinRegression.record.status, 'success')
assert.equal(builtinRegression.record.output, 'characters=10; words=2; lines=1')

const privateKeyBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
const privateKeyBase64 = Buffer.from(privateKeyBytes).toString('base64')
const storageRaw = JSON.stringify(localStorage.snapshot())
assert.ok(!storageRaw.includes(privateKeyBase64))
assert.ok(!storageRaw.includes('privateKey'))

console.log('Phase 10D Plugin/Adapter SDK smoke: PASS')
console.log('Static reviewed adapter registry: PASS')
console.log('Marketplace registration remains disabled after adapter activation: PASS')
console.log('Activation approval and Agent allowlist approval are separate: PASS')
console.log('Adapter tool execution uses existing Tool Gate + Capability Sandbox + Tool Call Log: PASS')
console.log('Deactivation prevents successful execution even with stale Agent allowlist: PASS')
console.log('Built-in Tool SDK regression: PASS')
console.log('Private signing key persistence: absent')
console.log('Mandatory additional spend: 0 USD')
