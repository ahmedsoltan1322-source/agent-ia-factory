import fs from 'node:fs'

const required = [
  'src/core/workerProtocol.ts',
  'src/core/referenceWorker.ts',
  'src/components/SelfHostWorkerCenter.tsx',
  'src/worker.css',
  'scripts/run-reference-worker.mjs',
  'scripts/test-phase9b-worker.mjs',
  'docs/PHASE9B_SELF_HOST_WORKER.md',
  '.github/workflows/phase9b-worker-ci.yml',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 9B file: ${file}`)
}

const protocol = fs.readFileSync('src/core/workerProtocol.ts', 'utf8')
const referenceWorker = fs.readFileSync('src/core/referenceWorker.ts', 'utf8')
const runtime = fs.readFileSync('src/core/runtime.ts', 'utf8')
const deploymentEngine = fs.readFileSync('src/core/deploymentEngine.ts', 'utf8')
const deploymentStorage = fs.readFileSync('src/core/deploymentStorage.ts', 'utf8')
const ui = fs.readFileSync('src/components/SelfHostWorkerCenter.tsx', 'utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx', 'utf8')
const main = fs.readFileSync('src/main.tsx', 'utf8')
const cli = fs.readFileSync('scripts/run-reference-worker.mjs', 'utf8')
const smoke = fs.readFileSync('scripts/test-phase9b-worker.mjs', 'utf8')
const docs = fs.readFileSync('docs/PHASE9B_SELF_HOST_WORKER.md', 'utf8')
const workflow = fs.readFileSync('.github/workflows/phase9b-worker-ci.yml', 'utf8')
const phase9aValidator = fs.readFileSync('scripts/validate-phase9a.mjs', 'utf8')
const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'))
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

const protocolRequired = [
  "import { validateDurableJob, validateTenantId, type DurableJob } from './deploymentEngine.ts'",
  "export const WORKER_PROTOCOL = 'agent-ia-factory.worker/0.1'",
  "export const REFERENCE_WORKER_ID = 'portable-node-worker'",
  'export const MAX_WORKER_BUNDLE_CHARS = 300_000',
  'export const MAX_WORKER_RECEIPT_CHARS = 400_000',
  "transport: 'offline-file'",
  "supportedRuntimeAdapters: ['local-demo']",
  'maxConcurrentJobs: 1',
  'allowPaid: false',
  'maxMonetarySpendUsd: 0',
  'automaticNetwork: false',
  'automaticToolExecution: false',
  'requiresHumanTransfer: true',
  'function exactKeys',
  "'WORKER_BUNDLE_EXTRA_FIELD'",
  "'WORKER_RECEIPT_EXTRA_FIELD'",
  "'WORKER_BUNDLE_EXPIRED'",
  "'WORKER_TOOLS_MUST_BE_DISABLED'",
  "agent.runtime.adapter !== 'local-demo'",
  'JSON.stringify(safe).length > MAX_WORKER_BUNDLE_CHARS',
  'JSON.stringify(safe).length > MAX_WORKER_RECEIPT_CHARS',
]
for (const marker of protocolRequired) {
  if (!protocol.includes(marker)) throw new Error(`Phase 9B worker protocol invariant missing: ${marker}`)
}
for (const forbidden of [
  'fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.', 'localStorage', 'sessionStorage',
  'Authorization', 'Bearer ', 'callMcpTool(', 'executeBuiltinTool(', 'installFactoryBlueprint(',
  'LocalDemoRuntimeAdapter', 'new Function(', 'eval(',
]) {
  if (protocol.includes(forbidden)) throw new Error(`Worker protocol must remain pure/provider-neutral: ${forbidden}`)
}

const referenceRequired = [
  "import { LocalDemoRuntimeAdapter } from './runtime.ts'",
  "} from './workerProtocol.ts'",
  'validateWorkerBundle(rawBundle, now)',
  "bundle.worker.supportedRuntimeAdapters[0] !== 'local-demo'",
  'run.monetaryCostUsd !== 0 || run.toolCalls !== 0',
  "'REFERENCE_WORKER_ZERO_COST_BREACH'",
  "'REFERENCE_WORKER_LEASE_EXPIRED_DURING_RUN'",
  'buildWorkerReceipt(bundle, run)',
]
for (const marker of referenceRequired) {
  if (!referenceWorker.includes(marker)) throw new Error(`Reference Worker invariant missing: ${marker}`)
}
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.', 'localStorage', 'Authorization', 'Bearer ', 'callMcpTool(', 'executeBuiltinTool(']) {
  if (referenceWorker.includes(forbidden)) throw new Error(`Reference Worker must remain offline/tool-free: ${forbidden}`)
}
if (!runtime.includes("import { evaluateZeroCostGate } from './zeroCostGate.ts'")) {
  throw new Error('Node-executed local-demo runtime must use an explicit .ts runtime import')
}
if (tsconfig.compilerOptions?.allowImportingTsExtensions !== true || tsconfig.compilerOptions?.noEmit !== true) {
  throw new Error('Explicit TypeScript runtime imports require allowImportingTsExtensions=true with noEmit=true')
}

const leaseRequired = [
  'renewedAt?: string',
  'export function renewDurableJobLease',
  "throw new Error('DURABLE_JOB_LEASE_EXPIRED')",
  'expiresAt: new Date(nowMs + safeLeaseMs).toISOString()',
  'renewedAt: iso(now)',
]
for (const marker of leaseRequired) {
  if (!deploymentEngine.includes(marker)) throw new Error(`Phase 9B lease invariant missing: ${marker}`)
}
if ((deploymentEngine.match(/DURABLE_JOB_LEASE_EXPIRED/g) ?? []).length < 2) {
  throw new Error('Lease expiry must be enforced on both renewal and completion paths')
}

const bridgeRequired = [
  'leaseMs = 60_000',
  'claimNextDurableJob(loadDurableJobs(), LOCAL_TENANT_ID, workerId, now, leaseMs)',
  'export function renewLocalDurableJobLease',
  'export function applyLocalWorkerReceipt',
  'validateWorkerReceipt(rawReceipt)',
  "current.lease.workerId !== receipt.workerId",
  "current.lease.token !== receipt.leaseToken",
  "current.payload.agentId !== receipt.run.agentId || current.payload.task !== receipt.run.task",
  "Date.parse(receipt.createdAt) > Date.parse(current.lease.expiresAt)",
  'completeDurableJob(jobs, receipt.jobId, receipt.leaseToken, result, now)',
]
for (const marker of bridgeRequired) {
  if (!deploymentStorage.includes(marker)) throw new Error(`Phone worker bridge invariant missing: ${marker}`)
}
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.sendBeacon', 'Authorization', 'Bearer ']) {
  if (deploymentStorage.includes(forbidden)) throw new Error(`Phone worker bridge must not gain automatic network: ${forbidden}`)
}

for (const marker of [
  'Phase 9B — Self-Host Worker Foundation',
  'Portable Worker Protocol (بروتوكول عامل قابل للنقل)',
  'لا Server (خادم) إلزامي، لا Cloud (سحابة)، لا Telemetry (قياس عن بعد)، ولا Credentials (بيانات دخول)',
  "candidate.kind !== 'agent_run'",
  "agent.runtime.adapter === 'local-demo'",
  "agent.toolPolicy.defaultAction === 'deny'",
  'claimLocalDurableJob(REFERENCE_WORKER_ID, now, 5 * 60_000)',
  'buildPortableWorkerBundle',
  'Import Worker Receipt (استورد إيصال العامل)',
  'Offline File ليس Authentication (مصادقة) شبكية',
]) {
  if (!ui.includes(marker)) throw new Error(`Phase 9B UI invariant missing: ${marker}`)
}
if (ui.includes("from '../core/referenceWorker'")) throw new Error('Browser UI must not bundle the Node reference worker runtime')
if (!toolCenter.includes('<SelfHostWorkerCenter agents={agents}')) throw new Error('SelfHostWorkerCenter is not integrated')
if (!main.includes("import './worker.css'")) throw new Error('Worker mobile styles are not loaded')

for (const marker of [
  "import { readFile, stat, writeFile } from 'node:fs/promises'",
  "argument('--input')",
  "argument('--output')",
  'importWorkerBundle(raw, new Date().toISOString())',
  'runReferenceWorkerBundle(bundle, new Date().toISOString())',
  "mode: 0o600",
  'Reference Worker: PASS',
  'automatic network: false; automatic tools: false',
]) {
  if (!cli.includes(marker)) throw new Error(`Reference Worker CLI invariant missing: ${marker}`)
}
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'Authorization', 'Bearer ', 'https://', 'http://']) {
  if (cli.includes(forbidden)) throw new Error(`Reference Worker CLI must remain local-file only: ${forbidden}`)
}

const smokeRequired = [
  "new URL('../src/core/workerProtocol.ts', import.meta.url)",
  "new URL('../src/core/referenceWorker.ts', import.meta.url)",
  'WORKER_BUNDLE_EXTRA_FIELD',
  'WORKER_AUTOMATION_POLICY_INVALID',
  "assert.equal(receipt.run.status, 'success')",
  "assert.equal(receipt.automaticNetworkUsed, false)",
  "assert.equal(receipt.automaticToolExecutionUsed, false)",
  'DURABLE_JOB_LEASE_EXPIRED',
  'deployment.renewDurableJobLease(',
  "assert.equal(renewed.job.lease?.renewedAt, '2026-08-29T11:00:04.000Z')",
  "spawnSync(process.execPath, ['scripts/run-reference-worker.mjs'",
  "assert.ok(cli.stdout.includes('Reference Worker: PASS'))",
  'protocol.validateWorkerReceipt(cliReceipt, cliBundle)',
]
for (const marker of smokeRequired) {
  if (!smoke.includes(marker)) throw new Error(`Phase 9B executable smoke invariant missing: ${marker}`)
}

for (const marker of [
  'agent-ia-factory.worker/0.1',
  'Offline File Transport',
  'ليس Network Authentication',
  '`automaticNetwork=false`',
  '`automaticToolExecution=false`',
  'Extra Fields',
  'Completion (إغلاق المهمة) بعد انتهاء Lease يُرفض',
  'Heartbeat/Renewal',
  'Offline File Transport ليس Authentication',
  'Phase 9C ستضيف Transport/Auth Adapter',
  'New production dependencies = 0',
  'Mandatory additional spend = 0 USD',
]) {
  if (!docs.includes(marker)) throw new Error(`Phase 9B documentation marker missing: ${marker}`)
}

for (const marker of [
  'Phase 9B Self-Host Worker CI',
  "node-version: '24'",
  'npm install --ignore-scripts --no-fund --no-audit',
  'npm run check',
  'npm run test:phase8',
  'npm run test:phase9a',
  'npm run test:phase9b',
  'npm audit --omit=dev --audit-level=high',
  'npm audit --audit-level=high',
]) {
  if (!workflow.includes(marker)) throw new Error(`Phase 9B CI invariant missing: ${marker}`)
}

if (phase9aValidator.includes("pkg.version !== '1.2.0'")) throw new Error('Phase 9A validator must be forward-compatible before Phase 9B version bump')
if (!phase9aValidator.includes('Phase 9A requires package version 1.2.0 or newer')) throw new Error('Phase 9A minimum-version invariant missing')
if (!versionAtLeast(pkg.version, '1.3.0')) throw new Error('Phase 9B requires package version 1.3.0 or newer')
if (!pkg.scripts?.['validate:phase9b']?.includes('validate-phase9b.mjs')) throw new Error('validate:phase9b script missing')
if (!pkg.scripts?.['test:phase9b']?.includes('test-phase9b-worker.mjs')) throw new Error('test:phase9b script missing')
if (!pkg.scripts?.check?.includes('validate:phase9b')) throw new Error('Phase 9B validator missing from full check')
const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 9B: ${dependency}`)
}

console.log('Phase 9B Self-Host Worker validation: PASS')
console.log('Reference runtime: local-demo only; no automatic network/tools')
console.log('Node TypeScript runtime graph: explicit .ts imports')
console.log('Worker bundle/receipt: tenant + job + lease bound')
console.log('Lease completion after expiry: rejected')
console.log('Heartbeat renewal: bounded and token-bound')
console.log('Browser UI: manual bundle/receipt transport only')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')