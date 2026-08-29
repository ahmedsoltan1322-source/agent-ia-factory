export type BrowserAction =
  | { id: string; kind: 'read_text'; selector: string; maxChars: number }
  | { id: string; kind: 'extract_links'; selector: string; maxItems: number }
  | { id: string; kind: 'follow_link'; selector: string }
  | { id: string; kind: 'fill_preview'; selector: string; value: string }
  | { id: string; kind: 'screenshot'; label: string }

export interface BrowserJobPlan {
  schemaVersion: '0.1'
  id: string
  name: string
  targetUrl: string
  createdAt: string
  approvedByHuman: boolean
  executionMode: 'github-actions-manual'
  actions: BrowserAction[]
  policy: {
    readOnlyNetworkMethods: readonly ['GET', 'HEAD', 'OPTIONS']
    allowSubmit: false
    allowDownload: false
    allowUpload: false
    allowSecrets: false
    allowCrossSiteTopNavigation: false
    maxActions: 10
    maxRunSeconds: 60
    monetaryCostUsd: 0
  }
}

const PLANS_KEY = 'agent-ia-factory.browser-plans.v1'
const MAX_PLANS = 20
const MAX_ACTIONS = 10
const MAX_PLAN_JSON_CHARS = 16_000
const SENSITIVE_SELECTOR = /password|passwd|secret|token|api[-_ ]?key|credit|card|cvv|cvc|iban|routing|ssn|social[-_ ]?security|otp|one[-_ ]?time|2fa|mfa/iu
const SENSITIVE_QUERY_KEY = /token|secret|password|passwd|auth|api[-_]?key|access[-_]?key|session|credential/iu
const DANGEROUS_NAV_TERM = /\b(delete|remove|logout|log-out|signout|sign-out|unsubscribe|checkout|purchase|buy|pay|payment|transfer|submit|confirm|revoke|disable|deactivate|reset-password|change-password)\b/iu
const SECRET_VALUE = /-----BEGIN .*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bBearer\s+[A-Za-z0-9._~-]{24,}/iu
const PUBLIC_PREVIEW_UNSAFE = /https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\+?\d[\d\s().-]{6,}\d\b/iu

function newId(prefix: string): string {
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
  // Raw IPv4 is intentionally blocked even when public in Phase 7A.
  return true
}

function containsDangerousNavigation(url: URL): boolean {
  let pathText = url.pathname
  try { pathText = decodeURIComponent(url.pathname) } catch { /* encoded path remains checked */ }
  if (DANGEROUS_NAV_TERM.test(pathText.replace(/[\/_.,]+/gu, ' '))) return true
  for (const [key, value] of url.searchParams.entries()) {
    if (DANGEROUS_NAV_TERM.test(`${key} ${value}`.replace(/[-_.,]+/gu, ' '))) return true
  }
  return false
}

export function validateBrowserTarget(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw new Error('BROWSER_URL_INVALID')
  }
  if (url.protocol !== 'https:') throw new Error('BROWSER_HTTPS_REQUIRED')
  if (url.port && url.port !== '443') throw new Error('BROWSER_NONSTANDARD_PORT_FORBIDDEN')
  if (url.username || url.password) throw new Error('BROWSER_URL_CREDENTIALS_FORBIDDEN')
  if (isPrivateOrUnsafeHost(url.hostname)) throw new Error('BROWSER_PRIVATE_OR_IP_HOST_FORBIDDEN')
  if (url.href.length > 2_000) throw new Error('BROWSER_URL_TOO_LONG')
  if (containsDangerousNavigation(url)) throw new Error('BROWSER_MUTATING_GET_FORBIDDEN')
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) throw new Error('BROWSER_SENSITIVE_QUERY_FORBIDDEN')
  }
  return url
}

function validateSelector(selector: string): string {
  const safe = selector.trim().slice(0, 300)
  if (!safe) throw new Error('BROWSER_SELECTOR_REQUIRED')
  if (SENSITIVE_SELECTOR.test(safe)) throw new Error('BROWSER_SENSITIVE_FIELD_FORBIDDEN')
  return safe
}

function validateAction(action: BrowserAction): BrowserAction {
  if (!/^[A-Za-z0-9._:-]{1,80}$/u.test(action.id)) throw new Error('BROWSER_ACTION_ID_INVALID')
  if (action.kind === 'read_text') {
    return { ...action, selector: validateSelector(action.selector), maxChars: Math.max(100, Math.min(10_000, Math.floor(action.maxChars))) }
  }
  if (action.kind === 'extract_links') {
    return { ...action, selector: validateSelector(action.selector), maxItems: Math.max(1, Math.min(50, Math.floor(action.maxItems))) }
  }
  if (action.kind === 'follow_link') {
    return { ...action, selector: validateSelector(action.selector) }
  }
  if (action.kind === 'fill_preview') {
    const selector = validateSelector(action.selector)
    const value = action.value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '').slice(0, 200)
    if (!value) throw new Error('BROWSER_FILL_VALUE_REQUIRED')
    if (SECRET_VALUE.test(value) || /\b\d{13,19}\b/u.test(value)) throw new Error('BROWSER_SECRET_VALUE_FORBIDDEN')
    if (PUBLIC_PREVIEW_UNSAFE.test(value)) throw new Error('BROWSER_PUBLIC_PREVIEW_VALUE_FORBIDDEN')
    return { ...action, selector, value }
  }
  const label = clean(action.label, 80).replace(/[^A-Za-z0-9._-]+/gu, '-') || 'screenshot'
  return { ...action, label }
}

