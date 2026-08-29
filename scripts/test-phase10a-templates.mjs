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
const storage = await import(new URL('../src/core/storage.ts', import.meta.url).href)
const workflowEngine = await import(new URL('../src/core/workflowEngine.ts', import.meta.url).href)

const blueprint = factory.planAgentFactory('ابن تطبيقاً محلياً آمناً مع اختبارات ومراجعة أمنية', 'local-demo')
assert.equal(factory.validateFactoryBlueprint(blueprint).valid, true)
assert.equal(storage.loadAgents().length, 0)
assert.equal(storage.loadRuns().length, 0)

const pkg = await ecosystem.createAgentTemplatePackage(blueprint, {
  templateId: 'template.software.safe-smoke',
  version: '1.0.0',
  name: 'Safe Software Team',
  description: 'Portable zero-cost team template.',
}, '2026-08-29T15:00:00.000Z')

assert.equal(pkg.schemaVersion, '0.1')
assert.equal(pkg.packageType, 'agent-template')
assert.equal(pkg.protocol, ecosystem.AGENT_TEMPLATE_PROTOCOL)
assert.equal(pkg.integrity.algorithm, 'SHA-256')
assert.equal(pkg.integrity.digest.length, 43)
assert.equal(pkg.template.policy.maxMonetarySpendUsd, 0)
assert.equal(pkg.template.policy.allowPaidModels, false)
assert.equal(pkg.template.policy.enableSuggestedToolsAutomatically, false)
assert.equal(pkg.template.policy.automaticExecutionAfterInstall, false)
assert.equal(pkg.template.policy.humanApprovalRequiredToInstall, true)

const raw = ecosystem.exportAgentTemplatePackage(pkg)
assert.ok(raw.length < ecosystem.MAX_AGENT_TEMPLATE_JSON_CHARS)
assert.ok(!raw.includes(blueprint.id))
assert.ok(!raw.includes('"status":"installed"'))
assert.ok(!raw.toLowerCase().includes('password'))
assert.ok(!raw.toLowerCase().includes('authorization'))

const beforeImport = localStorage.snapshot()
const imported = await ecosystem.importAgentTemplatePackage(raw)
assert.deepEqual(localStorage.snapshot(), beforeImport)
assert.equal(imported.integrity.digest, pkg.integrity.digest)
assert.equal(storage.loadAgents().length, 0)
assert.equal(storage.loadRuns().length, 0)

const reordered = JSON.stringify({
  integrity: pkg.integrity,
  template: pkg.template,
  exporter: pkg.exporter,
  exportedAt: pkg.exportedAt,
  protocol: pkg.protocol,
  packageType: pkg.packageType,
  schemaVersion: pkg.schemaVersion,
})
const reorderedImported = await ecosystem.importAgentTemplatePackage(reordered)
assert.equal(reorderedImported.integrity.digest, pkg.integrity.digest)

const tampered = JSON.parse(raw)
tampered.template.roles[0].instructions += ' hidden mutation'
await assert.rejects(
  () => ecosystem.importAgentTemplatePackage(JSON.stringify(tampered)),
  /TEMPLATE_INTEGRITY_MISMATCH/,
)

const secretLike = JSON.parse(raw)
secretLike.template.roles[0].instructions = 'api_key = ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
await assert.rejects(
  () => ecosystem.importAgentTemplatePackage(JSON.stringify(secretLike)),
  /TEMPLATE_SECRET_LIKE_CONTENT/,
)

const secretBlueprint = structuredClone(blueprint)
secretBlueprint.roles[0].instructions = '-----BEGIN PRIVATE KEY-----\nnot-a-real-key-for-regression\n-----END PRIVATE KEY-----'
await assert.rejects(
  () => ecosystem.createAgentTemplatePackage(secretBlueprint, {
    templateId: 'template.secret.rejected',
    name: 'Rejected Secret Template',
  }),
  /TEMPLATE_SECRET_LIKE_CONTENT/,
)

