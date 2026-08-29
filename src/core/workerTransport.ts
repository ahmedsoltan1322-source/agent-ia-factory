import { LOCAL_TENANT_ID } from './deploymentEngine.ts'
import {
  WORKER_EXECUTE_PATH,
  createSignedWorkerRequest,
  validateWorkerTransportSecret,
  verifySignedWorkerResponse,
  type SignedWorkerResponseHeaders,
} from './workerAuth.ts'
import {
  MAX_WORKER_RECEIPT_CHARS,
  exportWorkerBundle,
  importWorkerReceipt,
  validateWorkerBundle,
  validateWorkerReceipt,
  type PortableWorkerBundle,
  type PortableWorkerReceipt,
} from './workerProtocol.ts'

const MAX_ENDPOINT_CHARS = 500
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 30_000

export function validateAuthenticatedWorkerEndpoint(raw: string): string {
  const clean = raw.trim()
  if (!clean || clean.length > MAX_ENDPOINT_CHARS) throw new Error('WORKER_ENDPOINT_INVALID')
  let url: URL
  try {
    url = new URL(clean)
  } catch {
    throw new Error('WORKER_ENDPOINT_INVALID')
  }
  if (url.protocol !== 'https:') throw new Error('WORKER_ENDPOINT_HTTPS_REQUIRED')
  if (url.username || url.password || url.search || url.hash) throw new Error('WORKER_ENDPOINT_CREDENTIAL_OR_QUERY_FORBIDDEN')
  if (!url.hostname) throw new Error('WORKER_ENDPOINT_HOST_REQUIRED')
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('WORKER_ENDPOINT_BASE_PATH_FORBIDDEN')
  return url.origin
}

function responseHeaders(response: Response): SignedWorkerResponseHeaders {
  return {
    'x-agent-ia-protocol': response.headers.get('x-agent-ia-protocol') ?? '',
    'x-agent-ia-tenant': response.headers.get('x-agent-ia-tenant') ?? '',
    'x-agent-ia-timestamp': response.headers.get('x-agent-ia-timestamp') ?? '',
    'x-agent-ia-request-nonce': response.headers.get('x-agent-ia-request-nonce') ?? '',
    'x-agent-ia-content-sha256': response.headers.get('x-agent-ia-content-sha256') ?? '',
    'x-agent-ia-signature': response.headers.get('x-agent-ia-signature') ?? '',
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  const lengthHeader = response.headers.get('content-length')
  if (lengthHeader) {
    const length = Number(lengthHeader)
    if (!Number.isFinite(length) || length < 0 || length > MAX_WORKER_RECEIPT_CHARS) throw new Error('WORKER_RESPONSE_SIZE_INVALID')
  }
  if (!response.body) {
    const text = await response.text()
    if (text.length > MAX_WORKER_RECEIPT_CHARS) throw new Error('WORKER_RESPONSE_SIZE_LIMIT')
    return text
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_WORKER_RECEIPT_CHARS) throw new Error('WORKER_RESPONSE_SIZE_LIMIT')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  if (text.length > MAX_WORKER_RECEIPT_CHARS) throw new Error('WORKER_RESPONSE_SIZE_LIMIT')
  return text
}

export async function executeWorkerBundleOverAuthenticatedHttps(
  endpointRaw: string,
  secretRaw: string,
  rawBundle: PortableWorkerBundle,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PortableWorkerReceipt> {
  const endpoint = validateAuthenticatedWorkerEndpoint(endpointRaw)
  const secret = validateWorkerTransportSecret(secretRaw)
  const bundle = validateWorkerBundle(rawBundle, new Date().toISOString())
  if (bundle.tenantId !== LOCAL_TENANT_ID) throw new Error('WORKER_TRANSPORT_TENANT_MISMATCH')
  const body = exportWorkerBundle(bundle)
  const signed = await createSignedWorkerRequest(secret, bundle.tenantId, body)
  const executeUrl = `${endpoint}${WORKER_EXECUTE_PATH}`
  const safeTimeoutMs = Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.floor(timeoutMs)))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('WORKER_TRANSPORT_TIMEOUT'), safeTimeoutMs)

  try {
    const response = await fetch(executeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json;charset=utf-8',
        'accept': 'application/json',
        ...signed,
      },
      body,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      mode: 'cors',
      signal: controller.signal,
    })
    const responseBody = await readBoundedResponse(response)
    await verifySignedWorkerResponse(
      secret,
      bundle.tenantId,
      signed['x-agent-ia-nonce'],
      response.status,
      responseHeaders(response),
      responseBody,
    )
    if (!response.ok) throw new Error(`WORKER_TRANSPORT_REMOTE_ERROR:${response.status}`)
    const receipt = importWorkerReceipt(responseBody)
    return validateWorkerReceipt(receipt, bundle)
  } catch (error) {
    if (controller.signal.aborted) throw new Error('WORKER_TRANSPORT_UNCERTAIN_TIMEOUT')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
