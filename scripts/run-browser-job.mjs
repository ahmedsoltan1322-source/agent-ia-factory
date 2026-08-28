import dns from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright-core'

const MAX_ACTIONS = 10
const MAX_PLAN_JSON_CHARS = 16_000
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const SENSITIVE_SELECTOR = /password|passwd|secret|token|api[-_ ]?key|credit|card|cvv|cvc|iban|routing|ssn|social[-_ ]?security|otp|one[-_ ]?time|2fa|mfa/iu
const SENSITIVE_QUERY_KEY = /token|secret|password|passwd|auth|api[-_]?key|access[-_]?key|session|credential/iu
const DANGEROUS_NAV_TERM = /\b(delete|remove|logout|log-out|signout|sign-out|unsubscribe|checkout|purchase|buy|pay|payment|transfer|submit|confirm|revoke|disable|deactivate|reset-password|change-password)\b/iu
const SECRET_VALUE = /-----BEGIN .*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bBearer\s+[A-Za-z0-9._~-]{24,}/iu
const PUBLIC_PREVIEW_UNSAFE = /https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\+?\d[\d\s().-]{6,}\d\b/iu
const ARTIFACT_DIR = path.resolve('browser-artifacts')
const dnsCache = new Map()

function fail(code) {
  throw new Error(code)
}

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f]/gu, ' ').trim().slice(0, max)
}

function isUnsafeIpv4(address) {
  if (address === '168.63.129.16') return true
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && parts[2] === 100) return true
  if (a === 203 && b === 0 && parts[2] === 113) return true
  if (a >= 224) return true
  return false
}

function isUnsafeIpv6(address) {
  const value = address.toLowerCase().split('%')[0]
  if (value === '::' || value === '::1') return true
  if (value.startsWith('fc') || value.startsWith('fd')) return true
  if (/^fe[89ab]/u.test(value)) return true
  if (value.startsWith('2001:db8:') || value === '2001:db8::') return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(value)
  if (mapped) return isUnsafeIpv4(mapped[1])
  return false
}

function isUnsafeIp(address) {
  const family = net.isIP(address)
  if (family === 4) return isUnsafeIpv4(address)
  if (family === 6) return isUnsafeIpv6(address)
  return true
}

function isUnsafeHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (net.isIP(host)) return true
  return false
}

async function assertPublicDns(hostname) {
  const host = hostname.toLowerCase()
  if (isUnsafeHostname(host)) fail('BROWSER_UNSAFE_HOST')
  if (dnsCache.has(host)) return dnsCache.get(host)
  const promise = (async () => {
    const addresses = await dns.lookup(host, { all: true, verbatim: true })
    if (!addresses.length) fail('BROWSER_DNS_EMPTY')
    for (const item of addresses) {
      if (isUnsafeIp(item.address)) fail(`BROWSER_DNS_PRIVATE_ADDRESS:${host}`)
    }
    return true
  })()
  dnsCache.set(host, promise)
  return promise
}

function containsDangerousNavigation(url) {
  let pathText = url.pathname
  try { pathText = decodeURIComponent(url.pathname) } catch { /* encoded path remains checked */ }
  if (DANGEROUS_NAV_TERM.test(pathText.replace(/[\/_.,]+/gu, ' '))) return true
  for (const [key, value] of url.searchParams.entries()) {
    if (DANGEROUS_NAV_TERM.test(`${key} ${value}`.replace(/[-_.,]+/gu, ' '))) return true
  }
  return false
}

function validateUrl(rawUrl) {
  let url
  try { url = new URL(String(rawUrl).trim()) } catch { fail('BROWSER_URL_INVALID') }
  if (url.protocol !== 'https:') fail('BROWSER_HTTPS_REQUIRED')
  if (url.username || url.password) fail('BROWSER_URL_CREDENTIALS_FORBIDDEN')
  if (isUnsafeHostname(url.hostname)) fail('BROWSER_UNSAFE_HOST')
  if (url.href.length > 2_000) fail('BROWSER_URL_TOO_LONG')
  if (containsDangerousNavigation(url)) fail('BROWSER_MUTATING_GET_FORBIDDEN')
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) fail('BROWSER_SENSITIVE_QUERY_FORBIDDEN')
  }
  return url
}

function hostFamily(hostname) {
  const host = hostname.toLowerCase()
  return new Set(host.startsWith('www.') ? [host, host.slice(4)] : [host, `www.${host}`])
}

function validateSelector(selector) {
  const safe = String(selector ?? '').trim().slice(0, 300)
  if (!safe) fail('BROWSER_SELECTOR_REQUIRED')
  if (SENSITIVE_SELECTOR.test(safe)) fail('BROWSER_SENSITIVE_FIELD_FORBIDDEN')
  return safe
}

