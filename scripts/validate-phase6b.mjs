import fs from 'node:fs'

const required = [
  'src/core/ossBenchmark.ts',
  'src/components/OssBenchmarkCenter.tsx',
  'scripts/test-phase6b-oss-benchmark.mjs',
  'docs/PHASE6B_OSS_SANDBOX_BENCHMARK.md',
  '.github/workflows/phase6b-ci.yml',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 6B file: ${file}`)
}

const core = fs.readFileSync('src/core/ossBenchmark.ts', 'utf8')
const ui = fs.readFileSync('src/components/OssBenchmarkCenter.tsx', 'utf8')
const harvesterUi = fs.readFileSync('src/components/OssHarvesterCenter.tsx', 'utf8')
const scan = fs.readFileSync('.github/workflows/oss-candidate-scan.yml', 'utf8')
const smoke = fs.readFileSync('scripts/test-phase6b-oss-benchmark.mjs', 'utf8')
const docs = fs.readFileSync('docs/PHASE6B_OSS_SANDBOX_BENCHMARK.md', 'utf8')
const workflow = fs.readFileSync('.github/workflows/phase6b-ci.yml', 'utf8')
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
  "OSS_BENCHMARK_SCHEMA_VERSION = '0.1'",
  "OSS_STATIC_SCAN_SCHEMA_VERSION = '2'",
  'MAX_OSS_BENCHMARKS = 40',
  "mode: 'static-sandbox-readiness'",
  'executionSandboxPerformed: false',
  'candidateCodeExecuted: false',
  'integrationAllowed: false',
  'monetaryCostUsd: 0',
  'parseOssStaticScanReport',
  'parseOssNpmAuditSummary',
  'benchmarkOssCandidate',
  'saveOssBenchmark',
  'deleteOssBenchmark',
  "hardBlocks.push(`Heuristic secret signals observed:",
  'Critical npm vulnerabilities',
  'High npm vulnerabilities',
  "decision = 'REJECT'",
  "decision = 'STUDY'",
  "decision = 'WATCH'",
  "decision = 'ADAPT'",
  'USE is intentionally unreachable in this static-only phase',
  'OSS_BENCHMARK_SAVE_APPROVAL_REQUIRED',
  'OSS_BENCHMARK_DELETE_APPROVAL_REQUIRED',
]) {
  if (!core.includes(marker)) throw new Error(`Phase 6B core invariant missing: ${marker}`)
}

for (const forbidden of [
  'fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.sendBeacon', 'Authorization', 'Bearer ',
  'executeBuiltinTool(', 'executeToolDefinition(', 'callMcpTool(', 'installFactoryBlueprint(',
  'saveAgent(', 'saveWorkflow(', 'runWorkflowUntilPause(', 'eval(', 'new Function(',
  'child_process', 'npm install', 'pip install', 'cargo build', 'go run',
]) {
  if (core.includes(forbidden)) throw new Error(`OSS benchmark core must remain evidence-only/non-executing: ${forbidden}`)
}

for (const marker of [
  'Phase 6B',
  'Static Sandbox Readiness Benchmark (اختبار جاهزية العزل الساكن)',
  'No Candidate Code Execution · $0',
  'executionSandboxPerformed=false',
  'integrationAllowed=false',
  'Import oss-static-report.json',
  'Import npm-audit-summary.json',
  'Run Static Benchmark (شغّل التقييم الساكن)',
  'Save Benchmark Evidence',
]) {
  if (!ui.includes(marker)) throw new Error(`Phase 6B UI invariant missing: ${marker}`)
}
if (!harvesterUi.includes("import OssBenchmarkCenter from './OssBenchmarkCenter'")) throw new Error('OssBenchmarkCenter import missing')
if (!harvesterUi.includes('<OssBenchmarkCenter candidates={watchlist}')) throw new Error('OSS benchmark is not integrated into Watchlist review flow')

