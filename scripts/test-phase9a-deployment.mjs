import assert from 'node:assert/strict'

const engine = await import(new URL('../src/core/deploymentEngine.ts', import.meta.url).href)

const start = '2026-08-28T12:00:00.000Z'
const input = {
  tenantId: engine.LOCAL_TENANT_ID,
  kind: 'agent_run',
  idempotencyKey: 'agent:demo:task-1',
  payload: { agentId: 'agent-demo', task: 'Durable smoke task' },
  maxAttempts: 3,
}

const first = engine.enqueueDurableJob([], input, start)
assert.equal(first.deduplicated, false)
assert.equal(first.job.status, 'pending')
assert.equal(first.job.requiresHumanStart, true)
assert.equal(first.job.monetaryCostUsd, 0)

const duplicate = engine.enqueueDurableJob(first.jobs, input, start)
assert.equal(duplicate.deduplicated, true)
assert.equal(duplicate.jobs.length, 1)
assert.equal(duplicate.job.id, first.job.id)

const otherTenant = engine.claimNextDurableJob(first.jobs, 'tenant-other', 'worker-1', start)
assert.equal(otherTenant.claimed, null)
assert.equal(otherTenant.jobs[0].status, 'pending')

const claimed = engine.claimNextDurableJob(first.jobs, engine.LOCAL_TENANT_ID, 'worker-1', start, 60_000)
assert.ok(claimed.claimed?.lease)
assert.equal(claimed.claimed.status, 'leased')
assert.equal(claimed.claimed.attempts, 1)
assert.throws(
  () => engine.completeDurableJob(claimed.jobs, claimed.claimed.id, 'lease-wrong', { ok: true }, '2026-08-28T12:00:01.000Z'),
  /DURABLE_JOB_LEASE_MISMATCH/,
)

const failedOnce = engine.completeDurableJob(
  claimed.jobs,
  claimed.claimed.id,
  claimed.claimed.lease.token,
  { ok: false, errorCode: 'SMOKE_RETRY' },
  '2026-08-28T12:00:01.000Z',
)
assert.equal(failedOnce.job.status, 'retry_wait')
assert.equal(failedOnce.job.lastErrorCode, 'SMOKE_RETRY')

const tooEarly = engine.claimNextDurableJob(failedOnce.jobs, engine.LOCAL_TENANT_ID, 'worker-1', '2026-08-28T12:00:01.500Z')
assert.equal(tooEarly.claimed, null)

const claimedAgain = engine.claimNextDurableJob(failedOnce.jobs, engine.LOCAL_TENANT_ID, 'worker-1', '2026-08-28T12:00:02.000Z')
assert.ok(claimedAgain.claimed?.lease)
assert.equal(claimedAgain.claimed.attempts, 2)
const completed = engine.completeDurableJob(
  claimedAgain.jobs,
  claimedAgain.claimed.id,
  claimedAgain.claimed.lease.token,
  { ok: true },
  '2026-08-28T12:00:03.000Z',
)
assert.equal(completed.job.status, 'succeeded')
assert.equal(completed.job.monetaryCostUsd, 0)

const second = engine.enqueueDurableJob(completed.jobs, {
  ...input,
  idempotencyKey: 'agent:demo:task-2',
  payload: { agentId: 'agent-demo', task: 'Lease expiry task' },
}, '2026-08-28T12:01:00.000Z')
const expiring = engine.claimNextDurableJob(second.jobs, engine.LOCAL_TENANT_ID, 'worker-expire', '2026-08-28T12:01:00.000Z', 5_000)
assert.ok(expiring.claimed)
const reclaimed = engine.reclaimExpiredLeases(expiring.jobs, '2026-08-28T12:01:06.000Z')
const reclaimedJob = reclaimed.find((job) => job.id === expiring.claimed.id)
assert.equal(reclaimedJob?.status, 'retry_wait')
assert.equal(reclaimedJob?.lastErrorCode, 'LEASE_EXPIRED')

const events = Array.from({ length: 20 }, (_, index) => ({
  tenantId: engine.LOCAL_TENANT_ID,
  action: 'enqueue',
  at: new Date(Date.parse(start) - index * 1_000).toISOString(),
}))
const rate = engine.evaluateRateLimit(events, engine.LOCAL_TENANT_ID, { action: 'enqueue', maxEvents: 20, windowMs: 300_000 }, start)
assert.equal(rate.allowed, false)
assert.equal(rate.remaining, 0)
assert.ok(rate.retryAfterMs > 0)

const summary = engine.summarizeDurableQueue(completed.jobs, engine.LOCAL_TENANT_ID)
assert.equal(summary.succeeded, 1)
assert.equal(summary.total, 1)

assert.throws(
  () => engine.validateDurableJob({ ...first.job, monetaryCostUsd: 1 }),
  /DURABLE_JOB_NONZERO_COST_FORBIDDEN/,
)
assert.throws(
  () => engine.validateDurableJob({ ...first.job, requiresHumanStart: false }),
  /DURABLE_JOB_HUMAN_START_REQUIRED/,
)

console.log('Phase 9A durable queue smoke: PASS')
console.log('Idempotency prevents duplicate jobs: PASS')
console.log('Tenant claim isolation: PASS')
console.log('Lease token enforcement + bounded retry: PASS')
console.log('Expired lease recovery: PASS')
console.log('Rate limit fail-closed: PASS')
console.log('Mandatory job monetary cost: 0 USD')
console.log('Automatic execution: forbidden; Human Start required')
