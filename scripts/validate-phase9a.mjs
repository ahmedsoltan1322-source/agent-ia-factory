import fs from 'node:fs'

const required = [
  'src/core/deploymentEngine.ts',
  'src/core/deploymentStorage.ts',
  'src/components/DeploymentScaleCenter.tsx',
  'src/deployment.css',
  'scripts/test-phase9a-deployment.mjs',
  'docs/PHASE9A_DEPLOYMENT_SCALE.md',
  '.github/workflows/phase9a-deployment-ci.yml',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 9A file: ${file}`)
}

const engine = fs.readFileSync('src/core/deploymentEngine.ts', 'utf8')
const storage = fs.readFileSync('src/core/deploymentStorage.ts', 'utf8')
const ui = fs.readFileSync('src/components/DeploymentScaleCenter.tsx', 'utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx', 'utf8')
const main = fs.readFileSync('src/main.tsx', 'utf8')
const smoke = fs.readFileSync('scripts/test-phase9a-deployment.mjs', 'utf8')
const docs = fs.readFileSync('docs/PHASE9A_DEPLOYMENT_SCALE.md', 'utf8')
const workflow = fs.readFileSync('.github/workflows/phase9a-deployment-ci.yml', 'utf8')
const phase8Validator = fs.readFileSync('scripts/validate-phase8.mjs', 'utf8')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

const engineRequired = [
  "export const LOCAL_TENANT_ID = 'local-owner'",
  "DurableJobStatus = 'pending' | 'leased' | 'retry_wait' | 'succeeded' | 'failed' | 'cancelled'",
  'idempotencyKey: string',
  'requiresHumanStart: true',
  'monetaryCostUsd: 0',
  'const MAX_QUEUE_JOBS = 100',
  'const MAX_ATTEMPTS = 5',
  "job.status !== 'cancelled'",
  "job.tenantId === tenantId",
  "['pending', 'retry_wait'].includes(job.status)",
  "current.lease.token !== leaseToken",
  "status: exhausted ? 'failed' : 'retry_wait'",
  "lastErrorCode: 'LEASE_EXPIRED'",
  'export function evaluateRateLimit',
  'retryAfterMs',
  'export function summarizeDurableQueue',
]
for (const marker of engineRequired) {
  if (!engine.includes(marker)) throw new Error(`Phase 9A durable engine invariant missing: ${marker}`)
}
for (const forbidden of ['localStorage', 'sessionStorage', 'fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.', 'callMcpTool(', 'executeBuiltinTool(', 'run-browser-job', 'Authorization', 'Bearer ']) {
  if (engine.includes(forbidden)) throw new Error(`Deployment engine must remain pure and provider-neutral: ${forbidden}`)
}

const storageRequired = [
  "const JOBS_KEY = 'agent-ia-factory.deployment.jobs.v1'",
  "const RATE_EVENTS_KEY = 'agent-ia-factory.deployment.rate-events.v1'",
  "const FACTORY_PREFIX = 'agent-ia-factory.'",
  'const RESTORABLE_KEYS = new Set([JOBS_KEY, RATE_EVENTS_KEY])',
  'const MAX_STORED_JOBS = 100',
  'const MAX_RATE_EVENTS = 500',
  'const MAX_BACKUP_ENTRIES = 100',
  'const MAX_BACKUP_VALUE_CHARS = 750_000',
  'const MAX_BACKUP_JSON_CHARS = 4_000_000',
  'secret|token|password|credential|authorization|cookie|sessionid',
  "ENQUEUE_RATE_LIMIT: RateLimitPolicy = { action: 'enqueue', maxEvents: 20, windowMs: 5 * 60_000 }",
  "CLAIM_RATE_LIMIT: RateLimitPolicy = { action: 'claim', maxEvents: 10, windowMs: 60_000 }",
  'exportFactoryBackup',
  'importFactoryBackup',
  'function normalizeRestorableEntry',
  'validateDurableJob(item as DurableJob)',
  'validateEvent(item as RateLimitEvent)',
  "restorable = safe.entries.filter((entry) => RESTORABLE_KEYS.has(entry.key))",
  "restoreFactoryBackup(backup: FactoryBackup, mode: 'merge' | 'replace' = 'merge')",
  'localStorage.setItem',
  'localStorage.removeItem',
]
for (const marker of storageRequired) {
  if (!storage.includes(marker)) throw new Error(`Phase 9A storage invariant missing: ${marker}`)
}
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.sendBeacon', 'Authorization', 'Bearer ', 'localStorage.clear(']) {
  if (storage.includes(forbidden)) throw new Error(`Deployment storage must not auto-sync or globally wipe browser storage: ${forbidden}`)
}

for (const marker of [
  'Phase 9A — Deployment & Scale',
  'لا توجد Job تُنفذ تلقائيًا في Phase 9A',
  'Idempotency (منع التكرار)',
  'Claim Next (حضّر التالية)',
  'Export Backup (تصدير نسخة)',
  'Restore Merge (استعادة بالدمج)',
  'قد يحتوي Agents/Memory/Knowledge/Logs',
  'Restore (الاستعادة) في 9A يعيد فقط سجلات Deployment ذات Schema مُتحقق منه',
]) {
  if (!ui.includes(marker)) throw new Error(`Phase 9A UI disclosure missing: ${marker}`)
}
if (!toolCenter.includes('<DeploymentScaleCenter agents={agents}')) throw new Error('DeploymentScaleCenter is not integrated')
if (!main.includes("import './deployment.css'")) throw new Error('Deployment mobile styles are not loaded')

const smokeRequired = [
  "new URL('../src/core/deploymentEngine.ts', import.meta.url)",
  'assert.equal(duplicate.deduplicated, true)',
  "assert.equal(otherTenant.claimed, null)",
  'DURABLE_JOB_LEASE_MISMATCH',
  "assert.equal(failedOnce.job.status, 'retry_wait')",
  "assert.equal(reclaimedJob?.lastErrorCode, 'LEASE_EXPIRED')",
  'assert.equal(rate.allowed, false)',
  'DURABLE_JOB_NONZERO_COST_FORBIDDEN',
  'DURABLE_JOB_HUMAN_START_REQUIRED',
]
for (const marker of smokeRequired) {
  if (!smoke.includes(marker)) throw new Error(`Phase 9A executable smoke invariant missing: ${marker}`)
}

for (const marker of [
  'Phone-Local Baseline',
  'idempotencyKey',
  'requiresHumanStart=true',
  'monetaryCostUsd=0',
  'Tenant Boundary',
  '20 Job خلال 5 دقائق',
  '10 عمليات حجز في الدقيقة',
  'secret/token/password/credential/authorization/cookie/sessionid',
  'Conservative Restore',
  'تُستعاد تلقائيًا فقط مفاتيح Deployment المعروفة',
  'لا Upload',
  'Mandatory additional spend = 0 USD',
]) {
  if (!docs.includes(marker)) throw new Error(`Phase 9A documentation marker missing: ${marker}`)
}

for (const marker of [
  'Phase 9A Deployment Scale CI',
  "node-version: '24'",
  'npm install --ignore-scripts --no-fund --no-audit',
  'npm run check',
  'npm run test:phase9a',
  'npm audit --omit=dev --audit-level=high',
  'npm audit --audit-level=high',
]) {
  if (!workflow.includes(marker)) throw new Error(`Phase 9A CI invariant missing: ${marker}`)
}

if (phase8Validator.includes("pkg.version !== '1.1.0'")) throw new Error('Phase 8 validator must be forward-compatible before Phase 9 version bump')
if (!phase8Validator.includes('Phase 8 requires package version 1.1.0 or newer')) throw new Error('Phase 8 minimum-version invariant missing')
if (pkg.version !== '1.2.0') throw new Error('Phase 9A version must be 1.2.0')
if (!pkg.scripts?.['validate:phase9a']?.includes('validate-phase9a.mjs')) throw new Error('validate:phase9a script missing')
if (!pkg.scripts?.['test:phase9a']?.includes('test-phase9a-deployment.mjs')) throw new Error('test:phase9a script missing')
if (!pkg.scripts?.check?.includes('validate:phase9a')) throw new Error('Phase 9A validator missing from full check')
const allowedProductionDependencies = new Set(['@mlc-ai/web-llm', '@modelcontextprotocol/client', 'react', 'react-dom'])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) throw new Error(`Unexpected production dependency in Phase 9A: ${dependency}`)
}

console.log('Phase 9A Deployment & Scale validation: PASS')
console.log('Durable queue: bounded + idempotent + leased + retryable')
console.log('Tenant boundary: explicit, phone-local tenant only')
console.log('Rate limits: fail-closed per tenant/action')
console.log('Backup export: local factory prefix only, secret-like keys excluded')
console.log('Restore: schema-validated Deployment keys only; other archive records skipped')
console.log('Automatic execution: forbidden in 9A; Human Start required')
console.log('External telemetry/sync: none')
console.log('New production dependencies: 0')
console.log('Mandatory additional spend: 0 USD')
