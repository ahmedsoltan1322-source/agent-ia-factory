import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright-core'

const MAX_PLAN_JSON_CHARS = 48_000
const MAX_OPERATIONS = 4
const MAX_DOWNLOAD_BYTES = 5_000_000
const MAX_UPLOAD_PREVIEW_BYTES = 16_384
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const ARTIFACT_DIR = path.resolve('browser-transfer-artifacts')
const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/u
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.txt$/u
const SENSITIVE_SELECTOR = /password|passwd|secret|token|api[-_ ]?key|credit|card|cvv|cvc|iban|routing|ssn|social[-_ ]?security|otp|one[-_ ]?time|2fa|mfa/iu
const SENSITIVE_QUERY_KEY = /token|secret|password|passwd|auth|api[-_]?key|access[-_]?key|session|credential/iu
const DANGEROUS_NAV_TERM = /\b(delete|remove|logout|log-out|signout|sign-out|unsubscribe|checkout|purchase|buy|pay|payment|transfer|submit|confirm|revoke|disable|deactivate|reset-password|change-password)\b/iu
const SECRET_VALUE = /-----BEGIN .*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bBearer\s+[A-Za-z0-9._~-]{24,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/iu
const PERSONAL_OR_REMOTE_VALUE = /https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\+?\d[\d\s().-]{6,}\d\b/iu
const ALLOWED_MIME = new Map([
  ['text/plain', 'txt'],
  ['text/csv', 'csv.txt'],
  ['text/html', 'html.txt'],
  ['application/json', 'json.txt'],
  ['application/pdf', 'pdf'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
])

function fail(code) { throw new Error(code) }
function clean(value, max) { return String(value ?? '').replace(/[\u0000-\u001f]/gu, ' ').trim().slice(0, max) }
function hostFamily(hostname) {
  const host = hostname.toLowerCase()
  return new Set(host.startsWith('www.') ? [host, host.slice(4)] : [host, `www.${host}`])
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
  if (a === 192 && (b === 0 || b === 168)) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && parts[2] === 100) return true
  if (a === 203 && b === 0 && parts[2] === 113) return true
  if (a >= 224) return true
  return false
}
function isUnsafeHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  return !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || net.isIP(host) !== 0
}
function containsDangerousNavigation(url) {
  let pathText = url.pathname
  try { pathText = decodeURIComponent(url.pathname) } catch { /* keep encoded */ }
  if (DANGEROUS_NAV_TERM.test(pathText.replace(/[\/_.,]+/gu, ' '))) return true
  for (const [key, value] of url.searchParams.entries()) if (DANGEROUS_NAV_TERM.test(`${key} ${value}`.replace(/[-_.,]+/gu, ' '))) return true
  return false
}
function hasSensitiveQuery(url) {
  for (const key of url.searchParams.keys()) if (SENSITIVE_QUERY_KEY.test(key)) return true
  return false
}
function validateUrl(raw) {
  let url
  try { url = new URL(String(raw).trim()) } catch { fail('BROWSER_TRANSFER_URL_INVALID') }
  if (url.protocol !== 'https:') fail('BROWSER_TRANSFER_HTTPS_REQUIRED')
  if (url.port && url.port !== '443') fail('BROWSER_TRANSFER_NONSTANDARD_PORT_FORBIDDEN')
  if (url.username || url.password) fail('BROWSER_TRANSFER_URL_CREDENTIALS_FORBIDDEN')
  if (isUnsafeHostname(url.hostname)) fail('BROWSER_TRANSFER_UNSAFE_HOST')
  if (url.href.length > 2_000) fail('BROWSER_TRANSFER_URL_TOO_LONG')
  if (containsDangerousNavigation(url)) fail('BROWSER_TRANSFER_MUTATING_GET_FORBIDDEN')
  if (hasSensitiveQuery(url)) fail('BROWSER_TRANSFER_SENSITIVE_QUERY_FORBIDDEN')
  return url
}
async function resolvePinnedPublicIpv4(hostname) {
  const answers = await dns.lookup(hostname, { all: true, verbatim: true })
  const safe = answers.find((item) => item.family === 4 && !isUnsafeIpv4(item.address))
  if (!safe) fail('BROWSER_TRANSFER_NO_SAFE_IPV4')
  return safe.address
}
function validateSelector(raw) {
  const selector = String(raw ?? '').trim().slice(0, 300)
  if (!selector) fail('BROWSER_TRANSFER_SELECTOR_REQUIRED')
  if (SENSITIVE_SELECTOR.test(selector)) fail('BROWSER_TRANSFER_SENSITIVE_FIELD_FORBIDDEN')
  return selector
}
function validatePlan(raw) {
  if (!raw || raw.schemaVersion !== '0.1') fail('BROWSER_TRANSFER_SCHEMA_UNSUPPORTED')
  if (raw.executionMode !== 'github-actions-manual') fail('BROWSER_TRANSFER_EXECUTION_MODE_FORBIDDEN')
  if (raw.approvedByHuman !== true) fail('BROWSER_TRANSFER_HUMAN_APPROVAL_REQUIRED')
  if (!Array.isArray(raw.operations) || raw.operations.length < 1 || raw.operations.length > MAX_OPERATIONS) fail('BROWSER_TRANSFER_OPERATION_COUNT_INVALID')
  const target = validateUrl(raw.targetUrl)
  const policy = raw.policy ?? {}
  if (policy.monetaryCostUsd !== 0) fail('BROWSER_TRANSFER_NONZERO_COST_FORBIDDEN')
  if (policy.allowExternalUpload !== false || policy.allowSubmit !== false || policy.allowRedirects !== false || policy.allowCookies !== false || policy.allowAuth !== false || policy.allowSecrets !== false) fail('BROWSER_TRANSFER_DANGEROUS_CAPABILITY_FORBIDDEN')
  if (policy.allowExecutableDownloads !== false || policy.allowArchiveDownloads !== false || policy.sameHostFamilyOnly !== true) fail('BROWSER_TRANSFER_FILE_POLICY_INVALID')
  if (!Array.isArray(policy.allowedNetworkMethods) || policy.allowedNetworkMethods.join(',') !== 'GET,HEAD,OPTIONS') fail('BROWSER_TRANSFER_NETWORK_POLICY_INVALID')
  if (policy.maxDownloadBytes !== MAX_DOWNLOAD_BYTES || policy.maxUploadPreviewBytes !== MAX_UPLOAD_PREVIEW_BYTES || policy.maxOperations !== MAX_OPERATIONS || policy.maxRunSeconds !== 60) fail('BROWSER_TRANSFER_LIMIT_POLICY_INVALID')
  const family = hostFamily(target.hostname)
  const operations = raw.operations.map((operation) => {
    if (!operation || !SAFE_ID.test(String(operation.id ?? ''))) fail('BROWSER_TRANSFER_OPERATION_ID_INVALID')
    if (operation.kind === 'download_capture') {
      const url = validateUrl(operation.url)
      if (!family.has(url.hostname.toLowerCase())) fail('BROWSER_TRANSFER_CROSS_SITE_FORBIDDEN')
      const maxBytes = Math.floor(Number(operation.maxBytes))
      if (!Number.isFinite(maxBytes) || maxBytes < 1024 || maxBytes > MAX_DOWNLOAD_BYTES) fail('BROWSER_TRANSFER_DOWNLOAD_LIMIT_INVALID')
      return { id: operation.id, kind: operation.kind, url: url.href, maxBytes }
    }
    if (operation.kind === 'upload_preview') {
      const selector = validateSelector(operation.selector)
      const filename = String(operation.filename ?? '').trim()
      if (!SAFE_FILENAME.test(filename) || filename.includes('..')) fail('BROWSER_TRANSFER_FILENAME_INVALID')
      if (operation.mimeType !== 'text/plain') fail('BROWSER_TRANSFER_UPLOAD_MIME_FORBIDDEN')
      const content = String(operation.content ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '')
      const bytes = Buffer.byteLength(content, 'utf8')
      if (!content.trim() || bytes > MAX_UPLOAD_PREVIEW_BYTES) fail('BROWSER_TRANSFER_UPLOAD_PREVIEW_SIZE_INVALID')
      if (SECRET_VALUE.test(content) || /\b\d{13,19}\b/u.test(content)) fail('BROWSER_TRANSFER_SECRET_VALUE_FORBIDDEN')
      if (PERSONAL_OR_REMOTE_VALUE.test(content)) fail('BROWSER_TRANSFER_PUBLIC_PREVIEW_VALUE_FORBIDDEN')
      return { id: operation.id, kind: operation.kind, selector, filename, mimeType: 'text/plain', content }
    }
    fail('BROWSER_TRANSFER_OPERATION_KIND_FORBIDDEN')
  })
  return { ...raw, name: clean(raw.name, 120), targetUrl: target.href, operations }
}
function findChrome() {
  const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean)
  for (const candidate of candidates) { try { if (fs.statSync(candidate).isFile()) return candidate } catch { /* try next */ } }
  fail('BROWSER_TRANSFER_SYSTEM_CHROME_NOT_FOUND')
}
function assertSafeMagic(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) fail('BROWSER_TRANSFER_EXECUTABLE_MAGIC_FORBIDDEN')
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer.subarray(1, 4).toString('ascii') === 'ELF') fail('BROWSER_TRANSFER_EXECUTABLE_MAGIC_FORBIDDEN')
  const hex4 = buffer.subarray(0, 4).toString('hex')
  if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe'].includes(hex4)) fail('BROWSER_TRANSFER_EXECUTABLE_MAGIC_FORBIDDEN')
  if (hex4 === '504b0304' || hex4 === '52617221' || buffer.subarray(0, 6).toString('hex') === '377abcaf271c' || buffer.subarray(0, 2).toString('hex') === '1f8b') fail('BROWSER_TRANSFER_ARCHIVE_MAGIC_FORBIDDEN')
}
async function downloadCapture(operation, family, report) {
  const url = validateUrl(operation.url)
  if (!family.has(url.hostname.toLowerCase())) fail('BROWSER_TRANSFER_CROSS_SITE_FORBIDDEN')
  const address = await resolvePinnedPublicIpv4(url.hostname)
  const tempPath = path.join(ARTIFACT_DIR, `${operation.id}.part`)
  const hash = crypto.createHash('sha256')
  let bytes = 0
  let firstChunk = Buffer.alloc(0)
  let mime = ''
  try {
    await new Promise((resolve, reject) => {
      const request = https.request({
        protocol: 'https:', hostname: url.hostname, port: 443, method: 'GET', path: `${url.pathname}${url.search}`,
        servername: url.hostname, timeout: 10_000,
        headers: { Accept: [...ALLOWED_MIME.keys()].join(', '), 'User-Agent': 'Agent-IA-Factory-FileTransfer/0.1', Connection: 'close' },
        lookup: (_hostname, _options, callback) => callback(null, address, 4),
      }, (response) => {
        if (response.statusCode !== 200) { response.resume(); reject(new Error(response.statusCode && response.statusCode >= 300 && response.statusCode < 400 ? 'BROWSER_TRANSFER_REDIRECT_FORBIDDEN' : `BROWSER_TRANSFER_HTTP_${response.statusCode ?? 0}`)); return }
        mime = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
        if (!ALLOWED_MIME.has(mime)) { response.resume(); reject(new Error('BROWSER_TRANSFER_DOWNLOAD_MIME_FORBIDDEN')); return }
        const declared = Number(response.headers['content-length'] ?? '0')
        if (Number.isFinite(declared) && declared > operation.maxBytes) { response.resume(); reject(new Error('BROWSER_TRANSFER_DOWNLOAD_TOO_LARGE')); return }
        const output = fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 })
        let settled = false
        const stop = (error) => { if (settled) return; settled = true; response.destroy(); output.destroy(); reject(error) }
        response.on('data', (chunk) => {
          bytes += chunk.length
          if (bytes > operation.maxBytes) { stop(new Error('BROWSER_TRANSFER_DOWNLOAD_TOO_LARGE')); return }
          if (firstChunk.length < 16) firstChunk = Buffer.concat([firstChunk, chunk]).subarray(0, 16)
          hash.update(chunk)
        })
        response.pipe(output)
        output.on('finish', () => { if (settled) return; settled = true; resolve() })
        output.on('error', (error) => stop(error))
        response.on('error', (error) => stop(error))
      })
      request.on('timeout', () => request.destroy(new Error('BROWSER_TRANSFER_DOWNLOAD_TIMEOUT')))
      request.on('error', reject)
      request.end()
    })
    assertSafeMagic(firstChunk)
    const extension = ALLOWED_MIME.get(mime)
    const finalName = `download-${operation.id}.${extension}`
    const finalPath = path.join(ARTIFACT_DIR, finalName)
    fs.renameSync(tempPath, finalPath)
    fs.chmodSync(finalPath, 0o400)
    report.operations.push({ id: operation.id, kind: operation.kind, status: 'success', bytes, mimeType: mime, sha256: hash.digest('hex'), artifactFile: finalName, sourceHost: url.hostname })
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }) } catch { /* ignored */ }
    throw error
  }
}
async function uploadPreview(operation, target, family, report) {
  const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: ['--disable-dev-shm-usage', '--no-referrers'] })
  try {
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', javaScriptEnabled: false, ignoreHTTPSErrors: false, viewport: { width: 1280, height: 720 } })
    const page = await context.newPage()
    page.setDefaultTimeout(7_000)
    page.setDefaultNavigationTimeout(15_000)
    let blockedWriteRequests = 0
    let blockedCrossSiteRequests = 0
    await context.route('**/*', async (route) => {
      const request = route.request()
      const method = request.method().toUpperCase()
      if (!ALLOWED_METHODS.has(method)) { blockedWriteRequests += 1; await route.abort('blockedbyclient'); return }
      let requestUrl
      try { requestUrl = validateUrl(request.url()) } catch { blockedCrossSiteRequests += 1; await route.abort('blockedbyclient'); return }
      if (!family.has(requestUrl.hostname.toLowerCase())) { blockedCrossSiteRequests += 1; await route.abort('blockedbyclient'); return }
      try { await resolvePinnedPublicIpv4(requestUrl.hostname) } catch { blockedCrossSiteRequests += 1; await route.abort('blockedbyclient'); return }
      const headers = { ...request.headers() }
      delete headers.cookie
      delete headers.authorization
      delete headers.referer
      await route.continue({ headers })
    })
    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    const locator = page.locator(operation.selector).first()
    const type = (await locator.getAttribute('type'))?.toLowerCase()
    if (type !== 'file') fail('BROWSER_TRANSFER_FILE_INPUT_REQUIRED')
    const size = Buffer.byteLength(operation.content, 'utf8')
    await locator.setInputFiles({ name: operation.filename, mimeType: 'text/plain', buffer: Buffer.from(operation.content, 'utf8') })
    const selectedName = await locator.evaluate((element) => element instanceof HTMLInputElement ? element.files?.[0]?.name ?? '' : '')
    const selectedSize = await locator.evaluate((element) => element instanceof HTMLInputElement ? element.files?.[0]?.size ?? -1 : -1)
    if (selectedName !== operation.filename || selectedSize !== size) fail('BROWSER_TRANSFER_UPLOAD_PREVIEW_BINDING_FAILED')
    report.operations.push({ id: operation.id, kind: operation.kind, status: 'success', filename: operation.filename, mimeType: 'text/plain', bytes: size, javascriptEnabled: false, externalUploadPerformed: false, blockedWriteRequests, blockedCrossSiteRequests })
    await context.close()
  } finally { await browser.close() }
}

