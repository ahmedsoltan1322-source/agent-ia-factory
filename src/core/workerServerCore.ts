import { validateTenantId } from './deploymentEngine.ts'
import {
  WORKER_EXECUTE_PATH,
  createSignedWorkerResponse,
  validateWorkerTransportSecret,
  verifySignedWorkerRequest,
  type SignedWorkerRequestHeaders,
} from './workerAuth.ts'
import { runReferenceWorkerBundle } from './referenceWorker.ts'
import {
  MAX_WORKER_BUNDLE_CHARS,
  REFERENCE_WORKER_ID,
  exportWorkerReceipt,
  importWorkerBundle,
} from './workerProtocol.ts'

export const WORKER_SERVER_REPLAY_TTL_MS = 2 * 60_000
export const WORKER_SERVER_RATE_WINDOW_MS = 60_000
export const WORKER_SERVER_MAX_REQUESTS_PER_WINDOW = 10
export const WORKER_SERVER_MAX_NONCES = 1_000
export const WORKER_SERVER_MAX_RECEIPTS = 100

export interface DurableWorkerStoreReserveInput {
  bundleId: string
  tenantId: string
  bodyDigest: string
  leaseExpiresAt: string
  nowMs: number
}

export interface DurableWorkerStoreCompleteInput extends DurableWorkerStoreReserveInput {
  receiptBody: string
}

export type DurableWorkerStoreReserveResult =
  | { state: 'reserved-new' }
  | { state: 'reserved-existing' }
  | { state: 'completed'; receiptBody: string }

export interface DurableWorkerExecutionStore {
  reserve(input: DurableWorkerStoreReserveInput): Promise<DurableWorkerStoreReserveResult>
  complete(input: DurableWorkerStoreCompleteInput): Promise<void>
}

export interface AuthenticatedWorkerServerConfig {
  tenantId: string
  secret: string
  allowedOrigin: string
  maxRequestsPerMinute?: number
}

export interface AuthenticatedWorkerServerState {
  seenNonces: Map<string, number>
  requestTimes: number[]
  receiptCache: Map<string, { body: string; expiresAtMs: number }>
}

export interface WorkerServerRequest {
  method: string
  path: string
  origin: string
  headers: Record<string, string>
  body: string
}

export interface WorkerServerResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export function createAuthenticatedWorkerServerState(): AuthenticatedWorkerServerState {
  return {
    seenNonces: new Map(),
    requestTimes: [],
    receiptCache: new Map(),
  }
}

export function validateWorkerAllowedOrigin(raw: string): string {
  const clean = raw.trim()
  let url: URL
  try {
    url = new URL(clean)
  } catch {
    throw new Error('WORKER_SERVER_ALLOWED_ORIGIN_INVALID')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('WORKER_SERVER_ALLOWED_ORIGIN_INVALID')
  }
  if (!url.hostname || (url.pathname !== '/' && url.pathname !== '')) throw new Error('WORKER_SERVER_ALLOWED_ORIGIN_INVALID')
  return url.origin
}

export function validateAuthenticatedWorkerServerConfig(raw: AuthenticatedWorkerServerConfig): Required<AuthenticatedWorkerServerConfig> {
  const tenantId = validateTenantId(raw.tenantId)
  const secret = validateWorkerTransportSecret(raw.secret)
  const allowedOrigin = validateWorkerAllowedOrigin(raw.allowedOrigin)
  const maxRequestsPerMinute = raw.maxRequestsPerMinute ?? WORKER_SERVER_MAX_REQUESTS_PER_WINDOW
  if (!Number.isInteger(maxRequestsPerMinute) || maxRequestsPerMinute < 1 || maxRequestsPerMinute > 60) {
    throw new Error('WORKER_SERVER_RATE_LIMIT_INVALID')
  }
  return { tenantId, secret, allowedOrigin, maxRequestsPerMinute }
}

function baseHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'vary': 'origin',
    'cache-control': 'no-store',
    'content-type': 'application/json;charset=utf-8',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }
}

