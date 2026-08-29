import {
  LOCAL_TENANT_ID,
  cancelDurableJob,
  claimNextDurableJob,
  completeDurableJob,
  enqueueDurableJob,
  evaluateRateLimit,
  recordRateLimitEvent,
  renewDurableJobLease,
  validateDurableJob,
  type DurableJob,
  type EnqueueDurableJobInput,
  type RateLimitEvent,
  type RateLimitPolicy,
} from './deploymentEngine'
import { validateWorkerReceipt, type PortableWorkerReceipt } from './workerProtocol'

const JOBS_KEY = 'agent-ia-factory.deployment.jobs.v1'
const RATE_EVENTS_KEY = 'agent-ia-factory.deployment.rate-events.v1'
const FACTORY_PREFIX = 'agent-ia-factory.'
const RESTORABLE_KEYS = new Set([JOBS_KEY, RATE_EVENTS_KEY])
const MAX_STORED_JOBS = 100
const MAX_RATE_EVENTS = 500
const MAX_BACKUP_ENTRIES = 100
const MAX_BACKUP_VALUE_CHARS = 750_000
const MAX_BACKUP_JSON_CHARS = 4_000_000
const FORBIDDEN_BACKUP_KEY = /(?:secret|token|password|credential|authorization|cookie|sessionid)/iu

export const ENQUEUE_RATE_LIMIT: RateLimitPolicy = { action: 'enqueue', maxEvents: 20, windowMs: 5 * 60_000 }
export const CLAIM_RATE_LIMIT: RateLimitPolicy = { action: 'claim', maxEvents: 10, windowMs: 60_000 }

export interface FactoryBackupEntry {
  key: string
  value: string
}

export interface FactoryBackup {
  schemaVersion: '0.1'
  tenantId: typeof LOCAL_TENANT_ID
  createdAt: string
  source: 'phone-local'
  entries: FactoryBackupEntry[]
}

export interface RestoreResult {
  restored: number
  skipped: number
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  const raw = JSON.stringify(value)
  if (raw.length > MAX_BACKUP_JSON_CHARS) throw new Error('DEPLOYMENT_STORAGE_LIMIT_REACHED')
  localStorage.setItem(key, raw)
}

function validateEvent(event: RateLimitEvent): RateLimitEvent {
  if (!event || typeof event !== 'object') throw new Error('RATE_EVENT_INVALID')
  if (event.tenantId !== LOCAL_TENANT_ID) throw new Error('RATE_EVENT_TENANT_INVALID')
  if (!['enqueue', 'claim'].includes(event.action)) throw new Error('RATE_EVENT_ACTION_INVALID')
  if (!Number.isFinite(Date.parse(event.at))) throw new Error('RATE_EVENT_TIME_INVALID')
  return event
}

export function loadDurableJobs(): DurableJob[] {
  const raw = readJson<unknown[]>(JOBS_KEY, [])
  if (!Array.isArray(raw)) return []
  try {
    return raw.slice(0, MAX_STORED_JOBS).map((item) => validateDurableJob(item as DurableJob))
  } catch {
    return []
  }
}

export function saveDurableJobs(jobs: DurableJob[]): DurableJob[] {
  const safe = jobs.slice(0, MAX_STORED_JOBS).map(validateDurableJob)
  writeJson(JOBS_KEY, safe)
  return safe
}

export function loadRateLimitEvents(): RateLimitEvent[] {
  const raw = readJson<unknown[]>(RATE_EVENTS_KEY, [])
  if (!Array.isArray(raw)) return []
  try {
    return raw.slice(0, MAX_RATE_EVENTS).map((item) => validateEvent(item as RateLimitEvent))
  } catch {
    return []
  }
}

function saveRateLimitEvents(events: RateLimitEvent[]): RateLimitEvent[] {
  const safe = events.slice(0, MAX_RATE_EVENTS).map(validateEvent)
  writeJson(RATE_EVENTS_KEY, safe)
  return safe
}

export function enqueueLocalDurableJob(
  input: Omit<EnqueueDurableJobInput, 'tenantId'>,
  now = new Date().toISOString(),
): { jobs: DurableJob[]; job: DurableJob; deduplicated: boolean } {
  const existing = loadDurableJobs()
  const result = enqueueDurableJob(existing, { ...input, tenantId: LOCAL_TENANT_ID }, now)
  if (result.deduplicated) return result
  const events = loadRateLimitEvents()
  const decision = evaluateRateLimit(events, LOCAL_TENANT_ID, ENQUEUE_RATE_LIMIT, now)
  if (!decision.allowed) throw new Error(`RATE_LIMIT_ENQUEUE:${decision.retryAfterMs}`)
  const jobs = saveDurableJobs(result.jobs)
  saveRateLimitEvents(recordRateLimitEvent(events, LOCAL_TENANT_ID, 'enqueue', now))
  return { ...result, jobs }
}

