import { validateTenantId } from './deploymentEngine.ts'
import { createWorkerTransportNonce, validateWorkerTransportSecret } from './workerAuth.ts'

export const UPLOAD_STAGE_PROTOCOL = 'agent-ia-factory.upload-stage/0.1' as const
export const UPLOAD_STAGE_PATH = '/v1/browser-upload-stage' as const
export const UPLOAD_DELETE_PATH = '/v1/browser-upload-delete' as const
export const UPLOAD_AUTH_MAX_SKEW_SECONDS = 90

const UTF8 = new TextEncoder()
const BASE64URL = /^[A-Za-z0-9_-]+$/u

export interface SignedUploadRequestHeaders {
  'x-agent-ia-upload-protocol': typeof UPLOAD_STAGE_PROTOCOL
  'x-agent-ia-tenant': string
  'x-agent-ia-timestamp': string
  'x-agent-ia-nonce': string
  'x-agent-ia-content-sha256': string
  'x-agent-ia-signature': string
}

export interface SignedUploadResponseHeaders {
  'x-agent-ia-upload-protocol': typeof UPLOAD_STAGE_PROTOCOL
  'x-agent-ia-tenant': string
  'x-agent-ia-timestamp': string
  'x-agent-ia-request-nonce': string
  'x-agent-ia-content-sha256': string
  'x-agent-ia-signature': string
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/gu, '')
}

function base64UrlBytes(value: string, code: string): Uint8Array<ArrayBuffer> {
  const clean = value.trim()
  if (!clean || !BASE64URL.test(clean)) throw new Error(code)
  const padded = clean.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - clean.length % 4) % 4)
  let binary: string
  try { binary = atob(padded) } catch { throw new Error(code) }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function digest(body: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', UTF8.encode(body))))
}

async function key(secret: string): Promise<CryptoKey> {
  const validated = validateWorkerTransportSecret(secret)
  const bytes = base64UrlBytes(validated, 'UPLOAD_AUTH_SECRET_INVALID')
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

function requestCanonical(method: 'POST', path: string, tenant: string, timestamp: string, nonce: string, bodyDigest: string): string {
  return [UPLOAD_STAGE_PROTOCOL, 'REQUEST', method, path, tenant, timestamp, nonce, bodyDigest].join('\n')
}
function responseCanonical(path: string, status: number, tenant: string, timestamp: string, nonce: string, bodyDigest: string): string {
  return [UPLOAD_STAGE_PROTOCOL, 'RESPONSE', String(status), path, tenant, timestamp, nonce, bodyDigest].join('\n')
}

function validatePath(path: string): typeof UPLOAD_STAGE_PATH | typeof UPLOAD_DELETE_PATH {
  if (path !== UPLOAD_STAGE_PATH && path !== UPLOAD_DELETE_PATH) throw new Error('UPLOAD_AUTH_ROUTE_INVALID')
  return path
}

function validateTimestamp(raw: string, nowMs: number): string {
  if (!/^\d{10}$/u.test(raw)) throw new Error('UPLOAD_AUTH_TIMESTAMP_INVALID')
  const seconds = Number(raw)
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(nowMs / 1000) - seconds) > UPLOAD_AUTH_MAX_SKEW_SECONDS) throw new Error('UPLOAD_AUTH_TIMESTAMP_STALE')
  return raw
}

async function signature(secret: string, canonical: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), UTF8.encode(canonical))))
}
async function verifySignature(secret: string, canonical: string, raw: string): Promise<boolean> {
  const bytes = base64UrlBytes(raw, 'UPLOAD_AUTH_SIGNATURE_INVALID')
  if (bytes.byteLength !== 32) throw new Error('UPLOAD_AUTH_SIGNATURE_INVALID')
  return crypto.subtle.verify('HMAC', await key(secret), bytes, UTF8.encode(canonical))
}

export async function createSignedUploadRequest(secretRaw: string, tenantRaw: string, pathRaw: string, body: string, options: { nowMs?: number; nonce?: string } = {}): Promise<SignedUploadRequestHeaders> {
  const secret = validateWorkerTransportSecret(secretRaw)
  const tenant = validateTenantId(tenantRaw)
  const path = validatePath(pathRaw)
  const nowMs = options.nowMs ?? Date.now()
  if (!Number.isFinite(nowMs)) throw new Error('UPLOAD_AUTH_TIME_INVALID')
  const timestamp = String(Math.floor(nowMs / 1000))
  const nonce = options.nonce ?? createWorkerTransportNonce()
  if (!/^[A-Za-z0-9_-]{20,40}$/u.test(nonce)) throw new Error('UPLOAD_AUTH_NONCE_INVALID')
  const bodyDigest = await digest(body)
  return {
    'x-agent-ia-upload-protocol': UPLOAD_STAGE_PROTOCOL,
    'x-agent-ia-tenant': tenant,
    'x-agent-ia-timestamp': timestamp,
    'x-agent-ia-nonce': nonce,
    'x-agent-ia-content-sha256': bodyDigest,
    'x-agent-ia-signature': await signature(secret, requestCanonical('POST', path, tenant, timestamp, nonce, bodyDigest)),
  }
}

