export const LOCAL_TENANT_ID = 'local-owner'

export type DurableJobKind = 'agent_run' | 'workflow_run'
export type DurableJobStatus = 'pending' | 'leased' | 'retry_wait' | 'succeeded' | 'failed' | 'cancelled'
export type RateLimitAction = 'enqueue' | 'claim'

export interface DurableJobPayload {
  agentId?: string
  workflowId?: string
  task: string
}

export interface DurableJobLease {
  workerId: string
  token: string
  acquiredAt: string
  expiresAt: string
}

export interface DurableJob {
  schemaVersion: '0.1'
  id: string
  tenantId: string
  kind: DurableJobKind
  idempotencyKey: string
  payload: DurableJobPayload
  status: DurableJobStatus
  attempts: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
  nextAttemptAt: string
  lease?: DurableJobLease
  lastErrorCode?: string
  requiresHumanStart: true
  monetaryCostUsd: 0
}

export interface EnqueueDurableJobInput {
  tenantId: string
  kind: DurableJobKind
  idempotencyKey: string
  payload: DurableJobPayload
  maxAttempts?: number
}

export interface RateLimitEvent {
  tenantId: string
  action: RateLimitAction
  at: string
}

export interface RateLimitPolicy {
  action: RateLimitAction
  maxEvents: number
  windowMs: number
}

export interface RateLimitDecision {
  allowed: boolean
  used: number
  remaining: number
  retryAfterMs: number
}

export interface DurableQueueSummary {
  tenantId: string
  total: number
  pending: number
  leased: number
  retryWait: number
  succeeded: number
  failed: number
  cancelled: number
}

const MAX_QUEUE_JOBS = 100
const MAX_TASK_CHARS = 5_000
const MAX_ID_CHARS = 120
const MAX_IDEMPOTENCY_CHARS = 160
const MAX_ATTEMPTS = 5
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_LEASE_MS = 60_000
const MAX_LEASE_MS = 5 * 60_000
const MAX_ERROR_CODE_CHARS = 120
const IDENTIFIER = /^[A-Za-z0-9._:-]+$/u

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function parseTime(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error('DEPLOYMENT_TIME_INVALID')
  return parsed
}

function iso(value: string | Date): string {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error('DEPLOYMENT_TIME_INVALID')
  return new Date(parsed).toISOString()
}

function boundedIdentifier(value: string, max: number, errorCode: string): string {
  const clean = value.trim()
  if (!clean || clean.length > max || !IDENTIFIER.test(clean)) throw new Error(errorCode)
  return clean
}

export function validateTenantId(tenantId: string): string {
  return boundedIdentifier(tenantId, 80, 'TENANT_ID_INVALID')
}

function validatePayload(kind: DurableJobKind, payload: DurableJobPayload): DurableJobPayload {
  const task = payload.task.trim()
  if (!task || task.length > MAX_TASK_CHARS) throw new Error('DURABLE_JOB_TASK_INVALID')
  const agentId = payload.agentId?.trim()
  const workflowId = payload.workflowId?.trim()
  if (agentId && (agentId.length > MAX_ID_CHARS || !IDENTIFIER.test(agentId))) throw new Error('DURABLE_JOB_AGENT_ID_INVALID')
  if (workflowId && (workflowId.length > MAX_ID_CHARS || !IDENTIFIER.test(workflowId))) throw new Error('DURABLE_JOB_WORKFLOW_ID_INVALID')
  if (kind === 'agent_run' && !agentId) throw new Error('DURABLE_JOB_AGENT_REQUIRED')
  if (kind === 'workflow_run' && !workflowId) throw new Error('DURABLE_JOB_WORKFLOW_REQUIRED')
  return { task, ...(agentId ? { agentId } : {}), ...(workflowId ? { workflowId } : {}) }
}

