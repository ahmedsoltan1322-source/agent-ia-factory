import fs from 'node:fs'

const required = [
  'src/core/workerAuth.ts',
  'src/core/workerTransport.ts',
  'src/core/workerServerCore.ts',
  'src/components/AuthenticatedWorkerCenter.tsx',
  'src/transport.css',
  'scripts/worker-server.mjs',
  'scripts/test-phase9c-transport.mjs',
  'docs/PHASE9C_AUTHENTICATED_TRANSPORT.md',
  '.github/workflows/phase9c-transport-ci.yml',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 9C file: ${file}`)
}

const auth = fs.readFileSync('src/core/workerAuth.ts', 'utf8')
const transport = fs.readFileSync('src/core/workerTransport.ts', 'utf8')
const serverCore = fs.readFileSync('src/core/workerServerCore.ts', 'utf8')
const server = fs.readFileSync('scripts/worker-server.mjs', 'utf8')
const ui = fs.readFileSync('src/components/AuthenticatedWorkerCenter.tsx', 'utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx', 'utf8')
const main = fs.readFileSync('src/main.tsx', 'utf8')
const smoke = fs.readFileSync('scripts/test-phase9c-transport.mjs', 'utf8')
const docs = fs.readFileSync('docs/PHASE9C_AUTHENTICATED_TRANSPORT.md', 'utf8')
const workflow = fs.readFileSync('.github/workflows/phase9c-transport-ci.yml', 'utf8')
const phase9bValidator = fs.readFileSync('scripts/validate-phase9b.mjs', 'utf8')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

for (const marker of [
  "export const WORKER_TRANSPORT_PROTOCOL = 'agent-ia-factory.transport/0.1'",
  "export const WORKER_EXECUTE_PATH = '/v1/execute'",
  'export const WORKER_AUTH_MAX_SKEW_SECONDS = 90',
  'export const WORKER_AUTH_SECRET_BYTES = 32',
  'export const WORKER_AUTH_NONCE_BYTES = 16',
  "crypto.getRandomValues(bytes)",
  "crypto.subtle.digest('SHA-256'",
  "{ name: 'HMAC', hash: 'SHA-256' }",
  "crypto.subtle.sign('HMAC'",
  "crypto.subtle.verify('HMAC'",
  "'WORKER_AUTH_TIMESTAMP_STALE'",
  "'WORKER_AUTH_BODY_DIGEST_MISMATCH'",
  "'WORKER_AUTH_SIGNATURE_MISMATCH'",
  "'WORKER_AUTH_RESPONSE_DIGEST_MISMATCH'",
  "'WORKER_AUTH_RESPONSE_SIGNATURE_MISMATCH'",
]) {
  if (!auth.includes(marker)) throw new Error(`Phase 9C auth invariant missing: ${marker}`)
}
for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'WebSocket(', 'Authorization', 'Bearer ']) {
  if (auth.includes(forbidden)) throw new Error(`Worker auth must remain pure and storage/network neutral: ${forbidden}`)
}

for (const marker of [
  "url.protocol !== 'https:'",
  'url.username || url.password || url.search || url.hash',
  "credentials: 'omit'",
  "cache: 'no-store'",
  "redirect: 'error'",
  "referrerPolicy: 'no-referrer'",
  "mode: 'cors'",
  "const MAX_TIMEOUT_MS = 30_000",
  "throw new Error('WORKER_TRANSPORT_UNCERTAIN_TIMEOUT')",
  'verifySignedWorkerResponse(',
  'validateWorkerReceipt(receipt, bundle)',
]) {
  if (!transport.includes(marker)) throw new Error(`Phase 9C transport invariant missing: ${marker}`)
}
for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'setInterval(', 'Authorization', 'Bearer ', 'retry(', 'while (true)']) {
  if (transport.includes(forbidden)) throw new Error(`Authenticated transport must not persist secrets or auto-retry: ${forbidden}`)
}

for (const marker of [
  'export const WORKER_SERVER_REPLAY_TTL_MS = 2 * 60_000',
  'export const WORKER_SERVER_MAX_REQUESTS_PER_WINDOW = 10',
  'export const WORKER_SERVER_MAX_NONCES = 1_000',
  'export const WORKER_SERVER_MAX_RECEIPTS = 100',
  "url.protocol !== 'https:'",
  "'access-control-allow-origin': origin",
  "'access-control-allow-methods': 'POST, OPTIONS'",
  "state.seenNonces.has(auth.nonce)",
  "WORKER_AUTH_REPLAY",
  'state.requestTimes.length >= config.maxRequestsPerMinute',
  "WORKER_SERVER_RATE_LIMIT",
  'state.receiptCache.get(bundle.bundleId)',
  'state.receiptCache.set(bundle.bundleId',
  'runReferenceWorkerBundle(bundle, nowIso)',
]) {
  if (!serverCore.includes(marker)) throw new Error(`Phase 9C server-core invariant missing: ${marker}`)
}
if (serverCore.includes("'access-control-allow-origin': '*'")) throw new Error('Wildcard CORS is forbidden')
for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'Authorization', 'Bearer ', '0.0.0.0']) {
  if (serverCore.includes(forbidden)) throw new Error(`Server core forbidden capability: ${forbidden}`)
}

for (const marker of [
  "const HOST = '127.0.0.1'",
  "env('AGENT_IA_WORKER_SECRET_B64URL')",
  "env('AGENT_IA_ALLOWED_ORIGIN')",
  'server.requestTimeout = 30_000',
  'server.headersTimeout = 10_000',
  'server.maxHeadersCount = MAX_HEADER_COUNT',
  'Remote exposure requires an HTTPS reverse proxy',
]) {
  if (!server.includes(marker)) throw new Error(`Phase 9C reference-server invariant missing: ${marker}`)
}
for (const forbidden of ["listen(port, '0.0.0.0'", "HOST = '0.0.0.0'", 'console.log(config.secret)', 'console.log(body)', 'fetch(', 'WebSocket(']) {
  if (server.includes(forbidden)) throw new Error(`Reference server must remain loopback-only and secret-safe: ${forbidden}`)
}

for (const marker of [
  'Phase 9C — Authenticated Transport',
  'HMAC-SHA256',
  'لا اتصال في الخلفية',
  'لا Retry تلقائي',
  'Memory (ذاكرة الصفحة) فقط',
  'Retry Same Bundle',
  "setSecret('')",
  'claimLocalDurableJob(REFERENCE_WORKER_ID, now, 5 * 60_000)',
  'executeWorkerBundleOverAuthenticatedHttps(endpoint, secret, bundle)',
  '127.0.0.1 فقط',
]) {
  if (!ui.includes(marker)) throw new Error(`Phase 9C phone UI invariant missing: ${marker}`)
}
for (const forbidden of ['localStorage.setItem', 'sessionStorage.setItem', 'indexedDB.open', 'setInterval(', 'setTimeout(() => void handlePrepareAndSend']) {
  if (ui.includes(forbidden)) throw new Error(`Phone transport UI must not persist secret or auto-send: ${forbidden}`)
}
if (!toolCenter.includes('<AuthenticatedWorkerCenter agents={agents}')) throw new Error('AuthenticatedWorkerCenter is not integrated')
if (!main.includes("import './transport.css'")) throw new Error('Authenticated transport mobile styles are not loaded')

for (const marker of [
  "assert.throws(() => auth.validateWorkerTransportSecret('weak-secret')",
  "WORKER_ENDPOINT_HTTPS_REQUIRED",
  "WORKER_ENDPOINT_CREDENTIAL_OR_QUERY_FORBIDDEN",
  "WORKER_AUTH_BODY_DIGEST_MISMATCH",
  "WORKER_AUTH_TIMESTAMP_STALE",
  "WORKER_AUTH_RESPONSE_DIGEST_MISMATCH",
  'assert.equal(replay.status, 409)',
  "WORKER_AUTH_REPLAY",
  'assert.equal(retryReceipt.run.id, pureReceipt.run.id)',
  "origin: 'https://evil.example.test'",
  'assert.equal(wrongOrigin.status, 403)',
  "spawn(process.execPath, ['scripts/worker-server.mjs']",
  "assert.ok(serverOutput.includes('http://127.0.0.1:'))",
  'assert.ok(!serverOutput.includes(SECRET))',
  'assert.ok(!serverOutput.includes(bundle.job.payload.task))',
]) {
  if (!smoke.includes(marker)) throw new Error(`Phase 9C executable smoke invariant missing: ${marker}`)
}

for (const marker of [
  'agent-ia-factory.transport/0.1',
  'POST /v1/execute',
  '32-byte random secret',
  '±90 ثانية',
  '16-byte random Nonce',
  'HTTPS يبقى إلزاميًا',
  'لا Auto-Retry بعد أي Failure في النقل',
  'Receipt cache في 9C **In-Memory',
  'لا `*`',
  'يستمع فقط على `127.0.0.1`',
  'AGENT_IA_WORKER_SECRET_B64URL',
  'Phase 7A real Chrome smoke on the same PR',
  'New production dependencies = 0',
  'Mandatory additional spend = 0 USD',
]) {
  if (!docs.includes(marker)) throw new Error(`Phase 9C documentation marker missing: ${marker}`)
}

for (const marker of [
  'Phase 9C Authenticated Transport CI',
  "node-version: '24'",
  'npm install --ignore-scripts --no-fund --no-audit',
  'npm run check',
  'npm run test:phase8',
  'npm run test:phase9a',
  'npm run test:phase9b',
  'npm run test:phase9c',
  'npm audit --omit=dev --audit-level=high',
  'npm audit --audit-level=high',
]) {
  if (!workflow.includes(marker)) throw new Error(`Phase 9C CI invariant missing: ${marker}`)
}

if (phase9bValidator.includes("pkg.version !== '1.3.0'")) throw new Error('Phase 9B validator must be forward-compatible before Phase 9C version bump')
if (!phase9bValidator.includes('Phase 9B requires package version 1.3.0 or newer')) throw new Error('Phase 9B minimum-version invariant missing')
if (pkg.version !== '1.4.0') throw new Error('Phase 9C version must be 1.4.0')
if (!pkg.scripts?.['validate:phase9c']?.includes('validate-phase9c.mjs')) throw new Error('validate:phase9c script missing')
if (!pkg.scripts?.['test:phase9c']?.includes('test-phase9c-transport.mjs')) throw new Error('test:phase9c script missing')
if (!pkg.scripts?.check?.includes('validate:phase9c')) throw new Error('Phase 9C validator missing from full check')
const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 9C: ${dependency}`)
}

console.log('Phase 9C Authenticated Transport validation: PASS')
console.log('HMAC-SHA256: request + response binding required')
console.log('Replay protection: nonce + timestamp + bounded cache')
console.log('Phone transport: HTTPS only, manual send, no auto-retry')
console.log('Pairing secret: 32-byte Base64URL, memory/env only')
console.log('Reference server: loopback-only behind HTTPS reverse proxy')
console.log('CORS: one exact HTTPS origin; wildcard forbidden')
console.log('Remote side effects/tools: still forbidden')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')