export async function verifySignedUploadRequest(secretRaw: string, expectedTenantRaw: string, pathRaw: string, headers: SignedUploadRequestHeaders, body: string, nowMs = Date.now()): Promise<{ tenantId: string; nonce: string; bodyDigest: string }> {
  const secret = validateWorkerTransportSecret(secretRaw)
  const tenant = validateTenantId(headers['x-agent-ia-tenant'])
  const expectedTenant = validateTenantId(expectedTenantRaw)
  const path = validatePath(pathRaw)
  if (headers['x-agent-ia-upload-protocol'] !== UPLOAD_STAGE_PROTOCOL || tenant !== expectedTenant) throw new Error('UPLOAD_AUTH_PROTOCOL_OR_TENANT_MISMATCH')
  const timestamp = validateTimestamp(headers['x-agent-ia-timestamp'], nowMs)
  const nonce = headers['x-agent-ia-nonce']
  if (!/^[A-Za-z0-9_-]{20,40}$/u.test(nonce)) throw new Error('UPLOAD_AUTH_NONCE_INVALID')
  const bodyDigest = await digest(body)
  if (bodyDigest !== headers['x-agent-ia-content-sha256']) throw new Error('UPLOAD_AUTH_BODY_DIGEST_MISMATCH')
  const valid = await verifySignature(secret, requestCanonical('POST', path, tenant, timestamp, nonce, bodyDigest), headers['x-agent-ia-signature'])
  if (!valid) throw new Error('UPLOAD_AUTH_SIGNATURE_MISMATCH')
  return { tenantId: tenant, nonce, bodyDigest }
}

export async function createSignedUploadResponse(secretRaw: string, tenantRaw: string, pathRaw: string, requestNonce: string, status: number, body: string, nowMs = Date.now()): Promise<SignedUploadResponseHeaders> {
  const secret = validateWorkerTransportSecret(secretRaw)
  const tenant = validateTenantId(tenantRaw)
  const path = validatePath(pathRaw)
  if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error('UPLOAD_AUTH_RESPONSE_STATUS_INVALID')
  const timestamp = String(Math.floor(nowMs / 1000))
  const bodyDigest = await digest(body)
  return {
    'x-agent-ia-upload-protocol': UPLOAD_STAGE_PROTOCOL,
    'x-agent-ia-tenant': tenant,
    'x-agent-ia-timestamp': timestamp,
    'x-agent-ia-request-nonce': requestNonce,
    'x-agent-ia-content-sha256': bodyDigest,
    'x-agent-ia-signature': await signature(secret, responseCanonical(path, status, tenant, timestamp, requestNonce, bodyDigest)),
  }
}

export async function verifySignedUploadResponse(secretRaw: string, expectedTenantRaw: string, pathRaw: string, requestNonce: string, status: number, headers: SignedUploadResponseHeaders, body: string, nowMs = Date.now()): Promise<void> {
  const secret = validateWorkerTransportSecret(secretRaw)
  const tenant = validateTenantId(headers['x-agent-ia-tenant'])
  const expectedTenant = validateTenantId(expectedTenantRaw)
  const path = validatePath(pathRaw)
  if (headers['x-agent-ia-upload-protocol'] !== UPLOAD_STAGE_PROTOCOL || tenant !== expectedTenant || headers['x-agent-ia-request-nonce'] !== requestNonce) throw new Error('UPLOAD_AUTH_RESPONSE_BINDING_MISMATCH')
  const timestamp = validateTimestamp(headers['x-agent-ia-timestamp'], nowMs)
  const bodyDigest = await digest(body)
  if (bodyDigest !== headers['x-agent-ia-content-sha256']) throw new Error('UPLOAD_AUTH_RESPONSE_DIGEST_MISMATCH')
  const valid = await verifySignature(secret, responseCanonical(path, status, tenant, timestamp, requestNonce, bodyDigest), headers['x-agent-ia-signature'])
  if (!valid) throw new Error('UPLOAD_AUTH_RESPONSE_SIGNATURE_MISMATCH')
}
