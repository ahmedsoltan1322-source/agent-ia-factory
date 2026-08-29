import fs from 'node:fs'

const required = [
  'src/core/ecosystemTemplate.ts',
  'src/core/templateSecretScan.ts',
  'src/components/TemplateExchangeCenter.tsx',
  'src/template-exchange.css',
  'scripts/test-phase10a-templates.mjs',
  'docs/PHASE10A_SAFE_TEMPLATES.md',
  '.github/workflows/phase10a-template-ci.yml',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 10A file: ${file}`)
}

const ecosystem = fs.readFileSync('src/core/ecosystemTemplate.ts', 'utf8')
const secretScan = fs.readFileSync('src/core/templateSecretScan.ts', 'utf8')
const ui = fs.readFileSync('src/components/TemplateExchangeCenter.tsx', 'utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx', 'utf8')
const main = fs.readFileSync('src/main.tsx', 'utf8')
const smoke = fs.readFileSync('scripts/test-phase10a-templates.mjs', 'utf8')
const docs = fs.readFileSync('docs/PHASE10A_SAFE_TEMPLATES.md', 'utf8')
const workflow = fs.readFileSync('.github/workflows/phase10a-template-ci.yml', 'utf8')
const phase9dValidator = fs.readFileSync('scripts/validate-phase9d.mjs', 'utf8')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

function versionAtLeast(version, minimum) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value)
    if (!match) throw new Error(`Invalid semantic version: ${value}`)
    return match.slice(1).map(Number)
  }
  const current = parse(version)
  const floor = parse(minimum)
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > floor[index]) return true
    if (current[index] < floor[index]) return false
  }
  return true
}

for (const marker of [
  "export const AGENT_TEMPLATE_PROTOCOL = 'agent-ia-factory.template/0.1'",
  'export const MAX_AGENT_TEMPLATE_JSON_CHARS = 160_000',
  "const PACKAGE_ID = /^[A-Za-z0-9._:-]{1,120}$/u",
  "const SEMVER = /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/u",
  'function exactKeys',
  'export function stableTemplateStringify',
  "crypto.subtle.digest('SHA-256'",
  "integrity: {\n    algorithm: 'SHA-256'",
  "throw new Error('TEMPLATE_INTEGRITY_MISMATCH')",
  "throw new Error('TEMPLATE_PACKAGE_EXTRA_FIELD')",
  "throw new Error('TEMPLATE_CONTENT_EXTRA_FIELD')",
  "throw new Error('TEMPLATE_ZERO_COST_POLICY_INVALID')",
  'maxMonetarySpendUsd: 0',
  'allowPaidModels: false',
  'enableSuggestedToolsAutomatically: false',
  'automaticExecutionAfterInstall: false',
  'humanApprovalRequiredToInstall: true',
  'assertNoTemplateSecretLikeContent(unsigned.template)',
  'assertNoTemplateSecretLikeContent(template)',
  'validateFactoryBlueprint(blueprint)',
  "'template import: no automatic install or execution'",
]) {
  if (!ecosystem.includes(marker)) throw new Error(`Phase 10A template invariant missing: ${marker}`)
}
for (const forbidden of [
  'fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.sendBeacon',
  'localStorage', 'sessionStorage', 'indexedDB', 'Authorization', 'Bearer ',
  'eval(', 'new Function(',
]) {
  if (ecosystem.includes(forbidden)) throw new Error(`Template package core must remain local/data-only: ${forbidden}`)
}

for (const marker of [
  'const SECRET_PATTERNS: RegExp[]',
  'PRIVATE KEY',
  'github_pat_',
  'AKIA',
  'sk-(?:proj-)?',
  'api[_-]?key',
  'access[_-]?token',
  'client[_-]?secret',
  "throw new Error('TEMPLATE_SECRET_LIKE_CONTENT')",
  "throw new Error('TEMPLATE_SECRET_SCAN_DEPTH_LIMIT')",
  'export function assertNoTemplateSecretLikeContent',
]) {
  if (!secretScan.includes(marker)) throw new Error(`Phase 10A secret-scan invariant missing: ${marker}`)
}
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'localStorage', 'sessionStorage', 'indexedDB']) {
  if (secretScan.includes(forbidden)) throw new Error(`Template secret scan must remain local-only: ${forbidden}`)
}

for (const marker of [
  'Phase 10A — Ecosystem',
  'Agent Templates + Safe Import/Export',
  'Import Preview (معاينة الاستيراد)',
  'SHA-256',
  'Human-Approved Install (تثبيت بموافقة بشرية)',
  'installFactoryBlueprint(importedBlueprint, true)',
  'checked={installApproved}',
  'disabled={!installApproved}',
  'Save Verified Blueprint Only',
  'لم يتم حفظ أو تثبيت أو تشغيل أي Agent بعد',
  'Tools بقيت Denied by Default ولا يوجد Auto-Run',
]) {
  if (!ui.includes(marker)) throw new Error(`Phase 10A phone UI invariant missing: ${marker}`)
}
for (const forbidden of [
  'fetch(', 'XMLHttpRequest', 'WebSocket(', 'setInterval(',
  'useEffect(', 'navigator.sendBeacon',
]) {
  if (ui.includes(forbidden)) throw new Error(`Template exchange must not auto-fetch or auto-run: ${forbidden}`)
}
if (!toolCenter.includes("import TemplateExchangeCenter from './TemplateExchangeCenter'")) throw new Error('TemplateExchangeCenter import missing')
if (!toolCenter.includes('<TemplateExchangeCenter onAgentChange={props.onAgentChange} onNotice={props.onNotice} />')) throw new Error('TemplateExchangeCenter is not integrated')
if (!main.includes("import './template-exchange.css'")) throw new Error('Template exchange mobile styles are not loaded')

for (const marker of [
  'globalThis.localStorage = new MemoryStorage()',
  'createAgentTemplatePackage(blueprint',
  'assert.equal(pkg.integrity.digest.length, 43)',
  'const beforeImport = localStorage.snapshot()',
  'assert.deepEqual(localStorage.snapshot(), beforeImport)',
  'TEMPLATE_INTEGRITY_MISMATCH',
  'TEMPLATE_PACKAGE_EXTRA_FIELD',
  'TEMPLATE_ZERO_COST_POLICY_INVALID',
  'TEMPLATE_ROLE_TOOL_DUPLICATE',
  'TEMPLATE_SECRET_LIKE_CONTENT',
  'FACTORY_HUMAN_APPROVAL_REQUIRED',
  'factory.installFactoryBlueprint(importedBlueprint, true)',
  "agent.toolPolicy.defaultAction === 'deny'",
  'agent.toolPolicy.allowedTools.length === 0',
  'assert.equal(storage.loadRuns().length, 0)',
]) {
  if (!smoke.includes(marker)) throw new Error(`Phase 10A executable smoke invariant missing: ${marker}`)
}

for (const marker of [
  'agent-ia-factory.template/0.1',
  'Canonical JSON',
  'TEMPLATE_INTEGRITY_MISMATCH',
  'Integrity ليست Publisher Trust',
  'Exact Fields',
  'enableSuggestedToolsAutomatically = false',
  'automaticExecutionAfterInstall = false',
  'humanApprovalRequiredToInstall = true',
  'Import Preview',
  'Human-Approved Install',
  'Secret-like Content Gate',
  'Defense-in-Depth',
  'Phase 7A real Chrome smoke on the same PR',
  'New production dependencies = 0',
  'Mandatory additional spend = 0 USD',
]) {
  if (!docs.includes(marker)) throw new Error(`Phase 10A documentation marker missing: ${marker}`)
}

for (const marker of [
  'Phase 10A Safe Template CI',
  "node-version: '24'",
  'npm install --ignore-scripts --no-fund --no-audit',
  'npm run check',
  'npm run test:phase8',
  'npm run test:phase9a',
  'npm run test:phase9b',
  'npm run test:phase9c',
  'npm run test:phase9d',
  'npm run test:phase10a',
  'npm audit --omit=dev --audit-level=high',
  'npm audit --audit-level=high',
]) {
  if (!workflow.includes(marker)) throw new Error(`Phase 10A CI invariant missing: ${marker}`)
}

if (phase9dValidator.includes("pkg.version !== '1.5.0'")) throw new Error('Phase 9D validator must be forward-compatible before Phase 10A version bump')
if (!phase9dValidator.includes('Phase 9D requires package version 1.5.0 or newer')) throw new Error('Phase 9D minimum-version invariant missing')
if (!versionAtLeast(pkg.version, '1.6.0')) throw new Error('Phase 10A requires package version 1.6.0 or newer')
if (!pkg.scripts?.['validate:phase10a']?.includes('validate-phase10a.mjs')) throw new Error('validate:phase10a script missing')
if (!pkg.scripts?.['test:phase10a']?.includes('test-phase10a-templates.mjs')) throw new Error('test:phase10a script missing')
if (!pkg.scripts?.check?.includes('validate:phase10a')) throw new Error('Phase 10A validator missing from full check')
const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 10A: ${dependency}`)
}

console.log('Phase 10A Safe Agent Templates validation: PASS')
console.log('Template protocol: strict data-only package with exact fields')
console.log('Integrity: canonical SHA-256 required')
console.log('Secret-like content: local defense-in-depth scan required')
console.log('Import preview: no install/run/storage side effects')
console.log('Installation: explicit human approval only')
console.log('Installed agents: zero-cost + tools denied + no auto-run')
console.log('Publisher trust: intentionally not inferred from SHA-256')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')