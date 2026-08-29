import fs from 'node:fs'

const required = [
  'src/core/communityCatalog.ts',
  'src/core/publisherTrust.ts',
  'src/components/CommunityCatalogCenter.tsx',
  'src/community-catalog.css',
  'scripts/test-phase10b-catalog.mjs',
  'docs/PHASE10B_PUBLISHER_TRUST_CATALOG.md',
  '.github/workflows/phase10b-catalog-ci.yml',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 10B file: ${file}`)
}

const catalog = fs.readFileSync('src/core/communityCatalog.ts', 'utf8')
const trust = fs.readFileSync('src/core/publisherTrust.ts', 'utf8')
const ui = fs.readFileSync('src/components/CommunityCatalogCenter.tsx', 'utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx', 'utf8')
const main = fs.readFileSync('src/main.tsx', 'utf8')
const smoke = fs.readFileSync('scripts/test-phase10b-catalog.mjs', 'utf8')
const docs = fs.readFileSync('docs/PHASE10B_PUBLISHER_TRUST_CATALOG.md', 'utf8')
const workflow = fs.readFileSync('.github/workflows/phase10b-catalog-ci.yml', 'utf8')
const phase10aValidator = fs.readFileSync('scripts/validate-phase10a.mjs', 'utf8')
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
  "export const COMMUNITY_CATALOG_PROTOCOL = 'agent-ia-factory.catalog/0.1'",
  'export const MAX_COMMUNITY_CATALOG_JSON_CHARS = 300_000',
  'export const MAX_COMMUNITY_CATALOG_ENTRIES = 80',
  "const ED25519_PUBLIC_KEY_B64URL = /^[A-Za-z0-9_-]{43}$/u",
  "const ED25519_SIGNATURE_B64URL = /^[A-Za-z0-9_-]{86}$/u",
  "const COMMIT_SHA = /^[0-9a-f]{40}$/u",
  "new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0'])",
  'export function stableCommunityCatalogStringify',
  "crypto.subtle.digest('SHA-256'",
  "crypto.subtle.importKey('raw'",
  "crypto.subtle.verify({ name: 'Ed25519' }",
  "crypto.subtle.sign({ name: 'Ed25519' }",
  'CATALOG_PUBLISHER_FINGERPRINT_MISMATCH',
  'CATALOG_SIGNATURE_INVALID',
  'CATALOG_PACKAGE_EXTRA_FIELD',
  'CATALOG_ENTRY_LICENSE_NOT_ALLOWED',
  "url.hostname !== 'github.com'",
  "!value.endsWith('.agent-template.json')",
  "segment === '..'",
  'CATALOG_ENTRY_IDENTITY_DUPLICATE',
  'assertNoTemplateSecretLikeContent({',
  'export function matchTemplatePackageToCatalog',
]) {
  if (!catalog.includes(marker)) throw new Error(`Phase 10B catalog invariant missing: ${marker}`)
}
for (const forbidden of [
  'fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.sendBeacon',
  'localStorage', 'sessionStorage', 'indexedDB', 'Authorization', 'Bearer ',
  'installFactoryBlueprint(', 'saveAgent(', 'saveWorkflow(', 'eval(', 'new Function(',
]) {
  if (catalog.includes(forbidden)) throw new Error(`Community catalog core must remain data-only and network-free: ${forbidden}`)
}

for (const marker of [
  "export type PublisherTrustStatus = 'trusted' | 'untrusted' | 'key-changed'",
  "const TRUST_KEY = 'agent-ia-factory.publisher-trust.v1'",
  'const MAX_TRUSTED_PUBLISHERS = 32',
  "source: 'human-pinned'",
  "status: 'untrusted'",
  "status: 'trusted'",
  "status: 'key-changed'",
  'PUBLISHER_TRUST_HUMAN_APPROVAL_REQUIRED',
  'PUBLISHER_KEY_CHANGE_REQUIRES_EXPLICIT_REPLACE',
  'PUBLISHER_TRUST_REVOKE_APPROVAL_REQUIRED',
  'existing.fingerprint === publisher.keyFingerprint && existing.publicKey === publisher.publicKey',
  'verifyCommunityCatalogPackage(pkg)',
]) {
  if (!trust.includes(marker)) throw new Error(`Phase 10B trust invariant missing: ${marker}`)
}
for (const forbidden of [
  'privateKey', 'generateKey(', 'sign(', 'fetch(', 'XMLHttpRequest', 'WebSocket(',
  'sessionStorage', 'indexedDB', 'Authorization', 'Bearer ',
]) {
  if (trust.includes(forbidden)) throw new Error(`Publisher trust store must never manage private signing capability: ${forbidden}`)
}

for (const marker of [
  'Phase 10B — Publisher Trust + Community Catalog',
  'Ed25519 · Manual Trust · 0$',
  'Signature Valid (توقيع صالح) لا تعني Trusted Publisher',
  'Import Signed Catalog (استورد دليلًا موقّعًا)',
  'Local File Only (ملف محلي فقط)',
  "trust.status === 'key-changed'",
  'Replace Trusted Key (استبدل المفتاح الموثوق)',
  'Trust Publisher Fingerprint (وثّق بصمة الناشر)',
  'Revoke Publisher Trust (ألغِ ثقة الناشر)',
  'Verify Template Against Catalog (طابق قالبًا مع الدليل)',
  'لا تثبيت ولا تشغيل ولا Tool Activation',
]) {
  if (!ui.includes(marker)) throw new Error(`Phase 10B phone UI invariant missing: ${marker}`)
}
for (const forbidden of [
  'fetch(', 'XMLHttpRequest', 'WebSocket(', 'setInterval(', 'useEffect(', 'navigator.sendBeacon',
  'installFactoryBlueprint(', 'saveAgent(', 'saveWorkflow(', 'executeBuiltinTool(', 'callMcpTool(',
]) {
  if (ui.includes(forbidden)) throw new Error(`Community catalog UI must not fetch/install/run automatically: ${forbidden}`)
}
if (!toolCenter.includes("import CommunityCatalogCenter from './CommunityCatalogCenter'")) throw new Error('CommunityCatalogCenter import missing')
if (!toolCenter.includes('<CommunityCatalogCenter onNotice={props.onNotice} />')) throw new Error('CommunityCatalogCenter is not integrated')
if (!main.includes("import './community-catalog.css'")) throw new Error('Community catalog styles are not loaded')

for (const marker of [
  "crypto.subtle.generateKey({ name: 'Ed25519' }",
  'createSignedCommunityCatalogPackage({',
  'assert.equal(verified.signatureVerified, true)',
  "assert.equal(trust.status, 'untrusted')",
  'PUBLISHER_TRUST_HUMAN_APPROVAL_REQUIRED',
  "assert.equal(trust.status, 'trusted')",
  "assert.ok(!trustStorageRaw.includes(privateKeyBase64))",
  "assert.ok(!trustStorageRaw.includes('privateKey'))",
  "assert.equal(attackerTrust.status, 'untrusted')",
  "assert.equal(rotatedStatus.status, 'key-changed')",
  'PUBLISHER_KEY_CHANGE_REQUIRES_EXPLICIT_REPLACE',
  "assert.equal(replaced.status, 'trusted')",
  'PUBLISHER_TRUST_REVOKE_APPROVAL_REQUIRED',
  'CATALOG_SIGNATURE_INVALID',
  'CATALOG_PACKAGE_EXTRA_FIELD',
  'CATALOG_ENTRY_LICENSE_NOT_ALLOWED',
  'CATALOG_SOURCE_REPOSITORY_INVALID',
  'CATALOG_SOURCE_PATH_INVALID',
  'TEMPLATE_SECRET_LIKE_CONTENT',
  'matchTemplatePackageToCatalog(template, catalog)',
  'assert.equal(storage.loadAgents().length, 0)',
  'assert.equal(storage.loadRuns().length, 0)',
]) {
  if (!smoke.includes(marker)) throw new Error(`Phase 10B executable smoke invariant missing: ${marker}`)
}

for (const marker of [
  'agent-ia-factory.catalog/0.1',
  'Signature Valid ليست Trusted Publisher',
  'Fingerprint Pinning',
  'status = key-changed',
  'لا Automatic Key Rotation',
  'Publisher-Attested Provenance',
  'لا تدعي Independent GitHub Provenance Verification',
  'https://github.com/<owner>/<repo>',
  'AGPL/SSPL/BUSL/GPL',
  'Secret-like Content Gate',
  'Match لا يعني Install',
  'Private-key persistence',
  'Phase 7A real Chrome smoke on the same PR',
  'New production dependencies: 0',
  'Mandatory additional spend: 0 USD',
]) {
  if (!docs.includes(marker)) throw new Error(`Phase 10B documentation marker missing: ${marker}`)
}

for (const marker of [
  'Phase 10B Publisher Trust Catalog CI',
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
  'npm audit --omit=dev --audit-level=high',
  'npm audit --audit-level=high',
]) {
  if (!workflow.includes(marker)) throw new Error(`Phase 10B CI invariant missing: ${marker}`)
}

if (phase10aValidator.includes("pkg.version !== '1.6.0'")) throw new Error('Phase 10A validator must be forward-compatible before Phase 10B version bump')
if (!phase10aValidator.includes('Phase 10A requires package version 1.6.0 or newer')) throw new Error('Phase 10A minimum-version invariant missing')
if (!versionAtLeast(pkg.version, '1.7.0')) throw new Error('Phase 10B requires package version 1.7.0 or newer')
if (!pkg.scripts?.['validate:phase10b']?.includes('validate-phase10b.mjs')) throw new Error('validate:phase10b script missing')
if (!pkg.scripts?.['test:phase10b']?.includes('test-phase10b-catalog.mjs')) throw new Error('test:phase10b script missing')
if (!pkg.scripts?.check?.includes('validate:phase10b')) throw new Error('Phase 10B validator missing from full check')
const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 10B: ${dependency}`)
}

console.log('Phase 10B Publisher Trust + Community Catalog validation: PASS')
console.log('Catalog signature: Ed25519 verified locally')
console.log('Signature validity and publisher trust: strictly separated')
console.log('Publisher trust: human-pinned fingerprint only')
console.log('Key rotation: fail-closed until explicit replacement')
console.log('Private signing key persistence: forbidden')
console.log('Catalog metadata secret-like scan: required locally')
console.log('GitHub source coordinates: signed but not independently fetched')
console.log('Catalog/template matching: data-only, no install/run')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')