export function claimLocalDurableJob(
  workerId: string,
  now = new Date().toISOString(),
  leaseMs = 60_000,
): { jobs: DurableJob[]; claimed: DurableJob | null } {
  const events = loadRateLimitEvents()
  const decision = evaluateRateLimit(events, LOCAL_TENANT_ID, CLAIM_RATE_LIMIT, now)
  if (!decision.allowed) throw new Error(`RATE_LIMIT_CLAIM:${decision.retryAfterMs}`)
  const result = claimNextDurableJob(loadDurableJobs(), LOCAL_TENANT_ID, workerId, now, leaseMs)
  if (!result.claimed) return result
  const jobs = saveDurableJobs(result.jobs)
  saveRateLimitEvents(recordRateLimitEvent(events, LOCAL_TENANT_ID, 'claim', now))
  return { jobs, claimed: result.claimed }
}

export function renewLocalDurableJobLease(
  jobId: string,
  leaseToken: string,
  now = new Date().toISOString(),
  leaseMs = 60_000,
): DurableJob {
  const renewed = renewDurableJobLease(loadDurableJobs(), jobId, leaseToken, now, leaseMs)
  saveDurableJobs(renewed.jobs)
  return renewed.job
}

export function completeLocalDurableJob(
  jobId: string,
  leaseToken: string,
  result: { ok: boolean; errorCode?: string },
  now = new Date().toISOString(),
): DurableJob {
  const completed = completeDurableJob(loadDurableJobs(), jobId, leaseToken, result, now)
  saveDurableJobs(completed.jobs)
  return completed.job
}

export function applyLocalWorkerReceipt(
  rawReceipt: PortableWorkerReceipt,
  now = new Date().toISOString(),
): { job: DurableJob; receipt: PortableWorkerReceipt } {
  const receipt = validateWorkerReceipt(rawReceipt)
  if (receipt.tenantId !== LOCAL_TENANT_ID) throw new Error('WORKER_RECEIPT_TENANT_MISMATCH')
  const jobs = loadDurableJobs()
  const current = jobs.find((job) => job.id === receipt.jobId)
  if (!current || current.status !== 'leased' || !current.lease) throw new Error('WORKER_RECEIPT_JOB_NOT_LEASED')
  if (current.tenantId !== receipt.tenantId || current.lease.workerId !== receipt.workerId) throw new Error('WORKER_RECEIPT_WORKER_MISMATCH')
  if (current.lease.token !== receipt.leaseToken) throw new Error('WORKER_RECEIPT_LEASE_MISMATCH')
  if (current.payload.agentId !== receipt.run.agentId || current.payload.task !== receipt.run.task) throw new Error('WORKER_RECEIPT_RUN_MISMATCH')
  if (Date.parse(receipt.createdAt) > Date.parse(current.lease.expiresAt)) throw new Error('WORKER_RECEIPT_CREATED_AFTER_LEASE')
  const result = receipt.run.status === 'success'
    ? { ok: true as const }
    : { ok: false as const, errorCode: receipt.run.status === 'blocked' ? 'WORKER_RUN_BLOCKED' : 'WORKER_RUN_FAILED' }
  const completed = completeDurableJob(jobs, receipt.jobId, receipt.leaseToken, result, now)
  saveDurableJobs(completed.jobs)
  return { job: completed.job, receipt }
}

export function cancelLocalDurableJob(jobId: string, now = new Date().toISOString()): DurableJob[] {
  return saveDurableJobs(cancelDurableJob(loadDurableJobs(), LOCAL_TENANT_ID, jobId, now))
}

export function clearDeploymentQueue(): void {
  localStorage.removeItem(JOBS_KEY)
  localStorage.removeItem(RATE_EVENTS_KEY)
}

function isFactoryBackupKeyAllowed(key: string): boolean {
  return key.startsWith(FACTORY_PREFIX) && key.length <= 180 && !FORBIDDEN_BACKUP_KEY.test(key)
}

