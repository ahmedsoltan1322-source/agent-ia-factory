import fs from 'node:fs'

const required = [
  'src/core/factoryIntelligence.ts',
  'src/components/FactoryIntelligenceCenter.tsx',
  'src/factory-intelligence.css',
  'scripts/test-phase5b-factory-intelligence.mjs',
  'docs/PHASE5B_FACTORY_INTELLIGENCE.md',
  '.github/workflows/phase5b-ci.yml',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 5B file: ${file}`)
}

const core = fs.readFileSync('src/core/factoryIntelligence.ts', 'utf8')
const ui = fs.readFileSync('src/components/FactoryIntelligenceCenter.tsx', 'utf8')
const factoryCenter = fs.readFileSync('src/components/FactoryCenter.tsx', 'utf8')
const main = fs.readFileSync('src/main.tsx', 'utf8')
const smoke = fs.readFileSync('scripts/test-phase5b-factory-intelligence.mjs', 'utf8')
const docs = fs.readFileSync('docs/PHASE5B_FACTORY_INTELLIGENCE.md', 'utf8')
const workflow = fs.readFileSync('.github/workflows/phase5b-ci.yml', 'utf8')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

function versionAtLeast(version, minimum) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value)
    if (!match) throw new Error(`Invalid semantic version: ${value}`)
    return match.slice(1).map(Number)
  }
  const current = parse(version)
  const floor = parse(minimum)
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > floor[index]) return true
    if (current[index] < floor[index]) return false
  }
  return true
}

for (const marker of [
  "FACTORY_INTELLIGENCE_SCHEMA_VERSION = '0.1'",
  'buildFactoryToolPlan',
  'buildFactoryTestPlan',
  'buildFactoryRepairPreview',
  'applyFactoryRepair',
  "disposition: 'existing' | 'adapter_required' | 'no_tool_required'",
  'automaticCodeGeneration: false',
  'automaticActivation: false',
  'humanApprovalRequiredBeforeActivation: true',
  'automaticExecution: false',
  'automaticInstall: false',
  'automaticRun: false',
  'FACTORY_REPAIR_HUMAN_APPROVAL_REQUIRED',
  'FACTORY_REPAIR_INSTALLED_BLUEPRINT_FORBIDDEN',
  'FACTORY_REPAIR_PREVIEW_TAMPERED_OR_STALE',
  'FACTORY_REPAIR_MANUAL_REVIEW_REQUIRED',
  "maxMonetarySpendUsd: 0",
  'allowPaidModels: false',
  'enableSuggestedToolsAutomatically: false',
  'automaticExecutionAfterInstall: false',
  'humanApprovalRequiredToInstall: true',
]) {
  if (!core.includes(marker)) throw new Error(`Phase 5B core invariant missing: ${marker}`)
}

for (const forbidden of [
  'fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.sendBeacon',
  'executeBuiltinTool(', 'executeToolDefinition(', 'callMcpTool(',
  'installFactoryBlueprint(', 'saveAgent(', 'saveWorkflow(',
  'eval(', 'new Function(', 'child_process', 'npm install', 'pip install',
]) {
  if (core.includes(forbidden)) throw new Error(`Factory Intelligence core must remain local/non-executing: ${forbidden}`)
}

for (const marker of [
  'Phase 5B',
  'Factory Intelligence (ذكاء المصنع)',
  'Build Tool Plan (خطة الأدوات)',
  'Build Test Plan (خطة الاختبارات)',
  'Preview Auto-Repair (معاينة الإصلاح)',
  'Apply Approved Repair (طبق الإصلاح)',
  'لا Install ولا Run ولا Tool activation',
]) {
  if (!ui.includes(marker)) throw new Error(`Phase 5B UI invariant missing: ${marker}`)
}
if (!factoryCenter.includes("import FactoryIntelligenceCenter from './FactoryIntelligenceCenter'")) throw new Error('Factory Intelligence import missing from FactoryCenter')
if (!factoryCenter.includes('<FactoryIntelligenceCenter')) throw new Error('Factory Intelligence is not integrated into FactoryCenter')
if (!main.includes("import './factory-intelligence.css'")) throw new Error('Factory Intelligence styles are not loaded')

for (const marker of [
  'buildFactoryToolPlan(blueprint)',
  "assert.equal(toolPlan.automaticCodeGeneration, false)",
  "assert.equal(unknownRequirement.disposition, 'adapter_required')",
  "assert.equal(unknownRequirement.riskCeiling, 'external_write')",
  'buildFactoryTestPlan(blueprint)',
  "item.dimension === 'security'",
  "item.dimension === 'quality'",
  "item.dimension === 'reliability'",
  'buildFactoryRepairPreview(broken)',
  "assert.equal(repair.safeToApply, true)",
  'FACTORY_REPAIR_HUMAN_APPROVAL_REQUIRED',
  'FACTORY_REPAIR_PREVIEW_TAMPERED_OR_STALE',
  'applyFactoryRepair(broken, repair, true)',
  'assert.equal(storage.loadAgents().length, 0)',
  'assert.equal(storage.loadRuns().length, 0)',
]) {
  if (!smoke.includes(marker)) throw new Error(`Phase 5B smoke invariant missing: ${marker}`)
}

for (const marker of [
  'Tool Builder', 'Test Builder', 'Auto-Repair',
  'automaticActivation = false', 'Human Approval',
  'Repair Preview is side-effect free',
  'Installed Blueprints are immutable to Auto-Repair',
  'Mandatory additional spend = 0 USD',
]) {
  if (!docs.includes(marker)) throw new Error(`Phase 5B documentation marker missing: ${marker}`)
}

for (const marker of [
  'Phase 5B Factory Intelligence CI',
  "node-version: '24'",
  'npm install --ignore-scripts --no-fund --no-audit',
  'npm run check',
  'npm run test:phase5b',
  'npm run test:phase8',
  'npm run test:phase10d',
  'npm audit --omit=dev --audit-level=high',
  'npm audit --audit-level=high',
]) {
  if (!workflow.includes(marker)) throw new Error(`Phase 5B CI invariant missing: ${marker}`)
}

if (!versionAtLeast(pkg.version, '1.10.0')) throw new Error('Phase 5B requires package version 1.10.0 or newer')
if (!pkg.scripts?.['validate:phase5b']?.includes('validate-phase5b.mjs')) throw new Error('validate:phase5b script missing')
if (!pkg.scripts?.['test:phase5b']?.includes('test-phase5b-factory-intelligence.mjs')) throw new Error('test:phase5b script missing')
if (!pkg.scripts?.check?.includes('validate:phase5b')) throw new Error('Phase 5B validator missing from full check')

const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 5B: ${dependency}`)
}

console.log('Phase 5B Factory Intelligence validation: PASS')
console.log('Tool Builder: proposal/data only, no execution or activation')
console.log('Test Builder: local plan only, no automatic execution')
console.log('Auto-Repair: preview first, human-approved apply only')
console.log('Installed Blueprint repair: forbidden')
console.log('Agent/Workflow/Tool execution side effects: forbidden')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')
