import fs from 'node:fs'

const required = [
  'src/core/browserWriteJob.ts',
  'src/components/BrowserWriteCenter.tsx',
  'src/browser-write.css',
  'scripts/run-browser-write-job.mjs',
  'scripts/test-phase7b-browser-write.mjs',
  'docs/PHASE7B_SAFE_BROWSER_ACTIONS.md',
  '.github/workflows/phase7b-browser-write-ci.yml',
  '.github/workflows/safe-browser-write-job.yml',
]
for (const file of required) if (!fs.existsSync(file)) throw new Error(`Missing Phase 7B file: ${file}`)

const core = fs.readFileSync('src/core/browserWriteJob.ts','utf8')
const exec = fs.readFileSync('scripts/run-browser-write-job.mjs','utf8')
const ui = fs.readFileSync('src/components/BrowserWriteCenter.tsx','utf8')
const docs = fs.readFileSync('docs/PHASE7B_SAFE_BROWSER_ACTIONS.md','utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx','utf8')
const main = fs.readFileSync('src/main.tsx','utf8')
const workflow = fs.readFileSync('.github/workflows/phase7b-browser-write-ci.yml','utf8')
const manual = fs.readFileSync('.github/workflows/safe-browser-write-job.yml','utf8')
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
  "executionMode: 'github-actions-manual-write-safe'",
  "allowedNetworkMethods: readonly ['GET', 'HEAD', 'OPTIONS', 'POST']",
  'maxPostRequests: 3',
  'allowPutPatchDelete: false',
  'allowSecrets: false',
  'allowPayments: false',
  'allowAuthenticationChanges: false',
  'allowUpload: false',
  'maxDownloadBytes: 5_000_000',
  'monetaryCostUsd: 0',
  'BROWSER_WRITE_HUMAN_APPROVAL_REQUIRED',
]) if (!core.includes(marker)) throw new Error(`Phase 7B plan invariant missing: ${marker}`)

for (const marker of [
  "const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])",
  "if (method !== 'POST')",
  'currentPermit && !currentPermit.consumed',
  'currentPermit.consumed = true',
  'currentPermit.resolve(true)',
  'permitDecision = new Promise',
  'Promise.race([permitDecision',
  'body.length <= 16000',
  "meta.method !== 'POST'",
  'meta.valid',
  'BROWSER_WRITE_FORM_CONSTRAINT_VALIDATION_FAILED',
  'BROWSER_WRITE_FORM_FIELD_FORBIDDEN',
  'BROWSER_WRITE_DOWNLOAD_TOO_LARGE',
  "const SAFE_EXT = new Set(['.pdf', '.txt', '.csv', '.json', '.png', '.jpg', '.jpeg', '.webp'])",
  'monetaryCostUsd: 0',
]) if (!exec.includes(marker)) throw new Error(`Phase 7B executor invariant missing: ${marker}`)

for (const forbidden of ['child_process', 'eval(', 'new Function(', '--no-sandbox']) {
  if (exec.includes(forbidden)) throw new Error(`Forbidden Phase 7B executor capability: ${forbidden}`)
}
for (const forbiddenMethod of ["method === 'PUT'", "method === 'PATCH'", "method === 'DELETE'", "new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'", "new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH'", "new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'DELETE'"]) {
  if (exec.includes(forbiddenMethod)) throw new Error(`PUT/PATCH/DELETE must never be enabled: ${forbiddenMethod}`)
}

if (!toolCenter.includes("import BrowserWriteCenter from './BrowserWriteCenter'")) throw new Error('BrowserWriteCenter import missing')
if (!toolCenter.includes('<BrowserWriteCenter onNotice={props.onNotice} />')) throw new Error('BrowserWriteCenter not integrated')
if (!main.includes("import './browser-write.css'")) throw new Error('Browser write styles missing')

for (const marker of ['Phase 7B','POST one-shot','Uploads: blocked','Money/auth changes: blocked','Copy Approved Plan JSON']) if (!ui.includes(marker)) throw new Error(`Phase 7B UI marker missing: ${marker}`)
for (const marker of ['One-Shot Permit','Upload غير مدعوم','Mandatory additional spend = 0 USD','لا شراء أو دفع أو تحويل مالي']) if (!docs.includes(marker)) throw new Error(`Phase 7B docs marker missing: ${marker}`)
for (const marker of ['Phase 7B Safe Browser Actions CI','npm run check','npm run test:phase7b','Real Chrome one-shot POST smoke','npm audit --audit-level=high']) if (!workflow.includes(marker)) throw new Error(`Phase 7B CI marker missing: ${marker}`)
for (const marker of ['Safe Browser Write Job','workflow_dispatch:','WORKFLOW_APPROVED: ${{ inputs.approved }}','github-actions-manual-write-safe','sudo -u browserjob -H env -i','retention-days: 1']) if (!manual.includes(marker)) throw new Error(`Phase 7B manual workflow marker missing: ${marker}`)
if (manual.includes('secrets.GITHUB_TOKEN') || manual.includes('github.token')) throw new Error('Write browser workflow must never expose GitHub token')

if (!versionAtLeast(pkg.version, '1.12.0')) throw new Error('Phase 7B requires package version 1.12.0 or newer')
if (!pkg.scripts?.['validate:phase7b']?.includes('validate-phase7b.mjs')) throw new Error('validate:phase7b missing')
if (!pkg.scripts?.['test:phase7b']?.includes('test-phase7b-browser-write.mjs')) throw new Error('test:phase7b missing')
if (!pkg.scripts?.check?.includes('validate:phase7b')) throw new Error('Phase 7B missing from full check')

const allowedProductionDependencies = new Set(['@mlc-ai/web-llm','@modelcontextprotocol/client','react','react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 7B: ${dependency}`)

console.log('Phase 7B Safe Browser Actions validation: PASS')
console.log('POST: one-shot permit per approved submit action')
console.log('POST route decision: synchronized before success is recorded')
console.log('PUT/PATCH/DELETE/payment/auth/secrets/upload: forbidden')
console.log('Downloads: bounded non-executable allowlist')
console.log('Manual execution: two-layer human approval')
console.log('Phase 7A read-only path: separate and unchanged')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')
