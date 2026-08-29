import {
  verifyCommunityCatalogPackage,
  type CommunityCatalogPackage,
  type VerifiedCommunityCatalog,
} from './communityCatalog'

export type PublisherTrustStatus = 'trusted' | 'untrusted' | 'key-changed'

export interface TrustedPublisherRecord {
  schemaVersion: '0.1'
  publisherId: string
  displayName: string
  fingerprint: string
  publicKey: string
  trustedAt: string
  source: 'human-pinned'
}

export interface VerifiedPublisherIdentity {
  signatureVerified: true
  publisher: {
    id: string
    displayName: string
    publicKey: string
    keyFingerprint: string
  }
}

export interface VerifiedPublisherTrustResult {
  verified: VerifiedPublisherIdentity
  status: PublisherTrustStatus
  trustedRecord: TrustedPublisherRecord | null
}

export interface PublisherTrustResult {
  verified: VerifiedCommunityCatalog
  status: PublisherTrustStatus
  trustedRecord: TrustedPublisherRecord | null
}

const TRUST_KEY = 'agent-ia-factory.publisher-trust.v1'
const MAX_TRUSTED_PUBLISHERS = 32
const FINGERPRINT = /^[A-Za-z0-9_-]{43}$/u
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/u
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/u

function now(): string { return new Date().toISOString() }

function validateRecord(raw: TrustedPublisherRecord): TrustedPublisherRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const keys = Object.keys(raw).sort()
  const expected = ['schemaVersion', 'publisherId', 'displayName', 'fingerprint', 'publicKey', 'trustedAt', 'source'].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null
  if (raw.schemaVersion !== '0.1' || raw.source !== 'human-pinned') return null
  if (!SAFE_ID.test(raw.publisherId) || !raw.displayName.trim() || raw.displayName.length > 120) return null
  if (!FINGERPRINT.test(raw.fingerprint) || !PUBLIC_KEY.test(raw.publicKey)) return null
  const parsed = Date.parse(raw.trustedAt)
  if (!Number.isFinite(parsed)) return null
  return {
    schemaVersion: '0.1',
    publisherId: raw.publisherId,
    displayName: raw.displayName.trim(),
    fingerprint: raw.fingerprint,
    publicKey: raw.publicKey,
    trustedAt: new Date(parsed).toISOString(),
    source: 'human-pinned',
  }
}

function validateVerifiedIdentity(subject: VerifiedPublisherIdentity): VerifiedPublisherIdentity {
  if (!subject || subject.signatureVerified !== true || !subject.publisher) throw new Error('PUBLISHER_IDENTITY_VERIFICATION_REQUIRED')
  const publisher = subject.publisher
  if (!SAFE_ID.test(publisher.id)) throw new Error('PUBLISHER_TRUST_ID_INVALID')
  if (!publisher.displayName.trim() || publisher.displayName.length > 120) throw new Error('PUBLISHER_TRUST_NAME_INVALID')
  if (!FINGERPRINT.test(publisher.keyFingerprint) || !PUBLIC_KEY.test(publisher.publicKey)) throw new Error('PUBLISHER_TRUST_KEY_INVALID')
  return {
    signatureVerified: true,
    publisher: {
      id: publisher.id,
      displayName: publisher.displayName.trim(),
      publicKey: publisher.publicKey,
      keyFingerprint: publisher.keyFingerprint,
    },
  }
}

