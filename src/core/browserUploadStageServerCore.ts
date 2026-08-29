import { validateTenantId } from './deploymentEngine.ts'
import { validateBrowserUploadCapsule, type BrowserUploadCapsule } from './browserUploadCapsule.ts'
import {
  UPLOAD_DELETE_PATH,
  UPLOAD_STAGE_PATH,
  createSignedUploadResponse,
  verifySignedUploadRequest,
  type SignedUploadRequestHeaders,
} from './browserUploadStageAuth.ts'
import { type BrowserUploadStageStore } from './browserUploadStageStore.ts'
import { validateWorkerAllowedOrigin } from './workerServerCore.ts'
import { validateWorkerTransportSecret } from './workerAuth.ts'

export const UPLOAD_STAGE_SERVER_MAX_REQUESTS_PER_MINUTE = 12
export const UPLOAD_STAGE_SERVER_REPLAY_TTL_MS = 2 * 60_000
export const UPLOAD_STAGE_SERVER_MAX_NONCES = 1_000
export const UPLOAD_STAGE_SERVER_MAX_BODY_CHARS = 60_000

export interface UploadStageServerConfig {
  tenantId: string
  secret: string
  allowedOrigin: string
  maxRequestsPerMinute?: number
}
export interface UploadStageServerState {
  seenNonces: Map<string, number>
  requestTimes: number[]
}
export interface UploadStageServerRequest {
  method: string
  path: string
  origin: string
  headers: Record<string, string>
  body: string
}
export interface UploadStageServerResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export function createUploadStageServerState(): UploadStageServerState {
  return { seenNonces: new Map(), requestTimes: [] }
}

