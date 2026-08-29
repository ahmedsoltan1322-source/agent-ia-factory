import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  DurableWorkerExecutionStore,
  DurableWorkerStoreCompleteInput,
  DurableWorkerStoreReserveInput,
  DurableWorkerStoreReserveResult,
} from './workerServerCore.ts'

export const WORKER_DURABLE_STORE_SCHEMA = 'agent-ia-factory.worker-store/0.1' as const
export const WORKER_DURABLE_STORE_MAX_RECORDS = 1_000
export const WORKER_DURABLE_STORE_MAX_RECORD_CHARS = 500_000

const IDENTIFIER = /^[A-Za-z0-9._:-]+$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const RECORD_FILE = /^[a-f0-9]{64}\.json$/u

type StoreStatus = 'reserved' | 'completed'

interface DurableWorkerStoreRecord {
  schemaVersion: typeof WORKER_DURABLE_STORE_SCHEMA
  bundleId: string
  tenantId: string
  bodyDigest: string
  leaseExpiresAt: string
  status: StoreStatus
  reservedAt: string
  completedAt?: string
  receiptBody?: string
}

function iso(value: string, code: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(code)
  return new Date(parsed).toISOString()
}

function boundedIdentifier(value: string, max: number, code: string): string {
  const clean = value.trim()
  if (!clean || clean.length > max || !IDENTIFIER.test(clean)) throw new Error(code)
  return clean
}

function validateDigest(value: string): string {
  const clean = value.trim()
  if (!DIGEST.test(clean)) throw new Error('WORKER_STORE_BODY_DIGEST_INVALID')
  return clean
}

function validateRecord(raw: DurableWorkerStoreRecord): DurableWorkerStoreRecord {
  if (!raw || raw.schemaVersion !== WORKER_DURABLE_STORE_SCHEMA) throw new Error('WORKER_STORE_RECORD_SCHEMA_INVALID')
  const bundleId = boundedIdentifier(raw.bundleId, 140, 'WORKER_STORE_BUNDLE_ID_INVALID')
  const tenantId = boundedIdentifier(raw.tenantId, 80, 'WORKER_STORE_TENANT_INVALID')
  const bodyDigest = validateDigest(raw.bodyDigest)
  const leaseExpiresAt = iso(raw.leaseExpiresAt, 'WORKER_STORE_LEASE_TIME_INVALID')
  const reservedAt = iso(raw.reservedAt, 'WORKER_STORE_RESERVED_TIME_INVALID')
  if (!['reserved', 'completed'].includes(raw.status)) throw new Error('WORKER_STORE_STATUS_INVALID')
  if (Date.parse(leaseExpiresAt) <= Date.parse(reservedAt)) throw new Error('WORKER_STORE_LEASE_ORDER_INVALID')

  if (raw.status === 'reserved') {
    if (raw.completedAt !== undefined || raw.receiptBody !== undefined) throw new Error('WORKER_STORE_RESERVED_RECORD_INVALID')
    return { schemaVersion: WORKER_DURABLE_STORE_SCHEMA, bundleId, tenantId, bodyDigest, leaseExpiresAt, status: 'reserved', reservedAt }
  }

  if (!raw.completedAt || typeof raw.receiptBody !== 'string' || !raw.receiptBody) throw new Error('WORKER_STORE_COMPLETED_RECORD_INVALID')
  const completedAt = iso(raw.completedAt, 'WORKER_STORE_COMPLETED_TIME_INVALID')
  if (Date.parse(completedAt) < Date.parse(reservedAt) || Date.parse(completedAt) > Date.parse(leaseExpiresAt)) {
    throw new Error('WORKER_STORE_COMPLETED_TIME_ORDER_INVALID')
  }
  if (raw.receiptBody.length > WORKER_DURABLE_STORE_MAX_RECORD_CHARS) throw new Error('WORKER_STORE_RECEIPT_LIMIT')
  return {
    schemaVersion: WORKER_DURABLE_STORE_SCHEMA,
    bundleId,
    tenantId,
    bodyDigest,
    leaseExpiresAt,
    status: 'completed',
    reservedAt,
    completedAt,
    receiptBody: raw.receiptBody,
  }
}

function stableRecordName(bundleId: string): string {
  return `${createHash('sha256').update(bundleId, 'utf8').digest('hex')}.json`
}

async function ensurePrivateDirectory(root: string): Promise<string> {
  const absolute = resolve(root)
  await mkdir(absolute, { recursive: true, mode: 0o700 })
  const info = await lstat(absolute)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('WORKER_STORE_ROOT_INVALID')
  return absolute
}