const extraField = JSON.parse(raw)
extraField.autoRun = true
await assert.rejects(
  () => ecosystem.importAgentTemplatePackage(JSON.stringify(extraField)),
  /TEMPLATE_PACKAGE_EXTRA_FIELD/,
)

const paid = JSON.parse(raw)
paid.template.policy.allowPaidModels = true
await assert.rejects(
  () => ecosystem.importAgentTemplatePackage(JSON.stringify(paid)),
  /TEMPLATE_ZERO_COST_POLICY_INVALID/,
)

const autoTools = JSON.parse(raw)
autoTools.template.policy.enableSuggestedToolsAutomatically = true
await assert.rejects(
  () => ecosystem.importAgentTemplatePackage(JSON.stringify(autoTools)),
  /TEMPLATE_ZERO_COST_POLICY_INVALID/,
)

const duplicateTool = JSON.parse(raw)
const firstTool = duplicateTool.template.roles[0].suggestedToolIds[0] ?? 'local.memory.search'
duplicateTool.template.roles[0].suggestedToolIds = [firstTool, firstTool]
await assert.rejects(
  () => ecosystem.importAgentTemplatePackage(JSON.stringify(duplicateTool)),
  /TEMPLATE_ROLE_TOOL_DUPLICATE/,
)

await assert.rejects(
  () => ecosystem.importAgentTemplatePackage('x'.repeat(ecosystem.MAX_AGENT_TEMPLATE_JSON_CHARS + 1)),
  /TEMPLATE_IMPORT_SIZE_LIMIT/,
)

const importedBlueprint = ecosystem.templatePackageToBlueprint(imported, '2026-08-29T15:01:00.000Z')
assert.equal(importedBlueprint.status, 'validated')
assert.notEqual(importedBlueprint.id, blueprint.id)
assert.ok(importedBlueprint.id.startsWith('blueprint-import-'))
assert.equal(importedBlueprint.policy.maxMonetarySpendUsd, 0)
assert.equal(importedBlueprint.policy.enableSuggestedToolsAutomatically, false)
assert.equal(factory.validateFactoryBlueprint(importedBlueprint).valid, true)
assert.ok(importedBlueprint.checks.includes('template integrity: SHA-256 verified'))
assert.ok(importedBlueprint.checks.includes('template secret-like scan: passed locally'))
assert.ok(importedBlueprint.checks.includes('template import: no automatic install or execution'))
assert.equal(storage.loadAgents().length, 0)
assert.equal(storage.loadRuns().length, 0)

assert.throws(
  () => factory.installFactoryBlueprint(importedBlueprint, false),
  /FACTORY_HUMAN_APPROVAL_REQUIRED/,
)
assert.equal(storage.loadAgents().length, 0)

const installed = factory.installFactoryBlueprint(importedBlueprint, true)
assert.equal(installed.agents.length, imported.template.roles.length)
const approvalNodes = installed.workflow.nodes.filter((node) => node.kind === 'approval')
assert.equal(approvalNodes.length, installed.agents.length - 1)
assert.equal(workflowEngine.loadWorkflowRuns(installed.workflow.id).length, 0)
assert.ok(installed.agents.every((agent) => agent.modelPolicy.allowPaid === false))
assert.ok(installed.agents.every((agent) => agent.budgetPolicy.maxMonetarySpendUsd === 0))
assert.ok(installed.agents.every((agent) => agent.toolPolicy.defaultAction === 'deny'))
assert.ok(installed.agents.every((agent) => agent.toolPolicy.allowedTools.length === 0))
assert.equal(storage.loadRuns().length, 0)

console.log('Phase 10A safe template package smoke: PASS')
console.log('Canonical SHA-256 integrity: PASS')
console.log('JSON key reordering preserves verified content identity: PASS')
console.log('Tampering + hidden fields: rejected')
console.log('Secret-like content on export/import: rejected locally')
console.log('Paid policy + automatic tool enablement injection: rejected')
console.log('Import preview has no storage/install/run side effects: PASS')
console.log('Install without Human Approval: rejected')
console.log('Human-approved install: approval nodes preserved; agents remain zero-cost + tools denied + no auto-run')
console.log('Mandatory additional spend: 0 USD')