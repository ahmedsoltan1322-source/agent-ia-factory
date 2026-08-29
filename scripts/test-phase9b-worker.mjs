import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const deployment = await import(new URL('../src/core/deploymentEngine.ts', import.meta.url).href)
const protocol = await import(new URL('../src/core/workerProtocol.ts', import.meta.url).href)
const worker = await import(new URL('../src/core/referenceWorker.ts', import.meta.url).href)

const agent = {
  specVersion: '0.1',
  id: 'agent-worker-smoke',
  name: 'Worker Smoke Agent',
  description: 'Portable self-host worker smoke test',
  instructions: 'Execute only the deterministic local demo runtime.',
  runtime: { adapter: 'local-demo' },
  modelPolicy: { mode: 'local_only', allowPaid: false },
  toolPolicy: { defaultAction: 'deny', allowedTools: [] },
  memoryPolicy: { session: false, longTerm: false, shared: false },
  approvalPolicy: { externalWrite: 'ask', delete: 'ask', financial: 'deny', securityChange: 'ask' },
  budgetPolicy: { maxMonetarySpendUsd: 0, maxRunSeconds: 60, maxToolCalls: 0 },
  evaluationPolicy: { requiredBeforeProduction: true, minimumPassRate: 0.95, securityTestsRequired: true },
}

// The real Worker execution below uses the live wall clock because LocalDemoRuntimeAdapter
// records real timestamps. Fixed clocks are used only for deterministic lease-state tests later.
const liveStart = new Date().toISOString()
const first = deployment.enqueueDurableJob([], {
  tenantId: deployment.LOCAL_TENANT_ID,
  kind: 'agent_run',
  idempotencyKey: `worker-smoke-${Date.now()}`,
  payload: { agentId: agent.id, task: 'شغّل اختبار العامل المرجعي' },
  maxAttempts: 3,
}, liveStart)
const claimed = deployment.claimNextDurableJob(first.jobs, deployment.LOCAL_TENANT_ID, protocol.REFERENCE_WORKER_ID, liveStart, 60_000)
assert.ok(claimed.claimed?.lease)
const bundle = protocol.buildPortableWorkerBundle(claimed.claimed, agent, deployment.LOCAL_TENANT_ID, liveStart)
assert.equal(bundle.worker.transport, 'offline-file')
assert.equal(bundle.worker.automaticNetwork, false)
assert.equal(bundle.worker.automaticToolExecution, false)
assert.equal(bundle.monetaryCostUsd, 0)
assert.throws(() => protocol.validateWorkerBundle({ ...bundle, monetaryCostUsd: 1 }), /WORKER_BUNDLE_POLICY_INVALID/)
assert.throws(() => protocol.validateWorkerBundle({ ...bundle, injectedSecret: 'x' }), /WORKER_BUNDLE_EXTRA_FIELD/)
assert.throws(() => protocol.validateWorkerBundle({ ...bundle, worker: { ...bundle.worker, automaticNetwork: true } }), /WORKER_AUTOMATION_POLICY_INVALID/)

const receipt = await worker.runReferenceWorkerBundle(bundle, new Date().toISOString())
assert.equal(receipt.run.status, 'success')
assert.equal(receipt.run.runtimeAdapter, 'local-demo')
assert.equal(receipt.run.toolCalls, 0)
assert.equal(receipt.monetaryCostUsd, 0)
assert.equal(receipt.automaticNetworkUsed, false)
assert.equal(receipt.automaticToolExecutionUsed, false)
assert.equal(protocol.validateWorkerReceipt(receipt, bundle).jobId, bundle.job.id)
assert.throws(() => protocol.validateWorkerReceipt({ ...receipt, automaticNetworkUsed: true }), /WORKER_RECEIPT_POLICY_INVALID/)

const completed = deployment.completeDurableJob(claimed.jobs, receipt.jobId, receipt.leaseToken, { ok: true }, receipt.createdAt)
assert.equal(completed.job.status, 'succeeded')

const expirySeed = deployment.enqueueDurableJob([], {
  tenantId: deployment.LOCAL_TENANT_ID,
  kind: 'agent_run',
  idempotencyKey: 'worker-expiry',
  payload: { agentId: agent.id, task: 'اختبار انتهاء الحجز' },
}, '2026-08-29T10:01:00.000Z')
const expiring = deployment.claimNextDurableJob(expirySeed.jobs, deployment.LOCAL_TENANT_ID, protocol.REFERENCE_WORKER_ID, '2026-08-29T10:01:00.000Z', 5_000)
assert.ok(expiring.claimed?.lease)
assert.throws(
  () => deployment.completeDurableJob(expiring.jobs, expiring.claimed.id, expiring.claimed.lease.token, { ok: true }, '2026-08-29T10:01:06.000Z'),
  /DURABLE_JOB_LEASE_EXPIRED/,
)