for (const marker of [
  "'schemaVersion': '2'",
  'sourceFilesObserved',
  'testFilesObserved',
  'ciConfigsObserved',
  'readmeObserved',
  'No npm install, npm scripts, build, test, pip install, cargo build, go run, or project executable was invoked.',
  'Phase 6B static sandbox-readiness evidence does not claim an execution sandbox.',
  "'integrationAllowed': False",
]) {
  if (!scan.includes(marker)) throw new Error(`Phase 6B deep-scan evidence invariant missing: ${marker}`)
}
if (scan.includes('uses: actions/checkout@')) throw new Error('Candidate scan must not use actions/checkout with repository token')

for (const marker of [
  "assert.equal(clean.decision, 'ADAPT')",
  'assert.equal(clean.executionSandboxPerformed, false)',
  'assert.equal(clean.candidateCodeExecuted, false)',
  'assert.equal(clean.integrationAllowed, false)',
  "assert.equal(secretResult.decision, 'REJECT')",
  "assert.equal(vulnerableResult.decision, 'REJECT')",
  "assert.equal(unavailableResult.decision, 'WATCH')",
  "assert.equal(reviewLicenseResult.decision, 'STUDY')",
  "assert.equal(unknownLicenseResult.decision, 'REJECT')",
  'OSS_BENCHMARK_REPORT_EXTRA_FIELD',
  'OSS_BENCHMARK_SCAN_POLICY_INVALID',
  'OSS_BENCHMARK_SAVE_APPROVAL_REQUIRED',
  'OSS_BENCHMARK_DELETE_APPROVAL_REQUIRED',
  'assert.equal(storage.loadAgents().length, 0)',
  'assert.equal(storage.loadRuns().length, 0)',
]) {
  if (!smoke.includes(marker)) throw new Error(`Phase 6B smoke invariant missing: ${marker}`)
}

for (const marker of [
  'Static Sandbox Readiness Benchmark',
  'Execution Sandbox',
  '`executionSandboxPerformed = false`',
  '`candidateCodeExecuted = false`',
  '`integrationAllowed = false`',
  'USE مقفلة عمداً',
  'Secret signal → REJECT',
  'High/Critical npm vulnerability → REJECT',
  'Mandatory additional spend = **0 USD**',
]) {
  if (!docs.includes(marker)) throw new Error(`Phase 6B documentation marker missing: ${marker}`)
}

for (const marker of [
  'Phase 6B OSS Sandbox Benchmark CI',
  "node-version: '24'",
  'npm install --ignore-scripts --no-fund --no-audit',
  'npm run check',
  'npm run test:phase6b',
  'npm run test:phase5b',
  'npm run test:phase8',
  'npm run test:phase10d',
  'npm audit --omit=dev --audit-level=high',
  'npm audit --audit-level=high',
]) {
  if (!workflow.includes(marker)) throw new Error(`Phase 6B CI invariant missing: ${marker}`)
}

if (!versionAtLeast(pkg.version, '1.11.0')) throw new Error('Phase 6B requires package version 1.11.0 or newer')
if (!pkg.scripts?.['validate:phase6b']?.includes('validate-phase6b.mjs')) throw new Error('validate:phase6b script missing')
if (!pkg.scripts?.['test:phase6b']?.includes('test-phase6b-oss-benchmark.mjs')) throw new Error('test:phase6b script missing')
if (!pkg.scripts?.check?.includes('validate:phase6b')) throw new Error('Phase 6B validator missing from full check')

const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 6B: ${dependency}`)
}

console.log('Phase 6B OSS Static Sandbox Readiness Benchmark validation: PASS')
console.log('Candidate code execution: forbidden')
console.log('Execution sandbox performed: false')
console.log('USE: intentionally blocked in static-only mode')
console.log('Secret/high/critical signals: fail-closed')
console.log('Benchmark save/delete: Human Approval required')
console.log('Integration allowed: false')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')