function validatePlan(raw) {
  if (!raw || raw.schemaVersion !== '0.1') fail('BROWSER_SCHEMA_UNSUPPORTED')
  if (raw.executionMode !== 'github-actions-manual') fail('BROWSER_EXECUTION_MODE_FORBIDDEN')
  if (raw.approvedByHuman !== true) fail('BROWSER_HUMAN_APPROVAL_REQUIRED')
  if (!Array.isArray(raw.actions) || raw.actions.length < 1 || raw.actions.length > MAX_ACTIONS) fail('BROWSER_ACTION_COUNT_INVALID')
  const target = validateUrl(raw.targetUrl)
  const policy = raw.policy ?? {}
  if (policy.monetaryCostUsd !== 0) fail('BROWSER_NONZERO_COST_FORBIDDEN')
  if (policy.allowSubmit !== false || policy.allowDownload !== false || policy.allowUpload !== false || policy.allowSecrets !== false) fail('BROWSER_DANGEROUS_CAPABILITY_FORBIDDEN')
  if (policy.allowCrossSiteTopNavigation !== false) fail('BROWSER_CROSS_SITE_NAV_FORBIDDEN')
  if (!Array.isArray(policy.readOnlyNetworkMethods) || policy.readOnlyNetworkMethods.join(',') !== 'GET,HEAD,OPTIONS') fail('BROWSER_NETWORK_METHOD_POLICY_INVALID')
  const screenshotCount = raw.actions.filter((action) => action?.kind === 'screenshot').length
  if (screenshotCount > 4) fail('BROWSER_SCREENSHOT_LIMIT_EXCEEDED')

  const actions = raw.actions.map((action) => {
    if (!action || !/^[A-Za-z0-9._:-]{1,80}$/u.test(String(action.id ?? ''))) fail('BROWSER_ACTION_ID_INVALID')
    if (action.kind === 'read_text') return { ...action, selector: validateSelector(action.selector), maxChars: Math.max(100, Math.min(10_000, Number(action.maxChars) || 8_000)) }
    if (action.kind === 'extract_links') return { ...action, selector: validateSelector(action.selector), maxItems: Math.max(1, Math.min(50, Number(action.maxItems) || 30)) }
    if (action.kind === 'follow_link') return { ...action, selector: validateSelector(action.selector) }
    if (action.kind === 'fill_preview') {
      const selector = validateSelector(action.selector)
      const value = String(action.value ?? '').replace(/[\u0000-\u001f]/gu, ' ').slice(0, 200)
      if (!value.trim()) fail('BROWSER_FILL_VALUE_REQUIRED')
      if (SECRET_VALUE.test(value) || /\b\d{13,19}\b/u.test(value)) fail('BROWSER_SECRET_VALUE_FORBIDDEN')
      if (PUBLIC_PREVIEW_UNSAFE.test(value)) fail('BROWSER_PUBLIC_PREVIEW_VALUE_FORBIDDEN')
      return { ...action, selector, value }
    }
    if (action.kind === 'screenshot') {
      const label = cleanText(action.label, 80).replace(/[^A-Za-z0-9._-]+/gu, '-') || 'screenshot'
      return { ...action, label }
    }
    fail('BROWSER_ACTION_KIND_FORBIDDEN')
  })

  return { ...raw, name: cleanText(raw.name, 120), targetUrl: target.href, actions }
}

function findChrome() {
  const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean)
  for (const candidate of candidates) {
    try { if (fs.statSync(candidate).isFile()) return candidate } catch { /* try next */ }
  }
  fail('BROWSER_SYSTEM_CHROME_NOT_FOUND')
}

function safeOutputUrl(rawUrl) {
  try {
    const url = validateUrl(rawUrl)
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return ''
  }
}

