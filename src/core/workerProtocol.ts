import { validateDurableJob, validateTenantId, type DurableJob } from './deploymentEngine'
import type { AgentSpec, RunRecord } from './types'

export const WORKER_PROTOCOL = 'agent-ia-factory.worker/0.1' as const
export const REFERENCE_WORKER_ID = 'portable-node-worker' as const
export const MAX_WORKER_BUNDLE_CHARS = 300_000
export const MAX_WORKER_RECEIPT_CHARS = 400_000

const MAX_OUTPUT_CHARS = 80_000
const MAX_ERROR_CHARS = 2_000
const MAX_POLICY_CHECKS = 64
const MAX_POLICY_CHECK_CHARS = 240
const IDENTIFIER = /^[A-Za-z0-9._:-]+$/u

export interface PortableWorkerManifest {
  schemaVersion: '0.1'
  protocol: typeof WORKER_PROTOCOL
  workerId: string
  tenantId: string
  transport: 'offline-file'
  supportedRuntimeAdapters: ['local-demo']
  maxConcurrentJobs: 1
  allowPaid: false
  maxMonetarySpendUsd: 0
  automaticNetwork: false
  automaticToolExecution: false
  requiresHumanTransfer: true
}

export interface PortableWorkerBundle {
  schemaVersion: '0.1'
  protocol: typeof WORKER_PROTOCOL
  bundleId: string
  createdAt: string
  expiresAt: string
  tenantId: string
  worker: PortableWorkerManifest
  job: DurableJob
  agent: AgentSpec
  monetaryCostUsd: 0
  requiresHumanTransfer: true
}

export interface PortableWorkerReceipt {
  schemaVersion: '0.1'
  protocol: typeof WORKER_PROTOCOL
  bundleId: string
  tenantId: string
  workerId: string
  jobId: string
  leaseToken: string
  createdAt: string
  run: RunRecord
  monetaryCostUsd: 0
  automaticNetworkUsed: false
  automaticToolExecutionUsed: false
}

function parseTime(value: string, code: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(code)
  return parsed
}

function boundedIdentifier(value: string, max: number, code: string): string {
  const clean = value.trim()
  if (!clean || clean.length > max || !IDENTIFIER.test(clean)) throw new Error(code)
  return clean
}

function exactKeys(value: object, allowed: readonly string[], code: string): void {
  const allow = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allow.has(key)) throw new Error(code)
  }
}

function cloneAgentForWorker(agent: AgentSpec): AgentSpec {
  if (!agent || agent.specVersion !== '0.1') throw new Error('WORKER_AGENT_SCHEMA_UNSUPPORTED')
  const id = boundedIdentifier(agent.id, 120, 'WORKER_AGENT_ID_INVALID')
  if (agent.runtime.adapter !== 'local-demo') throw new Error('WORKER_RUNTIME_NOT_SUPPORTED')
  if (agent.modelPolicy.allowPaid !== false || agent.budgetPolicy.maxMonetarySpendUsd !== 0) {
    throw new Error('WORKER_ZERO_COST_POLICY_REQUIRED')
  }
  if (agent.toolPolicy.defaultAction !== 'deny' || agent.toolPolicy.allowedTools.length !== 0) {
    throw new Error('WORKER_TOOLS_MUST_BE_DISABLED')
  }
  if (agent.approvalPolicy.externalWrite === 'allow' || agent.approvalPolicy.financial !== 'deny') {
    throw new Error('WORKER_EXTERNAL_ACTION_POLICY_UNSAFE')
  }
  if (agent.evaluationPolicy.requiredBeforeProduction !== true) throw new Error('WORKER_EVAL_POLICY_REQUIRED')

  return {
    specVersion: '0.1',
    id,
    name: String(agent.name).slice(0, 160),
    description: String(agent.description).slice(0, 2_000),
    instructions: String(agent.instructions).slice(0, 20_000),
    runtime: { adapter: 'local-demo' },
    modelPolicy: { mode: agent.modelPolicy.mode, allowPaid: false },
    toolPolicy: { defaultAction: 'deny', allowedTools: [] },
    memoryPolicy: {
      session: Boolean(agent.memoryPolicy.session),
      longTerm: Boolean(agent.memoryPolicy.longTerm),
      shared: Boolean(agent.memoryPolicy.shared),
    },
    approvalPolicy: {
      externalWrite: agent.approvalPolicy.externalWrite,
      delete: agent.approvalPolicy.delete,
      financial: 'deny',
      securityChange: agent.approvalPolicy.securityChange,
    },
    budgetPolicy: {
      maxMonetarySpendUsd: 0,
      maxRunSeconds: Math.max(1, Math.min(300, Math.floor(agent.budgetPolicy.maxRunSeconds))),
      maxToolCalls: Math.max(0, Math.min(30, Math.floor(agent.budgetPolicy.maxToolCalls))),
    },
    evaluationPolicy: {
      requiredBeforeProduction: true,
      minimumPassRate: Math.max(0, Math.min(1, Number(agent.evaluationPolicy.minimumPassRate))),
      securityTestsRequired: Boolean(agent.evaluationPolicy.securityTestsRequired),
    },
  }
}

