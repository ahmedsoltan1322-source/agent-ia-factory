import fs from 'node:fs'

const required = [
  'src/core/browserJob.ts',
  'src/components/BrowserAgentCenter.tsx',
  'src/browser-agent.css',
  'scripts/run-browser-job.mjs',
  'scripts/setup-browser-sandbox.sh',
  '.github/workflows/safe-browser-job.yml',
  '.github/workflows/phase7-browser-ci.yml',
  'tests/fixtures/browser-smoke-plan.json',
  'docs/PHASE7_SAFE_BROWSER.md',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 7A file: ${file}`)
}

const core = fs.readFileSync('src/core/browserJob.ts', 'utf8')
const ui = fs.readFileSync('src/components/BrowserAgentCenter.tsx', 'utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx', 'utf8')
const main = fs.readFileSync('src/main.tsx', 'utf8')
const executor = fs.readFileSync('scripts/run-browser-job.mjs', 'utf8')
const sandbox = fs.readFileSync('scripts/setup-browser-sandbox.sh', 'utf8')
const manualWorkflow = fs.readFileSync('.github/workflows/safe-browser-job.yml', 'utf8')
const ci = fs.readFileSync('.github/workflows/phase7-browser-ci.yml', 'utf8')
const docs = fs.readFileSync('docs/PHASE7_SAFE_BROWSER.md', 'utf8')
const fixture = JSON.parse(fs.readFileSync('tests/fixtures/browser-smoke-plan.json', 'utf8'))
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

const coreRequired = [
  "executionMode: 'github-actions-manual'",
  "readOnlyNetworkMethods: readonly ['GET', 'HEAD', 'OPTIONS']",
  'allowSubmit: false',
  'allowDownload: false',
  'allowUpload: false',
  'allowSecrets: false',
  'allowCrossSiteTopNavigation: false',
  'maxActions: 10',
  'maxRunSeconds: 60',
  'monetaryCostUsd: 0',
  "if (url.protocol !== 'https:')",
  "if (url.username || url.password)",
  'isPrivateOrUnsafeHost(url.hostname)',
  'SENSITIVE_QUERY_KEY',
  'SENSITIVE_SELECTOR',
  'SECRET_VALUE',
  "BROWSER_HUMAN_APPROVAL_REQUIRED",
  'approvedByHuman: false',
]
for (const needle of coreRequired) {
  if (!core.includes(needle)) throw new Error(`Browser plan invariant missing: ${needle}`)
}

for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'playwright', 'chromium.', 'saveWorkflow(', 'executeBuiltinTool(', 'callMcpTool(']) {
  if (core.includes(forbidden)) throw new Error(`PWA browser plan core must remain planning-only: ${forbidden}`)
}

if (!ui.includes('Phase 7A — Safe Browser Agent')) throw new Error('Phase 7A UI banner missing')
if (!ui.includes('Read-Only Network')) throw new Error('Read-only disclosure missing')
if (!ui.includes('لا يوجد GitHub Token داخل PWA ولا Auto-Dispatch')) throw new Error('Manual-execution disclosure missing')
if (!ui.includes('Approval إضافية')) throw new Error('Second approval disclosure missing')
if (!toolCenter.includes('<BrowserAgentCenter')) throw new Error('Browser Agent Center is not integrated into Tool Center')
if (!main.includes("import './browser-agent.css'")) throw new Error('Browser Agent mobile styles are not loaded')

const executorRequired = [
  "import { chromium } from 'playwright-core'",
  "const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])",
  'DANGEROUS_NAV_TERM',
  "if (url.protocol !== 'https:')",
  'assertPublicDns(target.hostname)',
  "address === '168.63.129.16'",
  "acceptDownloads: false",
  "serviceWorkers: 'block'",
  "await context.routeWebSocket('**/*'",
  "await context.route('**/*'",
  "await route.abort('blockedbyclient')",
  'allowedTopHosts.has',
  'PUBLIC_PREVIEW_UNSAFE',
  'Preview value applied without submit or input/change event dispatch.',
  "args: ['--disable-dev-shm-usage', '--no-referrers']",
]
for (const needle of executorRequired) {
  if (!executor.includes(needle)) throw new Error(`Browser executor invariant missing: ${needle}`)
}
if (/\.connectToServer\s*\(/u.test(executor)) throw new Error('WebSocket executor must never connect to server')
if (executor.includes('--no-sandbox')) throw new Error('Chrome sandbox must never be disabled')
if (executor.includes('process.env.GITHUB_TOKEN') || executor.includes('process.env.GH_TOKEN')) throw new Error('Browser executor must not access GitHub tokens')

const sandboxRequired = [
  'AGENTIA_BROWSER_',
  '-m owner --uid-owner',
  '168.63.129.16',
  '10.0.0.0/8',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '198.18.0.0/15',
  'ip6tables -A "$IP6_CHAIN" -j REJECT',
]
for (const needle of sandboxRequired) {
  if (!sandbox.includes(needle)) throw new Error(`Browser UID sandbox invariant missing: ${needle}`)
}
if (sandbox.includes('iptables -F OUTPUT') || sandbox.includes('ip6tables -F OUTPUT')) throw new Error('Browser sandbox must not flush global OUTPUT chains')

const workflowRequired = [
  'workflow_dispatch:',
  'persist-credentials: false',
  "node-version: '24'",
  'npm install --ignore-scripts --no-fund --no-audit',
  "plan.get('approvedByHuman') is not True",
  "WORKFLOW_APPROVED: ${{ inputs.approved }}",
  'System Chrome/Chromium not found; fail closed.',
  'setup-browser-sandbox.sh browserjob',
  'sudo -u browserjob -H env -i',
  'retention-days: 1',
]
for (const needle of workflowRequired) {
  if (!manualWorkflow.includes(needle)) throw new Error(`Manual browser workflow invariant missing: ${needle}`)
}
if (/playwright\s+install|npx\s+playwright\s+install/u.test(manualWorkflow)) throw new Error('Manual browser workflow must not download browsers')
if (manualWorkflow.includes('secrets.GITHUB_TOKEN') || manualWorkflow.includes('github.token')) throw new Error('Manual browser workflow must not pass GitHub token to browser')

const ciRequired = [
  'Phase 7A Safe Browser CI',
  'npm run validate:phase7',
  'tests/fixtures/browser-smoke-plan.json',
  'setup-browser-sandbox.sh browserjob',
  'sudo -u browserjob -H env -i',
  '169.254.169.254',
  'browser-report.json',
  "report.get('status') != 'success'",
  "report.get('monetaryCostUsd') != 0",
]
for (const needle of ciRequired) {
  if (!ci.includes(needle)) throw new Error(`Phase 7A CI invariant missing: ${needle}`)
}

if (pkg.version !== '1.0.0') throw new Error('Phase 7A version must be 1.0.0')
if (pkg.devDependencies?.['playwright-core'] !== '1.62.1') throw new Error('playwright-core must be pinned to 1.62.1')
if ('playwright' in (pkg.devDependencies ?? {}) || 'playwright' in (pkg.dependencies ?? {})) throw new Error('Full Playwright browser package is forbidden; use playwright-core only')
const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 7A: ${dependency}`)
}
if (!pkg.scripts?.['validate:phase7']?.includes('validate-phase7.mjs')) throw new Error('validate:phase7 script missing')
if (!pkg.scripts?.check?.includes('validate:phase7')) throw new Error('Phase 7 validator missing from full check')

