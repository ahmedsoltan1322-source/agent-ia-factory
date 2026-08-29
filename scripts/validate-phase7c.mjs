import fs from 'node:fs'

const required = [
  'src/core/browserUploadCapsule.ts',
  'src/components/BrowserUploadCenter.tsx',
  'src/browser-upload.css',
  'scripts/test-phase7c-upload-capsule.mjs',
  'docs/PHASE7C_SAFE_FILE_UPLOAD.md',
  '.github/workflows/phase7c-upload-ci.yml',
]
for (const file of required) if (!fs.existsSync(file)) throw new Error(`Missing Phase 7C-A file: ${file}`)

const core = fs.readFileSync('src/core/browserUploadCapsule.ts','utf8')
const ui = fs.readFileSync('src/components/BrowserUploadCenter.tsx','utf8')
const docs = fs.readFileSync('docs/PHASE7C_SAFE_FILE_UPLOAD.md','utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx','utf8')
const main = fs.readFileSync('src/main.tsx','utf8')
const workflow = fs.readFileSync('.github/workflows/phase7c-upload-ci.yml','utf8')
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'))

function versionAtLeast(version, minimum) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(String(value))
    if (!match) throw new Error(`Invalid semantic version: ${value}`)
    return match.slice(1).map(Number)
  }
  const current = parse(version); const floor = parse(minimum)
  for (let index=0; index<3; index+=1) {
    if (current[index] > floor[index]) return true
    if (current[index] < floor[index]) return false
  }
  return true
}

for (const marker of [
  "BROWSER_UPLOAD_SCHEMA_VERSION = '0.1'",
  'MAX_UPLOAD_FILE_BYTES = 32_000',
  'UPLOAD_CAPSULE_TTL_MS = 10 * 60_000',
  "new Set(['.txt', '.csv', '.json'])",
  "new Set(['text/plain', 'text/csv', 'application/json'])",
  'BROWSER_UPLOAD_SECRET_LIKE_CONTENT_FORBIDDEN',
  'BROWSER_UPLOAD_PAYMENT_OR_IDENTITY_CONTENT_FORBIDDEN',
  'BROWSER_UPLOAD_PERSONAL_CONTACT_CONTENT_FORBIDDEN',
  'BROWSER_UPLOAD_UTF8_REQUIRED',
  'BROWSER_UPLOAD_HIDDEN_FIELD_FORBIDDEN',
  'publicNonSensitiveContentOnly: true',
  'executableContentAllowed: false',
  'secretsAllowed: false',
  'personalContactAllowed: false',
  'paymentOrIdentityDataAllowed: false',
  'monetaryCostUsd: 0',
]) if (!core.includes(marker)) throw new Error(`Phase 7C-A invariant missing: ${marker}`)

for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'localStorage', 'sessionStorage', 'setInputFiles(', 'navigator.sendBeacon']) {
  if (core.includes(forbidden)) throw new Error(`Phase 7C-A core must remain local staging only: ${forbidden}`)
}

if (!toolCenter.includes("import BrowserUploadCenter from './BrowserUploadCenter'")) throw new Error('BrowserUploadCenter import missing')
if (!toolCenter.includes('<BrowserUploadCenter onNotice={props.onNotice} />')) throw new Error('BrowserUploadCenter not integrated')
if (!main.includes("import './browser-upload.css'")) throw new Error('Browser upload styles missing')
for (const marker of ['Phase 7C-A','Local scan · no network','لم يُرسل الملف لأي خادم أو GitHub','TXT/CSV/JSON فقط']) if (!ui.includes(marker)) throw new Error(`Phase 7C-A UI marker missing: ${marker}`)
for (const marker of ['7C-A ليست Upload فعلية','لا `fetch`','لا localStorage/sessionStorage','7C-B','Mandatory additional spend = 0 USD']) if (!docs.includes(marker)) throw new Error(`Phase 7C-A docs marker missing: ${marker}`)
for (const marker of ['Phase 7C-A Safe File Staging CI','npm run check','npm run test:phase7c','npm audit --audit-level=high']) if (!workflow.includes(marker)) throw new Error(`Phase 7C-A workflow marker missing: ${marker}`)

if (!versionAtLeast(pkg.version, '1.13.0')) throw new Error('Phase 7C-A requires package version 1.13.0 or newer')
if (!pkg.scripts?.['validate:phase7c']?.includes('validate-phase7c.mjs')) throw new Error('validate:phase7c missing')
if (!pkg.scripts?.['test:phase7c']?.includes('test-phase7c-upload-capsule.mjs')) throw new Error('test:phase7c missing')
if (!pkg.scripts?.check?.includes('validate:phase7c')) throw new Error('Phase 7C-A missing from full check')

const allowedProductionDependencies = new Set(['@mlc-ai/web-llm','@modelcontextprotocol/client','react','react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 7C-A: ${dependency}`)

console.log('Phase 7C-A Safe File Staging validation: PASS')
console.log('Allowed: TXT/CSV/JSON UTF-8 <= 32KB')
console.log('Secrets/contact/payment/identity/executable content: fail-closed')
console.log('Network/storage/browser upload side effects: none')
console.log('Capsule lifetime: 10 minutes')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')
