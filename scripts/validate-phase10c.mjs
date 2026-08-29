import fs from 'node:fs'

const required = [
  'src/core/toolMarketplace.ts',
  'src/components/ToolMarketplaceCenter.tsx',
  'src/tool-marketplace.css',
  'scripts/test-phase10c-tools.mjs',
  'docs/PHASE10C_SAFE_TOOL_MARKETPLACE.md',
  '.github/workflows/phase10c-tool-marketplace-ci.yml',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 10C file: ${file}`)
}

const core = fs.readFileSync('src/core/toolMarketplace.ts', 'utf8')
const trust = fs.readFileSync('src/core/publisherTrust.ts', 'utf8')
const ui = fs.readFileSync('src/components/ToolMarketplaceCenter.tsx', 'utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx', 'utf8')
const main = fs.readFileSync('src/main.tsx', 'utf8')
const smoke = fs.readFileSync('scripts/test-phase10c-tools.mjs', 'utf8')
const docs = fs.readFileSync('docs/PHASE10C_SAFE_TOOL_MARKETPLACE.md', 'utf8')
const workflow = fs.readFileSync('.github/workflows/phase10c-tool-marketplace-ci.yml', 'utf8')
const phase10bValidator = fs.readFileSync('scripts/validate-phase10b.mjs', 'utf8')
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
  "export const TOOL_PACKAGE_PROTOCOL = 'agent-ia-factory.tool-package/0.1'",
  'export const MAX_TOOL_PACKAGE_JSON_CHARS = 120_000',
  'export const MAX_MARKETPLACE_TOOLS = 60',
  "const ALLOWED_RISKS: Exclude<ToolRisk, 'financial'>[]",
  "'network:write': 'external_write'",
  "'security:change': 'security_change'",
  'TOOL_RISK_UNDERSTATED_FOR_SCOPE',
  "kind: 'registered-adapter'",
  "adapterApiVersion: '0.1'",
  'maxMonetarySpendUsd: 0',
  'automaticRegistration: false',
  'automaticActivation: false',
  'automaticExecution: false',
  'humanApprovalRequiredToRegister: true',
  'humanApprovalRequiredToActivate: true',
  "new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0'])",
  "crypto.subtle.verify({ name: 'Ed25519' }",
  "crypto.subtle.sign({ name: 'Ed25519' }",
  "crypto.subtle.digest('SHA-256'",
  'assertNoTemplateSecretLikeContent',
  "url.hostname !== 'github.com'",
  "!value.endsWith('.agent-tool.json')",
  "segment === '..'",
  "registrationStatus: 'disabled'",
  'activationAllowed: false',
  "status: 'eligible-for-phase10d'",
  'registerMarketplaceToolDisabled',
  'evaluateMarketplaceActivationEligibility',
]) {
  if (!core.includes(marker)) throw new Error(`Phase 10C marketplace invariant missing: ${marker}`)
}
for (const forbidden of [
  'fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.sendBeacon', 'Authorization', 'Bearer ',
  'executeBuiltinTool(', 'callMcpTool(', 'installFactoryBlueprint(', 'saveAgent(', 'saveWorkflow(',
  'eval(', 'new Function(', 'npm install', 'pip install', 'child_process',
]) {
  if (core.includes(forbidden)) throw new Error(`Tool marketplace core must remain data-only/non-executing: ${forbidden}`)
}

for (const marker of [
  'export interface VerifiedPublisherIdentity',
  'export interface VerifiedPublisherTrustResult',
  'getVerifiedPublisherIdentityTrustStatus',
  'pinVerifiedPublisherIdentityTrust',
  'PUBLISHER_IDENTITY_VERIFICATION_REQUIRED',
  'PUBLISHER_KEY_CHANGE_REQUIRES_EXPLICIT_REPLACE',
  'getCatalogPublisherTrustStatus',
  'pinCatalogPublisherTrust',
]) {
  if (!trust.includes(marker)) throw new Error(`Shared publisher trust invariant missing: ${marker}`)
}
for (const forbidden of ['privateKey', 'generateKey(', 'sign(', 'fetch(', 'XMLHttpRequest', 'WebSocket(']) {
  if (trust.includes(forbidden)) throw new Error(`Publisher trust store must not own private signing/network capability: ${forbidden}`)
}

for (const marker of [
  'Phase 10C',
  'Tool Marketplace Architecture (سوق الأدوات الآمن)',
  'Signed · Disabled by Default · 0$',
  'Import Signed Tool Package (استورد حزمة أداة موقعة)',
  'Trust Publisher Fingerprint (وثّق بصمة الناشر)',
  'Register Disabled Tool (سجّل الأداة معطلة)',
  'activationAllowed=false',
  'Runtime Activation مقفلة في Phase 10C',
  'Phase 10D Adapter SDK',
]) {
  if (!ui.includes(marker)) throw new Error(`Phase 10C phone UI invariant missing: ${marker}`)
}
for (const forbidden of [
  'fetch(', 'XMLHttpRequest', 'WebSocket(', 'setInterval(', 'navigator.sendBeacon',
  'executeBuiltinTool(', 'callMcpTool(', 'saveAgent(', 'installFactoryBlueprint(',
  '>Activate<', '>Run<',
]) {
  if (ui.includes(forbidden)) throw new Error(`Tool marketplace UI must not auto-fetch/activate/run tools: ${forbidden}`)
}
if (!toolCenter.includes("import ToolMarketplaceCenter from './ToolMarketplaceCenter'")) throw new Error('ToolMarketplaceCenter import missing')
if (!toolCenter.includes('<ToolMarketplaceCenter onNotice={props.onNotice} />')) throw new Error('ToolMarketplaceCenter is not integrated')
if (!main.includes("import './tool-marketplace.css'")) throw new Error('Tool marketplace styles are not loaded')

for (const marker of [
  "crypto.subtle.generateKey({ name: 'Ed25519' }",
  'createSignedToolPackage({',
  'assert.equal(verified.signatureVerified, true)',
  "assert.equal(preview.trustStatus, 'untrusted')",
  'TOOL_PUBLISHER_TRUST_REQUIRED',
  'PUBLISHER_TRUST_HUMAN_APPROVAL_REQUIRED',
  "assert.equal(trust.getVerifiedPublisherIdentityTrustStatus(identity).status, 'trusted')",
  'TOOL_REGISTRATION_HUMAN_APPROVAL_REQUIRED',
  "assert.equal(registered.registrationStatus, 'disabled')",
  'assert.equal(registered.activationAllowed, false)',
  'assert.equal(registered.monetaryCostUsd, 0)',
  "assert.equal(eligibility.status, 'eligible-for-phase10d')",
  'assert.equal(storage.loadAgents().length, 0)',
  'assert.equal(storage.loadRuns().length, 0)',
  'TOOL_SIGNATURE_INVALID',
  'TOOL_PACKAGE_EXTRA_FIELD',
  'TOOL_RISK_INVALID',
  'TOOL_RISK_UNDERSTATED_FOR_SCOPE',
  'TOOL_LICENSE_NOT_ALLOWED',
  'TOOL_SOURCE_REPOSITORY_INVALID',
  'TOOL_SOURCE_PATH_INVALID',
  'TEMPLATE_SECRET_LIKE_CONTENT',
  "assert.equal(trust.getVerifiedPublisherIdentityTrustStatus(rotatedIdentity).status, 'key-changed')",
  'PUBLISHER_KEY_CHANGE_REQUIRES_EXPLICIT_REPLACE',
  'TOOL_REGISTRY_REMOVE_APPROVAL_REQUIRED',
]) {
  if (!smoke.includes(marker)) throw new Error(`Phase 10C executable smoke invariant missing: ${marker}`)
}

for (const marker of [
  'agent-ia-factory.tool-package/0.1',
  'Data-only Tool Manifest',
  'registered-adapter',
  'TOOL_RISK_UNDERSTATED_FOR_SCOPE',
  'Signature صالح لا يعني Trusted',
  'registrationStatus = disabled',
  'activationAllowed = false',
  'لا Runtime Activation في Phase 10C',
  'eligible-for-phase10d',
  'Phase 10D — Plugin/Adapter SDK',
  'AGPL',
  'Secret-like Metadata Gate',
  'No Agent/Run side effects',
  'Phase 7A real Chrome smoke on same PR',
  'New production dependencies = 0',
  'Mandatory additional spend = 0 USD',
]) {
  if (!docs.includes(marker)) throw new Error(`Phase 10C documentation marker missing: ${marker}`)
}

for (const marker of [
  'Phase 10C Safe Tool Marketplace CI',
  "node-version: '24'",
  'npm install --ignore-scripts --no-fund --no-audit',
  'npm run check',
  'npm run test:phase8',
  'npm run test:phase9a',
  'npm run test:phase9b',
  'npm run test:phase9c',
  'npm run test:phase9d',
  'npm run test:phase10a',
  'npm run test:phase10b',
  'npm run test:phase10c',
  'npm audit --omit=dev --audit-level=high',
  'npm audit --audit-level=high',
]) {
  if (!workflow.includes(marker)) throw new Error(`Phase 10C CI invariant missing: ${marker}`)
}

if (phase10bValidator.includes("pkg.version !== '1.7.0'")) throw new Error('Phase 10B validator must be forward-compatible before Phase 10C version bump')
if (!phase10bValidator.includes("versionAtLeast(pkg.version, '1.7.0')")) throw new Error('Phase 10B minimum-version invariant missing')
if (!versionAtLeast(pkg.version, '1.8.0')) throw new Error('Phase 10C requires package version 1.8.0 or newer')
if (!pkg.scripts?.['validate:phase10c']?.includes('validate-phase10c.mjs')) throw new Error('validate:phase10c script missing')
if (!pkg.scripts?.['test:phase10c']?.includes('test-phase10c-tools.mjs')) throw new Error('test:phase10c script missing')
if (!pkg.scripts?.check?.includes('validate:phase10c')) throw new Error('Phase 10C validator missing from full check')
const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 10C: ${dependency}`)
}

console.log('Phase 10C Safe Tool Marketplace validation: PASS')
console.log('Tool packages: Ed25519 signed, data-only manifests')
console.log('Publisher trust: shared human-pinned fingerprint store')
console.log('Registration: trusted publisher + human approval, disabled only')
console.log('Runtime activation: absent/deferred to Phase 10D')
console.log('Financial tools: forbidden in zero-cost baseline')
console.log('Risk/scope understatement: forbidden')
console.log('Agent allowlist / Tool SDK execution side effects: absent')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')
