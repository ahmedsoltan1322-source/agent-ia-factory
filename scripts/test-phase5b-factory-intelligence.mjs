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

const planner = await import(new URL('../src/core/factoryPlanner.ts', import.meta.url).href)
const intelligence = await import(new URL('../src/core/factoryIntelligence.ts', import.meta.url).href)
const storage = await import(new URL('../src/core/storage.ts', import.meta.url).href)

const blueprint = planner.planAgentFactory(
  'أنشئ تطبيقاً محلياً مع تنفيذ واختبارات ومراجعة أمنية، ولا تستخدم خدمة مدفوعة.',
  'local-demo',
)
assert.equal(planner.validateFactoryBlueprint(blueprint).valid, true)
assert.equal(storage.loadAgents().length, 0)
assert.equal(storage.loadRuns().length, 0)

const afterPlanningSnapshot = localStorage.snapshot()
const toolPlan = intelligence.buildFactoryToolPlan(blueprint)
assert.equal(toolPlan.monetaryCostUsd, 0)
assert.equal(toolPlan.automaticCodeGeneration, false)
assert.equal(toolPlan.automaticActivation, false)
assert.ok(toolPlan.requirements.length >= blueprint.roles.length)
assert.ok(toolPlan.requirements.every((item) => item.monetaryCostUsd === 0 && item.automaticActivation === false))
assert.ok(toolPlan.requirements.some((item) => item.disposition === 'existing'))
assert.deepEqual(localStorage.snapshot(), afterPlanningSnapshot)

const unknownToolBlueprint = {
  ...blueprint,
  roles: blueprint.roles.map((role, index) => index === 0
    ? { ...role, suggestedToolIds: [...role.suggestedToolIds, 'community.publish.external'] }
    : role),
}
const unknownPlan = intelligence.buildFactoryToolPlan(unknownToolBlueprint)
const unknownRequirement = unknownPlan.requirements.find((item) => item.requestedToolId === 'community.publish.external')
assert.equal(unknownRequirement.disposition, 'adapter_required')
assert.equal(unknownRequirement.riskCeiling, 'external_write')
assert.equal(unknownRequirement.candidateAdapterIds.length, 0)
assert.equal(unknownRequirement.humanApprovalRequiredBeforeActivation, true)
assert.deepEqual(localStorage.snapshot(), afterPlanningSnapshot)

const testPlan = intelligence.buildFactoryTestPlan(blueprint)
assert.equal(testPlan.monetaryCostUsd, 0)
assert.equal(testPlan.automaticExecution, false)
assert.ok(testPlan.cases.some((item) => item.dimension === 'security'))
assert.ok(testPlan.cases.some((item) => item.dimension === 'quality'))
assert.ok(testPlan.cases.some((item) => item.dimension === 'reliability'))
assert.ok(testPlan.cases.some((item) => item.target === 'role'))
assert.deepEqual(localStorage.snapshot(), afterPlanningSnapshot)

const broken = {
  ...blueprint,
  status: 'validated',
  roles: [
    {
      ...blueprint.roles[0],
      id: 'worker',
      name: 'عامل أول',
      purpose: 'تنفيذ المهمة فقط.',
      suggestedToolIds: ['local.memory.search', 'local.memory.search'],
    },
    {
      ...blueprint.roles[1],
      id: 'worker',
      name: 'عامل ثان',
      purpose: 'تنفيذ جزء آخر فقط.',
      suggestedToolIds: ['local.text.stats'],
    },
  ],
  acceptanceTests: [],
  workflow: { approvalBetweenAgents: false, maxAgents: 99 },
  policy: {
    maxMonetarySpendUsd: 9,
    allowPaidModels: true,
    enableSuggestedToolsAutomatically: true,
    automaticExecutionAfterInstall: true,
    humanApprovalRequiredToInstall: false,
  },
}
assert.equal(planner.validateFactoryBlueprint(broken).valid, false)

const beforeRepairSnapshot = localStorage.snapshot()
const repair = intelligence.buildFactoryRepairPreview(broken)
assert.equal(repair.monetaryCostUsd, 0)
assert.equal(repair.automaticInstall, false)
assert.equal(repair.automaticRun, false)
assert.equal(repair.safeToApply, true)
assert.equal(repair.after.valid, true)
assert.ok(repair.changes.some((item) => item.code === 'REVIEWER_ADDED'))
assert.ok(repair.changes.some((item) => item.code === 'ZERO_COST_POLICY_REPAIRED'))
assert.ok(repair.changes.some((item) => item.code === 'WORKFLOW_POLICY_REPAIRED'))
assert.ok(repair.changes.some((item) => item.code === 'ROLE_ID_DEDUPED'))
assert.deepEqual(localStorage.snapshot(), beforeRepairSnapshot)

assert.throws(
  () => intelligence.applyFactoryRepair(broken, repair, false),
  /FACTORY_REPAIR_HUMAN_APPROVAL_REQUIRED/,
)
assert.deepEqual(localStorage.snapshot(), beforeRepairSnapshot)

const tampered = { ...repair, changes: [...repair.changes, { code: 'TAMPER', description: 'Injected change.' }] }
assert.throws(
  () => intelligence.applyFactoryRepair(broken, tampered, true),
  /FACTORY_REPAIR_PREVIEW_TAMPERED_OR_STALE/,
)
assert.deepEqual(localStorage.snapshot(), beforeRepairSnapshot)

const repaired = intelligence.applyFactoryRepair(broken, repair, true)
assert.equal(planner.validateFactoryBlueprint(repaired).valid, true)
assert.equal(repaired.policy.maxMonetarySpendUsd, 0)
assert.equal(repaired.policy.allowPaidModels, false)
assert.equal(repaired.policy.enableSuggestedToolsAutomatically, false)
assert.equal(repaired.policy.automaticExecutionAfterInstall, false)
assert.equal(repaired.policy.humanApprovalRequiredToInstall, true)
assert.equal(repaired.workflow.approvalBetweenAgents, true)
assert.equal(repaired.workflow.maxAgents, 6)
assert.ok(repaired.roles.some((role) => /مراجعة|جودة/u.test(`${role.name} ${role.purpose}`)))
assert.equal(storage.loadAgents().length, 0)
assert.equal(storage.loadRuns().length, 0)
assert.ok(!localStorage.snapshot().some(([key]) => key.includes('workflow') || key.includes('tool-calls') || key.includes('adapter-activations')))

const installedLike = { ...blueprint, status: 'installed' }
assert.throws(() => intelligence.buildFactoryRepairPreview(installedLike), /FACTORY_REPAIR_INSTALLED_BLUEPRINT_FORBIDDEN/)

console.log('Phase 5B Factory Intelligence smoke: PASS')
console.log('Tool Builder: data-only requirements, no activation/code generation: PASS')
console.log('Unknown Tool: reviewed adapter required + external-write risk inferred: PASS')
console.log('Test Builder: quality + security + reliability plan, no execution: PASS')
console.log('Auto-Repair Preview: side-effect free: PASS')
console.log('Repair apply: explicit Human Approval + stale/tamper binding: PASS')
console.log('Repair result: zero-cost/no-auto-tools/no-auto-run/reviewer/workflow policy restored: PASS')
console.log('Agents/Runs/Workflows/Tool Calls side effects during planning/repair: absent')
console.log('Mandatory additional spend: 0 USD')