async function main() {
  const planPath = process.argv[2]
  if (!planPath) fail('BROWSER_PLAN_PATH_REQUIRED')
  const rawText = fs.readFileSync(planPath, 'utf8')
  if (rawText.length > MAX_PLAN_JSON_CHARS) fail('BROWSER_PLAN_TOO_LARGE')
  const plan = validatePlan(JSON.parse(rawText))
  const target = validateUrl(plan.targetUrl)
  await assertPublicDns(target.hostname)
  const allowedTopHosts = hostFamily(target.hostname)

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const report = {
    schemaVersion: '1', planId: plan.id, name: plan.name, target: `${target.origin}${target.pathname}`,
    status: 'running', startedAt: new Date().toISOString(), finishedAt: '', monetaryCostUsd: 0,
    blockedWriteRequests: 0, blockedUnsafeNetworkRequests: 0, blockedPopups: 0, actions: [], finalUrl: '',
    policy: { networkMethods: ['GET', 'HEAD', 'OPTIONS'], submit: 'blocked', downloads: 'blocked', uploads: 'blocked', crossSiteTopNavigation: 'blocked', mutatingGetHeuristics: 'blocked', secrets: 'blocked', referrers: 'disabled' },
  }

  const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: ['--disable-dev-shm-usage', '--no-referrers'] })

  try {
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', ignoreHTTPSErrors: false, javaScriptEnabled: true, viewport: { width: 1280, height: 720 } })
    const page = await context.newPage()
    page.setDefaultTimeout(7_000)
    page.setDefaultNavigationTimeout(15_000)
    page.on('popup', async (popup) => { report.blockedPopups += 1; try { await popup.close() } catch { /* ignored */ } })
    page.on('dialog', async (dialog) => { try { await dialog.dismiss() } catch { /* ignored */ } })

    await context.route('**/*', async (route) => {
      const request = route.request()
      const method = request.method().toUpperCase()
      if (!ALLOWED_METHODS.has(method)) { report.blockedWriteRequests += 1; await route.abort('blockedbyclient'); return }
      let requestUrl
      try { requestUrl = new URL(request.url()) } catch { report.blockedUnsafeNetworkRequests += 1; await route.abort('blockedbyclient'); return }
      if (requestUrl.protocol === 'data:' || requestUrl.protocol === 'blob:') { await route.continue(); return }
      if (requestUrl.protocol !== 'https:') { report.blockedUnsafeNetworkRequests += 1; await route.abort('blockedbyclient'); return }
      try { await assertPublicDns(requestUrl.hostname) } catch { report.blockedUnsafeNetworkRequests += 1; await route.abort('blockedbyclient'); return }
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        try { validateUrl(requestUrl.href) } catch { report.blockedUnsafeNetworkRequests += 1; await route.abort('blockedbyclient'); return }
        if (!allowedTopHosts.has(requestUrl.hostname.toLowerCase())) { report.blockedUnsafeNetworkRequests += 1; await route.abort('blockedbyclient'); return }
      }
      await route.continue()
    })

    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 15_000 })

    for (const action of plan.actions) {
      const startedAt = new Date().toISOString()
      if (action.kind === 'read_text') {
        const text = await page.locator(action.selector).first().innerText({ timeout: 7_000 })
        report.actions.push({ id: action.id, kind: action.kind, status: 'success', startedAt, finishedAt: new Date().toISOString(), output: cleanText(text, action.maxChars) })
        continue
      }
      if (action.kind === 'extract_links') {
        const links = await page.locator(action.selector).evaluateAll((elements, maxItems) => elements.slice(0, maxItems).map((element) => ({ text: (element.textContent ?? '').trim().slice(0, 300), href: element instanceof HTMLAnchorElement ? element.href : '' })), action.maxItems)
        const safeLinks = links.map((link) => ({ text: cleanText(link.text, 300), href: safeOutputUrl(link.href) })).filter((link) => link.href && allowedTopHosts.has(new URL(link.href).hostname.toLowerCase()))
        report.actions.push({ id: action.id, kind: action.kind, status: 'success', startedAt, finishedAt: new Date().toISOString(), output: safeLinks.slice(0, action.maxItems) })
        continue
      }
      if (action.kind === 'follow_link') {
        const href = await page.locator(action.selector).first().getAttribute('href', { timeout: 7_000 })
        if (!href) fail('BROWSER_LINK_HREF_MISSING')
        const destination = validateUrl(new URL(href, page.url()).href)
        if (!allowedTopHosts.has(destination.hostname.toLowerCase())) fail('BROWSER_CROSS_SITE_NAV_FORBIDDEN')
        await assertPublicDns(destination.hostname)
        await page.goto(destination.href, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        report.actions.push({ id: action.id, kind: action.kind, status: 'success', startedAt, finishedAt: new Date().toISOString(), output: safeOutputUrl(page.url()) })
        continue
      }
      if (action.kind === 'fill_preview') {
        await page.locator(action.selector).first().evaluate((element, value) => {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            element.setAttribute('value', String(value))
            if (element instanceof HTMLTextAreaElement) element.textContent = String(value)
          } else if (element instanceof HTMLElement && element.isContentEditable) element.textContent = String(value)
          else throw new Error('BROWSER_FILL_TARGET_UNSUPPORTED')
        }, action.value)
        report.actions.push({ id: action.id, kind: action.kind, status: 'success', startedAt, finishedAt: new Date().toISOString(), output: 'Dummy preview value applied without submit or input/change event dispatch.' })
        continue
      }
      if (action.kind === 'screenshot') {
        const fileName = `${String(report.actions.length + 1).padStart(2, '0')}-${action.label}.png`
        await page.screenshot({ path: path.join(ARTIFACT_DIR, fileName), fullPage: false, animations: 'disabled', timeout: 10_000 })
        report.actions.push({ id: action.id, kind: action.kind, status: 'success', startedAt, finishedAt: new Date().toISOString(), output: fileName })
      }
    }

    report.status = 'success'
    report.finalUrl = safeOutputUrl(page.url())
    report.finishedAt = new Date().toISOString()
    await context.clearCookies()
    await context.close()
  } catch (error) {
    report.status = 'failed'
    report.finishedAt = new Date().toISOString()
    report.error = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'browser-report.json'), JSON.stringify(report, null, 2), 'utf8')
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