function validateConfig(raw: UploadStageServerConfig): Required<UploadStageServerConfig> {
  const tenantId = validateTenantId(raw.tenantId)
  const secret = validateWorkerTransportSecret(raw.secret)
  const allowedOrigin = validateWorkerAllowedOrigin(raw.allowedOrigin)
  const maxRequestsPerMinute = raw.maxRequestsPerMinute ?? UPLOAD_STAGE_SERVER_MAX_REQUESTS_PER_MINUTE
  if (!Number.isInteger(maxRequestsPerMinute) || maxRequestsPerMinute < 1 || maxRequestsPerMinute > 30) throw new Error('UPLOAD_STAGE_SERVER_RATE_LIMIT_INVALID')
  return { tenantId, secret, allowedOrigin, maxRequestsPerMinute }
}
function headers(origin: string): Record<string, string> {
  return { 'access-control-allow-origin': origin, 'vary': 'origin', 'cache-control': 'no-store', 'content-type': 'application/json;charset=utf-8', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
}
function preflight(origin: string): Record<string, string> {
  return { ...headers(origin), 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': ['content-type','accept','x-agent-ia-upload-protocol','x-agent-ia-tenant','x-agent-ia-timestamp','x-agent-ia-nonce','x-agent-ia-content-sha256','x-agent-ia-signature'].join(', '), 'access-control-max-age': '600' }
}
function signedHeaders(raw: Record<string,string>): SignedUploadRequestHeaders {
  return {
    'x-agent-ia-upload-protocol': raw['x-agent-ia-upload-protocol'] as SignedUploadRequestHeaders['x-agent-ia-upload-protocol'],
    'x-agent-ia-tenant': raw['x-agent-ia-tenant'] ?? '',
    'x-agent-ia-timestamp': raw['x-agent-ia-timestamp'] ?? '',
    'x-agent-ia-nonce': raw['x-agent-ia-nonce'] ?? '',
    'x-agent-ia-content-sha256': raw['x-agent-ia-content-sha256'] ?? '',
    'x-agent-ia-signature': raw['x-agent-ia-signature'] ?? '',
  }
}
function cleanup(state: UploadStageServerState, nowMs: number): void {
  for (const [nonce, expiry] of state.seenNonces) if (expiry <= nowMs) state.seenNonces.delete(nonce)
  state.requestTimes = state.requestTimes.filter((time) => time > nowMs - 60_000 && time <= nowMs)
  while (state.seenNonces.size > UPLOAD_STAGE_SERVER_MAX_NONCES) {
    const first = state.seenNonces.keys().next().value as string | undefined
    if (!first) break
    state.seenNonces.delete(first)
  }
}
async function signedResponse(config: Required<UploadStageServerConfig>, path: string, nonce: string, status: number, body: string, nowMs: number): Promise<UploadStageServerResponse> {
  const signed = await createSignedUploadResponse(config.secret, config.tenantId, path, nonce, status, body, nowMs)
  return { status, headers: { ...headers(config.allowedOrigin), ...signed }, body }
}

export async function handleUploadStageServerRequest(rawConfig: UploadStageServerConfig, state: UploadStageServerState, request: UploadStageServerRequest, store: BrowserUploadStageStore, nowMs = Date.now()): Promise<UploadStageServerResponse> {
  const config = validateConfig(rawConfig)
  if (!Number.isFinite(nowMs)) throw new Error('UPLOAD_STAGE_SERVER_TIME_INVALID')
  cleanup(state, nowMs)
  if (request.path !== UPLOAD_STAGE_PATH && request.path !== UPLOAD_DELETE_PATH) return { status: 404, headers: { 'cache-control': 'no-store' }, body: '' }
  if (request.origin !== config.allowedOrigin) return { status: 403, headers: { 'cache-control': 'no-store' }, body: '' }
  if (request.method === 'OPTIONS') return { status: 204, headers: preflight(config.allowedOrigin), body: '' }
  if (request.method !== 'POST') return { status: 405, headers: headers(config.allowedOrigin), body: '' }
  if (!request.body || request.body.length > UPLOAD_STAGE_SERVER_MAX_BODY_CHARS) return { status: 413, headers: headers(config.allowedOrigin), body: '' }

  let auth: { tenantId: string; nonce: string; bodyDigest: string }
  try { auth = await verifySignedUploadRequest(config.secret, config.tenantId, request.path, signedHeaders(request.headers), request.body, nowMs) }
  catch { return { status: 401, headers: headers(config.allowedOrigin), body: '' } }
  if (state.seenNonces.has(auth.nonce)) return signedResponse(config, request.path, auth.nonce, 409, JSON.stringify({ error: 'UPLOAD_AUTH_REPLAY' }), nowMs)
  state.seenNonces.set(auth.nonce, nowMs + UPLOAD_STAGE_SERVER_REPLAY_TTL_MS)
  if (state.requestTimes.length >= config.maxRequestsPerMinute) return signedResponse(config, request.path, auth.nonce, 429, JSON.stringify({ error: 'UPLOAD_STAGE_RATE_LIMIT' }), nowMs)
  state.requestTimes.push(nowMs)

  try {
    if (request.path === UPLOAD_STAGE_PATH) {
      const capsule = validateBrowserUploadCapsule(JSON.parse(request.body) as BrowserUploadCapsule, nowMs)
      const receipt = await store.stage(capsule, nowMs)
      return signedResponse(config, request.path, auth.nonce, 200, JSON.stringify(receipt), Date.now())
    }
    const parsed = JSON.parse(request.body) as { stageId?: string }
    if (!parsed || Object.keys(parsed).length !== 1 || typeof parsed.stageId !== 'string') throw new Error('UPLOAD_DELETE_BODY_INVALID')
    const deleted = await store.remove(parsed.stageId)
    return signedResponse(config, request.path, auth.nonce, 200, JSON.stringify({ stageId: parsed.stageId, deleted, monetaryCostUsd: 0 }), Date.now())
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_:.-]{1,160}$/u.test(error.message) ? error.message : 'UPLOAD_STAGE_SERVER_REJECTED'
    return signedResponse(config, request.path, auth.nonce, 400, JSON.stringify({ error: code }), Date.now())
  }
}
