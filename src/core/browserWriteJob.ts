export type BrowserWriteAction =
  | { id: string; kind: 'fill_field'; selector: string; value: string }
  | { id: string; kind: 'submit_form'; formSelector: string; expectedPathPrefix: string }
  | { id: string; kind: 'download_file'; selector: string; maxBytes: number; allowedExtensions: string[] }
  | { id: string; kind: 'screenshot'; label: string }

export interface BrowserWriteJobPlan {
  schemaVersion: '0.1'
  id: string
  name: string
  targetUrl: string
  createdAt: string
  approvedByHuman: boolean
  executionMode: 'github-actions-manual-write-safe'
  actions: BrowserWriteAction[]
  policy: {
    allowedNetworkMethods: readonly ['GET', 'HEAD', 'OPTIONS', 'POST']
    maxPostRequests: 3
    allowPutPatchDelete: false
    allowCrossSiteTopNavigation: false
    allowSecrets: false
    allowPayments: false
    allowAuthenticationChanges: false
    allowUpload: false
    maxDownloadBytes: 5_000_000
    monetaryCostUsd: 0
  }
}

const PLANS_KEY = 'agent-ia-factory.browser-write-plans.v1'
const MAX_PLANS = 12
const MAX_ACTIONS = 8
const MAX_PLAN_JSON_CHARS = 20_000
const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/u
const SENSITIVE_SELECTOR = /password|passwd|secret|token|api[-_ ]?key|credit|card|cvv|cvc|iban|routing|ssn|social[-_ ]?security|otp|one[-_ ]?time|2fa|mfa|authenticator|recovery[-_ ]?code/iu
const SENSITIVE_VALUE = /-----BEGIN .*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bBearer\s+[A-Za-z0-9._~-]{24,}|\b\d{13,19}\b/iu
const PAYMENT_OR_ACCOUNT = /\b(checkout|purchase|buy|pay|payment|transfer|wire|withdraw|deposit|bank|billing|subscription|upgrade|password|reset-password|change-password|delete-account|close-account|revoke|disable|deactivate)\b/iu
const SENSITIVE_QUERY_KEY = /token|secret|password|passwd|auth|api[-_]?key|access[-_]?key|session|credential/iu
const SAFE_DOWNLOAD_EXTENSIONS = new Set(['.pdf', '.txt', '.csv', '.json', '.png', '.jpg', '.jpeg', '.webp'])

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f]/gu, ' ').trim().slice(0, max)
}

function isPrivateOrUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host.includes(':')) return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host)
  if (!match) return false
  const parts = match.slice(1).map(Number)
  if (parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return true
}

function validateUrl(rawUrl: string): URL {
  let url: URL
  try { url = new URL(rawUrl.trim()) } catch { throw new Error('BROWSER_WRITE_URL_INVALID') }
  if (url.protocol !== 'https:') throw new Error('BROWSER_WRITE_HTTPS_REQUIRED')
  if (url.port && url.port !== '443') throw new Error('BROWSER_WRITE_NONSTANDARD_PORT_FORBIDDEN')
  if (url.username || url.password) throw new Error('BROWSER_WRITE_URL_CREDENTIALS_FORBIDDEN')
  if (isPrivateOrUnsafeHost(url.hostname)) throw new Error('BROWSER_WRITE_PRIVATE_OR_IP_HOST_FORBIDDEN')
  if (url.href.length > 2_000) throw new Error('BROWSER_WRITE_URL_TOO_LONG')
  for (const key of url.searchParams.keys()) if (SENSITIVE_QUERY_KEY.test(key)) throw new Error('BROWSER_WRITE_SENSITIVE_QUERY_FORBIDDEN')
  if (PAYMENT_OR_ACCOUNT.test(`${url.pathname} ${url.search}`.replace(/[\/_.,?=&-]+/gu, ' '))) throw new Error('BROWSER_WRITE_HIGH_RISK_TARGET_FORBIDDEN')
  return url
}