function cloneJobForWorker(raw: DurableJob): DurableJob {
  const job = validateDurableJob(raw)
  if (job.kind !== 'agent_run') throw new Error('WORKER_JOB_KIND_NOT_SUPPORTED')
  if (job.status !== 'leased' || !job.lease) throw new Error('WORKER_JOB_MUST_BE_LEASED')
  return {
    schemaVersion: '0.1',
    id: job.id,
    tenantId: job.tenantId,
    kind: 'agent_run',
    idempotencyKey: job.idempotencyKey,
    payload: { agentId: job.payload.agentId, task: job.payload.task },
    status: 'leased',
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    nextAttemptAt: job.nextAttemptAt,
    lease: {
      workerId: job.lease.workerId,
      token: job.lease.token,
      acquiredAt: job.lease.acquiredAt,
      ...(job.lease.renewedAt ? { renewedAt: job.lease.renewedAt } : {}),
      expiresAt: job.lease.expiresAt,
    },
    ...(job.lastErrorCode ? { lastErrorCode: job.lastErrorCode } : {}),
    requiresHumanStart: true,
    monetaryCostUsd: 0,
  }
}

export function createReferenceWorkerManifest(tenantIdRaw: string): PortableWorkerManifest {
  const tenantId = validateTenantId(tenantIdRaw)
  return {
    schemaVersion: '0.1',
    protocol: WORKER_PROTOCOL,
    workerId: REFERENCE_WORKER_ID,
    tenantId,
    transport: 'offline-file',
    supportedRuntimeAdapters: ['local-demo'],
    maxConcurrentJobs: 1,
    allowPaid: false,
    maxMonetarySpendUsd: 0,
    automaticNetwork: false,
    automaticToolExecution: false,
    requiresHumanTransfer: true,
  }
}

export function validateWorkerManifest(raw: PortableWorkerManifest): PortableWorkerManifest {
  if (!raw || typeof raw !== 'object') throw new Error('WORKER_MANIFEST_INVALID')
  exactKeys(raw, [
    'schemaVersion', 'protocol', 'workerId', 'tenantId', 'transport', 'supportedRuntimeAdapters',
    'maxConcurrentJobs', 'allowPaid', 'maxMonetarySpendUsd', 'automaticNetwork',
    'automaticToolExecution', 'requiresHumanTransfer',
  ], 'WORKER_MANIFEST_EXTRA_FIELD')
  if (raw.schemaVersion !== '0.1' || raw.protocol !== WORKER_PROTOCOL) throw new Error('WORKER_PROTOCOL_UNSUPPORTED')
  const tenantId = validateTenantId(raw.tenantId)
  const workerId = boundedIdentifier(raw.workerId, 100, 'WORKER_ID_INVALID')
  if (raw.transport !== 'offline-file') throw new Error('WORKER_TRANSPORT_UNSUPPORTED')
  if (!Array.isArray(raw.supportedRuntimeAdapters) || raw.supportedRuntimeAdapters.length !== 1 || raw.supportedRuntimeAdapters[0] !== 'local-demo') {
    throw new Error('WORKER_RUNTIME_SET_INVALID')
  }
  if (raw.maxConcurrentJobs !== 1) throw new Error('WORKER_CONCURRENCY_INVALID')
  if (raw.allowPaid !== false || raw.maxMonetarySpendUsd !== 0) throw new Error('WORKER_NONZERO_COST_FORBIDDEN')
  if (raw.automaticNetwork !== false || raw.automaticToolExecution !== false || raw.requiresHumanTransfer !== true) {
    throw new Error('WORKER_AUTOMATION_POLICY_INVALID')
  }
  return { ...raw, tenantId, workerId }
}

