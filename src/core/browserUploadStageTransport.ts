import { LOCAL_TENANT_ID } from './deploymentEngine.ts'
import { validateBrowserUploadCapsule, type BrowserUploadCapsule } from './browserUploadCapsule.ts'
import {
  UPLOAD_DELETE_PATH,
  UPLOAD_STAGE_PATH,
  createSignedUploadRequest,
  verifySignedUploadResponse,
  type SignedUploadResponseHeaders,
} from './browserUploadStageAuth.ts'
import type { BrowserUploadStageReceipt } from './browserUploadStageStore.ts'
import { validateAuthenticatedWorkerEndpoint } from './workerTransport.ts'
import { validateWorkerTransportSecret } from './workerAuth.ts'

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 30_000
const MAX_RESPONSE_CHARS = 8_000

function responseHeaders(response: Response): SignedUploadResponseHeaders {
  return {
    'x-agent-ia-upload-protocol': (response.headers.get('x-agent-ia-upload-protocol') ?? '') as SignedUploadResponseHeaders['x-agent-ia-upload-protocol'],
    'x-agent-ia-tenant': response.headers.get('x-agent-ia-tenant') ?? '',
    'x-agent-ia-timestamp': response.headers.get('x-agent-ia-timestamp') ?? '',
    'x-agent-ia-request-nonce': response.headers.get('x-agent-ia-request-nonce') ?? '',
    'x-agent-ia-content-sha256': response.headers.get('x-agent-ia-content-sha256') ?? '',
    'x-agent-ia-signature': response.headers.get('x-agent-ia-signature') ?? '',
  }
}

async function readBounded(response: Response): Promise<string> {
  const header = response.headers.get('content-length')
  if (header && (!Number.isFinite(Number(header)) || Number(header) < 0 || Number(header) > MAX_RESPONSE_CHARS)) throw new Error('UPLOAD_TRANSPORT_RESPONSE_SIZE_INVALID')
  const text = await response.text()
  if (text.length > MAX_RESPONSE_CHARS) throw new Error('UPLOAD_TRANSPORT_RESPONSE_SIZE_LIMIT')
  return text
}

async function postSigned(endpointRaw: string, secretRaw: string, path: typeof UPLOAD_STAGE_PATH | typeof UPLOAD_DELETE_PATH, body: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const endpoint = validateAuthenticatedWorkerEndpoint(endpointRaw)
  const secret = validateWorkerTransportSecret(secretRaw)
  const signed = await createSignedUploadRequest(secret, LOCAL_TENANT_ID, path, body)
  const controller = new AbortController()
  const safeTimeout = Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.floor(timeoutMs)))
  const timer = setTimeout(() => controller.abort('UPLOAD_TRANSPORT_TIMEOUT'), safeTimeout)
  try {
    const response = await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=utf-8', 'accept': 'application/json', ...signed },
      body,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      mode: 'cors',
      signal: controller.signal,
    })
    const responseBody = await readBounded(response)
    await verifySignedUploadResponse(secret, LOCAL_TENANT_ID, path, signed['x-agent-ia-nonce'], response.status, responseHeaders(response), responseBody)
    if (!response.ok) {
      let code = `UPLOAD_TRANSPORT_REMOTE_ERROR:${response.status}`
      try { const parsed = JSON.parse(responseBody) as { error?: string }; if (parsed.error && /^[A-Z0-9_:.-]{1,160}$/u.test(parsed.error)) code = parsed.error } catch { /* keep generic */ }
      throw new Error(code)
    }
    return responseBody
  } catch (error) {
    if (controller.signal.aborted) throw new Error('UPLOAD_TRANSPORT_UNCERTAIN_TIMEOUT')
    throw error
  } finally { clearTimeout(timer) }
}

export async function stageBrowserUploadCapsuleOverAuthenticatedHttps(endpoint: string, secret: string, rawCapsule: BrowserUploadCapsule, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<BrowserUploadStageReceipt> {
  const capsule = validateBrowserUploadCapsule(rawCapsule)
  const raw = await postSigned(endpoint, secret, UPLOAD_STAGE_PATH, JSON.stringify(capsule), timeoutMs)
  const receipt = JSON.parse(raw) as BrowserUploadStageReceipt
  const expected = ['schemaVersion','stageId','capsuleId','fileName','mediaType','sizeBytes','sha256','stagedAt','expiresAt','monetaryCostUsd'].sort()
  const keys = Object.keys(receipt).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error('UPLOAD_TRANSPORT_RECEIPT_FIELDS_INVALID')
  if (receipt.schemaVersion !== '0.1' || receipt.capsuleId !== capsule.id || receipt.fileName !== capsule.fileName || receipt.mediaType !== capsule.mediaType || receipt.sizeBytes !== capsule.sizeBytes || receipt.sha256 !== capsule.sha256 || receipt.expiresAt !== capsule.expiresAt || receipt.monetaryCostUsd !== 0 || !/^stage-[a-f0-9]{32}$/u.test(receipt.stageId)) throw new Error('UPLOAD_TRANSPORT_RECEIPT_BINDING_INVALID')
  return receipt
}

export async function deleteStagedBrowserUploadOverAuthenticatedHttps(endpoint: string, secret: string, stageId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
  if (!/^stage-[a-f0-9]{32}$/u.test(stageId)) throw new Error('UPLOAD_STAGE_ID_INVALID')
  const raw = await postSigned(endpoint, secret, UPLOAD_DELETE_PATH, JSON.stringify({ stageId }), timeoutMs)
  const parsed = JSON.parse(raw) as { stageId?: string; deleted?: boolean; monetaryCostUsd?: number }
  if (Object.keys(parsed).sort().join(',') !== 'deleted,monetaryCostUsd,stageId' || parsed.stageId !== stageId || typeof parsed.deleted !== 'boolean' || parsed.monetaryCostUsd !== 0) throw new Error('UPLOAD_TRANSPORT_DELETE_RECEIPT_INVALID')
  return parsed.deleted
}