function preflightHeaders(origin: string): Record<string, string> {
  return {
    ...baseHeaders(origin),
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': [
      'content-type',
      'accept',
      'x-agent-ia-protocol',
      'x-agent-ia-tenant',
      'x-agent-ia-timestamp',
      'x-agent-ia-nonce',
      'x-agent-ia-content-sha256',
      'x-agent-ia-signature',
    ].join(', '),
    'access-control-max-age': '600',
  }
}

function signedRequestHeaders(headers: Record<string, string>): SignedWorkerRequestHeaders {
  return {
    'x-agent-ia-protocol': headers['x-agent-ia-protocol'] as SignedWorkerRequestHeaders['x-agent-ia-protocol'],
    'x-agent-ia-tenant': headers['x-agent-ia-tenant'] ?? '',
    'x-agent-ia-timestamp': headers['x-agent-ia-timestamp'] ?? '',
    'x-agent-ia-nonce': headers['x-agent-ia-nonce'] ?? '',
    'x-agent-ia-content-sha256': headers['x-agent-ia-content-sha256'] ?? '',
    'x-agent-ia-signature': headers['x-agent-ia-signature'] ?? '',
  }
}

function cleanupState(state: AuthenticatedWorkerServerState, nowMs: number): void {
  for (const [nonce, expiresAt] of state.seenNonces) {
    if (expiresAt <= nowMs) state.seenNonces.delete(nonce)
  }
  state.requestTimes = state.requestTimes.filter((time) => time > nowMs - WORKER_SERVER_RATE_WINDOW_MS && time <= nowMs)
  for (const [bundleId, cached] of state.receiptCache) {
    if (cached.expiresAtMs <= nowMs) state.receiptCache.delete(bundleId)
  }
  while (state.seenNonces.size > WORKER_SERVER_MAX_NONCES) {
    const first = state.seenNonces.keys().next().value as string | undefined
    if (!first) break
    state.seenNonces.delete(first)
  }
  while (state.receiptCache.size > WORKER_SERVER_MAX_RECEIPTS) {
    const first = state.receiptCache.keys().next().value as string | undefined
    if (!first) break
    state.receiptCache.delete(first)
  }
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /^[A-Z0-9_:.-]{1,160}$/u.test(message) ? message : 'WORKER_SERVER_REJECTED'
}

async function signedJsonResponse(
  config: Required<AuthenticatedWorkerServerConfig>,
  requestNonce: string,
  status: number,
  body: string,
  nowMs: number,
): Promise<WorkerServerResponse> {
  const signed = await createSignedWorkerResponse(config.secret, config.tenantId, requestNonce, status, body, nowMs)
  return { status, headers: { ...baseHeaders(config.allowedOrigin), ...signed }, body }
}

