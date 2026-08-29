import { validateTenantId } from './deploymentEngine.ts'

export const WORKER_TRANSPORT_PROTOCOL = 'agent-ia-factory.transport/0.1' as const
export const WORKER_EXECUTE_PATH = '/v1/execute' as const
export const WORKER_AUTH_MAX_SKEW_SECONDS = 90
export const WORKER_AUTH_SECRET_BYTES = 32
export const WORKER_AUTH_NONCE_BYTES = 16

const BASE64URL = /^[A-Za-z0-9_-]+$/u
const UTF8 = new TextEncoder()

export interface SignedWorkerRequestHeaders {
  'x-agent-ia-protocol': typeof WORKER_TRANSPORT_PROTOCOL
  'x-agent-ia-tenant': string
  'x-agent-ia-timestamp': string
  'x-agent-ia-nonce': string
  'x-agent-ia-content-sha256': string
  'x-agent-ia-signature': string
}

export interface SignedWorkerResponseHeaders {
  'x-agent-ia-protocol': typeof WORKER_TRANSPORT_PROTOCOL
  'x-agent-ia-tenant': string
  'x-agent-ia-timestamp': string
  'x-agent-ia-request-nonce': string
  'x-agent-ia-content-sha256': string
  'x-agent-ia-signature': string
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string, code: string): Uint8Array<ArrayBuffer> {
  const clean = value.trim()
  if (!clean || !BASE64URL.test(clean)) throw new Error(code)
  const padding = '='.repeat((4 - (clean.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(clean.replace(/-/g, '+').replace(/_/g, '/') + padding)
  } catch {
    throw new Error(code)
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function validateWorkerTransportSecret(secret: string): string {
  const clean = secret.trim()
  const bytes = base64UrlToBytes(clean, 'WORKER_AUTH_SECRET_INVALID')
  if (bytes.length !== WORKER_AUTH_SECRET_BYTES) throw new Error('WORKER_AUTH_SECRET_INVALID')
  if (clean.length > 80) throw new Error('WORKER_AUTH_SECRET_INVALID')
  return clean
}

export function createWorkerTransportNonce(): string {
  const bytes = new Uint8Array(WORKER_AUTH_NONCE_BYTES)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

function validateNonce(nonce: string): string {
  const clean = nonce.trim()
  const bytes = base64UrlToBytes(clean, 'WORKER_AUTH_NONCE_INVALID')
  if (bytes.length !== WORKER_AUTH_NONCE_BYTES || clean.length > 40) throw new Error('WORKER_AUTH_NONCE_INVALID')
  return clean
}

function validateTimestamp(raw: string, nowMs: number): string {
  if (!/^\d{10}$/u.test(raw)) throw new Error('WORKER_AUTH_TIMESTAMP_INVALID')
  const seconds = Number(raw)
  if (!Number.isSafeInteger(seconds)) throw new Error('WORKER_AUTH_TIMESTAMP_INVALID')
  const nowSeconds = Math.floor(nowMs / 1000)
  if (Math.abs(nowSeconds - seconds) > WORKER_AUTH_MAX_SKEW_SECONDS) throw new Error('WORKER_AUTH_TIMESTAMP_STALE')
  return raw
}

async function sha256Base64Url(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', UTF8.encode(body))
  return bytesToBase64Url(new Uint8Array(digest))
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const bytes = base64UrlToBytes(validateWorkerTransportSecret(secret), 'WORKER_AUTH_SECRET_INVALID')
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

function requestCanonical(
  method: string,
  path: string,
  tenantId: string,
  timestamp: string,
  nonce: string,
  digest: string,
): string {
  return [WORKER_TRANSPORT_PROTOCOL, 'REQUEST', method, path, tenantId, timestamp, nonce, digest].join('\n')
}

function responseCanonical(
  path: string,
  status: number,
  tenantId: string,
  timestamp: string,
  requestNonce: string,
  digest: string,
): string {
  return [WORKER_TRANSPORT_PROTOCOL, 'RESPONSE', String(status), path, tenantId, timestamp, requestNonce, digest].join('\n')
}

async function signBase64Url(secret: string, canonical: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), UTF8.encode(canonical))
  return bytesToBase64Url(new Uint8Array(signature))
}

async function verifyBase64Url(secret: string, canonical: string, signature: string): Promise<boolean> {
  const bytes = base64UrlToBytes(signature, 'WORKER_AUTH_SIGNATURE_INVALID')
  if (bytes.length !== 32) throw new Error('WORKER_AUTH_SIGNATURE_INVALID')
  return crypto.subtle.verify('HMAC', await hmacKey(secret), bytes, UTF8.encode(canonical))
}

export async function createSignedWorkerRequest(
  secretRaw: string,
  tenantIdRaw: string,
  body: string,
  options: { nowMs?: number; nonce?: string; method?: 'POST'; path?: typeof WORKER_EXECUTE_PATH } = {},
): Promise<SignedWorkerRequestHeaders> {
  const secret = validateWorkerTransportSecret(secretRaw)
  const tenantId = validateTenantId(tenantIdRaw)
  const method = options.method ?? 'POST'
  const path = options.path ?? WORKER_EXECUTE_PATH
  if (method !== 'POST' || path !== WORKER_EXECUTE_PATH) throw new Error('WORKER_AUTH_ROUTE_INVALID')
  const nowMs = options.nowMs ?? Date.now()
  if (!Number.isFinite(nowMs)) throw new Error('WORKER_AUTH_TIME_INVALID')
  const timestamp = String(Math.floor(nowMs / 1000))
  const nonce = options.nonce ? validateNonce(options.nonce) : createWorkerTransportNonce()
  const digest = await sha256Base64Url(body)
  const canonical = requestCanonical(method, path, tenantId, timestamp, nonce, digest)
  const signature = await signBase64Url(secret, canonical)
  return {
    'x-agent-ia-protocol': WORKER_TRANSPORT_PROTOCOL,
    'x-agent-ia-tenant': tenantId,
    'x-agent-ia-timestamp': timestamp,
    'x-agent-ia-nonce': nonce,
    'x-agent-ia-content-sha256': digest,
    'x-agent-ia-signature': signature,
  }
}

export async function verifySignedWorkerRequest(
  secretRaw: string,
  expectedTenantRaw: string,
  headers: SignedWorkerRequestHeaders,
  body: string,
  options: { nowMs?: number; method?: string; path?: string } = {},
): Promise<{ tenantId: string; nonce: string; timestamp: string }> {
  const secret = validateWorkerTransportSecret(secretRaw)
  const expectedTenant = validateTenantId(expectedTenantRaw)
  if (headers['x-agent-ia-protocol'] !== WORKER_TRANSPORT_PROTOCOL) throw new Error('WORKER_AUTH_PROTOCOL_MISMATCH')
  const tenantId = validateTenantId(headers['x-agent-ia-tenant'])
  if (tenantId !== expectedTenant) throw new Error('WORKER_AUTH_TENANT_MISMATCH')
  const nowMs = options.nowMs ?? Date.now()
  if (!Number.isFinite(nowMs)) throw new Error('WORKER_AUTH_TIME_INVALID')
  const timestamp = validateTimestamp(headers['x-agent-ia-timestamp'], nowMs)
  const nonce = validateNonce(headers['x-agent-ia-nonce'])
  const method = options.method ?? 'POST'
  const path = options.path ?? WORKER_EXECUTE_PATH
  if (method !== 'POST' || path !== WORKER_EXECUTE_PATH) throw new Error('WORKER_AUTH_ROUTE_INVALID')
  const digest = await sha256Base64Url(body)
  if (digest !== headers['x-agent-ia-content-sha256']) throw new Error('WORKER_AUTH_BODY_DIGEST_MISMATCH')
  const canonical = requestCanonical(method, path, tenantId, timestamp, nonce, digest)
  const valid = await verifyBase64Url(secret, canonical, headers['x-agent-ia-signature'])
  if (!valid) throw new Error('WORKER_AUTH_SIGNATURE_MISMATCH')
  return { tenantId, nonce, timestamp }
}

export async function createSignedWorkerResponse(
  secretRaw: string,
  tenantIdRaw: string,
  requestNonceRaw: string,
  status: number,
  body: string,
  nowMs = Date.now(),
): Promise<SignedWorkerResponseHeaders> {
  const secret = validateWorkerTransportSecret(secretRaw)
  const tenantId = validateTenantId(tenantIdRaw)
  const requestNonce = validateNonce(requestNonceRaw)
  if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error('WORKER_AUTH_RESPONSE_STATUS_INVALID')
  if (!Number.isFinite(nowMs)) throw new Error('WORKER_AUTH_TIME_INVALID')
  const timestamp = String(Math.floor(nowMs / 1000))
  const digest = await sha256Base64Url(body)
  const canonical = responseCanonical(WORKER_EXECUTE_PATH, status, tenantId, timestamp, requestNonce, digest)
  const signature = await signBase64Url(secret, canonical)
  return {
    'x-agent-ia-protocol': WORKER_TRANSPORT_PROTOCOL,
    'x-agent-ia-tenant': tenantId,
    'x-agent-ia-timestamp': timestamp,
    'x-agent-ia-request-nonce': requestNonce,
    'x-agent-ia-content-sha256': digest,
    'x-agent-ia-signature': signature,
  }
}

export async function verifySignedWorkerResponse(
  secretRaw: string,
  expectedTenantRaw: string,
  expectedRequestNonceRaw: string,
  status: number,
  headers: SignedWorkerResponseHeaders,
  body: string,
  nowMs = Date.now(),
): Promise<void> {
  const secret = validateWorkerTransportSecret(secretRaw)
  const expectedTenant = validateTenantId(expectedTenantRaw)
  const expectedRequestNonce = validateNonce(expectedRequestNonceRaw)
  if (headers['x-agent-ia-protocol'] !== WORKER_TRANSPORT_PROTOCOL) throw new Error('WORKER_AUTH_RESPONSE_PROTOCOL_MISMATCH')
  const tenantId = validateTenantId(headers['x-agent-ia-tenant'])
  if (tenantId !== expectedTenant) throw new Error('WORKER_AUTH_RESPONSE_TENANT_MISMATCH')
  if (headers['x-agent-ia-request-nonce'] !== expectedRequestNonce) throw new Error('WORKER_AUTH_RESPONSE_NONCE_MISMATCH')
  const timestamp = validateTimestamp(headers['x-agent-ia-timestamp'], nowMs)
  const digest = await sha256Base64Url(body)
  if (digest !== headers['x-agent-ia-content-sha256']) throw new Error('WORKER_AUTH_RESPONSE_DIGEST_MISMATCH')
  const canonical = responseCanonical(WORKER_EXECUTE_PATH, status, tenantId, timestamp, expectedRequestNonce, digest)
  const valid = await verifyBase64Url(secret, canonical, headers['x-agent-ia-signature'])
  if (!valid) throw new Error('WORKER_AUTH_RESPONSE_SIGNATURE_MISMATCH')
}