async function main() {
  const planPath = process.argv[2]
  if (!planPath) fail('BROWSER_TRANSFER_PLAN_PATH_REQUIRED')
  const rawText = fs.readFileSync(planPath, 'utf8')
  if (rawText.length > MAX_PLAN_JSON_CHARS) fail('BROWSER_TRANSFER_PLAN_TOO_LARGE')
  const plan = validatePlan(JSON.parse(rawText))
  const target = validateUrl(plan.targetUrl)
  const family = hostFamily(target.hostname)
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const report = {
    schemaVersion: '1', planId: plan.id, name: plan.name, targetHost: target.hostname, status: 'running',
    startedAt: new Date().toISOString(), finishedAt: '', monetaryCostUsd: 0,
    externalUploadAllowed: false, submitAllowed: false, redirectsAllowed: false, cookiesAllowed: false, authAllowed: false,
    executableDownloadsAllowed: false, archiveDownloadsAllowed: false, sameHostFamilyOnly: true,
    maxDownloadBytes: MAX_DOWNLOAD_BYTES, maxUploadPreviewBytes: MAX_UPLOAD_PREVIEW_BYTES,
    operations: [],
  }
  try {
    for (const operation of plan.operations) {
      if (operation.kind === 'download_capture') await downloadCapture(operation, family, report)
      else await uploadPreview(operation, target, family, report)
    }
    report.status = 'success'
  } catch (error) {
    report.status = 'failed'
    report.error = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    report.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'transfer-report.json'), JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 })
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