export function validateFactoryBackup(rawBackup: FactoryBackup): FactoryBackup {
  if (!rawBackup || rawBackup.schemaVersion !== '0.1') throw new Error('BACKUP_SCHEMA_UNSUPPORTED')
  if (rawBackup.tenantId !== LOCAL_TENANT_ID) throw new Error('BACKUP_TENANT_MISMATCH')
  if (rawBackup.source !== 'phone-local') throw new Error('BACKUP_SOURCE_INVALID')
  if (!Number.isFinite(Date.parse(rawBackup.createdAt))) throw new Error('BACKUP_TIME_INVALID')
  if (!Array.isArray(rawBackup.entries) || rawBackup.entries.length > MAX_BACKUP_ENTRIES) throw new Error('BACKUP_ENTRY_LIMIT')
  const seen = new Set<string>()
  let totalChars = 0
  const entries = rawBackup.entries.map((entry) => {
    if (!entry || typeof entry.key !== 'string' || typeof entry.value !== 'string') throw new Error('BACKUP_ENTRY_INVALID')
    if (!isFactoryBackupKeyAllowed(entry.key) || seen.has(entry.key)) throw new Error('BACKUP_KEY_INVALID')
    if (entry.value.length > MAX_BACKUP_VALUE_CHARS) throw new Error('BACKUP_VALUE_LIMIT')
    seen.add(entry.key)
    totalChars += entry.key.length + entry.value.length
    if (totalChars > MAX_BACKUP_JSON_CHARS) throw new Error('BACKUP_TOTAL_LIMIT')
    return { key: entry.key, value: entry.value }
  })
  return { ...rawBackup, entries }
}

export function createFactoryBackup(now = new Date().toISOString()): FactoryBackup {
  const entries: FactoryBackupEntry[] = []
  let totalChars = 0
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key || !isFactoryBackupKeyAllowed(key)) continue
    const value = localStorage.getItem(key)
    if (value === null) continue
    if (value.length > MAX_BACKUP_VALUE_CHARS) throw new Error(`BACKUP_VALUE_LIMIT:${key}`)
    totalChars += key.length + value.length
    if (totalChars > MAX_BACKUP_JSON_CHARS) throw new Error('BACKUP_TOTAL_LIMIT')
    entries.push({ key, value })
    if (entries.length > MAX_BACKUP_ENTRIES) throw new Error('BACKUP_ENTRY_LIMIT')
  }
  const parsedNow = Date.parse(now)
  if (!Number.isFinite(parsedNow)) throw new Error('BACKUP_TIME_INVALID')
  return validateFactoryBackup({
    schemaVersion: '0.1',
    tenantId: LOCAL_TENANT_ID,
    createdAt: new Date(parsedNow).toISOString(),
    source: 'phone-local',
    entries: entries.sort((a, b) => a.key.localeCompare(b.key)),
  })
}

export function exportFactoryBackup(now = new Date().toISOString()): string {
  const raw = JSON.stringify(createFactoryBackup(now), null, 2)
  if (raw.length > MAX_BACKUP_JSON_CHARS) throw new Error('BACKUP_TOTAL_LIMIT')
  return raw
}

export function importFactoryBackup(raw: string): FactoryBackup {
  if (!raw || raw.length > MAX_BACKUP_JSON_CHARS) throw new Error('BACKUP_IMPORT_LIMIT')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('BACKUP_JSON_INVALID')
  }
  return validateFactoryBackup(parsed as FactoryBackup)
}

function normalizeRestorableEntry(entry: FactoryBackupEntry): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(entry.value)
  } catch {
    throw new Error(`BACKUP_RESTORE_JSON_INVALID:${entry.key}`)
  }
  if (entry.key === JOBS_KEY) {
    if (!Array.isArray(parsed) || parsed.length > MAX_STORED_JOBS) throw new Error('BACKUP_RESTORE_JOBS_INVALID')
    const jobs = parsed.map((item) => validateDurableJob(item as DurableJob))
    if (jobs.some((job) => job.tenantId !== LOCAL_TENANT_ID)) throw new Error('BACKUP_RESTORE_TENANT_INVALID')
    return JSON.stringify(jobs)
  }
  if (entry.key === RATE_EVENTS_KEY) {
    if (!Array.isArray(parsed) || parsed.length > MAX_RATE_EVENTS) throw new Error('BACKUP_RESTORE_EVENTS_INVALID')
    return JSON.stringify(parsed.map((item) => validateEvent(item as RateLimitEvent)))
  }
  throw new Error('BACKUP_RESTORE_KEY_NOT_SUPPORTED')
}

export function restoreFactoryBackup(backup: FactoryBackup, mode: 'merge' | 'replace' = 'merge'): RestoreResult {
  const safe = validateFactoryBackup(backup)
  const restorable = safe.entries.filter((entry) => RESTORABLE_KEYS.has(entry.key))
  const normalized = restorable.map((entry) => ({ key: entry.key, value: normalizeRestorableEntry(entry) }))
  if (mode === 'replace') {
    for (const key of RESTORABLE_KEYS) localStorage.removeItem(key)
  }
  for (const entry of normalized) localStorage.setItem(entry.key, entry.value)
  return { restored: normalized.length, skipped: safe.entries.length - normalized.length }
}