function validateSelector(raw: string): string {
  const selector = raw.trim().slice(0, 300)
  if (!selector) throw new Error('BROWSER_WRITE_SELECTOR_REQUIRED')
  if (SENSITIVE_SELECTOR.test(selector) || PAYMENT_OR_ACCOUNT.test(selector.replace(/[#.\[\]_=:-]+/gu, ' '))) throw new Error('BROWSER_WRITE_SENSITIVE_SELECTOR_FORBIDDEN')
  return selector
}

function validateAction(action: BrowserWriteAction): BrowserWriteAction {
  if (!SAFE_ID.test(action.id)) throw new Error('BROWSER_WRITE_ACTION_ID_INVALID')
  if (action.kind === 'fill_field') {
    const selector = validateSelector(action.selector)
    const value = action.value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '').slice(0, 1_000)
    if (!value.trim()) throw new Error('BROWSER_WRITE_FILL_VALUE_REQUIRED')
    if (SENSITIVE_VALUE.test(value)) throw new Error('BROWSER_WRITE_SECRET_VALUE_FORBIDDEN')
    return { ...action, selector, value }
  }
  if (action.kind === 'submit_form') {
    const formSelector = validateSelector(action.formSelector)
    let prefix = clean(action.expectedPathPrefix, 300)
    if (!prefix.startsWith('/')) prefix = `/${prefix}`
    if (prefix.includes('..') || PAYMENT_OR_ACCOUNT.test(prefix.replace(/[\/_.,-]+/gu, ' '))) throw new Error('BROWSER_WRITE_SUBMIT_PATH_FORBIDDEN')
    return { ...action, formSelector, expectedPathPrefix: prefix }
  }
  if (action.kind === 'download_file') {
    const selector = validateSelector(action.selector)
    const extensions = [...new Set(action.allowedExtensions.map((value) => value.trim().toLowerCase()))]
    if (extensions.length < 1 || extensions.length > 8 || extensions.some((value) => !SAFE_DOWNLOAD_EXTENSIONS.has(value))) throw new Error('BROWSER_WRITE_DOWNLOAD_EXTENSION_FORBIDDEN')
    const maxBytes = Math.max(1_000, Math.min(5_000_000, Math.floor(action.maxBytes)))
    return { ...action, selector, maxBytes, allowedExtensions: extensions }
  }
  return { ...action, label: clean(action.label, 80).replace(/[^A-Za-z0-9._-]+/gu, '-') || 'write-safe' }
}

export function validateBrowserWriteJob(plan: BrowserWriteJobPlan): BrowserWriteJobPlan {
  if (plan.schemaVersion !== '0.1') throw new Error('BROWSER_WRITE_SCHEMA_UNSUPPORTED')
  if (plan.executionMode !== 'github-actions-manual-write-safe') throw new Error('BROWSER_WRITE_EXECUTION_MODE_FORBIDDEN')
  const target = validateUrl(plan.targetUrl)
  if (!Array.isArray(plan.actions) || plan.actions.length < 1 || plan.actions.length > MAX_ACTIONS) throw new Error('BROWSER_WRITE_ACTION_COUNT_INVALID')
  const submitCount = plan.actions.filter((action) => action.kind === 'submit_form').length
  if (submitCount > 3) throw new Error('BROWSER_WRITE_POST_LIMIT_EXCEEDED')
  const policy = plan.policy
  if (policy.monetaryCostUsd !== 0) throw new Error('BROWSER_WRITE_NONZERO_COST_FORBIDDEN')
  if (policy.allowedNetworkMethods.join(',') !== 'GET,HEAD,OPTIONS,POST') throw new Error('BROWSER_WRITE_METHOD_POLICY_INVALID')
  if (policy.maxPostRequests !== 3 || policy.allowPutPatchDelete !== false || policy.allowCrossSiteTopNavigation !== false || policy.allowSecrets !== false || policy.allowPayments !== false || policy.allowAuthenticationChanges !== false || policy.allowUpload !== false || policy.maxDownloadBytes !== 5_000_000) {
    throw new Error('BROWSER_WRITE_POLICY_INVARIANT_FAILED')
  }
  const safe: BrowserWriteJobPlan = {
    ...plan,
    name: clean(plan.name, 120) || target.hostname,
    targetUrl: target.href,
    actions: plan.actions.map(validateAction),
    policy: {
      allowedNetworkMethods: ['GET', 'HEAD', 'OPTIONS', 'POST'] as const,
      maxPostRequests: 3,
      allowPutPatchDelete: false,
      allowCrossSiteTopNavigation: false,
      allowSecrets: false,
      allowPayments: false,
      allowAuthenticationChanges: false,
      allowUpload: false,
      maxDownloadBytes: 5_000_000,
      monetaryCostUsd: 0,
    },
  }
  if (JSON.stringify(safe).length > MAX_PLAN_JSON_CHARS) throw new Error('BROWSER_WRITE_PLAN_TOO_LARGE')
  return safe
}

export function createBrowserWriteJob(name: string, targetUrl: string): BrowserWriteJobPlan {
  return validateBrowserWriteJob({
    schemaVersion: '0.1',
    id: id('browser-write-plan'),
    name,
    targetUrl,
    createdAt: new Date().toISOString(),
    approvedByHuman: false,
    executionMode: 'github-actions-manual-write-safe',
    actions: [{ id: 'evidence-before', kind: 'screenshot', label: 'before' }],
    policy: {
      allowedNetworkMethods: ['GET', 'HEAD', 'OPTIONS', 'POST'],
      maxPostRequests: 3,
      allowPutPatchDelete: false,
      allowCrossSiteTopNavigation: false,
      allowSecrets: false,
      allowPayments: false,
      allowAuthenticationChanges: false,
      allowUpload: false,
      maxDownloadBytes: 5_000_000,
      monetaryCostUsd: 0,
    },
  })
}

export function addBrowserWriteAction(plan: BrowserWriteJobPlan, action: BrowserWriteAction): BrowserWriteJobPlan {
  if (plan.actions.length >= MAX_ACTIONS) throw new Error('BROWSER_WRITE_ACTION_LIMIT_REACHED')
  return validateBrowserWriteJob({ ...plan, approvedByHuman: false, actions: [...plan.actions, action] })
}

export function removeBrowserWriteAction(plan: BrowserWriteJobPlan, actionId: string): BrowserWriteJobPlan {
  return validateBrowserWriteJob({ ...plan, approvedByHuman: false, actions: plan.actions.filter((action) => action.id !== actionId) })
}

export function approveBrowserWriteJob(plan: BrowserWriteJobPlan, approved: boolean): BrowserWriteJobPlan {
  return validateBrowserWriteJob({ ...plan, approvedByHuman: approved })
}

function readPlans(): BrowserWriteJobPlan[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLANS_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => { try { return [validateBrowserWriteJob(item as BrowserWriteJobPlan)] } catch { return [] } }).slice(0, MAX_PLANS)
  } catch { return [] }
}

export function loadBrowserWritePlans(): BrowserWriteJobPlan[] { return readPlans() }

export function saveBrowserWritePlan(plan: BrowserWriteJobPlan): BrowserWriteJobPlan[] {
  const safe = validateBrowserWriteJob(plan)
  const next = [safe, ...readPlans().filter((item) => item.id !== safe.id)].slice(0, MAX_PLANS)
  localStorage.setItem(PLANS_KEY, JSON.stringify(next))
  return next
}

export function exportBrowserWriteJob(plan: BrowserWriteJobPlan): string {
  const safe = validateBrowserWriteJob(plan)
  if (!safe.approvedByHuman) throw new Error('BROWSER_WRITE_HUMAN_APPROVAL_REQUIRED')
  return JSON.stringify(safe, null, 2)
}