function newBundleId(): string {
  return `worker-bundle-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function buildPortableWorkerBundle(
  rawJob: DurableJob,
  rawAgent: AgentSpec,
  tenantIdRaw: string,
  now = new Date().toISOString(),
): PortableWorkerBundle {
  const tenantId = validateTenantId(tenantIdRaw)
  const worker = createReferenceWorkerManifest(tenantId)
  const job = cloneJobForWorker(rawJob)
  const agent = cloneAgentForWorker(rawAgent)
  if (job.tenantId !== tenantId) throw new Error('WORKER_JOB_TENANT_MISMATCH')
  if (job.lease?.workerId !== worker.workerId) throw new Error('WORKER_LEASE_OWNER_MISMATCH')
  if (job.payload.agentId !== agent.id) throw new Error('WORKER_JOB_AGENT_MISMATCH')
  const createdAtMs = parseTime(now, 'WORKER_BUNDLE_TIME_INVALID')
  const acquiredAtMs = parseTime(job.lease.acquiredAt, 'WORKER_LEASE_TIME_INVALID')
  const expiresAtMs = parseTime(job.lease.expiresAt, 'WORKER_LEASE_TIME_INVALID')
  if (createdAtMs < acquiredAtMs || createdAtMs >= expiresAtMs) throw new Error('WORKER_BUNDLE_OUTSIDE_LEASE')
  return validateWorkerBundle({
    schemaVersion: '0.1',
    protocol: WORKER_PROTOCOL,
    bundleId: newBundleId(),
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    tenantId,
    worker,
    job,
    agent,
    monetaryCostUsd: 0,
    requiresHumanTransfer: true,
  })
}

export function validateWorkerBundle(raw: PortableWorkerBundle, now?: string): PortableWorkerBundle {
  if (!raw || typeof raw !== 'object') throw new Error('WORKER_BUNDLE_INVALID')
  exactKeys(raw, [
    'schemaVersion', 'protocol', 'bundleId', 'createdAt', 'expiresAt', 'tenantId', 'worker',
    'job', 'agent', 'monetaryCostUsd', 'requiresHumanTransfer',
  ], 'WORKER_BUNDLE_EXTRA_FIELD')
  if (raw.schemaVersion !== '0.1' || raw.protocol !== WORKER_PROTOCOL) throw new Error('WORKER_BUNDLE_PROTOCOL_UNSUPPORTED')
  const bundleId = boundedIdentifier(raw.bundleId, 140, 'WORKER_BUNDLE_ID_INVALID')
  const tenantId = validateTenantId(raw.tenantId)
  const worker = validateWorkerManifest(raw.worker)
  const job = cloneJobForWorker(raw.job)
  const agent = cloneAgentForWorker(raw.agent)
  if (raw.monetaryCostUsd !== 0 || raw.requiresHumanTransfer !== true) throw new Error('WORKER_BUNDLE_POLICY_INVALID')
  if (worker.tenantId !== tenantId || job.tenantId !== tenantId) throw new Error('WORKER_BUNDLE_TENANT_MISMATCH')
  if (!job.lease || job.lease.workerId !== worker.workerId) throw new Error('WORKER_BUNDLE_LEASE_MISMATCH')
  if (job.payload.agentId !== agent.id) throw new Error('WORKER_BUNDLE_AGENT_MISMATCH')
  const createdAtMs = parseTime(raw.createdAt, 'WORKER_BUNDLE_TIME_INVALID')
  const expiresAtMs = parseTime(raw.expiresAt, 'WORKER_BUNDLE_TIME_INVALID')
  if (raw.expiresAt !== job.lease.expiresAt || expiresAtMs <= createdAtMs) throw new Error('WORKER_BUNDLE_EXPIRY_INVALID')
  if (now !== undefined && parseTime(now, 'WORKER_NOW_INVALID') >= expiresAtMs) throw new Error('WORKER_BUNDLE_EXPIRED')
  const safe: PortableWorkerBundle = {
    schemaVersion: '0.1',
    protocol: WORKER_PROTOCOL,
    bundleId,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    tenantId,
    worker,
    job,
    agent,
    monetaryCostUsd: 0,
    requiresHumanTransfer: true,
  }
  if (JSON.stringify(safe).length > MAX_WORKER_BUNDLE_CHARS) throw new Error('WORKER_BUNDLE_SIZE_LIMIT')
  return safe
}

function cloneRunForReceipt(run: RunRecord): RunRecord {
  if (!run || run.monetaryCostUsd !== 0) throw new Error('WORKER_RUN_NONZERO_COST_FORBIDDEN')
  if (!['success', 'blocked', 'failed'].includes(run.status)) throw new Error('WORKER_RUN_STATUS_INVALID')
  if (run.runtimeAdapter !== 'local-demo') throw new Error('WORKER_RUN_ADAPTER_INVALID')
  if (!Number.isInteger(run.toolCalls) || run.toolCalls !== 0) throw new Error('WORKER_RUN_TOOL_CALL_FORBIDDEN')
  if (!Array.isArray(run.policyChecks) || run.policyChecks.length > MAX_POLICY_CHECKS) throw new Error('WORKER_RUN_POLICY_EVIDENCE_INVALID')
  const output = String(run.output)
  const error = run.error === undefined ? undefined : String(run.error)
  if (output.length > MAX_OUTPUT_CHARS || (error?.length ?? 0) > MAX_ERROR_CHARS) throw new Error('WORKER_RUN_CONTENT_LIMIT')
  const startedAt = new Date(parseTime(run.startedAt, 'WORKER_RUN_TIME_INVALID')).toISOString()
  const finishedAt = new Date(parseTime(run.finishedAt, 'WORKER_RUN_TIME_INVALID')).toISOString()
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new Error('WORKER_RUN_TIME_ORDER_INVALID')
  return {
    id: boundedIdentifier(run.id, 140, 'WORKER_RUN_ID_INVALID'),
    agentId: boundedIdentifier(run.agentId, 120, 'WORKER_RUN_AGENT_ID_INVALID'),
    startedAt,
    finishedAt,
    status: run.status,
    runtimeAdapter: 'local-demo',
    task: String(run.task).slice(0, 5_000),
    output,
    monetaryCostUsd: 0,
    toolCalls: 0,
    policyChecks: run.policyChecks.map((check) => String(check).slice(0, MAX_POLICY_CHECK_CHARS)),
    ...(error ? { error } : {}),
  }
}

export function buildWorkerReceipt(bundleRaw: PortableWorkerBundle, runRaw: RunRecord): PortableWorkerReceipt {
  const bundle = validateWorkerBundle(bundleRaw)
  const run = cloneRunForReceipt(runRaw)
  if (!bundle.job.lease) throw new Error('WORKER_RECEIPT_LEASE_MISSING')
  if (run.agentId !== bundle.agent.id) throw new Error('WORKER_RECEIPT_AGENT_MISMATCH')
  if (run.task !== bundle.job.payload.task) throw new Error('WORKER_RECEIPT_TASK_MISMATCH')
  return validateWorkerReceipt({
    schemaVersion: '0.1',
    protocol: WORKER_PROTOCOL,
    bundleId: bundle.bundleId,
    tenantId: bundle.tenantId,
    workerId: bundle.worker.workerId,
    jobId: bundle.job.id,
    leaseToken: bundle.job.lease.token,
    createdAt: run.finishedAt,
    run,
    monetaryCostUsd: 0,
    automaticNetworkUsed: false,
    automaticToolExecutionUsed: false,
  }, bundle)
}

export function validateWorkerReceipt(raw: PortableWorkerReceipt, expectedBundle?: PortableWorkerBundle): PortableWorkerReceipt {
  if (!raw || typeof raw !== 'object') throw new Error('WORKER_RECEIPT_INVALID')
  exactKeys(raw, [
    'schemaVersion', 'protocol', 'bundleId', 'tenantId', 'workerId', 'jobId', 'leaseToken',
    'createdAt', 'run', 'monetaryCostUsd', 'automaticNetworkUsed', 'automaticToolExecutionUsed',
  ], 'WORKER_RECEIPT_EXTRA_FIELD')
  if (raw.schemaVersion !== '0.1' || raw.protocol !== WORKER_PROTOCOL) throw new Error('WORKER_RECEIPT_PROTOCOL_UNSUPPORTED')
  const bundleId = boundedIdentifier(raw.bundleId, 140, 'WORKER_RECEIPT_BUNDLE_ID_INVALID')
  const tenantId = validateTenantId(raw.tenantId)
  const workerId = boundedIdentifier(raw.workerId, 100, 'WORKER_RECEIPT_WORKER_INVALID')
  const jobId = boundedIdentifier(raw.jobId, 120, 'WORKER_RECEIPT_JOB_INVALID')
  const leaseToken = boundedIdentifier(raw.leaseToken, 160, 'WORKER_RECEIPT_LEASE_TOKEN_INVALID')
  const createdAt = new Date(parseTime(raw.createdAt, 'WORKER_RECEIPT_TIME_INVALID')).toISOString()
  const run = cloneRunForReceipt(raw.run)
  if (raw.monetaryCostUsd !== 0 || raw.automaticNetworkUsed !== false || raw.automaticToolExecutionUsed !== false) {
    throw new Error('WORKER_RECEIPT_POLICY_INVALID')
  }
  const safe: PortableWorkerReceipt = {
    schemaVersion: '0.1',
    protocol: WORKER_PROTOCOL,
    bundleId,
    tenantId,
    workerId,
    jobId,
    leaseToken,
    createdAt,
    run,
    monetaryCostUsd: 0,
    automaticNetworkUsed: false,
    automaticToolExecutionUsed: false,
  }
  if (expectedBundle) {
    const bundle = validateWorkerBundle(expectedBundle)
    if (safe.bundleId !== bundle.bundleId || safe.tenantId !== bundle.tenantId || safe.workerId !== bundle.worker.workerId || safe.jobId !== bundle.job.id) {
      throw new Error('WORKER_RECEIPT_BUNDLE_MISMATCH')
    }
    if (!bundle.job.lease || safe.leaseToken !== bundle.job.lease.token) throw new Error('WORKER_RECEIPT_LEASE_MISMATCH')
    if (safe.run.agentId !== bundle.agent.id || safe.run.task !== bundle.job.payload.task) throw new Error('WORKER_RECEIPT_RUN_MISMATCH')
  }
  if (JSON.stringify(safe).length > MAX_WORKER_RECEIPT_CHARS) throw new Error('WORKER_RECEIPT_SIZE_LIMIT')
  return safe
}

export function exportWorkerBundle(bundle: PortableWorkerBundle): string {
  return JSON.stringify(validateWorkerBundle(bundle), null, 2)
}

export function importWorkerBundle(raw: string, now = new Date().toISOString()): PortableWorkerBundle {
  if (!raw || raw.length > MAX_WORKER_BUNDLE_CHARS) throw new Error('WORKER_BUNDLE_IMPORT_LIMIT')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('WORKER_BUNDLE_JSON_INVALID')
  }
  return validateWorkerBundle(parsed as PortableWorkerBundle, now)
}

export function exportWorkerReceipt(receipt: PortableWorkerReceipt): string {
  return JSON.stringify(validateWorkerReceipt(receipt), null, 2)
}

export function importWorkerReceipt(raw: string): PortableWorkerReceipt {
  if (!raw || raw.length > MAX_WORKER_RECEIPT_CHARS) throw new Error('WORKER_RECEIPT_IMPORT_LIMIT')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('WORKER_RECEIPT_JSON_INVALID')
  }
  return validateWorkerReceipt(parsed as PortableWorkerReceipt)
}
