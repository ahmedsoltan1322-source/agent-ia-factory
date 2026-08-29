export const BROWSER_UPLOAD_SCHEMA_VERSION = '0.1' as const
export const MAX_UPLOAD_FILE_BYTES = 32_000
export const MAX_UPLOAD_CAPSULE_CHARS = 60_000
export const UPLOAD_CAPSULE_TTL_MS = 10 * 60_000

const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u
const SAFE_EXTENSIONS = new Set(['.txt', '.csv', '.json'])
const SAFE_MEDIA_TYPES = new Set(['text/plain', 'text/csv', 'application/json'])
const SECRET_LIKE = /-----BEGIN .*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bBearer\s+[A-Za-z0-9._~-]{20,}|\b(?:api[_-]?key|secret|password|passwd|token|credential)\s*[:=]\s*[^\s,;]{8,}/iu
const PAYMENT_OR_ID = /\b(?:\d[ -]*?){13,19}\b|\b(?:iban|swift|routing|account number|credit card|cvv|cvc|ssn|social security)\b/iu
const PERSONAL_CONTACT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?\d[\s().-]*){8,}/iu

export interface BrowserUploadCapsule {
  schemaVersion: typeof BROWSER_UPLOAD_SCHEMA_VERSION
  id: string
  createdAt: string
  expiresAt: string
  fileName: string
  mediaType: 'text/plain' | 'text/csv' | 'application/json'
  sizeBytes: number
  sha256: string
  utf8Text: string
  policy: {
    publicNonSensitiveContentOnly: true
    maxFileBytes: 32_000
    executableContentAllowed: false
    secretsAllowed: false
    personalContactAllowed: false
    paymentOrIdentityDataAllowed: false
    monetaryCostUsd: 0
  }
}

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/gu, '')
}

function extension(name: string): string {
  const index = name.lastIndexOf('.')
  return index < 0 ? '' : name.slice(index).toLowerCase()
}

function assertSafeText(text: string): void {
  if (SECRET_LIKE.test(text)) throw new Error('BROWSER_UPLOAD_SECRET_LIKE_CONTENT_FORBIDDEN')
  if (PAYMENT_OR_ID.test(text)) throw new Error('BROWSER_UPLOAD_PAYMENT_OR_IDENTITY_CONTENT_FORBIDDEN')
  if (PERSONAL_CONTACT.test(text)) throw new Error('BROWSER_UPLOAD_PERSONAL_CONTACT_CONTENT_FORBIDDEN')
  if (/\u0000/u.test(text)) throw new Error('BROWSER_UPLOAD_BINARY_CONTENT_FORBIDDEN')
}

export async function createBrowserUploadCapsule(file: File, nowMs = Date.now()): Promise<BrowserUploadCapsule> {
  if (!(file instanceof File)) throw new Error('BROWSER_UPLOAD_FILE_REQUIRED')
  if (!Number.isFinite(nowMs)) throw new Error('BROWSER_UPLOAD_TIME_INVALID')
  const fileName = file.name.trim()
  if (!SAFE_FILE_NAME.test(fileName) || fileName.includes('..')) throw new Error('BROWSER_UPLOAD_FILE_NAME_FORBIDDEN')
  if (!SAFE_EXTENSIONS.has(extension(fileName))) throw new Error('BROWSER_UPLOAD_EXTENSION_FORBIDDEN')
  if (!SAFE_MEDIA_TYPES.has(file.type)) throw new Error('BROWSER_UPLOAD_MEDIA_TYPE_FORBIDDEN')
  if (file.size < 1 || file.size > MAX_UPLOAD_FILE_BYTES) throw new Error('BROWSER_UPLOAD_SIZE_FORBIDDEN')

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength !== file.size) throw new Error('BROWSER_UPLOAD_SIZE_MISMATCH')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('BROWSER_UPLOAD_UTF8_REQUIRED')
  }
  assertSafeText(text)
  if (file.type === 'application/json') {
    try { JSON.parse(text) } catch { throw new Error('BROWSER_UPLOAD_JSON_INVALID') }
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const capsule: BrowserUploadCapsule = {
    schemaVersion: BROWSER_UPLOAD_SCHEMA_VERSION,
    id: id('browser-upload'),
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + UPLOAD_CAPSULE_TTL_MS).toISOString(),
    fileName,
    mediaType: file.type as BrowserUploadCapsule['mediaType'],
    sizeBytes: bytes.byteLength,
    sha256: base64Url(new Uint8Array(digest)),
    utf8Text: text,
    policy: {
      publicNonSensitiveContentOnly: true,
      maxFileBytes: MAX_UPLOAD_FILE_BYTES,
      executableContentAllowed: false,
      secretsAllowed: false,
      personalContactAllowed: false,
      paymentOrIdentityDataAllowed: false,
      monetaryCostUsd: 0,
    },
  }
  return validateBrowserUploadCapsule(capsule, nowMs)
}

