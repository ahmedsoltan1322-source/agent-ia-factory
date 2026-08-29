import fs from 'node:fs'

const required = [
  'src/core/adapterSdk.ts',
  'src/core/adapterActivation.ts',
  'src/components/AdapterSdkCenter.tsx',
  'src/adapter-sdk.css',
  'scripts/test-phase10d-adapters.mjs',
  'docs/PHASE10D_PLUGIN_ADAPTER_SDK.md',
  '.github/workflows/phase10d-adapter-sdk-ci.yml',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 10D file: ${file}`)
}

const sdk = fs.readFileSync('src/core/adapterSdk.ts', 'utf8')
const activation = fs.readFileSync('src/core/adapterActivation.ts', 'utf8')
const toolSdk = fs.readFileSync('src/core/toolSdk.ts', 'utf8')
const ui = fs.readFileSync('src/components/AdapterSdkCenter.tsx', 'utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx', 'utf8')
const main = fs.readFileSync('src/main.tsx', 'utf8')
const smoke = fs.readFileSync('scripts/test-phase10d-adapters.mjs', 'utf8')
const docs = fs.readFileSync('docs/PHASE10D_PLUGIN_ADAPTER_SDK.md', 'utf8')
const workflow = fs.readFileSync('.github/workflows/phase10d-adapter-sdk-ci.yml', 'utf8')
const phase10cValidator = fs.readFileSync('scripts/validate-phase10c.mjs', 'utf8')
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
  "export const ADAPTER_SDK_API_VERSION = '0.1'",
  "export type AdapterKind = 'tool' | 'model' | 'memory' | 'browser' | 'deployment'",
  "source: 'factory-static-reviewed'",
  "id: 'adapter.local.text.stats'",
  "supportedToolIds: ['community.text.stats']",
  "supportedScopes: ['text:read']",
  "maximumRisk: 'read_only'",
  'networkMode: \'none\'',
  'secretAccess: false',
  'monetaryCostUsd: 0',
  'validateToolAdapterCompatibility',
  'ADAPTER_TOOL_ID_UNSUPPORTED',
  'ADAPTER_SCOPE_UNSUPPORTED',
  'ADAPTER_RISK_EXCEEDS_REVIEWED_CEILING',
  'PHASE10D_REFERENCE_ADAPTER_NETWORK_FORBIDDEN',
  'buildAdapterBackedToolDefinition',
]) {
  if (!sdk.includes(marker)) throw new Error(`Phase 10D Adapter SDK invariant missing: ${marker}`)
}
for (const forbidden of [
  'fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.sendBeacon', 'eval(', 'new Function(',
  'child_process', 'npm install', 'pip install', 'import(', 'Authorization', 'Bearer ',
]) {
  if (sdk.includes(forbidden)) throw new Error(`Adapter SDK must remain static/non-network/non-dynamic: ${forbidden}`)
}

for (const marker of [
  "export const ADAPTER_ACTIVATION_SCHEMA_VERSION = '0.1'",
  "const ACTIVATION_KEY = 'agent-ia-factory.adapter-activations.v1'",
  'MAX_ACTIVE_MARKETPLACE_TOOLS = 32',
  'publisherDisplayName',
  'publisherPublicKey',
  'requireCurrentPublisherTrust',
  'ADAPTER_PUBLISHER_TRUST_REQUIRED',
  'ADAPTER_ACTIVATION_HUMAN_APPROVAL_REQUIRED',
  'ADAPTER_ACTIVATION_MARKETPLACE_REGISTRATION_REQUIRED',
  'registration.activationAllowed !== false',
  'validateToolAdapterCompatibility',
  "activationStatus: 'active'",
  'monetaryCostUsd: 0',
  'ADAPTER_AGENT_ALLOWLIST_APPROVAL_REQUIRED',
  'ADAPTER_AGENT_ALLOWLIST_REMOVE_APPROVAL_REQUIRED',
  'ADAPTER_DEACTIVATION_HUMAN_APPROVAL_REQUIRED',
  'executeToolDefinition',
  'adapter-backed marketplace tool execution',
  'assertNoTemplateSecretLikeContent',
  'SCOPE_MIN_RISK',
]) {
  if (!activation.includes(marker)) throw new Error(`Phase 10D activation invariant missing: ${marker}`)
}
for (const forbidden of [
  'fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.sendBeacon', 'eval(', 'new Function(',
  'child_process', 'npm install', 'pip install', 'privateKey',
]) {
  if (activation.includes(forbidden)) throw new Error(`Adapter activation core must remain local/non-dynamic/no-private-key: ${forbidden}`)
}

for (const marker of [
  'export async function executeToolDefinition',
  'const gate = evaluateToolGate(agent, tool, approvedByHuman, callIndex)',
  'executeBuiltinInCapabilitySandbox(tool, { agent }, input)',
  'saveToolRecord(record)',
  "return executeToolDefinition(agent, tool, input, approvedByHuman, callIndex, 'built-in tool execution')",
]) {
  if (!toolSdk.includes(marker)) throw new Error(`Shared Tool SDK execution invariant missing: ${marker}`)
}
if (!toolSdk.includes('agent.toolPolicy.allowedTools.includes(tool.id)')) throw new Error('Agent allowlist gate must remain in shared Tool SDK path')
if (!toolSdk.includes("tool.risk === 'financial'")) throw new Error('Financial gate must remain in shared Tool SDK path')

for (const marker of [
  'Phase 10D',
  'Plugin/Adapter SDK (حزمة تطوير الموصلات)',
  'Static Reviewed Adapters · 0$',
  'Import Registered Tool Package (استورد حزمة Tool المسجلة)',
  'Activate Reviewed Adapter Binding (فعّل الربط المفحوص)',
  'Add to Agent Allowlist',
  'Deactivate Adapter Binding',
  'Request Adapter Tool Call',
  'Per-call Human Approval Required',
]) {
  if (!ui.includes(marker)) throw new Error(`Phase 10D phone UI invariant missing: ${marker}`)
}
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.sendBeacon', 'eval(', 'new Function(', 'import(']) {
  if (ui.includes(forbidden)) throw new Error(`Adapter SDK UI must not dynamically fetch/execute plugin code: ${forbidden}`)
}
if (!toolCenter.includes("import AdapterSdkCenter from './AdapterSdkCenter'")) throw new Error('AdapterSdkCenter import missing')
if (!toolCenter.includes('<AdapterSdkCenter agent={props.agent} onAgentChange={props.onAgentChange} onNotice={props.onNotice} />')) throw new Error('AdapterSdkCenter integration missing')
if (!main.includes("import './adapter-sdk.css'")) throw new Error('Adapter SDK styles are not loaded')

for (const marker of [
  "adapter.local.text.stats",
  'validateToolAdapterCompatibility(manifest)',
  'ADAPTER_TOOL_ID_UNSUPPORTED',
  'ADAPTER_SCOPE_UNSUPPORTED',
  'ADAPTER_RISK_EXCEEDS_REVIEWED_CEILING',
  'ADAPTER_ACTIVATION_MARKETPLACE_REGISTRATION_REQUIRED',
  'ADAPTER_ACTIVATION_HUMAN_APPROVAL_REQUIRED',
  "assert.equal(marketplaceRecord.registrationStatus, 'disabled')",
  'assert.equal(marketplaceRecord.activationAllowed, false)',
  'ADAPTER_AGENT_ALLOWLIST_APPROVAL_REQUIRED',
  "assert.equal(beforeAllowlist.gate.status, 'blocked')",
  "assert.equal(executed.record.status, 'success')",
  'adapter-backed marketplace tool execution: completed inside capability sandbox',
  'PUBLISHER_TRUST_REVOKE_APPROVAL_REQUIRED',
  'ADAPTER_PUBLISHER_TRUST_REQUIRED',
  'ADAPTER_DEACTIVATION_HUMAN_APPROVAL_REQUIRED',
  'ADAPTER_TOOL_NOT_ACTIVE',
  "toolSdk.executeBuiltinTool(builtinAgent, 'local.text.stats'",
  "assert.ok(!storageRaw.includes('privateKey'))",
]) {
  if (!smoke.includes(marker)) throw new Error(`Phase 10D executable smoke invariant missing: ${marker}`)
}

for (const marker of [
  'Plugin/Adapter SDK',
  'Static Reviewed Adapter Registry',
  'adapter.local.text.stats',
  'Why no Dynamic Plugin Code',
  'ADAPTER_ACTIVATION_HUMAN_APPROVAL_REQUIRED',
  'Agent Allowlist Approval',
  'Per-call Approval',
  'executeToolDefinition',
  'executeBuiltinInCapabilitySandbox',
  'stale allowlist',
  'Mandatory additional spend = 0 USD',
]) {
  if (!docs.includes(marker)) throw new Error(`Phase 10D documentation marker missing: ${marker}`)
}

for (const marker of [
  'Phase 10D Plugin Adapter SDK CI',
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
  'npm run test:phase10d',
  'npm audit --omit=dev --audit-level=high',
  'npm audit --audit-level=high',
]) {
  if (!workflow.includes(marker)) throw new Error(`Phase 10D CI invariant missing: ${marker}`)
}

if (phase10cValidator.includes("pkg.version !== '1.8.0'")) throw new Error('Phase 10C validator must remain forward-compatible')
if (!phase10cValidator.includes("versionAtLeast(pkg.version, '1.8.0')")) throw new Error('Phase 10C minimum-version invariant missing')
if (!versionAtLeast(pkg.version, '1.9.0')) throw new Error('Phase 10D requires package version 1.9.0 or newer')
if (!pkg.scripts?.['validate:phase10d']?.includes('validate-phase10d.mjs')) throw new Error('validate:phase10d script missing')
if (!pkg.scripts?.['test:phase10d']?.includes('test-phase10d-adapters.mjs')) throw new Error('test:phase10d script missing')
if (!pkg.scripts?.check?.includes('validate:phase10d')) throw new Error('Phase 10D validator missing from full check')
const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 10D: ${dependency}`)
}

console.log('Phase 10D Plugin/Adapter SDK validation: PASS')
console.log('Adapter registry: static + factory-reviewed only')
console.log('Dynamic marketplace code loading: forbidden')
console.log('Activation / Agent allowlist / per-call approval: separated')
console.log('Publisher trust revocation: runtime fail-closed')
console.log('Execution path: existing Tool Gate + Capability Sandbox + Tool Call Log')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')
