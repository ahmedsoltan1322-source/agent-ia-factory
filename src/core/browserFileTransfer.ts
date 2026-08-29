import { validateBrowserTarget } from './browserJob'

export type BrowserFileTransferOperation =
  | { id: string; kind: 'download_capture'; url: string; maxBytes: number }
  | { id: string; kind: 'upload_preview'; selector: string; filename: string; mimeType: 'text/plain'; content: string }

export interface BrowserFileTransferPlan {
  schemaVersion: '0.1'
  id: string
  name: string
  targetUrl: string
  createdAt: string
  approvedByHuman: boolean
  executionMode: 'github-actions-manual'
  operations: BrowserFileTransferOperation[]
  policy: {
    allowedNetworkMethods: readonly ['GET', 'HEAD', 'OPTIONS']
    allowExternalUpload: false
    allowSubmit: false
    allowRedirects: false
    allowCookies: false
    allowAuth: false
    allowSecrets: false
    allowExecutableDownloads: false
    allowArchiveDownloads: false
    sameHostFamilyOnly: true
    maxDownloadBytes: 5_000_000
    maxUploadPreviewBytes: 16_384
    maxOperations: 4
    maxRunSeconds: 60
    monetaryCostUsd: 0
  }
}

const PLANS_KEY = 'agent-ia-factory.browser-file-transfer-plans.v1'
const MAX_PLANS = 12
const MAX_OPERATIONS = 4
const MAX_PLAN_JSON_CHARS = 48_000
const MAX_DOWNLOAD_BYTES = 5_000_000
const MAX_UPLOAD_PREVIEW_BYTES = 16_384
const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/u
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.txt$/u
const SENSITIVE_SELECTOR = /password|passwd|secret|token|api[-_ ]?key|credit|card|cvv|cvc|iban|routing|ssn|social[-_ ]?security|otp|one[-_ ]?time|2fa|mfa/iu
const SECRET_VALUE = /-----BEGIN .*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bBearer\s+[A-Za-z0-9._~-]{24,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/iu
const PERSONAL_OR_REMOTE_VALUE = /https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\+?\d[\d\s().-]{6,}\d\b/iu

function newId(prefix: string): string { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
function clean(value: string, max: number): string { return value.replace(/[\u0000-\u001f]/gu, ' ').trim().slice(0, max) }
function hostFamily(hostname: string): Set<string> {
  const host = hostname.toLowerCase()
  return new Set(host.startsWith('www.') ? [host, host.slice(4)] : [host, `www.${host}`])
}

function validateSelector(selector: string): string {
  const safe = selector.trim().slice(0, 300)
  if (!safe) throw new Error('BROWSER_TRANSFER_SELECTOR_REQUIRED')
  if (SENSITIVE_SELECTOR.test(safe)) throw new Error('BROWSER_TRANSFER_SENSITIVE_FIELD_FORBIDDEN')
  return safe
}

function validateOperation(operation: BrowserFileTransferOperation, target: URL): BrowserFileTransferOperation {
  if (!SAFE_ID.test(operation.id)) throw new Error('BROWSER_TRANSFER_OPERATION_ID_INVALID')
  if (operation.kind === 'download_capture') {
    const url = validateBrowserTarget(operation.url)
    if (!hostFamily(target.hostname).has(url.hostname.toLowerCase())) throw new Error('BROWSER_TRANSFER_CROSS_SITE_FORBIDDEN')
    const maxBytes = Math.floor(operation.maxBytes)
    if (!Number.isFinite(maxBytes) || maxBytes < 1_024 || maxBytes > MAX_DOWNLOAD_BYTES) throw new Error('BROWSER_TRANSFER_DOWNLOAD_LIMIT_INVALID')
    return { id: operation.id, kind: 'download_capture', url: url.href, maxBytes }
  }
  const selector = validateSelector(operation.selector)
  const filename = operation.filename.trim()
  if (!SAFE_FILENAME.test(filename) || filename.includes('..')) throw new Error('BROWSER_TRANSFER_FILENAME_INVALID')
  if (operation.mimeType !== 'text/plain') throw new Error('BROWSER_TRANSFER_UPLOAD_MIME_FORBIDDEN')
  const content = operation.content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '')
  const bytes = new TextEncoder().encode(content).length
  if (!content.trim() || bytes > MAX_UPLOAD_PREVIEW_BYTES) throw new Error('BROWSER_TRANSFER_UPLOAD_PREVIEW_SIZE_INVALID')
  if (SECRET_VALUE.test(content) || /\b\d{13,19}\b/u.test(content)) throw new Error('BROWSER_TRANSFER_SECRET_VALUE_FORBIDDEN')
  if (PERSONAL_OR_REMOTE_VALUE.test(content)) throw new Error('BROWSER_TRANSFER_PUBLIC_PREVIEW_VALUE_FORBIDDEN')
  return { id: operation.id, kind: 'upload_preview', selector, filename, mimeType: 'text/plain', content }
}

export function validateBrowserFileTransferPlan(plan: BrowserFileTransferPlan): BrowserFileTransferPlan {
  if (!plan || plan.schemaVersion !== '0.1') throw new Error('BROWSER_TRANSFER_SCHEMA_UNSUPPORTED')
  if (plan.executionMode !== 'github-actions-manual') throw new Error('BROWSER_TRANSFER_EXECUTION_MODE_FORBIDDEN')
  const target = validateBrowserTarget(plan.targetUrl)
  if (!Array.isArray(plan.operations) || plan.operations.length < 1 || plan.operations.length > MAX_OPERATIONS) throw new Error('BROWSER_TRANSFER_OPERATION_COUNT_INVALID')
  const policy = plan.policy
  if (!policy || policy.monetaryCostUsd !== 0) throw new Error('BROWSER_TRANSFER_NONZERO_COST_FORBIDDEN')
  if (policy.allowExternalUpload !== false || policy.allowSubmit !== false || policy.allowRedirects !== false || policy.allowCookies !== false || policy.allowAuth !== false || policy.allowSecrets !== false) {
    throw new Error('BROWSER_TRANSFER_DANGEROUS_CAPABILITY_FORBIDDEN')
  }
  if (policy.allowExecutableDownloads !== false || policy.allowArchiveDownloads !== false || policy.sameHostFamilyOnly !== true) throw new Error('BROWSER_TRANSFER_FILE_POLICY_INVALID')
  if ([...policy.allowedNetworkMethods].join(',') !== 'GET,HEAD,OPTIONS') throw new Error('BROWSER_TRANSFER_NETWORK_POLICY_INVALID')
  if (policy.maxDownloadBytes !== MAX_DOWNLOAD_BYTES || policy.maxUploadPreviewBytes !== MAX_UPLOAD_PREVIEW_BYTES || policy.maxOperations !== MAX_OPERATIONS || policy.maxRunSeconds !== 60) {
    throw new Error('BROWSER_TRANSFER_LIMIT_POLICY_INVALID')
  }
  const safe: BrowserFileTransferPlan = {
    ...plan,
    name: clean(plan.name, 120) || target.hostname,
    targetUrl: target.href,
    operations: plan.operations.map((operation) => validateOperation(operation, target)),
    policy: {
      allowedNetworkMethods: ['GET', 'HEAD', 'OPTIONS'] as const,
      allowExternalUpload: false,
      allowSubmit: false,
      allowRedirects: false,
      allowCookies: false,
      allowAuth: false,
      allowSecrets: false,
      allowExecutableDownloads: false,
      allowArchiveDownloads: false,
      sameHostFamilyOnly: true,
      maxDownloadBytes: MAX_DOWNLOAD_BYTES,
      maxUploadPreviewBytes: MAX_UPLOAD_PREVIEW_BYTES,
      maxOperations: MAX_OPERATIONS,
      maxRunSeconds: 60,
      monetaryCostUsd: 0,
    },
  }
  if (JSON.stringify(safe).length > MAX_PLAN_JSON_CHARS) throw new Error('BROWSER_TRANSFER_PLAN_TOO_LARGE')
  return safe
}

export function createBrowserFileTransferPlan(name: string, targetUrl: string): BrowserFileTransferPlan {
  const target = validateBrowserTarget(targetUrl)
  return validateBrowserFileTransferPlan({
    schemaVersion: '0.1',
    id: newId('browser-transfer'),
    name,
    targetUrl: target.href,
    createdAt: new Date().toISOString(),
    approvedByHuman: false,
    executionMode: 'github-actions-manual',
    operations: [{ id: 'download-example', kind: 'download_capture', url: target.href, maxBytes: 1_000_000 }],
    policy: {
      allowedNetworkMethods: ['GET', 'HEAD', 'OPTIONS'] as const,
      allowExternalUpload: false,
      allowSubmit: false,
      allowRedirects: false,
      allowCookies: false,
      allowAuth: false,
      allowSecrets: false,
      allowExecutableDownloads: false,
      allowArchiveDownloads: false,
      sameHostFamilyOnly: true,
      maxDownloadBytes: MAX_DOWNLOAD_BYTES,
      maxUploadPreviewBytes: MAX_UPLOAD_PREVIEW_BYTES,
      maxOperations: MAX_OPERATIONS,
      maxRunSeconds: 60,
      monetaryCostUsd: 0,
    },
  })
}

export function addBrowserFileTransferOperation(plan: BrowserFileTransferPlan, operation: BrowserFileTransferOperation): BrowserFileTransferPlan {
  if (plan.operations.length >= MAX_OPERATIONS) throw new Error('BROWSER_TRANSFER_OPERATION_LIMIT_REACHED')
  return validateBrowserFileTransferPlan({ ...plan, approvedByHuman: false, operations: [...plan.operations, operation] })
}

export function removeBrowserFileTransferOperation(plan: BrowserFileTransferPlan, operationId: string): BrowserFileTransferPlan {
  return validateBrowserFileTransferPlan({ ...plan, approvedByHuman: false, operations: plan.operations.filter((item) => item.id !== operationId) })
}

export function approveBrowserFileTransferPlan(plan: BrowserFileTransferPlan, approved: boolean): BrowserFileTransferPlan {
  return validateBrowserFileTransferPlan({ ...plan, approvedByHuman: approved })
}

function readPlans(): BrowserFileTransferPlan[] {
  try {
    const raw = localStorage.getItem(PLANS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => { try { return [validateBrowserFileTransferPlan(item as BrowserFileTransferPlan)] } catch { return [] } }).slice(0, MAX_PLANS)
  } catch { return [] }
}

export function loadBrowserFileTransferPlans(): BrowserFileTransferPlan[] { return readPlans() }

export function saveBrowserFileTransferPlan(plan: BrowserFileTransferPlan): BrowserFileTransferPlan[] {
  const safe = validateBrowserFileTransferPlan(plan)
  const next = [safe, ...readPlans().filter((item) => item.id !== safe.id)].slice(0, MAX_PLANS)
  localStorage.setItem(PLANS_KEY, JSON.stringify(next))
  return next
}

export function deleteBrowserFileTransferPlan(planId: string): BrowserFileTransferPlan[] {
  const next = readPlans().filter((item) => item.id !== planId)
  localStorage.setItem(PLANS_KEY, JSON.stringify(next))
  return next
}

export function exportBrowserFileTransferPlan(plan: BrowserFileTransferPlan): string {
  const safe = validateBrowserFileTransferPlan(plan)
  if (!safe.approvedByHuman) throw new Error('BROWSER_TRANSFER_HUMAN_APPROVAL_REQUIRED')
  return JSON.stringify(safe, null, 2)
}
