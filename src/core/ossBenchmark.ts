import type { OssCandidate, OssDecision } from './ossHarvester'

export const OSS_BENCHMARK_SCHEMA_VERSION = '0.1' as const
export const OSS_STATIC_SCAN_SCHEMA_VERSION = '2' as const
export const MAX_OSS_BENCHMARKS = 40

const BENCHMARK_KEY = 'agent-ia-factory.oss-benchmarks.v1'
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u
const PREFERRED_LICENSES = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause'])
const REVIEW_LICENSES = new Set(['ISC', 'MPL-2.0', 'LGPL-2.1', 'LGPL-3.0', 'GPL-2.0', 'GPL-3.0'])
const RESTRICTIVE_LICENSES = new Set(['AGPL-3.0', 'SSPL-1.0', 'BUSL-1.1'])

export interface OssStaticScanReportV2 {
  schemaVersion: typeof OSS_STATIC_SCAN_SCHEMA_VERSION
  repository: string
  scanMode: 'static-no-candidate-code-execution'
  filesScanned: number
  boundedBytesRead: number
  symlinksSkipped: number
  executableFilesObserved: number
  sourceFilesObserved: number
  testFilesObserved: number
  ciConfigsObserved: number
  readmeObserved: boolean
  licenseFiles: string[]
  manifests: string[]
  secretSignals: Array<{ file: string; type: string }>
  packageSummary: Record<string, unknown>
  integrationAllowed: false
  deepScanDecision: 'manual-review-required'
}

export interface OssNpmAuditSummary {
  available: boolean
  parseError?: boolean
  reason?: string
  vulnerabilities?: {
    info?: number
    low?: number
    moderate?: number
    high?: number
    critical?: number
    total?: number
  }
}

export interface OssBenchmarkScore {
  isolationEvidence: number
  staticCoverage: number
  securitySignals: number
  supplyChain: number
  projectHealth: number
  total: number
}

export interface OssBenchmarkResult {
  schemaVersion: typeof OSS_BENCHMARK_SCHEMA_VERSION
  id: string
  repository: string
  candidateId: number
  createdAt: string
  mode: 'static-sandbox-readiness'
  executionSandboxPerformed: false
  candidateCodeExecuted: false
  integrationAllowed: false
  monetaryCostUsd: 0
  score: OssBenchmarkScore
  decision: OssDecision
  hardBlocks: string[]
  limitations: string[]
  evidence: string[]
  staticReport: {
    filesScanned: number
    boundedBytesRead: number
    sourceFilesObserved: number
    testFilesObserved: number
    ciConfigsObserved: number
    symlinksSkipped: number
    executableFilesObserved: number
    secretSignalCount: number
    manifestCount: number
    licenseFileCount: number
    readmeObserved: boolean
  }
  npmAudit: {
    available: boolean
    parseError: boolean
    high: number | null
    critical: number | null
    total: number | null
  }
}