export function validateDurableJob(job: DurableJob): DurableJob {
  if (job.schemaVersion !== '0.1') throw new Error('DURABLE_JOB_SCHEMA_UNSUPPORTED')
  validateTenantId(job.tenantId)
  boundedIdentifier(job.id, MAX_ID_CHARS, 'DURABLE_JOB_ID_INVALID')
  boundedIdentifier(job.idempotencyKey, MAX_IDEMPOTENCY_CHARS, 'DURABLE_JOB_IDEMPOTENCY_INVALID')
  if (!['agent_run', 'workflow_run'].includes(job.kind)) throw new Error('DURABLE_JOB_KIND_INVALID')
  if (!['pending', 'leased', 'retry_wait', 'succeeded', 'failed', 'cancelled'].includes(job.status)) throw new Error('DURABLE_JOB_STATUS_INVALID')
  if (!Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > MAX_ATTEMPTS) throw new Error('DURABLE_JOB_ATTEMPTS_INVALID')
  if (!Number.isInteger(job.maxAttempts) || job.maxAttempts < 1 || job.maxAttempts > MAX_ATTEMPTS) throw new Error('DURABLE_JOB_MAX_ATTEMPTS_INVALID')
  if (job.attempts > job.maxAttempts) throw new Error('DURABLE_JOB_ATTEMPT_OVERFLOW')
  iso(job.createdAt)
  iso(job.updatedAt)
  iso(job.nextAttemptAt)
  if (job.requiresHumanStart !== true) throw new Error('DURABLE_JOB_HUMAN_START_REQUIRED')
  if (job.monetaryCostUsd !== 0) throw new Error('DURABLE_JOB_NONZERO_COST_FORBIDDEN')
  validatePayload(job.kind, job.payload)
  if (job.status === 'leased') {
    if (!job.lease) throw new Error('DURABLE_JOB_LEASE_REQUIRED')
    boundedIdentifier(job.lease.workerId, 100, 'DURABLE_JOB_WORKER_INVALID')
    boundedIdentifier(job.lease.token, 160, 'DURABLE_JOB_LEASE_TOKEN_INVALID')
    const acquired = parseTime(job.lease.acquiredAt)
    const expires = parseTime(job.lease.expiresAt)
    if (expires <= acquired || expires - acquired > MAX_LEASE_MS) throw new Error('DURABLE_JOB_LEASE_INVALID')
  } else if (job.lease) {
    throw new Error('DURABLE_JOB_STALE_LEASE')
  }
  if (job.lastErrorCode && (job.lastErrorCode.length > MAX_ERROR_CODE_CHARS || !IDENTIFIER.test(job.lastErrorCode))) {
    throw new Error('DURABLE_JOB_ERROR_CODE_INVALID')
  }
  return job
}

export function enqueueDurableJob(
  existing: DurableJob[],
  input: EnqueueDurableJobInput,
  now = new Date().toISOString(),
): { jobs: DurableJob[]; job: DurableJob; deduplicated: boolean } {
  const tenantId = validateTenantId(input.tenantId)
  const idempotencyKey = boundedIdentifier(input.idempotencyKey, MAX_IDEMPOTENCY_CHARS, 'DURABLE_JOB_IDEMPOTENCY_INVALID')
  const payload = validatePayload(input.kind, input.payload)
  const queue = existing.map(validateDurableJob)
  const duplicate = queue.find((job) => job.tenantId === tenantId && job.idempotencyKey === idempotencyKey && job.status !== 'cancelled')
  if (duplicate) return { jobs: queue, job: duplicate, deduplicated: true }
  if (queue.filter((job) => job.tenantId === tenantId && !['succeeded', 'cancelled'].includes(job.status)).length >= MAX_QUEUE_JOBS) {
    throw new Error('DURABLE_QUEUE_LIMIT_REACHED')
  }
  const timestamp = iso(now)
  const maxAttempts = Math.max(1, Math.min(MAX_ATTEMPTS, Math.floor(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)))
  const job: DurableJob = validateDurableJob({
    schemaVersion: '0.1',
    id: newId('job'),
    tenantId,
    kind: input.kind,
    idempotencyKey,
    payload,
    status: 'pending',
    attempts: 0,
    maxAttempts,
    createdAt: timestamp,
    updatedAt: timestamp,
    nextAttemptAt: timestamp,
    requiresHumanStart: true,
    monetaryCostUsd: 0,
  })
  return { jobs: [job, ...queue].slice(0, MAX_QUEUE_JOBS), job, deduplicated: false }
}