function readTrustedPublishers(): TrustedPublisherRecord[] {
  try {
    const raw = localStorage.getItem(TRUST_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    const records = parsed.map((item) => validateRecord(item as TrustedPublisherRecord)).filter(Boolean) as TrustedPublisherRecord[]
    const unique = new Map<string, TrustedPublisherRecord>()
    for (const record of records) {
      if (!unique.has(record.publisherId)) unique.set(record.publisherId, record)
    }
    return [...unique.values()].slice(0, MAX_TRUSTED_PUBLISHERS)
  } catch {
    return []
  }
}

function writeTrustedPublishers(records: TrustedPublisherRecord[]): void {
  localStorage.setItem(TRUST_KEY, JSON.stringify(records.slice(0, MAX_TRUSTED_PUBLISHERS)))
}

export function loadTrustedPublishers(): TrustedPublisherRecord[] {
  return readTrustedPublishers()
}

function statusForIdentity(subject: VerifiedPublisherIdentity): VerifiedPublisherTrustResult {
  const verified = validateVerifiedIdentity(subject)
  const publisher = verified.publisher
  const existing = readTrustedPublishers().find((record) => record.publisherId === publisher.id) ?? null
  if (!existing) return { verified, status: 'untrusted', trustedRecord: null }
  if (existing.fingerprint === publisher.keyFingerprint && existing.publicKey === publisher.publicKey) {
    return { verified, status: 'trusted', trustedRecord: existing }
  }
  return { verified, status: 'key-changed', trustedRecord: existing }
}

export function getVerifiedPublisherIdentityTrustStatus(subject: VerifiedPublisherIdentity): VerifiedPublisherTrustResult {
  return statusForIdentity(subject)
}

export function pinVerifiedPublisherIdentityTrust(
  subject: VerifiedPublisherIdentity,
  approvedByHuman: boolean,
  replaceExistingKey = false,
): VerifiedPublisherTrustResult {
  if (!approvedByHuman) throw new Error('PUBLISHER_TRUST_HUMAN_APPROVAL_REQUIRED')
  const current = statusForIdentity(subject)
  if (current.status === 'key-changed' && !replaceExistingKey) {
    throw new Error('PUBLISHER_KEY_CHANGE_REQUIRES_EXPLICIT_REPLACE')
  }
  const publisher = current.verified.publisher
  const record: TrustedPublisherRecord = {
    schemaVersion: '0.1',
    publisherId: publisher.id,
    displayName: publisher.displayName,
    fingerprint: publisher.keyFingerprint,
    publicKey: publisher.publicKey,
    trustedAt: now(),
    source: 'human-pinned',
  }
  const next = [record, ...readTrustedPublishers().filter((item) => item.publisherId !== publisher.id)].slice(0, MAX_TRUSTED_PUBLISHERS)
  writeTrustedPublishers(next)
  return { verified: current.verified, status: 'trusted', trustedRecord: record }
}

function catalogIdentity(verified: VerifiedCommunityCatalog): VerifiedPublisherIdentity {
  return {
    signatureVerified: true,
    publisher: {
      id: verified.package.publisher.id,
      displayName: verified.package.publisher.displayName,
      publicKey: verified.package.publisher.publicKey,
      keyFingerprint: verified.package.publisher.keyFingerprint,
    },
  }
}

export async function getCatalogPublisherTrustStatus(pkg: CommunityCatalogPackage): Promise<PublisherTrustResult> {
  const verified = await verifyCommunityCatalogPackage(pkg)
  const result = statusForIdentity(catalogIdentity(verified))
  return { verified, status: result.status, trustedRecord: result.trustedRecord }
}

export async function pinCatalogPublisherTrust(
  pkg: CommunityCatalogPackage,
  approvedByHuman: boolean,
  replaceExistingKey = false,
): Promise<PublisherTrustResult> {
  const verified = await verifyCommunityCatalogPackage(pkg)
  const result = pinVerifiedPublisherIdentityTrust(catalogIdentity(verified), approvedByHuman, replaceExistingKey)
  return { verified, status: result.status, trustedRecord: result.trustedRecord }
}

export function revokePublisherTrust(publisherId: string, approvedByHuman: boolean): TrustedPublisherRecord[] {
  if (!approvedByHuman) throw new Error('PUBLISHER_TRUST_REVOKE_APPROVAL_REQUIRED')
  if (!SAFE_ID.test(publisherId)) throw new Error('PUBLISHER_TRUST_ID_INVALID')
  const next = readTrustedPublishers().filter((record) => record.publisherId !== publisherId)
  writeTrustedPublishers(next)
  return next
}