export function validateBrowserJob(plan: BrowserJobPlan): BrowserJobPlan {
  if (plan.schemaVersion !== '0.1') throw new Error('BROWSER_SCHEMA_UNSUPPORTED')
  const target = validateBrowserTarget(plan.targetUrl)
  if (plan.executionMode !== 'github-actions-manual') throw new Error('BROWSER_EXECUTION_MODE_FORBIDDEN')
  if (plan.actions.length < 1 || plan.actions.length > MAX_ACTIONS) throw new Error('BROWSER_ACTION_COUNT_INVALID')
  if (plan.policy.monetaryCostUsd !== 0) throw new Error('BROWSER_NONZERO_COST_FORBIDDEN')
  if (plan.policy.allowSubmit !== false || plan.policy.allowDownload !== false || plan.policy.allowUpload !== false || plan.policy.allowSecrets !== false) {
    throw new Error('BROWSER_DANGEROUS_CAPABILITY_FORBIDDEN')
  }
  if (plan.policy.allowCrossSiteTopNavigation !== false) throw new Error('BROWSER_CROSS_SITE_NAV_FORBIDDEN')
  const methods = [...plan.policy.readOnlyNetworkMethods]
  if (methods.join(',') !== 'GET,HEAD,OPTIONS') throw new Error('BROWSER_NETWORK_METHOD_POLICY_INVALID')
  const safe: BrowserJobPlan = {
    ...plan,
    name: clean(plan.name, 120) || target.hostname,
    targetUrl: target.href,
    actions: plan.actions.map(validateAction),
    policy: {
      readOnlyNetworkMethods: ['GET', 'HEAD', 'OPTIONS'] as const,
      allowSubmit: false,
      allowDownload: false,
      allowUpload: false,
      allowSecrets: false,
      allowCrossSiteTopNavigation: false,
      maxActions: 10,
      maxRunSeconds: 60,
      monetaryCostUsd: 0,
    },
  }
  if (JSON.stringify(safe).length > MAX_PLAN_JSON_CHARS) throw new Error('BROWSER_PLAN_TOO_LARGE')
  return safe
}

export function createSafeBrowserJob(name: string, targetUrl: string): BrowserJobPlan {
  return validateBrowserJob({
    schemaVersion: '0.1',
    id: newId('browser-plan'),
    name,
    targetUrl,
    createdAt: new Date().toISOString(),
    approvedByHuman: false,
    executionMode: 'github-actions-manual',
    actions: [
      { id: 'read-page', kind: 'read_text', selector: 'body', maxChars: 8_000 },
      { id: 'links', kind: 'extract_links', selector: 'a[href]', maxItems: 30 },
      { id: 'screen', kind: 'screenshot', label: 'page' },
    ],
    policy: {
      readOnlyNetworkMethods: ['GET', 'HEAD', 'OPTIONS'] as const,
      allowSubmit: false,
      allowDownload: false,
      allowUpload: false,
      allowSecrets: false,
      allowCrossSiteTopNavigation: false,
      maxActions: 10,
      maxRunSeconds: 60,
      monetaryCostUsd: 0,
    },
  })
}

export function approveBrowserJob(plan: BrowserJobPlan, approved: boolean): BrowserJobPlan {
  return validateBrowserJob({ ...plan, approvedByHuman: approved })
}

export function addBrowserAction(plan: BrowserJobPlan, action: BrowserAction): BrowserJobPlan {
  if (plan.actions.length >= MAX_ACTIONS) throw new Error('BROWSER_ACTION_LIMIT_REACHED')
  return validateBrowserJob({ ...plan, approvedByHuman: false, actions: [...plan.actions, action] })
}

export function removeBrowserAction(plan: BrowserJobPlan, actionId: string): BrowserJobPlan {
  return validateBrowserJob({ ...plan, approvedByHuman: false, actions: plan.actions.filter((action) => action.id !== actionId) })
}

function readPlans(): BrowserJobPlan[] {
  try {
    const raw = localStorage.getItem(PLANS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      try { return [validateBrowserJob(item as BrowserJobPlan)] } catch { return [] }
    }).slice(0, MAX_PLANS)
  } catch {
    return []
  }
}

export function loadBrowserPlans(): BrowserJobPlan[] { return readPlans() }

export function saveBrowserPlan(plan: BrowserJobPlan): BrowserJobPlan[] {
  const safe = validateBrowserJob(plan)
  const next = [safe, ...readPlans().filter((item) => item.id !== safe.id)].slice(0, MAX_PLANS)
  localStorage.setItem(PLANS_KEY, JSON.stringify(next))
  return next
}

export function deleteBrowserPlan(planId: string): BrowserJobPlan[] {
  const next = readPlans().filter((item) => item.id !== planId)
  localStorage.setItem(PLANS_KEY, JSON.stringify(next))
  return next
}

export function exportBrowserJob(plan: BrowserJobPlan): string {
  const safe = validateBrowserJob(plan)
  if (!safe.approvedByHuman) throw new Error('BROWSER_HUMAN_APPROVAL_REQUIRED')
  return JSON.stringify(safe, null, 2)
}