if (fixture.targetUrl !== 'https://example.com/') throw new Error('Smoke fixture must target example.com only')
if (fixture.approvedByHuman !== true) throw new Error('Smoke fixture must be explicitly approved test data')
if (fixture.policy?.monetaryCostUsd !== 0) throw new Error('Smoke fixture cost must be zero')
if (fixture.policy?.readOnlyNetworkMethods?.join(',') !== 'GET,HEAD,OPTIONS') throw new Error('Smoke fixture network policy is not read-only')
if (fixture.policy?.allowSubmit !== false || fixture.policy?.allowDownload !== false || fixture.policy?.allowUpload !== false || fixture.policy?.allowSecrets !== false) {
  throw new Error('Smoke fixture contains a dangerous capability')
}

for (const marker of ['routeWebSocket', 'env -i', 'DNS Rebinding', 'Mandatory additional spend', '0 USD']) {
  if (!docs.includes(marker)) throw new Error(`Phase 7A documentation marker missing: ${marker}`)
}

console.log('Phase 7A safe browser validation: PASS')
console.log('PWA: planning/export only; no automatic browser execution')
console.log('Human approval: two layers')
console.log('Network methods: GET/HEAD/OPTIONS only')
console.log('WebSocket server connection: forbidden')
console.log('Private/metadata network: DNS gate + UID firewall')
console.log('Browser runtime: isolated env-i Linux UID + system Chrome')
console.log('Chrome sandbox: required')
console.log('Browser download: forbidden')
console.log('Mandatory additional spend: 0 USD')