export function validateBrowserUploadCapsule(raw: BrowserUploadCapsule, nowMs = Date.now()): BrowserUploadCapsule {
  if (!raw || raw.schemaVersion !== BROWSER_UPLOAD_SCHEMA_VERSION) throw new Error('BROWSER_UPLOAD_SCHEMA_UNSUPPORTED')
  const expected = ['schemaVersion','id','createdAt','expiresAt','fileName','mediaType','sizeBytes','sha256','utf8Text','policy'].sort()
  const keys = Object.keys(raw).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error('BROWSER_UPLOAD_HIDDEN_FIELD_FORBIDDEN')
  if (!/^[A-Za-z0-9._:-]{1,100}$/u.test(raw.id)) throw new Error('BROWSER_UPLOAD_ID_INVALID')
  if (!SAFE_FILE_NAME.test(raw.fileName) || !SAFE_EXTENSIONS.has(extension(raw.fileName))) throw new Error('BROWSER_UPLOAD_FILE_NAME_FORBIDDEN')
  if (!SAFE_MEDIA_TYPES.has(raw.mediaType)) throw new Error('BROWSER_UPLOAD_MEDIA_TYPE_FORBIDDEN')
  if (!Number.isInteger(raw.sizeBytes) || raw.sizeBytes < 1 || raw.sizeBytes > MAX_UPLOAD_FILE_BYTES) throw new Error('BROWSER_UPLOAD_SIZE_FORBIDDEN')
  if (!/^[A-Za-z0-9_-]{43}$/u.test(raw.sha256)) throw new Error('BROWSER_UPLOAD_DIGEST_INVALID')
  if (new TextEncoder().encode(raw.utf8Text).byteLength !== raw.sizeBytes) throw new Error('BROWSER_UPLOAD_SIZE_MISMATCH')
  assertSafeText(raw.utf8Text)
  if (raw.mediaType === 'application/json') { try { JSON.parse(raw.utf8Text) } catch { throw new Error('BROWSER_UPLOAD_JSON_INVALID') } }
  const created = Date.parse(raw.createdAt); const expires = Date.parse(raw.expiresAt)
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires - created !== UPLOAD_CAPSULE_TTL_MS) throw new Error('BROWSER_UPLOAD_EXPIRY_INVALID')
  if (!Number.isFinite(nowMs) || nowMs < created - 5_000 || nowMs >= expires) throw new Error('BROWSER_UPLOAD_EXPIRED')
  const p = raw.policy
  if (!p || p.publicNonSensitiveContentOnly !== true || p.maxFileBytes !== MAX_UPLOAD_FILE_BYTES || p.executableContentAllowed !== false || p.secretsAllowed !== false || p.personalContactAllowed !== false || p.paymentOrIdentityDataAllowed !== false || p.monetaryCostUsd !== 0) throw new Error('BROWSER_UPLOAD_POLICY_INVALID')
  if (JSON.stringify(raw).length > MAX_UPLOAD_CAPSULE_CHARS) throw new Error('BROWSER_UPLOAD_CAPSULE_TOO_LARGE')
  return { ...raw, policy: { ...raw.policy } }
}