export async function handleAuthenticatedWorkerServerRequest(
  rawConfig: AuthenticatedWorkerServerConfig,
  state: AuthenticatedWorkerServerState,
  request: WorkerServerRequest,
  nowMs = Date.now(),
  durableStore?: DurableWorkerExecutionStore,
): Promise<WorkerServerResponse> {
  const config = validateAuthenticatedWorkerServerConfig(rawConfig)
  if (!Number.isFinite(nowMs)) throw new Error('WORKER_SERVER_TIME_INVALID')
  cleanupState(state, nowMs)

  if (request.path !== WORKER_EXECUTE_PATH) {
    return { status: 404, headers: { 'cache-control': 'no-store' }, body: '' }
  }
  if (request.origin !== config.allowedOrigin) {
    return { status: 403, headers: { 'cache-control': 'no-store' }, body: '' }
  }
  if (request.method === 'OPTIONS') {
    return { status: 204, headers: preflightHeaders(config.allowedOrigin), body: '' }
  }
  if (request.method !== 'POST') {
    return { status: 405, headers: baseHeaders(config.allowedOrigin), body: '' }
  }
  if (!request.body || request.body.length > MAX_WORKER_BUNDLE_CHARS) {
    return { status: 413, headers: baseHeaders(config.allowedOrigin), body: '' }
  }

  const requestAuthHeaders = signedRequestHeaders(request.headers)
  let auth: { tenantId: string; nonce: string; timestamp: string }
  try {
    auth = await verifySignedWorkerRequest(
      config.secret,
      config.tenantId,
      requestAuthHeaders,
      request.body,
      { nowMs, method: 'POST', path: WORKER_EXECUTE_PATH },
    )
  } catch {
    return { status: 401, headers: baseHeaders(config.allowedOrigin), body: '' }
  }

  if (state.seenNonces.has(auth.nonce)) {
    return signedJsonResponse(config, auth.nonce, 409, JSON.stringify({ error: 'WORKER_AUTH_REPLAY' }), nowMs)
  }
  state.seenNonces.set(auth.nonce, nowMs + WORKER_SERVER_REPLAY_TTL_MS)

  if (state.requestTimes.length >= config.maxRequestsPerMinute) {
    return signedJsonResponse(config, auth.nonce, 429, JSON.stringify({ error: 'WORKER_SERVER_RATE_LIMIT' }), nowMs)
  }
  state.requestTimes.push(nowMs)

  let durableReserved = false
  try {
    const nowIso = new Date(nowMs).toISOString()
    const bundle = importWorkerBundle(request.body, nowIso)
    if (bundle.tenantId !== config.tenantId) throw new Error('WORKER_SERVER_BUNDLE_TENANT_MISMATCH')
    if (bundle.worker.workerId !== REFERENCE_WORKER_ID) throw new Error('WORKER_SERVER_WORKER_ID_MISMATCH')

    const cached = state.receiptCache.get(bundle.bundleId)
    if (cached && cached.expiresAtMs > nowMs) {
      return signedJsonResponse(config, auth.nonce, 200, cached.body, Date.now())
    }

    if (durableStore) {
      const reservation = await durableStore.reserve({
        bundleId: bundle.bundleId,
        tenantId: bundle.tenantId,
        bodyDigest: requestAuthHeaders['x-agent-ia-content-sha256'],
        leaseExpiresAt: bundle.expiresAt,
        nowMs,
      })
      if (reservation.state === 'completed') {
        state.receiptCache.set(bundle.bundleId, { body: reservation.receiptBody, expiresAtMs: Date.parse(bundle.expiresAt) })
        return signedJsonResponse(config, auth.nonce, 200, reservation.receiptBody, Date.now())
      }
      if (reservation.state === 'reserved-existing') {
        return signedJsonResponse(config, auth.nonce, 409, JSON.stringify({ error: 'WORKER_SERVER_UNCERTAIN_EXECUTION' }), Date.now())
      }
      durableReserved = true
    }

    const receipt = await runReferenceWorkerBundle(bundle, nowIso)
    const body = exportWorkerReceipt(receipt)

    if (durableStore) {
      try {
        await durableStore.complete({
          bundleId: bundle.bundleId,
          tenantId: bundle.tenantId,
          bodyDigest: requestAuthHeaders['x-agent-ia-content-sha256'],
          leaseExpiresAt: bundle.expiresAt,
          receiptBody: body,
          nowMs: Date.now(),
        })
      } catch {
        return signedJsonResponse(config, auth.nonce, 500, JSON.stringify({ error: 'WORKER_SERVER_UNCERTAIN_EXECUTION' }), Date.now())
      }
      durableReserved = false
    }

    state.receiptCache.set(bundle.bundleId, { body, expiresAtMs: Date.parse(bundle.expiresAt) })
    cleanupState(state, Date.now())
    return signedJsonResponse(config, auth.nonce, 200, body, Date.now())
  } catch (error) {
    if (durableReserved) {
      return signedJsonResponse(config, auth.nonce, 409, JSON.stringify({ error: 'WORKER_SERVER_UNCERTAIN_EXECUTION' }), Date.now())
    }
    const body = JSON.stringify({ error: safeErrorCode(error) })
    return signedJsonResponse(config, auth.nonce, 400, body, Date.now())
  }
}