function now(): string { return new Date().toISOString() }
function newId(): string { return `oss-bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)) }
function finiteInt(value: unknown, min: number, max: number, code: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) throw new Error(code)
  return value
}
function safeArray(value: unknown, maxItems: number, maxChars: number, code: string): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(code)
  return value.map((item) => {
    if (typeof item !== 'string' || item.length > maxChars || /[\u0000-\u001f]/u.test(item)) throw new Error(code)
    return item
  })
}
function exactKeys(value: object, expected: string[], code: string): void {
  const keys = Object.keys(value).sort()
  const target = [...expected].sort()
  if (keys.length !== target.length || keys.some((key, index) => key !== target[index])) throw new Error(code)
}

export function parseOssStaticScanReport(rawText: string): OssStaticScanReportV2 {
  if (rawText.length > 1_000_000) throw new Error('OSS_BENCHMARK_REPORT_TOO_LARGE')
  let raw: unknown
  try { raw = JSON.parse(rawText) } catch { throw new Error('OSS_BENCHMARK_REPORT_JSON_INVALID') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('OSS_BENCHMARK_REPORT_INVALID')
  const record = raw as Record<string, unknown>
  exactKeys(record, [
    'schemaVersion', 'repository', 'scanMode', 'filesScanned', 'boundedBytesRead', 'symlinksSkipped',
    'executableFilesObserved', 'sourceFilesObserved', 'testFilesObserved', 'ciConfigsObserved', 'readmeObserved',
    'licenseFiles', 'manifests', 'secretSignals', 'packageSummary', 'integrationAllowed', 'deepScanDecision',
  ], 'OSS_BENCHMARK_REPORT_EXTRA_FIELD')
  if (record.schemaVersion !== OSS_STATIC_SCAN_SCHEMA_VERSION) throw new Error('OSS_BENCHMARK_REPORT_SCHEMA_UNSUPPORTED')
  if (typeof record.repository !== 'string' || !SAFE_REPOSITORY.test(record.repository)) throw new Error('OSS_BENCHMARK_REPOSITORY_INVALID')
  if (record.scanMode !== 'static-no-candidate-code-execution') throw new Error('OSS_BENCHMARK_SCAN_MODE_INVALID')
  if (record.integrationAllowed !== false || record.deepScanDecision !== 'manual-review-required') throw new Error('OSS_BENCHMARK_SCAN_POLICY_INVALID')
  if (typeof record.readmeObserved !== 'boolean') throw new Error('OSS_BENCHMARK_README_INVALID')
  if (!record.packageSummary || typeof record.packageSummary !== 'object' || Array.isArray(record.packageSummary)) throw new Error('OSS_BENCHMARK_PACKAGE_SUMMARY_INVALID')

  const secretSignalsRaw = record.secretSignals
  if (!Array.isArray(secretSignalsRaw) || secretSignalsRaw.length > 100) throw new Error('OSS_BENCHMARK_SECRET_SIGNALS_INVALID')
  const secretSignals = secretSignalsRaw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('OSS_BENCHMARK_SECRET_SIGNALS_INVALID')
    const signal = item as Record<string, unknown>
    exactKeys(signal, ['file', 'type'], 'OSS_BENCHMARK_SECRET_SIGNAL_EXTRA_FIELD')
    if (typeof signal.file !== 'string' || !signal.file || signal.file.length > 500 || typeof signal.type !== 'string' || !signal.type || signal.type.length > 80) {
      throw new Error('OSS_BENCHMARK_SECRET_SIGNALS_INVALID')
    }
    return { file: signal.file, type: signal.type }
  })

  return {
    schemaVersion: OSS_STATIC_SCAN_SCHEMA_VERSION,
    repository: record.repository,
    scanMode: 'static-no-candidate-code-execution',
    filesScanned: finiteInt(record.filesScanned, 0, 6000, 'OSS_BENCHMARK_FILES_INVALID'),
    boundedBytesRead: finiteInt(record.boundedBytesRead, 0, 6_000_000_000, 'OSS_BENCHMARK_BYTES_INVALID'),
    symlinksSkipped: finiteInt(record.symlinksSkipped, 0, 6000, 'OSS_BENCHMARK_SYMLINKS_INVALID'),
    executableFilesObserved: finiteInt(record.executableFilesObserved, 0, 6000, 'OSS_BENCHMARK_EXECUTABLES_INVALID'),
    sourceFilesObserved: finiteInt(record.sourceFilesObserved, 0, 6000, 'OSS_BENCHMARK_SOURCE_FILES_INVALID'),
    testFilesObserved: finiteInt(record.testFilesObserved, 0, 6000, 'OSS_BENCHMARK_TEST_FILES_INVALID'),
    ciConfigsObserved: finiteInt(record.ciConfigsObserved, 0, 200, 'OSS_BENCHMARK_CI_INVALID'),
    readmeObserved: record.readmeObserved,
    licenseFiles: safeArray(record.licenseFiles, 50, 500, 'OSS_BENCHMARK_LICENSE_FILES_INVALID'),
    manifests: safeArray(record.manifests, 100, 500, 'OSS_BENCHMARK_MANIFESTS_INVALID'),
    secretSignals,
    packageSummary: record.packageSummary as Record<string, unknown>,
    integrationAllowed: false,
    deepScanDecision: 'manual-review-required',
  }
}

export function parseOssNpmAuditSummary(rawText: string): OssNpmAuditSummary {
  if (rawText.length > 200_000) throw new Error('OSS_BENCHMARK_AUDIT_TOO_LARGE')
  let raw: unknown
  try { raw = JSON.parse(rawText) } catch { throw new Error('OSS_BENCHMARK_AUDIT_JSON_INVALID') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('OSS_BENCHMARK_AUDIT_INVALID')
  const record = raw as Record<string, unknown>
  const allowed = new Set(['available', 'parseError', 'reason', 'vulnerabilities'])
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error('OSS_BENCHMARK_AUDIT_EXTRA_FIELD')
  if (typeof record.available !== 'boolean') throw new Error('OSS_BENCHMARK_AUDIT_AVAILABLE_INVALID')
  if (record.parseError !== undefined && typeof record.parseError !== 'boolean') throw new Error('OSS_BENCHMARK_AUDIT_PARSE_ERROR_INVALID')
  if (record.reason !== undefined && (typeof record.reason !== 'string' || record.reason.length > 160)) throw new Error('OSS_BENCHMARK_AUDIT_REASON_INVALID')
  let vulnerabilities: OssNpmAuditSummary['vulnerabilities']
  if (record.vulnerabilities !== undefined) {
    if (!record.vulnerabilities || typeof record.vulnerabilities !== 'object' || Array.isArray(record.vulnerabilities)) throw new Error('OSS_BENCHMARK_AUDIT_VULNS_INVALID')
    const v = record.vulnerabilities as Record<string, unknown>
    const vulnerabilityKeys = ['info', 'low', 'moderate', 'high', 'critical', 'total']
    if (Object.keys(v).some((key) => !vulnerabilityKeys.includes(key))) throw new Error('OSS_BENCHMARK_AUDIT_VULNS_EXTRA_FIELD')
    vulnerabilities = {}
    for (const key of vulnerabilityKeys) {
      if (v[key] !== undefined) vulnerabilities[key as keyof NonNullable<OssNpmAuditSummary['vulnerabilities']>] = finiteInt(v[key], 0, 1_000_000, 'OSS_BENCHMARK_AUDIT_VULNS_INVALID')
    }
  }
  return { available: record.available, parseError: record.parseError as boolean | undefined, reason: record.reason as string | undefined, vulnerabilities }
}

function readBenchmarks(): OssBenchmarkResult[] {
  try {
    const raw = localStorage.getItem(BENCHMARK_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is OssBenchmarkResult => Boolean(item && typeof item === 'object' && item.schemaVersion === OSS_BENCHMARK_SCHEMA_VERSION && item.integrationAllowed === false && item.executionSandboxPerformed === false)).slice(0, MAX_OSS_BENCHMARKS)
  } catch { return [] }
}

function writeBenchmarks(items: OssBenchmarkResult[]): void {
  localStorage.setItem(BENCHMARK_KEY, JSON.stringify(items.slice(0, MAX_OSS_BENCHMARKS)))
}

function auditNumbers(summary: OssNpmAuditSummary): { high: number | null; critical: number | null; total: number | null } {
  if (!summary.available || summary.parseError) return { high: null, critical: null, total: null }
  return {
    high: summary.vulnerabilities?.high ?? 0,
    critical: summary.vulnerabilities?.critical ?? 0,
    total: summary.vulnerabilities?.total ?? null,
  }
}

export function benchmarkOssCandidate(
  candidate: OssCandidate,
  report: OssStaticScanReportV2,
  npmAudit: OssNpmAuditSummary,
): OssBenchmarkResult {
  if (report.repository !== candidate.fullName) throw new Error('OSS_BENCHMARK_CANDIDATE_REPORT_MISMATCH')
  const hardBlocks: string[] = []
  const limitations: string[] = ['Candidate code was not executed; this is a static sandbox-readiness benchmark, not an execution sandbox.']
  const evidence: string[] = []
  const audit = auditNumbers(npmAudit)

  let isolationEvidence = 20
  evidence.push('scan mode: static-no-candidate-code-execution')
  evidence.push('integrationAllowed=false preserved by scan artifact')
  evidence.push(`symlinks skipped: ${report.symlinksSkipped}`)

  let staticCoverage = 0
  if (report.filesScanned > 0) staticCoverage += 4
  if (report.sourceFilesObserved >= 5) staticCoverage += 4
  else limitations.push('Very little source-file evidence was observed.')
  if (report.manifests.length > 0) staticCoverage += 3
  else limitations.push('No dependency/build manifest observed.')
  if (report.licenseFiles.length > 0) staticCoverage += 3
  else limitations.push('No license/notice file observed in static scan.')
  if (report.readmeObserved) staticCoverage += 2
  if (report.testFilesObserved > 0) staticCoverage += 2
  else limitations.push('No test files observed; tests were not executed.')
  if (report.ciConfigsObserved > 0) staticCoverage += 2
  else limitations.push('No CI configuration observed.')
  staticCoverage = clamp(staticCoverage, 0, 20)

  let securitySignals = 0
  if (report.secretSignals.length === 0) securitySignals += 15
  else hardBlocks.push(`Heuristic secret signals observed: ${report.secretSignals.length}`)
  if (!npmAudit.available) {
    limitations.push(`NPM audit unavailable: ${npmAudit.reason ?? 'not applicable'}.`)
    securitySignals += 4
  } else if (npmAudit.parseError) {
    limitations.push('NPM audit output could not be parsed.')
  } else if ((audit.high ?? 0) === 0 && (audit.critical ?? 0) === 0) {
    securitySignals += 15
  } else {
    if ((audit.critical ?? 0) > 0) hardBlocks.push(`Critical npm vulnerabilities: ${audit.critical}`)
    if ((audit.high ?? 0) > 0) hardBlocks.push(`High npm vulnerabilities: ${audit.high}`)
  }
  securitySignals = clamp(securitySignals, 0, 30)

  let supplyChain = 0
  if (PREFERRED_LICENSES.has(candidate.licenseSpdx)) supplyChain += 15
  else if (REVIEW_LICENSES.has(candidate.licenseSpdx)) {
    supplyChain += 8
    limitations.push(`License ${candidate.licenseSpdx} requires manual legal/license review.`)
  } else if (RESTRICTIVE_LICENSES.has(candidate.licenseSpdx)) {
    supplyChain += 2
    limitations.push(`License ${candidate.licenseSpdx} is study-only in the factory baseline.`)
  } else {
    hardBlocks.push(`License ${candidate.licenseSpdx || 'unknown'} is not accepted by the baseline.`)
  }
  if (report.manifests.length > 0) supplyChain += 5
  supplyChain = clamp(supplyChain, 0, 20)

  let projectHealth = 0
  projectHealth += clamp(Math.round((candidate.scores.maintenance / 25) * 4), 0, 4)
  projectHealth += clamp(Math.round((candidate.scores.repositoryHealth / 10) * 3), 0, 3)
  projectHealth += clamp(Math.round((candidate.scores.adoption / 15) * 2), 0, 2)
  if (report.testFilesObserved > 0 && report.ciConfigsObserved > 0) projectHealth += 1
  projectHealth = clamp(projectHealth, 0, 10)

  if (candidate.archived) hardBlocks.push('Repository is archived.')
  if (candidate.disabled) hardBlocks.push('Repository is disabled.')
  if (report.filesScanned === 0) hardBlocks.push('Static scan observed zero files.')

  const total = clamp(isolationEvidence + staticCoverage + securitySignals + supplyChain + projectHealth, 0, 100)
  let decision: OssDecision
  if (hardBlocks.length > 0) decision = 'REJECT'
  else if (RESTRICTIVE_LICENSES.has(candidate.licenseSpdx) || REVIEW_LICENSES.has(candidate.licenseSpdx)) decision = 'STUDY'
  else if (!npmAudit.available || npmAudit.parseError || staticCoverage < 12) decision = 'WATCH'
  else if (total >= 80) decision = 'ADAPT'
  else if (total >= 65) decision = 'WATCH'
  else decision = 'STUDY'

  // USE is intentionally unreachable in this static-only phase. It requires a stronger execution sandbox and manual integration review.
  limitations.push('USE remains blocked until a stronger execution-sandbox benchmark and manual integration review exist.')
  evidence.push(`files scanned: ${report.filesScanned}/6000`)
  evidence.push(`source/test/ci observations: ${report.sourceFilesObserved}/${report.testFilesObserved}/${report.ciConfigsObserved}`)
  evidence.push(`license files/manifests: ${report.licenseFiles.length}/${report.manifests.length}`)
  evidence.push(`secret signals: ${report.secretSignals.length}`)
  evidence.push(`npm high/critical: ${audit.high ?? 'unknown'}/${audit.critical ?? 'unknown'}`)
  evidence.push(`mandatory monetary spend: 0 USD`)

  return {
    schemaVersion: OSS_BENCHMARK_SCHEMA_VERSION,
    id: newId(),
    repository: candidate.fullName,
    candidateId: candidate.id,
    createdAt: now(),
    mode: 'static-sandbox-readiness',
    executionSandboxPerformed: false,
    candidateCodeExecuted: false,
    integrationAllowed: false,
    monetaryCostUsd: 0,
    score: { isolationEvidence, staticCoverage, securitySignals, supplyChain, projectHealth, total },
    decision,
    hardBlocks,
    limitations,
    evidence,
    staticReport: {
      filesScanned: report.filesScanned,
      boundedBytesRead: report.boundedBytesRead,
      sourceFilesObserved: report.sourceFilesObserved,
      testFilesObserved: report.testFilesObserved,
      ciConfigsObserved: report.ciConfigsObserved,
      symlinksSkipped: report.symlinksSkipped,
      executableFilesObserved: report.executableFilesObserved,
      secretSignalCount: report.secretSignals.length,
      manifestCount: report.manifests.length,
      licenseFileCount: report.licenseFiles.length,
      readmeObserved: report.readmeObserved,
    },
    npmAudit: { available: npmAudit.available, parseError: npmAudit.parseError === true, high: audit.high, critical: audit.critical, total: audit.total },
  }
}

export function saveOssBenchmark(result: OssBenchmarkResult, approvedByHuman: boolean): OssBenchmarkResult[] {
  if (!approvedByHuman) throw new Error('OSS_BENCHMARK_SAVE_APPROVAL_REQUIRED')
  if (result.integrationAllowed !== false || result.candidateCodeExecuted !== false || result.executionSandboxPerformed !== false || result.monetaryCostUsd !== 0) {
    throw new Error('OSS_BENCHMARK_RESULT_POLICY_INVALID')
  }
  const next = [result, ...readBenchmarks().filter((item) => item.repository !== result.repository)].slice(0, MAX_OSS_BENCHMARKS)
  writeBenchmarks(next)
  return next
}

export function loadOssBenchmarks(): OssBenchmarkResult[] { return readBenchmarks() }

export function deleteOssBenchmark(repository: string, approvedByHuman: boolean): OssBenchmarkResult[] {
  if (!approvedByHuman) throw new Error('OSS_BENCHMARK_DELETE_APPROVAL_REQUIRED')
  if (!SAFE_REPOSITORY.test(repository)) throw new Error('OSS_BENCHMARK_REPOSITORY_INVALID')
  const next = readBenchmarks().filter((item) => item.repository !== repository)
  writeBenchmarks(next)
  return next
}