async function syncDirectory(root: string): Promise<void> {
  const handle = await open(root, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeExclusive(path: string, content: string): Promise<void> {
  if (content.length > WORKER_DURABLE_STORE_MAX_RECORD_CHARS) throw new Error('WORKER_STORE_RECORD_LIMIT')
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(content, { encoding: 'utf8' })
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function atomicReplace(root: string, path: string, content: string): Promise<void> {
  const temp = `${path}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`
  try {
    await writeExclusive(temp, content)
    await rename(temp, path)
    await syncDirectory(root)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

async function readRecord(path: string): Promise<DurableWorkerStoreRecord> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > WORKER_DURABLE_STORE_MAX_RECORD_CHARS) {
    throw new Error('WORKER_STORE_RECORD_FILE_INVALID')
  }
  const raw = await readFile(path, 'utf8')
  if (!raw || raw.length > WORKER_DURABLE_STORE_MAX_RECORD_CHARS) throw new Error('WORKER_STORE_RECORD_LIMIT')
  try {
    return validateRecord(JSON.parse(raw) as DurableWorkerStoreRecord)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('WORKER_STORE_')) throw error
    throw new Error('WORKER_STORE_RECORD_CORRUPT')
  }
}

function bindRecord(record: DurableWorkerStoreRecord, input: DurableWorkerStoreReserveInput | DurableWorkerStoreCompleteInput): void {
  if (record.bundleId !== input.bundleId || record.tenantId !== input.tenantId || record.bodyDigest !== input.bodyDigest) {
    throw new Error('WORKER_STORE_BUNDLE_CONFLICT')
  }
  if (record.leaseExpiresAt !== iso(input.leaseExpiresAt, 'WORKER_STORE_LEASE_TIME_INVALID')) {
    throw new Error('WORKER_STORE_LEASE_CONFLICT')
  }
}

async function cleanupExpired(root: string, nowMs: number): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  const records = entries.filter((entry) => entry.isFile() && RECORD_FILE.test(entry.name))
  if (records.length > WORKER_DURABLE_STORE_MAX_RECORDS) throw new Error('WORKER_STORE_RECORD_COUNT_LIMIT')
  for (const entry of records) {
    const path = `${root}/${entry.name}`
    const record = await readRecord(path)
    if (Date.parse(record.leaseExpiresAt) <= nowMs) await rm(path, { force: true })
  }
}

export async function createFilesystemWorkerExecutionStore(rootRaw: string): Promise<DurableWorkerExecutionStore> {
  const root = await ensurePrivateDirectory(rootRaw)

  return {
    async reserve(rawInput: DurableWorkerStoreReserveInput): Promise<DurableWorkerStoreReserveResult> {
      const nowMs = rawInput.nowMs
      if (!Number.isFinite(nowMs)) throw new Error('WORKER_STORE_TIME_INVALID')
      const input: DurableWorkerStoreReserveInput = {
        bundleId: boundedIdentifier(rawInput.bundleId, 140, 'WORKER_STORE_BUNDLE_ID_INVALID'),
        tenantId: boundedIdentifier(rawInput.tenantId, 80, 'WORKER_STORE_TENANT_INVALID'),
        bodyDigest: validateDigest(rawInput.bodyDigest),
        leaseExpiresAt: iso(rawInput.leaseExpiresAt, 'WORKER_STORE_LEASE_TIME_INVALID'),
        nowMs,
      }
      if (Date.parse(input.leaseExpiresAt) <= nowMs) throw new Error('WORKER_STORE_LEASE_EXPIRED')
      await cleanupExpired(root, nowMs)

      const path = `${root}/${stableRecordName(input.bundleId)}`
      const record = validateRecord({
        schemaVersion: WORKER_DURABLE_STORE_SCHEMA,
        bundleId: input.bundleId,
        tenantId: input.tenantId,
        bodyDigest: input.bodyDigest,
        leaseExpiresAt: input.leaseExpiresAt,
        status: 'reserved',
        reservedAt: new Date(nowMs).toISOString(),
      })
      const content = JSON.stringify(record)

      try {
        await writeExclusive(path, content)
        await syncDirectory(root)
        return { state: 'reserved-new' }
      } catch (error) {
        const code = error as NodeJS.ErrnoException
        if (code.code !== 'EEXIST') throw error
      }

      const existing = await readRecord(path)
      bindRecord(existing, input)
      if (existing.status === 'completed' && existing.receiptBody) {
        return { state: 'completed', receiptBody: existing.receiptBody }
      }
      return { state: 'reserved-existing' }
    },

    async complete(rawInput: DurableWorkerStoreCompleteInput): Promise<void> {
      const nowMs = rawInput.nowMs
      if (!Number.isFinite(nowMs)) throw new Error('WORKER_STORE_TIME_INVALID')
      const input: DurableWorkerStoreCompleteInput = {
        bundleId: boundedIdentifier(rawInput.bundleId, 140, 'WORKER_STORE_BUNDLE_ID_INVALID'),
        tenantId: boundedIdentifier(rawInput.tenantId, 80, 'WORKER_STORE_TENANT_INVALID'),
        bodyDigest: validateDigest(rawInput.bodyDigest),
        leaseExpiresAt: iso(rawInput.leaseExpiresAt, 'WORKER_STORE_LEASE_TIME_INVALID'),
        receiptBody: rawInput.receiptBody,
        nowMs,
      }
      if (!input.receiptBody || input.receiptBody.length > WORKER_DURABLE_STORE_MAX_RECORD_CHARS) throw new Error('WORKER_STORE_RECEIPT_LIMIT')
      if (Date.parse(input.leaseExpiresAt) < nowMs) throw new Error('WORKER_STORE_LEASE_EXPIRED')
      const path = `${root}/${stableRecordName(input.bundleId)}`
      const existing = await readRecord(path)
      bindRecord(existing, input)
      if (existing.status === 'completed') {
        if (existing.receiptBody !== input.receiptBody) throw new Error('WORKER_STORE_RECEIPT_CONFLICT')
        return
      }
      const completed = validateRecord({
        ...existing,
        status: 'completed',
        completedAt: new Date(nowMs).toISOString(),
        receiptBody: input.receiptBody,
      })
      await atomicReplace(root, path, JSON.stringify(completed))
    },
  }
}