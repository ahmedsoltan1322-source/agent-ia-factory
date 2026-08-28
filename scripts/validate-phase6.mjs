import fs from 'node:fs'

const required = [
  'src/core/ossHarvester.ts',
  'src/components/OssHarvesterCenter.tsx',
  'src/oss-harvester.css',
  'docs/PHASE6_OSS_HARVESTER.md',
  '.github/workflows/oss-candidate-scan.yml',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 6 file: ${file}`)
}

const core = fs.readFileSync('src/core/ossHarvester.ts', 'utf8')
const ui = fs.readFileSync('src/components/OssHarvesterCenter.tsx', 'utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx', 'utf8')
const scan = fs.readFileSync('.github/workflows/oss-candidate-scan.yml', 'utf8')
const docs = fs.readFileSync('docs/PHASE6_OSS_HARVESTER.md', 'utf8')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

const coreInvariants = [
  "OssDecision = 'USE' | 'ADAPT' | 'STUDY' | 'WATCH' | 'REJECT'",
  "DeepScanStatus = 'pending' | 'passed' | 'failed'",
  "const MAX_RESULTS = 12",
  'const MAX_RESPONSE_BYTES = 2_000_000',
  'const REQUEST_TIMEOUT_MS = 10_000',
  "const GITHUB_API_ORIGIN = 'https://api.github.com'",
  "new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause'])",
  "credentials: 'omit'",
  "redirect: 'error'",
  "cache: 'no-store'",
  "referrerPolicy: 'no-referrer'",
  "deepScanStatus: 'pending' as const",
  "integrationAllowed: false as const",
  'integrationAllowed: false',
]
for (const needle of coreInvariants) {
  if (!core.includes(needle)) throw new Error(`Phase 6 invariant missing: ${needle}`)
}

for (const forbidden of ['Authorization', 'Bearer ', 'saveAgent(', 'saveWorkflow(', 'callMcpTool(', 'executeBuiltinTool(', 'installFactoryBlueprint(', 'runWorkflowUntilPause(']) {
  if (core.includes(forbidden)) throw new Error(`OSS discovery core must not auto-authorize/integrate/execute: ${forbidden}`)
}

if (!core.includes("path.startsWith('/search/repositories?')")) throw new Error('GitHub path allowlist is missing.')
if (!core.includes('url.origin !== GITHUB_API_ORIGIN')) throw new Error('GitHub fixed-origin check is missing.')
if (!core.includes("spdx === 'NOASSERTION'")) throw new Error('Unknown-license fail-closed gate is missing.')
if (!ui.includes('No Auto-Integration')) throw new Error('OSS UI must disclose no automatic integration.')
if (!ui.includes('Deep Scan:')) throw new Error('OSS UI must disclose deep-scan state.')
if (!ui.includes('Integration:')) throw new Error('OSS UI must disclose integration gate.')
if (!ui.includes('Watchlist')) throw new Error('OSS Watchlist UI is missing.')
if (!toolCenter.includes('<OssHarvesterCenter')) throw new Error('OSS Harvester is not exposed in the factory UI.')

const scanRequired = [
  'workflow_dispatch:',
  'persist-credentials: false',
  'fetch-depth: 1',
  'lfs: false',
  'submodules: false',
  'static-no-candidate-code-execution',
  "'integrationAllowed': False",
  "'deepScanDecision': 'manual-review-required'",
  'npm audit --omit=dev --audit-level=high --json',
  'No npm install, npm scripts, build, test, pip install, cargo build, go run, or project executable was invoked.',
]
for (const needle of scanRequired) {
  if (!scan.includes(needle)) throw new Error(`Deep-scan invariant missing: ${needle}`)
}

const forbiddenCandidateExecution = [
  'npm install ',
  'npm ci ',
  'npm run ',
  'pnpm install',
  'yarn install',
  'pip install',
  'poetry install',
  'uv sync',
  'cargo build',
  'cargo run',
  'go run ',
  'go test ',
  'pytest',
  'candidate/package.json && npm',
]
for (const needle of forbiddenCandidateExecution) {
  const occurrences = scan.split(needle).length - 1
  if (occurrences > 0 && !needle.startsWith('npm install')) {
    throw new Error(`Deep scan may execute candidate code/dependency install: ${needle}`)
  }
}
// The phrase "npm install" is allowed only inside human-readable denial text, never as a shell command.
if (/^\s*(?:cd\s+candidate\s*&&\s*)?npm\s+(?:install|ci|run)\b/gmu.test(scan)) {
  throw new Error('Deep scan must never execute npm install/ci/run against a candidate.')
}
if (/^\s*(?:cd\s+candidate\s*&&\s*)?(?:pip|pip3)\s+install\b/gmu.test(scan)) {
  throw new Error('Deep scan must never execute pip install against a candidate.')
}

if (!docs.includes('integrationAllowed=false')) throw new Error('Phase 6 docs must preserve integrationAllowed=false.')
if (!docs.includes('لا `npm install`')) throw new Error('Phase 6 docs must disclose no candidate install.')
if (!docs.includes('0 USD')) throw new Error('Phase 6 docs must state zero mandatory additional spend.')

const dependencies = Object.keys(pkg.dependencies ?? {})
const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of dependencies) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 6: ${dependency}`)
}

console.log('Phase 6 OSS Harvester validation: PASS')
console.log('Discovery: public GitHub metadata only')
console.log('Browser credentials/token: none')
console.log('Candidate code execution: forbidden')
console.log('Deep scan: static evidence only')
console.log('Auto-integration: forbidden')
console.log('Mandatory additional spend: 0 USD')
