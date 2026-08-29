import dns from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright-core'

const MAX_PLAN_JSON_CHARS = 20_000
const MAX_ACTIONS = 8
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const SENSITIVE = /password|passwd|secret|token|api[-_ ]?key|credit|card|cvv|cvc|iban|routing|ssn|otp|2fa|mfa|authenticator|recovery[-_ ]?code/iu
const PAYMENT = /\b(checkout|purchase|buy|pay|payment|transfer|wire|withdraw|deposit|bank|billing|subscription|upgrade|delete-account|close-account|reset-password|change-password|revoke|disable|deactivate)\b/iu
const SECRET_VALUE = /-----BEGIN .*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bBearer\s+[A-Za-z0-9._~-]{24,}|\b\d{13,19}\b/iu
const SAFE_EXT = new Set(['.pdf', '.txt', '.csv', '.json', '.png', '.jpg', '.jpeg', '.webp'])
const ARTIFACT_DIR = path.resolve('browser-write-artifacts')
const DOWNLOAD_DIR = path.join(ARTIFACT_DIR, 'downloads')
const dnsCache = new Map()

function fail(code) { throw new Error(code) }
function clean(value, max) { return String(value ?? '').replace(/[\u0000-\u001f]/gu, ' ').trim().slice(0, max) }
function isUnsafeIp(address) {
  const family = net.isIP(address)
  if (family === 6) return true
  if (family !== 4) return true
  const p = address.split('.').map(Number); const [a, b] = p
  if (p.length !== 4 || p.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return true
  if (address === '168.63.129.16' || a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224) return true
  return false
}
function unsafeHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  return !h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || Boolean(net.isIP(h))
}
async function assertPublicDns(hostname) {
  const h = hostname.toLowerCase()
  if (unsafeHost(h)) fail('BROWSER_WRITE_UNSAFE_HOST')
  if (!dnsCache.has(h)) dnsCache.set(h, (async () => {
    const items = await dns.lookup(h, { all: true, verbatim: true })
    if (!items.length || items.some((item) => isUnsafeIp(item.address))) fail('BROWSER_WRITE_DNS_PRIVATE_ADDRESS')
    return true
  })())
  return dnsCache.get(h)
}
function validateUrl(raw) {
  let url
  try { url = new URL(String(raw).trim()) } catch { fail('BROWSER_WRITE_URL_INVALID') }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || unsafeHost(url.hostname)) fail('BROWSER_WRITE_URL_FORBIDDEN')
  if (url.href.length > 2000 || PAYMENT.test(`${url.pathname} ${url.search}`.replace(/[\/_.,?=&-]+/gu, ' '))) fail('BROWSER_WRITE_HIGH_RISK_URL_FORBIDDEN')
  for (const key of url.searchParams.keys()) if (SENSITIVE.test(key)) fail('BROWSER_WRITE_SENSITIVE_QUERY_FORBIDDEN')
  return url
}
function validateSelector(raw) {
  const s = String(raw ?? '').trim().slice(0, 300)
  if (!s || SENSITIVE.test(s) || PAYMENT.test(s.replace(/[#.\[\]_=:-]+/gu, ' '))) fail('BROWSER_WRITE_SELECTOR_FORBIDDEN')
  return s
}
function validatePlan(raw) {
  if (!raw || raw.schemaVersion !== '0.1' || raw.executionMode !== 'github-actions-manual-write-safe' || raw.approvedByHuman !== true) fail('BROWSER_WRITE_PLAN_NOT_APPROVED')
  if (!Array.isArray(raw.actions) || raw.actions.length < 1 || raw.actions.length > MAX_ACTIONS) fail('BROWSER_WRITE_ACTION_COUNT_INVALID')
  const target = validateUrl(raw.targetUrl)
  const p = raw.policy ?? {}
  if (p.monetaryCostUsd !== 0 || p.allowedNetworkMethods?.join(',') !== 'GET,HEAD,OPTIONS,POST' || p.maxPostRequests !== 3 || p.allowPutPatchDelete !== false || p.allowCrossSiteTopNavigation !== false || p.allowSecrets !== false || p.allowPayments !== false || p.allowAuthenticationChanges !== false || p.allowUpload !== false || p.maxDownloadBytes !== 5000000) fail('BROWSER_WRITE_POLICY_INVALID')
  let submitCount = 0
  const actions = raw.actions.map((a) => {
    if (!a || !/^[A-Za-z0-9._:-]{1,80}$/u.test(String(a.id ?? ''))) fail('BROWSER_WRITE_ACTION_ID_INVALID')
    if (a.kind === 'fill_field') {
      const selector = validateSelector(a.selector); const value = String(a.value ?? '').slice(0, 1000)
      if (!value.trim() || SECRET_VALUE.test(value)) fail('BROWSER_WRITE_FILL_VALUE_FORBIDDEN')
      return { ...a, selector, value }
    }
    if (a.kind === 'submit_form') {
      submitCount += 1; if (submitCount > 3) fail('BROWSER_WRITE_POST_LIMIT_EXCEEDED')
      const formSelector = validateSelector(a.formSelector); let expectedPathPrefix = clean(a.expectedPathPrefix, 300)
      if (!expectedPathPrefix.startsWith('/')) expectedPathPrefix = `/${expectedPathPrefix}`
      if (expectedPathPrefix.includes('..') || PAYMENT.test(expectedPathPrefix.replace(/[\/_.,-]+/gu, ' '))) fail('BROWSER_WRITE_SUBMIT_PATH_FORBIDDEN')
      return { ...a, formSelector, expectedPathPrefix }
    }
    if (a.kind === 'download_file') {
      const selector = validateSelector(a.selector); const extensions = [...new Set((a.allowedExtensions ?? []).map((v) => String(v).toLowerCase()))]
      if (!extensions.length || extensions.some((v) => !SAFE_EXT.has(v))) fail('BROWSER_WRITE_DOWNLOAD_EXTENSION_FORBIDDEN')
      return { ...a, selector, maxBytes: Math.max(1000, Math.min(5000000, Number(a.maxBytes) || 5000000)), allowedExtensions: extensions }
    }
    if (a.kind === 'screenshot') return { ...a, label: clean(a.label, 80).replace(/[^A-Za-z0-9._-]+/gu, '-') || 'write-safe' }
    fail('BROWSER_WRITE_ACTION_KIND_FORBIDDEN')
  })
  return { ...raw, targetUrl: target.href, actions }
}
function findChrome() {
  for (const p of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean)) {
    try { if (fs.statSync(p).isFile()) return p } catch { /* next */ }
  }
  fail('BROWSER_WRITE_SYSTEM_CHROME_NOT_FOUND')
}
function hostFamily(hostname) { const h = hostname.toLowerCase(); return new Set(h.startsWith('www.') ? [h, h.slice(4)] : [h, `www.${h}`]) }
function timeoutReject(code, ms) { return new Promise((_, reject) => setTimeout(() => reject(new Error(code)), ms)) }

async function main() {
  const planPath = process.argv[2]
  if (!planPath) fail('BROWSER_WRITE_PLAN_PATH_REQUIRED')
  const text = fs.readFileSync(planPath, 'utf8'); if (text.length > MAX_PLAN_JSON_CHARS) fail('BROWSER_WRITE_PLAN_TOO_LARGE')
  const plan = validatePlan(JSON.parse(text)); const target = validateUrl(plan.targetUrl); await assertPublicDns(target.hostname)
  const allowedHosts = hostFamily(target.hostname)
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true, mode: 0o700 })
  const report = { schemaVersion: '0.1', planId: plan.id, status: 'running', startedAt: new Date().toISOString(), finishedAt: '', monetaryCostUsd: 0, postRequestsAllowed: 0, postRequestsBlocked: 0, unsafeRequestsBlocked: 0, downloadsSaved: 0, downloadsBlocked: 0, actions: [] }
  let permit = null
  const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: ['--disable-dev-shm-usage', '--no-referrers'] })
  try {
    const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block', ignoreHTTPSErrors: false, viewport: { width: 1280, height: 720 } })
    await context.routeWebSocket('**/*', () => {})
    const page = await context.newPage(); page.setDefaultTimeout(7000); page.setDefaultNavigationTimeout(15000)
    page.on('dialog', async (d) => { try { await d.dismiss() } catch {} })
    page.on('popup', async (p) => { try { await p.close() } catch {} })
    await context.route('**/*', async (route) => {
      const req = route.request(); const method = req.method().toUpperCase()
      let u; try { u = new URL(req.url()) } catch { report.unsafeRequestsBlocked += 1; await route.abort('blockedbyclient'); return }
      if (u.protocol === 'data:' || u.protocol === 'blob:') { await route.continue(); return }
      if (u.protocol !== 'https:' || (u.port && u.port !== '443') || !allowedHosts.has(u.hostname.toLowerCase())) { report.unsafeRequestsBlocked += 1; await route.abort('blockedbyclient'); return }
      try { validateUrl(u.href); await assertPublicDns(u.hostname) } catch { report.unsafeRequestsBlocked += 1; await route.abort('blockedbyclient'); return }
      if (SAFE_METHODS.has(method)) { await route.continue(); return }
      if (method !== 'POST') { report.postRequestsBlocked += 1; await route.abort('blockedbyclient'); return }
      const body = req.postData() ?? ''
      const currentPermit = permit
      const allowed = currentPermit && !currentPermit.consumed && currentPermit.host === u.hostname.toLowerCase() && u.pathname.startsWith(currentPermit.pathPrefix) && body.length <= 16000 && !SENSITIVE.test(body) && !SECRET_VALUE.test(body) && !PAYMENT.test(body)
      if (!allowed) {
        report.postRequestsBlocked += 1
        if (currentPermit && !currentPermit.settled) { currentPermit.settled = true; currentPermit.resolve(false) }
        await route.abort('blockedbyclient'); return
      }
      currentPermit.consumed = true; report.postRequestsAllowed += 1
      if (!currentPermit.settled) { currentPermit.settled = true; currentPermit.resolve(true) }
      await route.continue()
    })
    await page.goto(target.href, { waitUntil: 'domcontentloaded' })
    for (const action of plan.actions) {
      const startedAt = new Date().toISOString()
      if (action.kind === 'fill_field') {
        const loc = page.locator(action.selector).first(); const type = (await loc.getAttribute('type') ?? 'text').toLowerCase()
        const name = `${await loc.getAttribute('name') ?? ''} ${await loc.getAttribute('autocomplete') ?? ''}`
        if (['password', 'hidden', 'file'].includes(type) || SENSITIVE.test(name) || PAYMENT.test(name)) fail('BROWSER_WRITE_RUNTIME_FIELD_FORBIDDEN')
        await loc.fill(action.value)
        report.actions.push({ id: action.id, kind: action.kind, status: 'success', startedAt, finishedAt: new Date().toISOString(), valueChars: action.value.length })
        continue
      }
      if (action.kind === 'submit_form') {
        const form = page.locator(action.formSelector).first()
        const meta = await form.evaluate((el) => {
          if (!(el instanceof HTMLFormElement)) throw new Error('BROWSER_WRITE_FORM_REQUIRED')
          return { method: (el.method || 'get').toUpperCase(), action: el.action, valid: el.checkValidity(), fields: Array.from(el.elements).map((node) => ({ name: node instanceof HTMLElement ? (node.getAttribute('name') ?? '') : '', type: node instanceof HTMLInputElement ? node.type : '', value: node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : '' })) }
        })
        if (meta.method !== 'POST') fail('BROWSER_WRITE_FORM_POST_REQUIRED')
        if (!meta.valid) fail('BROWSER_WRITE_FORM_CONSTRAINT_VALIDATION_FAILED')
        const submitUrl = validateUrl(meta.action || page.url()); if (!allowedHosts.has(submitUrl.hostname.toLowerCase()) || !submitUrl.pathname.startsWith(action.expectedPathPrefix)) fail('BROWSER_WRITE_FORM_DESTINATION_FORBIDDEN')
        for (const field of meta.fields) if (SENSITIVE.test(`${field.name} ${field.type}`) || SECRET_VALUE.test(field.value) || PAYMENT.test(field.name)) fail('BROWSER_WRITE_FORM_FIELD_FORBIDDEN')
        let resolvePermit
        const permitDecision = new Promise((resolve) => { resolvePermit = resolve })
        permit = { host: submitUrl.hostname.toLowerCase(), pathPrefix: action.expectedPathPrefix, consumed: false, settled: false, resolve: resolvePermit }
        const observedPost = page.waitForRequest((request) => {
          if (request.method().toUpperCase() !== 'POST') return false
          try {
            const observed = new URL(request.url())
            return observed.hostname.toLowerCase() === submitUrl.hostname.toLowerCase() && observed.pathname.startsWith(action.expectedPathPrefix)
          } catch { return false }
        }, { timeout: 15000 })
        await form.evaluate((el) => { if (!(el instanceof HTMLFormElement)) throw new Error('BROWSER_WRITE_FORM_REQUIRED'); el.requestSubmit() })
        try { await observedPost } catch { fail('BROWSER_WRITE_EXPECTED_POST_NOT_OBSERVED') }
        const allowedByRoute = await Promise.race([permitDecision, timeoutReject('BROWSER_WRITE_POST_ROUTE_DECISION_TIMEOUT', 15000)])
        if (!allowedByRoute || !permit.consumed) fail('BROWSER_WRITE_EXPECTED_POST_NOT_ALLOWED')
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
        permit = null
        report.actions.push({ id: action.id, kind: action.kind, status: 'success', startedAt, finishedAt: new Date().toISOString() })
        continue
      }
      if (action.kind === 'download_file') {
        const locator = page.locator(action.selector).first(); const href = await locator.getAttribute('href'); if (!href) fail('BROWSER_WRITE_DOWNLOAD_HREF_REQUIRED')
        const downloadUrl = validateUrl(new URL(href, page.url()).href); if (!allowedHosts.has(downloadUrl.hostname.toLowerCase())) fail('BROWSER_WRITE_DOWNLOAD_CROSS_SITE_FORBIDDEN')
        const suggestedExt = path.extname(downloadUrl.pathname).toLowerCase(); if (suggestedExt && !action.allowedExtensions.includes(suggestedExt)) fail('BROWSER_WRITE_DOWNLOAD_EXTENSION_FORBIDDEN')
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), locator.click()])
        const name = path.basename(download.suggestedFilename()).replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 120) || 'download.bin'; const ext = path.extname(name).toLowerCase()
        if (!action.allowedExtensions.includes(ext) || !SAFE_EXT.has(ext)) { report.downloadsBlocked += 1; await download.cancel(); fail('BROWSER_WRITE_DOWNLOAD_EXTENSION_FORBIDDEN') }
        const stream = await download.createReadStream(); if (!stream) fail('BROWSER_WRITE_DOWNLOAD_STREAM_UNAVAILABLE')
        const out = path.join(DOWNLOAD_DIR, name); const writer = fs.createWriteStream(out, { flags: 'wx', mode: 0o600 }); let bytes = 0
        try { for await (const chunk of stream) { bytes += chunk.length; if (bytes > action.maxBytes || bytes > 5000000) { await download.cancel(); fail('BROWSER_WRITE_DOWNLOAD_TOO_LARGE') } writer.write(chunk) } } finally { writer.end() }
        report.downloadsSaved += 1; report.actions.push({ id: action.id, kind: action.kind, status: 'success', startedAt, finishedAt: new Date().toISOString(), bytes, extension: ext })
        continue
      }
      const file = path.join(ARTIFACT_DIR, `${action.label}.png`); await page.screenshot({ path: file, fullPage: false }); fs.chmodSync(file, 0o600)
      report.actions.push({ id: action.id, kind: action.kind, status: 'success', startedAt, finishedAt: new Date().toISOString() })
    }
    report.status = 'success'
  } finally {
    report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(ARTIFACT_DIR, 'browser-write-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); await browser.close()
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