const heartbeatSeed = deployment.enqueueDurableJob([], {
  tenantId: deployment.LOCAL_TENANT_ID,
  kind: 'agent_run',
  idempotencyKey: 'worker-heartbeat',
  payload: { agentId: agent.id, task: 'اختبار تجديد الحجز' },
}, '2026-08-29T11:00:00.000Z')
const heartbeatClaim = deployment.claimNextDurableJob(heartbeatSeed.jobs, deployment.LOCAL_TENANT_ID, protocol.REFERENCE_WORKER_ID, '2026-08-29T11:00:00.000Z', 5_000)
assert.ok(heartbeatClaim.claimed?.lease)
const renewed = deployment.renewDurableJobLease(
  heartbeatClaim.jobs,
  heartbeatClaim.claimed.id,
  heartbeatClaim.claimed.lease.token,
  '2026-08-29T11:00:04.000Z',
  10_000,
)
assert.equal(renewed.job.lease?.renewedAt, '2026-08-29T11:00:04.000Z')
assert.equal(renewed.job.lease?.expiresAt, '2026-08-29T11:00:14.000Z')
const renewedComplete = deployment.completeDurableJob(
  renewed.jobs,
  renewed.job.id,
  renewed.job.lease.token,
  { ok: true },
  '2026-08-29T11:00:08.000Z',
)
assert.equal(renewedComplete.job.status, 'succeeded')
assert.throws(
  () => deployment.renewDurableJobLease(heartbeatClaim.jobs, heartbeatClaim.claimed.id, heartbeatClaim.claimed.lease.token, '2026-08-29T11:00:06.000Z', 10_000),
  /DURABLE_JOB_LEASE_EXPIRED/,
)

const now = new Date()
const nowIso = now.toISOString()
const cliSeed = deployment.enqueueDurableJob([], {
  tenantId: deployment.LOCAL_TENANT_ID,
  kind: 'agent_run',
  idempotencyKey: `worker-cli-${Date.now()}`,
  payload: { agentId: agent.id, task: 'اختبار CLI عبر ملف محلي' },
}, nowIso)
const cliClaim = deployment.claimNextDurableJob(cliSeed.jobs, deployment.LOCAL_TENANT_ID, protocol.REFERENCE_WORKER_ID, nowIso, 5 * 60_000)
assert.ok(cliClaim.claimed?.lease)
const cliBundle = protocol.buildPortableWorkerBundle(cliClaim.claimed, agent, deployment.LOCAL_TENANT_ID, nowIso)
const dir = await mkdtemp(join(tmpdir(), 'agent-ia-worker-'))
const inputPath = join(dir, 'bundle.json')
const outputPath = join(dir, 'receipt.json')
await writeFile(inputPath, protocol.exportWorkerBundle(cliBundle), 'utf8')
const cli = spawnSync(process.execPath, ['scripts/run-reference-worker.mjs', '--input', inputPath, '--output', outputPath], {
  encoding: 'utf8',
  cwd: process.cwd(),
})
assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`)
assert.ok(cli.stdout.includes('Reference Worker: PASS'))
const outputInfo = await stat(outputPath)
assert.ok(outputInfo.size > 0 && outputInfo.size <= protocol.MAX_WORKER_RECEIPT_CHARS)
const cliReceipt = protocol.importWorkerReceipt(await readFile(outputPath, 'utf8'))
assert.equal(protocol.validateWorkerReceipt(cliReceipt, cliBundle).run.status, 'success')
assert.equal(cliReceipt.monetaryCostUsd, 0)

console.log('Phase 9B portable worker protocol smoke: PASS')
console.log('Bundle schema + no hidden extra fields: PASS')
console.log('Reference Worker local-demo execution: PASS')
console.log('Worker receipt binding: PASS')
console.log('Expired lease completion rejection: PASS')
console.log('Heartbeat lease renewal: PASS')
console.log('Offline CLI bundle → receipt path: PASS')
console.log('Automatic network/tools: forbidden')
console.log('Mandatory additional spend: 0 USD')