import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { validateBrowserUploadCapsule, type BrowserUploadCapsule } from './browserUploadCapsule.ts'

export const UPLOAD_STAGE_STORE_SCHEMA_VERSION = '0.1' as const
export const MAX_STAGED_UPLOADS = 32

export interface BrowserUploadStageReceipt {
  schemaVersion: '0.1'
  stageId: string
  capsuleId: string
  fileName: string
  mediaType: string
  sizeBytes: number
  sha256: string
  stagedAt: string
  expiresAt: string
  monetaryCostUsd: 0
}

interface StageRecord extends BrowserUploadStageReceipt {
  storeSchemaVersion: typeof UPLOAD_STAGE_STORE_SCHEMA_VERSION
}

export interface BrowserUploadStageStore {
  stage(capsule: BrowserUploadCapsule, nowMs?: number): Promise<BrowserUploadStageReceipt>
  remove(stageId: string): Promise<boolean>
  resolvePath(stageId: string, nowMs?: number): Promise<{ path: string; receipt: BrowserUploadStageReceipt }>
}

function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
function digestText(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('base64url')
}
function stageIdFor(capsule: BrowserUploadCapsule): string {
  return `stage-${sha(`${capsule.id}\n${capsule.sha256}`).slice(0, 32)}`
}
function validateStageId(stageId: string): string {
  if (!/^stage-[a-f0-9]{32}$/u.test(stageId)) throw new Error('UPLOAD_STAGE_ID_INVALID')
  return stageId
}
function publicReceipt(record: StageRecord): BrowserUploadStageReceipt {
  const { storeSchemaVersion: _ignored, ...receipt } = record
  return receipt
}

export async function createFilesystemBrowserUploadStageStore(rootRaw: string): Promise<BrowserUploadStageStore> {
  const root = path.resolve(rootRaw.trim())
  if (!rootRaw.trim()) throw new Error('UPLOAD_STAGE_ROOT_REQUIRED')
  await mkdir(root, { recursive: true, mode: 0o700 })

  async function cleanup(nowMs: number): Promise<void> {
    const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).slice(0, MAX_STAGED_UPLOADS * 4)
    for (const entry of entries) {
      try {
        const raw = JSON.parse(await readFile(path.join(root, entry.name), 'utf8')) as StageRecord
        if (Date.parse(raw.expiresAt) <= nowMs) {
          const id = validateStageId(raw.stageId)
          await rm(path.join(root, `${sha(id)}.data`), { force: true })
          await rm(path.join(root, `${sha(id)}.json`), { force: true })
        }
      } catch {
        // Corrupt metadata is not trusted; do not guess a data-file mapping from its contents.
      }
    }
  }

  function paths(stageId: string): { data: string; meta: string } {
    const id = validateStageId(stageId)
    const key = sha(id)
    return { data: path.join(root, `${key}.data`), meta: path.join(root, `${key}.json`) }
  }

  async function readRecord(stageId: string): Promise<StageRecord | null> {
    const p = paths(stageId)
    try {
      const record = JSON.parse(await readFile(p.meta, 'utf8')) as StageRecord
      if (record.storeSchemaVersion !== UPLOAD_STAGE_STORE_SCHEMA_VERSION || record.stageId !== stageId || record.monetaryCostUsd !== 0) throw new Error('UPLOAD_STAGE_RECORD_CORRUPT')
      if (!/^[A-Za-z0-9_-]{43}$/u.test(record.sha256) || !Number.isInteger(record.sizeBytes) || record.sizeBytes < 1) throw new Error('UPLOAD_STAGE_RECORD_CORRUPT')
      return record
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  return {
    async stage(rawCapsule, nowMs = Date.now()) {
      if (!Number.isFinite(nowMs)) throw new Error('UPLOAD_STAGE_TIME_INVALID')
      await cleanup(nowMs)
      const capsule = validateBrowserUploadCapsule(rawCapsule, nowMs)
      if (digestText(capsule.utf8Text) !== capsule.sha256) throw new Error('UPLOAD_STAGE_DIGEST_MISMATCH')
      const stageId = stageIdFor(capsule)
      const p = paths(stageId)
      const existing = await readRecord(stageId)
      if (existing) {
        if (existing.capsuleId !== capsule.id || existing.sha256 !== capsule.sha256 || existing.fileName !== capsule.fileName || existing.sizeBytes !== capsule.sizeBytes) throw new Error('UPLOAD_STAGE_IDEMPOTENCY_CONFLICT')
        if (Date.parse(existing.expiresAt) <= nowMs) throw new Error('UPLOAD_STAGE_EXPIRED')
        const data = await readFile(p.data, 'utf8')
        if (digestText(data) !== existing.sha256) throw new Error('UPLOAD_STAGE_DATA_CORRUPT')
        return publicReceipt(existing)
      }

      const records = (await readdir(root)).filter((name) => name.endsWith('.json'))
      if (records.length >= MAX_STAGED_UPLOADS) throw new Error('UPLOAD_STAGE_CAPACITY_REACHED')
      const record: StageRecord = {
        storeSchemaVersion: UPLOAD_STAGE_STORE_SCHEMA_VERSION,
        schemaVersion: '0.1',
        stageId,
        capsuleId: capsule.id,
        fileName: capsule.fileName,
        mediaType: capsule.mediaType,
        sizeBytes: capsule.sizeBytes,
        sha256: capsule.sha256,
        stagedAt: new Date(nowMs).toISOString(),
        expiresAt: capsule.expiresAt,
        monetaryCostUsd: 0,
      }
      const dataHandle = await open(p.data, 'wx', 0o600)
      try {
        await dataHandle.writeFile(capsule.utf8Text, 'utf8')
        await dataHandle.sync()
      } finally { await dataHandle.close() }
      try {
        await writeFile(p.meta, JSON.stringify(record), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      } catch (error) {
        await rm(p.data, { force: true })
        throw error
      }
      return publicReceipt(record)
    },

    async remove(stageId) {
      const p = paths(stageId)
      const exists = await readRecord(stageId)
      await rm(p.data, { force: true })
      await rm(p.meta, { force: true })
      return Boolean(exists)
    },

    async resolvePath(stageId, nowMs = Date.now()) {
      if (!Number.isFinite(nowMs)) throw new Error('UPLOAD_STAGE_TIME_INVALID')
      await cleanup(nowMs)
      const p = paths(stageId)
      const record = await readRecord(stageId)
      if (!record) throw new Error('UPLOAD_STAGE_NOT_FOUND')
      if (Date.parse(record.expiresAt) <= nowMs) throw new Error('UPLOAD_STAGE_EXPIRED')
      const data = await readFile(p.data, 'utf8')
      if (digestText(data) !== record.sha256 || Buffer.byteLength(data, 'utf8') !== record.sizeBytes) throw new Error('UPLOAD_STAGE_DATA_CORRUPT')
      return { path: p.data, receipt: publicReceipt(record) }
    },
  }
}
