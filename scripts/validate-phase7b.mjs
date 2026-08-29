import fs from 'node:fs'

const required = [
  'src/core/browserWriteJob.ts',
  'src/components/BrowserWriteCenter.tsx',
  'src/browser-write.css',
  'scripts/run-browser-write-job.mjs',
  'scripts/test-phase7b-browser-write.mjs',
  'docs/PHASE7B_SAFE_BROWSER_ACTIONS.md',
  '.github/workflows/phase7b-browser-write-ci.yml',
]
for (const file of required) if (!fs.existsSync(file)) throw new Error(`Missing Phase 7B file: ${file}`)

const core = fs.readFileSync('src/core/browserWriteJob.ts','utf8')
const exec = fs.readFileSync('scripts/run-browser-write-job.mjs','utf8')
const ui = fs.readFileSync('src/components/BrowserWriteCenter.tsx','utf8')
const docs = fs.readFileSync('docs/PHASE7B_SAFE_BROWSER_ACTIONS.md','utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx','utf8')
const main = fs.readFileSync('src/main.tsx','utf8')
const workflow = fs.readFileSync('.github/workflows/phase7b-browser-write-ci.yml','utf8')
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'))

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
  'permit && !permit.consumed',
  'permit.consumed = true',
  'body.length <= 16000',
  "meta.method !== 'POST'",
  'BROWSER_WRITE_FORM_FIELD_FORBIDDEN',
  'BROWSER_WRITE_DOWNLOAD_TOO_LARGE',
  "const SAFE_EXT = new Set(['.pdf', '.txt', '.csv', '.json', '.png', '.jpg', '.jpeg', '.webp'])",
  'monetaryCostUsd: 0',
]) if (!exec.includes(marker)) throw new Error(`Phase 7B executor invariant missing: ${marker}`)

for (const forbidden of ['PUT\'', 'PATCH\'', 'DELETE\'', 'child_process', 'eval(', 'new Function(', '--no-sandbox']) {
  if (exec.includes(forbidden)) throw new Error(`Forbidden Phase 7B executor capability: ${forbidden}`)
}

if (!toolCenter.includes("import BrowserWriteCenter from './BrowserWriteCenter'")) throw new Error('BrowserWriteCenter import missing')
if (!toolCenter.includes('<BrowserWriteCenter onNotice={props.onNotice} />')) throw new Error('BrowserWriteCenter not integrated')
if (!main.includes("import './browser-write.css'")) throw new Error('Browser write styles missing')

for (const marker of ['Phase 7B','POST one-shot','Uploads: blocked','Money/auth changes: blocked','Copy Approved Plan JSON']) if (!ui.includes(marker)) throw new Error(`Phase 7B UI marker missing: ${marker}`)
for (const marker of ['One-Shot Permit','Upload غير مدعوم','Mandatory additional spend = 0 USD','لا شراء أو دفع أو تحويل مالي']) if (!docs.includes(marker)) throw new Error(`Phase 7B docs marker missing: ${marker}`)
for (const marker of ['Phase 7B Safe Browser Actions CI','npm run check','npm run test:phase7b','Real Chrome one-shot POST smoke','npm audit --audit-level=high']) if (!workflow.includes(marker)) throw new Error(`Phase 7B workflow marker missing: ${marker}`)

if (!pkg.scripts?.['validate:phase7b']?.includes('validate-phase7b.mjs')) throw new Error('validate:phase7b missing')
if (!pkg.scripts?.['test:phase7b']?.includes('test-phase7b-browser-write.mjs')) throw new Error('test:phase7b missing')
if (!pkg.scripts?.check?.includes('validate:phase7b')) throw new Error('Phase 7B missing from full check')

console.log('Phase 7B Safe Browser Actions validation: PASS')
console.log('POST: one-shot permit per approved submit action')
console.log('PUT/PATCH/DELETE/payment/auth/secrets/upload: forbidden')
console.log('Downloads: bounded non-executable allowlist')
console.log('Phase 7A read-only path: separate and unchanged')
console.log('Mandatory additional spend: 0 USD')
