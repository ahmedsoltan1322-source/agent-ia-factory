import fs from 'node:fs'

const required = [
  'src/core/browserUploadStageAuth.ts',
  'src/core/browserUploadStageStore.ts',
  'src/core/browserUploadStageServerCore.ts',
  'src/core/browserUploadStageTransport.ts',
  'scripts/upload-stage-server.mjs',
  'scripts/test-phase7c-b-upload-staging.mjs',
  'docs/PHASE7C_B_AUTHENTICATED_UPLOAD_STAGING.md',
  '.github/workflows/phase7c-b-upload-staging-ci.yml',
]
for (const file of required) if (!fs.existsSync(file)) throw new Error(`Missing Phase 7C-B file: ${file}`)

const auth = fs.readFileSync('src/core/browserUploadStageAuth.ts','utf8')
const store = fs.readFileSync('src/core/browserUploadStageStore.ts','utf8')
const serverCore = fs.readFileSync('src/core/browserUploadStageServerCore.ts','utf8')
const transport = fs.readFileSync('src/core/browserUploadStageTransport.ts','utf8')
const server = fs.readFileSync('scripts/upload-stage-server.mjs','utf8')
const ui = fs.readFileSync('src/components/BrowserUploadCenter.tsx','utf8')
const docs = fs.readFileSync('docs/PHASE7C_B_AUTHENTICATED_UPLOAD_STAGING.md','utf8')
const workflow = fs.readFileSync('.github/workflows/phase7c-b-upload-staging-ci.yml','utf8')
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'))

function versionAtLeast(version, minimum) {
  const parse = (value) => { const m=/^(\d+)\.(\d+)\.(\d+)$/u.exec(String(value)); if(!m) throw new Error(`Invalid semantic version: ${value}`); return m.slice(1).map(Number) }
  const a=parse(version), b=parse(minimum)
  for(let i=0;i<3;i+=1){ if(a[i]>b[i]) return true; if(a[i]<b[i]) return false }
  return true
}

for (const marker of [
  "UPLOAD_STAGE_PROTOCOL = 'agent-ia-factory.upload-stage/0.1'",
  "UPLOAD_STAGE_PATH = '/v1/browser-upload-stage'",
  "UPLOAD_DELETE_PATH = '/v1/browser-upload-delete'",
  "crypto.subtle.sign('HMAC'",
  "crypto.subtle.verify('HMAC'",
  "x-agent-ia-content-sha256",
  "UPLOAD_AUTH_MAX_SKEW_SECONDS = 90",
]) if (!auth.includes(marker)) throw new Error(`Phase 7C-B auth invariant missing: ${marker}`)

for (const marker of [
  'MAX_STAGED_UPLOADS = 32',
  "mkdir(root, { recursive: true, mode: 0o700 })",
  "open(p.data, 'wx', 0o600)",
  "writeFile(p.meta, JSON.stringify(record), { encoding: 'utf8', mode: 0o600, flag: 'wx' })",
  "createHash('sha256')",
  'UPLOAD_STAGE_IDEMPOTENCY_CONFLICT',
  'UPLOAD_STAGE_DATA_CORRUPT',
  'validateBrowserUploadCapsule',
]) if (!store.includes(marker)) throw new Error(`Phase 7C-B store invariant missing: ${marker}`)

for (const marker of [
  'UPLOAD_STAGE_SERVER_MAX_REQUESTS_PER_MINUTE = 12',
  'UPLOAD_STAGE_SERVER_REPLAY_TTL_MS = 2 * 60_000',
  "request.origin !== config.allowedOrigin",
  "state.seenNonces.has(auth.nonce)",
  "UPLOAD_AUTH_REPLAY",
  "UPLOAD_STAGE_RATE_LIMIT",
  'store.stage(capsule, nowMs)',
  'store.remove(parsed.stageId)',
]) if (!serverCore.includes(marker)) throw new Error(`Phase 7C-B server-core invariant missing: ${marker}`)

for (const marker of [
  "const HOST = '127.0.0.1'",
  "createFilesystemBrowserUploadStageStore(env('AGENT_IA_UPLOAD_STAGE_DIR'))",
  'MAX_BODY_BYTES = 64_000',
  "console.log('File contents are never written to logs.')",
  'HTTPS reverse proxy',
]) if (!server.includes(marker)) throw new Error(`Phase 7C-B reference server invariant missing: ${marker}`)

for (const marker of [
  'validateAuthenticatedWorkerEndpoint',
  'validateWorkerTransportSecret',
  "method: 'POST'",
  "credentials: 'omit'",
  "cache: 'no-store'",
  "redirect: 'error'",
  "referrerPolicy: 'no-referrer'",
  'UPLOAD_TRANSPORT_UNCERTAIN_TIMEOUT',
  'stageBrowserUploadCapsuleOverAuthenticatedHttps',
  'deleteStagedBrowserUploadOverAuthenticatedHttps',
]) if (!transport.includes(marker)) throw new Error(`Phase 7C-B transport invariant missing: ${marker}`)
if (transport.includes('setInterval(') || transport.includes('while (true)') || transport.includes('retry(')) throw new Error('Phase 7C-B transport must not auto-retry')

for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'privateKey']) {
  if (transport.includes(forbidden)) throw new Error(`Transport must not persist secret/stage content: ${forbidden}`)
}
for (const marker of ['Phase 7C-B','Pairing Secret (memory only)','أوافق صراحة على نقل هذه Capsule','Browser upload: not executed','Delete staged file']) if (!ui.includes(marker)) throw new Error(`Phase 7C-B UI marker missing: ${marker}`)
if (ui.includes('localStorage') || ui.includes('sessionStorage')) throw new Error('Phase 7C-B UI must keep endpoint/secret/capsule in memory only')

for (const marker of ['7C-B','Request وResponse كلاهما موقّعان','State directory `0700`','staged data file `0600`','لا Browser `setInputFiles`','7C-C','Mandatory additional spend = 0 USD']) if (!docs.includes(marker)) throw new Error(`Phase 7C-B docs marker missing: ${marker}`)
for (const marker of ['Phase 7C-B Authenticated Upload Staging CI','npm run check','npm run test:phase7c-b','npm audit --audit-level=high']) if (!workflow.includes(marker)) throw new Error(`Phase 7C-B CI marker missing: ${marker}`)

if (!versionAtLeast(pkg.version, '1.14.0')) throw new Error('Phase 7C-B requires package version 1.14.0 or newer')
if (!pkg.scripts?.['validate:phase7c-b']?.includes('validate-phase7c-b.mjs')) throw new Error('validate:phase7c-b missing')
if (!pkg.scripts?.['test:phase7c-b']?.includes('test-phase7c-b-upload-staging.mjs')) throw new Error('test:phase7c-b missing')
if (!pkg.scripts?.check?.includes('validate:phase7c-b')) throw new Error('Phase 7C-B missing from full check')

const allowedProductionDependencies = new Set(['@mlc-ai/web-llm','@modelcontextprotocol/client','react','react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 7C-B: ${dependency}`)

console.log('Phase 7C-B Authenticated Upload Staging validation: PASS')
console.log('HMAC request/response + nonce replay protection: required')
console.log('Ephemeral filesystem: 0700 directory + 0600 files')
console.log('Same capsule retry: idempotent stageId')
console.log('Phone transport: HTTPS, manual, no auto-retry, memory-only secret')
console.log('Browser setInputFiles/target upload: intentionally absent until 7C-C')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')