export function reclaimExpiredLeases(jobs: DurableJob[], now = new Date().toISOString()): DurableJob[] {
  const nowMs = parseTime(now)
  return jobs.map((raw) => {
    const job = validateDurableJob(raw)
    if (job.status !== 'leased' || !job.lease || parseTime(job.lease.expiresAt) > nowMs) return job
    const exhausted = job.attempts >= job.maxAttempts
    return validateDurableJob({
      ...job,
      status: exhausted ? 'failed' : 'retry_wait',
      updatedAt: iso(now),
      nextAttemptAt: iso(now),
      lease: undefined,
      lastErrorCode: 'LEASE_EXPIRED',
    })
  })
}

export function claimNextDurableJob(
  jobs: DurableJob[],
  tenantIdRaw: string,
  workerIdRaw: string,
  now = new Date().toISOString(),
  leaseMs = DEFAULT_LEASE_MS,
): { jobs: DurableJob[]; claimed: DurableJob | null } {
  const tenantId = validateTenantId(tenantIdRaw)
  const workerId = boundedIdentifier(workerIdRaw, 100, 'DURABLE_JOB_WORKER_INVALID')
  const safeLeaseMs = Math.max(5_000, Math.min(MAX_LEASE_MS, Math.floor(leaseMs)))
  const recovered = reclaimExpiredLeases(jobs, now)
  const nowMs = parseTime(now)
  const candidate = recovered
    .filter((job) => job.tenantId === tenantId && ['pending', 'retry_wait'].includes(job.status) && job.attempts < job.maxAttempts && parseTime(job.nextAttemptAt) <= nowMs)
    .sort((a, b) => parseTime(a.createdAt) - parseTime(b.createdAt))[0]
  if (!candidate) return { jobs: recovered, claimed: null }
  const token = newId('lease')
  const claimed = validateDurableJob({
    ...candidate,
    status: 'leased',
    attempts: candidate.attempts + 1,
    updatedAt: iso(now),
    lease: {
      workerId,
      token,
      acquiredAt: iso(now),
      expiresAt: new Date(nowMs + safeLeaseMs).toISOString(),
    },
  })
  return {
    jobs: recovered.map((job) => job.id === claimed.id ? claimed : job),
    claimed,
  }
}

export function completeDurableJob(
  jobs: DurableJob[],
  jobIdRaw: string,
  leaseTokenRaw: string,
  result: { ok: boolean; errorCode?: string },
  now = new Date().toISOString(),
): { jobs: DurableJob[]; job: DurableJob } {
  const jobId = boundedIdentifier(jobIdRaw, MAX_ID_CHARS, 'DURABLE_JOB_ID_INVALID')
  const leaseToken = boundedIdentifier(leaseTokenRaw, 160, 'DURABLE_JOB_LEASE_TOKEN_INVALID')
  const queue = jobs.map(validateDurableJob)
  const current = queue.find((job) => job.id === jobId)
  if (!current || current.status !== 'leased' || !current.lease) throw new Error('DURABLE_JOB_NOT_LEASED')
  if (current.lease.token !== leaseToken) throw new Error('DURABLE_JOB_LEASE_MISMATCH')
  const timestamp = iso(now)
  let next: DurableJob
  if (result.ok) {
    next = validateDurableJob({
      ...current,
      status: 'succeeded',
      updatedAt: timestamp,
      nextAttemptAt: timestamp,
      lease: undefined,
      lastErrorCode: undefined,
    })
  } else {
    const errorCode = boundedIdentifier(result.errorCode ?? 'RUN_FAILED', MAX_ERROR_CODE_CHARS, 'DURABLE_JOB_ERROR_CODE_INVALID')
    const exhausted = current.attempts >= current.maxAttempts
    const backoffMs = Math.min(60_000, 1_000 * (2 ** Math.max(0, current.attempts - 1)))
    next = validateDurableJob({
      ...current,
      status: exhausted ? 'failed' : 'retry_wait',
      updatedAt: timestamp,
      nextAttemptAt: new Date(parseTime(now) + (exhausted ? 0 : backoffMs)).toISOString(),
      lease: undefined,
      lastErrorCode: errorCode,
    })
  }
  return { jobs: queue.map((job) => job.id === next.id ? next : job), job: next }
}

