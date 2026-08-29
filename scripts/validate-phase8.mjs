import fs from 'node:fs'

const required = [
  'src/core/evaluationEngine.ts',
  'src/core/evaluationStorage.ts',
  'src/components/EvaluationCenter.tsx',
  'src/evaluation.css',
  'scripts/test-phase8-evals.mjs',
  'docs/PHASE8_EVALS_OBSERVABILITY.md',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 8 file: ${file}`)
}

const engine = fs.readFileSync('src/core/evaluationEngine.ts', 'utf8')
const storage = fs.readFileSync('src/core/evaluationStorage.ts', 'utf8')
const ui = fs.readFileSync('src/components/EvaluationCenter.tsx', 'utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx', 'utf8')
const main = fs.readFileSync('src/main.tsx', 'utf8')
const smoke = fs.readFileSync('scripts/test-phase8-evals.mjs', 'utf8')
const docs = fs.readFileSync('docs/PHASE8_EVALS_OBSERVABILITY.md', 'utf8')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

const engineRequired = [
  "EvaluationDimension = 'quality' | 'security' | 'reliability'",
  "ProductionGateDecision = 'pass' | 'fail'",
  'agent.evaluationPolicy.minimumPassRate',
  'agent.evaluationPolicy.securityTestsRequired',
  "gate(securityPassRate === 1",
  "gate(qualityPassRate !== null",
  "gate(securityPassRate !== null",
  "gate(reliabilityPassRate !== null",
  "gate(suite.cases.length >= 3",
  "gate(monetaryCostUsd === 0",
  "gate(caseResults.every((result) => result.passed)",
  "[agent.modelPolicy.allowPaid === false",
  "[agent.approvalPolicy.financial === 'deny'",
  "[agent.evaluationPolicy.requiredBeforeProduction === true",
  'buildRunTrace',
  'outputChars: run.output.length',
  'policyCheckCount: run.policyChecks.length',
  'buildBenchmarkArena',
  'const comparable = limitations.length === 0',
  '* 0.5 +',
  '* 0.3 +',
  '* 0.2',
]
for (const marker of engineRequired) {
  if (!engine.includes(marker)) throw new Error(`Phase 8 engine invariant missing: ${marker}`)
}

for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'Authorization', 'Bearer ', 'localStorage.', 'sessionStorage.', 'callMcpTool(', 'executeBuiltinTool(', 'installFactoryBlueprint(']) {
  if (engine.includes(forbidden)) throw new Error(`Evaluation engine must remain pure/local and side-effect free: ${forbidden}`)
}

// Trace objects must not copy prompt/task/output/error text; counts/booleans only.
const traceStart = engine.indexOf('export function buildRunTrace')
const traceEnd = engine.indexOf('export function buildBenchmarkArena')
if (traceStart < 0 || traceEnd <= traceStart) throw new Error('Run trace function boundaries missing')
const traceBody = engine.slice(traceStart, traceEnd)
for (const forbidden of ['task:', 'output:', 'error:', 'run.task', 'run.error?.', 'run.output,']) {
  if (traceBody.includes(forbidden)) throw new Error(`Observability trace may leak run content: ${forbidden}`)
}

const storageRequired = [
  "const MAX_SUITES = 20",
  "const MAX_REPORTS = 50",
  "const MAX_JSON_CHARS = 1_500_000",
  'localStorage.setItem',
  'localStorage.removeItem',
  'exportEvaluationEvidence',
]
for (const marker of storageRequired) {
  if (!storage.includes(marker)) throw new Error(`Evaluation storage invariant missing: ${marker}`)
}
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.sendBeacon', 'Authorization', 'Bearer ']) {
  if (storage.includes(forbidden)) throw new Error(`Evaluation evidence must not auto-sync externally: ${forbidden}`)
}

if (!ui.includes('Evidence, not vibes')) throw new Error('Evidence-first UI disclosure missing')
if (!ui.includes('Quality + Security + Reliability')) throw new Error('Three-dimension production-gate disclosure missing')
if (!ui.includes('لا Task، لا Output، ولا Chain-of-Thought')) throw new Error('Trace privacy disclosure missing')
if (!ui.includes('Benchmark Arena')) throw new Error('Benchmark Arena UI missing')
if (!ui.includes('غير قابل للمقارنة بعد')) throw new Error('Incomplete-evidence no-ranking UI missing')
if (!toolCenter.includes('<EvaluationCenter agents={agents} runs={runs}')) throw new Error('EvaluationCenter is not integrated with local evidence')
if (!toolCenter.includes('loadRuns')) throw new Error('ToolCenter must load local Run evidence for Phase 8')
if (!main.includes("import './evaluation.css'")) throw new Error('Evaluation mobile styles are not loaded')

const smokeRequired = [
  "new URL('../src/core/evaluationEngine.ts', import.meta.url)",
  "assert.equal(incomplete.productionGate, 'fail')",
  "quality evidence missing",
  "assert.equal(report.productionGate, 'pass')",
  'monetaryCostUsd: 1',
  "modelPolicy: { ...agent.modelPolicy, allowPaid: true }",
  "!serializedTrace.includes('ULTRA_PRIVATE_TASK')",
  "!serializedTrace.includes('ULTRA_PRIVATE_OUTPUT')",
  'assert.equal(arena[0].score, 100)',
]
for (const marker of smokeRequired) {
  if (!smoke.includes(marker)) throw new Error(`Phase 8 executable smoke invariant missing: ${marker}`)
}
if (smoke.includes("from 'typescript'") || smoke.includes('transpileModule')) {
  throw new Error('Phase 8 smoke must execute the TypeScript source directly on pinned Node 24, not depend on unstable TypeScript runtime API exports')
}

for (const marker of ['Evidence, not vibes', 'Security Pass Rate = 100%', 'Task text', 'Output text', 'Chain-of-Thought', '0 USD']) {
  if (!docs.includes(marker)) throw new Error(`Phase 8 documentation marker missing: ${marker}`)
}

const versionParts = String(pkg.version ?? '').split('.').map(Number)
if (versionParts.length !== 3 || versionParts.some((part) => !Number.isInteger(part) || part < 0)) {
  throw new Error('Package version must be valid numeric semver')
}
const [major, minor] = versionParts
if (major < 1 || (major === 1 && minor < 1)) throw new Error('Phase 8 requires package version 1.1.0 or newer')
if (!pkg.scripts?.['validate:phase8']?.includes('validate-phase8.mjs')) throw new Error('validate:phase8 script missing')
if (!pkg.scripts?.['test:phase8']?.includes('test-phase8-evals.mjs')) throw new Error('test:phase8 script missing')
if (!pkg.scripts?.check?.includes('validate:phase8')) throw new Error('Phase 8 validator missing from full check')
const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 8: ${dependency}`)
}

console.log('Phase 8 Evals & Observability validation: PASS')
console.log('Production gate: fail-closed on missing evidence')
console.log('Dimensions required: quality + security + reliability')
console.log('Security-required pass rate: 100%')
console.log('Non-zero evaluated cost: production blocked')
console.log('Observability trace: metadata only, no task/output/chain-of-thought')
console.log('Benchmark Arena: no ranking without complete evidence')
console.log('Smoke runtime: Node 24 direct erasable TypeScript execution')
console.log('External telemetry: none')
console.log('Mandatory additional spend: 0 USD')
