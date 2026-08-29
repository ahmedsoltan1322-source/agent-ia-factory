import fs from 'node:fs'

const required = [
  'src/core/workerDurableStore.ts',
  'src/core/workerServerCore.ts',
  'scripts/worker-server.mjs',
  'scripts/test-phase9d-durable-worker.mjs',
  'docs/PHASE9D_CRASH_SAFE_WORKER_STORE.md',
  '.github/workflows/phase9d-durable-worker-ci.yml',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 9D file: ${file}`)
}

const store = fs.readFileSync('src/core/workerDurableStore.ts', 'utf8')
const serverCore = fs.readFileSync('src/core/workerServerCore.ts', 'utf8')
const server = fs.readFileSync('scripts/worker-server.mjs', 'utf8')
const phase9cSmoke = fs.readFileSync('scripts/test-phase9c-transport.mjs', 'utf8')
const smoke = fs.readFileSync('scripts/test-phase9d-durable-worker.mjs', 'utf8')
const docs = fs.readFileSync('docs/PHASE9D_CRASH_SAFE_WORKER_STORE.md', 'utf8')
const workflow = fs.readFileSync('.github/workflows/phase9d-durable-worker-ci.yml', 'utf8')
const phase9cValidator = fs.readFileSync('scripts/validate-phase9c.mjs', 'utf8')
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
  "export const WORKER_DURABLE_STORE_SCHEMA = 'agent-ia-factory.worker-store/0.1'",
  'export const WORKER_DURABLE_STORE_MAX_RECORDS = 1_000',
  'export const WORKER_DURABLE_STORE_MAX_RECORD_CHARS = 500_000',
  "createHash('sha256').update(bundleId, 'utf8').digest('hex')",
  "mkdir(absolute, { recursive: true, mode: 0o700 })",
  'info.isSymbolicLink()',
  "open(path, 'wx', 0o600)",
  'await handle.sync()',
  'await rename(temp, path)',
  'await syncDirectory(root)',
  "status: 'reserved'",
  "status: 'completed'",
  "throw new Error('WORKER_STORE_BUNDLE_CONFLICT')",
  "throw new Error('WORKER_STORE_LEASE_CONFLICT')",
  "throw new Error('WORKER_STORE_RECORD_CORRUPT')",
  "return { state: 'reserved-existing' }",
  "return { state: 'completed', receiptBody: existing.receiptBody }",
]) {
  if (!store.includes(marker)) throw new Error(`Phase 9D durable-store invariant missing: ${marker}`)
}
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'localStorage', 'sessionStorage', 'indexedDB', 'Authorization', 'Bearer ']) {
  if (store.includes(forbidden)) throw new Error(`Durable filesystem store must remain local and credential-neutral: ${forbidden}`)
}
if (store.includes('rm(root') || store.includes('rm(absolute')) throw new Error('Durable store must never recursively wipe its root directory')

for (const marker of [
  'export interface DurableWorkerExecutionStore',
  "state: 'reserved-new'",
  "state: 'reserved-existing'",
  "state: 'completed'",
  'durableStore?: DurableWorkerExecutionStore',
  'const reservation = await durableStore.reserve({',
  "if (reservation.state === 'completed')",
  "if (reservation.state === 'reserved-existing')",
  'WORKER_SERVER_UNCERTAIN_EXECUTION',
  'await durableStore.complete({',
  'let durableReserved = false',
  'if (durableReserved)',
]) {
  if (!serverCore.includes(marker)) throw new Error(`Phase 9D server-core invariant missing: ${marker}`)
}
const reserveIndex = serverCore.indexOf('const reservation = await durableStore.reserve({')
const executeIndex = serverCore.indexOf('const receipt = await runReferenceWorkerBundle(bundle, nowIso)')
const completeIndex = serverCore.indexOf('await durableStore.complete({')
if (!(reserveIndex >= 0 && executeIndex > reserveIndex && completeIndex > executeIndex)) {
  throw new Error('Durable reservation must happen before execution and durable completion after execution')
}
if (serverCore.includes("reservation.state === 'reserved-existing') {\n        const receipt")) {
  throw new Error('Reserved-existing state must never auto-execute or fabricate a receipt')
}

for (const marker of [
  "import { createFilesystemWorkerExecutionStore } from '../src/core/workerDurableStore.ts'",
  "createFilesystemWorkerExecutionStore(env('AGENT_IA_WORKER_STATE_DIR'))",
  'Date.now(), durableStore)',
  "const HOST = '127.0.0.1'",
  'Durable worker state: enabled',
]) {
  if (!server.includes(marker)) throw new Error(`Phase 9D reference-server invariant missing: ${marker}`)
}
if (server.includes("AGENT_IA_WORKER_STATE_DIR?.") || server.includes("|| '.agent-ia")) {
  throw new Error('Reference worker state directory must be explicit, not an implicit fallback')
}

for (const marker of [
  "mkdtemp(join(tmpdir(), 'agent-ia-worker-state-'))",
  'AGENT_IA_WORKER_STATE_DIR: stateDir',
  'Durable worker state: enabled',
]) {
  if (!phase9cSmoke.includes(marker)) throw new Error(`Phase 9C regression must use durable state after Phase 9D: ${marker}`)
}

for (const marker of [
  "new URL('../src/core/workerDurableStore.ts', import.meta.url)",
  "mkdtemp(join(tmpdir(), 'agent-ia-durable-worker-'))",
  'const firstServer = await startServer(stateDir)',
  'const secondServer = await startServer(stateDir)',
  'assert.equal(secondResponse.body, firstResponse.body)',
  'assert.equal(secondReceipt.run.id, firstReceipt.run.id)',
  "assert.equal(completedInfo.mode & 0o777, 0o600)",
  'assert.ok(!completedRaw.includes(SECRET))',
  "assert.equal(reserved.state, 'reserved-new')",
  "assert.equal(crashResponse.status, 409",
  'WORKER_SERVER_UNCERTAIN_EXECUTION',
  'WORKER_STORE_BUNDLE_CONFLICT',
  "writeFile(join(stateDir, corruptName), '{broken-json'",
  'WORKER_STORE_RECORD_CORRUPT',
]) {
  if (!smoke.includes(marker)) throw new Error(`Phase 9D executable smoke invariant missing: ${marker}`)
}

for (const marker of [
  'At-Most-Once Automatic Execution after durable reservation',
  'لا تدعي Exactly-Once',
  'Atomic Reserve on Disk',
  'Reserved? return Uncertain and DO NOT execute',
  '`0700`',
  '`0600`',
  'exclusive create (`wx`)',
  '`fsync`',
  '`rename` ذرّي',
  'WORKER_STORE_BUNDLE_CONFLICT',
  'AGENT_IA_WORKER_STATE_DIR',
  'Reference Runtime = `local-demo` فقط',
  'Phase 7A real Chrome smoke on the same PR',
  'New production dependencies = 0',
  'Mandatory additional spend = 0 USD',
]) {
  if (!docs.includes(marker)) throw new Error(`Phase 9D documentation marker missing: ${marker}`)
}

for (const marker of [
  'Phase 9D Crash-Safe Worker CI',
  "node-version: '24'",
  'npm install --ignore-scripts --no-fund --no-audit',
  'npm run check',
  'npm run test:phase8',
  'npm run test:phase9a',
  'npm run test:phase9b',
  'npm run test:phase9c',
  'npm run test:phase9d',
  'npm audit --omit=dev --audit-level=high',
  'npm audit --audit-level=high',
]) {
  if (!workflow.includes(marker)) throw new Error(`Phase 9D CI invariant missing: ${marker}`)
}

if (phase9cValidator.includes("pkg.version !== '1.4.0'")) throw new Error('Phase 9C validator must be forward-compatible before Phase 9D version bump')
if (!phase9cValidator.includes('Phase 9C requires package version 1.4.0 or newer')) throw new Error('Phase 9C minimum-version invariant missing')
if (!versionAtLeast(pkg.version, '1.5.0')) throw new Error('Phase 9D requires package version 1.5.0 or newer')
if (!pkg.scripts?.['validate:phase9d']?.includes('validate-phase9d.mjs')) throw new Error('validate:phase9d script missing')
if (!pkg.scripts?.['test:phase9d']?.includes('test-phase9d-durable-worker.mjs')) throw new Error('test:phase9d script missing')
if (!pkg.scripts?.check?.includes('validate:phase9d')) throw new Error('Phase 9D validator missing from full check')
const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 9D: ${dependency}`)
}

console.log('Phase 9D Crash-Safe Durable Worker validation: PASS')
console.log('Reservation: durable and exclusive before execution')
console.log('Completion: fsync + atomic rename after execution')
console.log('Restart: completed receipt is reusable from disk')
console.log('Crash uncertainty: reserved-without-receipt never auto-reexecutes')
console.log('Conflict/corruption: fail-closed')
console.log('Reference state directory: explicit and private')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')