export function cancelDurableJob(jobs: DurableJob[], tenantIdRaw: string, jobIdRaw: string, now = new Date().toISOString()): DurableJob[] {
  const tenantId = validateTenantId(tenantIdRaw)
  const jobId = boundedIdentifier(jobIdRaw, MAX_ID_CHARS, 'DURABLE_JOB_ID_INVALID')
  return jobs.map((raw) => {
    const job = validateDurableJob(raw)
    if (job.id !== jobId || job.tenantId !== tenantId) return job
    if (['succeeded', 'failed'].includes(job.status)) throw new Error('DURABLE_JOB_TERMINAL')
    return validateDurableJob({ ...job, status: 'cancelled', updatedAt: iso(now), nextAttemptAt: iso(now), lease: undefined })
  })
}

export function evaluateRateLimit(
  events: RateLimitEvent[],
  tenantIdRaw: string,
  policy: RateLimitPolicy,
  now = new Date().toISOString(),
): RateLimitDecision {
  const tenantId = validateTenantId(tenantIdRaw)
  if (!['enqueue', 'claim'].includes(policy.action)) throw new Error('RATE_LIMIT_ACTION_INVALID')
  if (!Number.isInteger(policy.maxEvents) || policy.maxEvents < 1 || policy.maxEvents > 1_000) throw new Error('RATE_LIMIT_MAX_INVALID')
  if (!Number.isInteger(policy.windowMs) || policy.windowMs < 1_000 || policy.windowMs > 24 * 60 * 60_000) throw new Error('RATE_LIMIT_WINDOW_INVALID')
  const nowMs = parseTime(now)
  const windowStart = nowMs - policy.windowMs
  const relevant = events
    .filter((event) => event.tenantId === tenantId && event.action === policy.action)
    .map((event) => parseTime(event.at))
    .filter((at) => at > windowStart && at <= nowMs)
    .sort((a, b) => a - b)
  const used = relevant.length
  const allowed = used < policy.maxEvents
  const retryAfterMs = allowed || !relevant.length ? 0 : Math.max(1, relevant[0] + policy.windowMs - nowMs)
  return { allowed, used, remaining: Math.max(0, policy.maxEvents - used), retryAfterMs }
}

export function recordRateLimitEvent(events: RateLimitEvent[], tenantIdRaw: string, action: RateLimitAction, now = new Date().toISOString()): RateLimitEvent[] {
  const tenantId = validateTenantId(tenantIdRaw)
  if (!['enqueue', 'claim'].includes(action)) throw new Error('RATE_LIMIT_ACTION_INVALID')
  const event: RateLimitEvent = { tenantId, action, at: iso(now) }
  return [event, ...events].slice(0, 500)
}

export function summarizeDurableQueue(jobs: DurableJob[], tenantIdRaw: string): DurableQueueSummary {
  const tenantId = validateTenantId(tenantIdRaw)
  const selected = jobs.map(validateDurableJob).filter((job) => job.tenantId === tenantId)
  const count = (status: DurableJobStatus) => selected.filter((job) => job.status === status).length
  return {
    tenantId,
    total: selected.length,
    pending: count('pending'),
    leased: count('leased'),
    retryWait: count('retry_wait'),
    succeeded: count('succeeded'),
    failed: count('failed'),
    cancelled: count('cancelled'),
  }
}
