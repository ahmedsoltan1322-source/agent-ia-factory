import type { AgentSpec, RunRecord, RunStatus } from './types'

export type EvaluationDimension = 'quality' | 'security' | 'reliability'
export type EvaluationCaseSource = { kind: 'agent_policy' } | { kind: 'run'; runId: string }

export interface EvaluationAssertions {
  requireStatus?: RunStatus
  requireZeroCost?: true
  requireNoError?: true
  requirePolicyEvidence?: true
  maxToolCalls?: number
  maxDurationMs?: number
  outputIncludes?: string[]
  outputExcludes?: string[]
  requireSecureAgentPolicy?: true
}

export interface EvaluationCase {
  id: string
  title: string
  dimension: EvaluationDimension
  required: true
  source: EvaluationCaseSource
  assertions: EvaluationAssertions
}

export interface EvaluationSuite {
  schemaVersion: '0.1'
  id: string
  name: string
  agentId: string
  createdAt: string
  cases: EvaluationCase[]
}

export interface EvaluationCaseResult {
  caseId: string
  title: string
  dimension: EvaluationDimension
  passed: boolean
  runId?: string
  durationMs?: number
  checks: string[]
  violations: string[]
}

export type ProductionGateDecision = 'pass' | 'fail'

export interface EvaluationReport {
  schemaVersion: '0.1'
  id: string
  suiteId: string
  suiteName: string
  agentId: string
  createdAt: string
  passedCases: number
  totalCases: number
  passRate: number
  qualityPassRate: number | null
  securityPassRate: number | null
  reliabilityPassRate: number | null
  averageDurationMs: number | null
  p95DurationMs: number | null
  monetaryCostUsd: number
  productionGate: ProductionGateDecision
  gateChecks: string[]
  gateViolations: string[]
  caseResults: EvaluationCaseResult[]
}

export interface AgentRunMetrics {
  agentId: string
  runCount: number
  successRate: number
  blockedRate: number
  failureRate: number
  averageDurationMs: number | null
  p95DurationMs: number | null
  totalToolCalls: number
  monetaryCostUsd: number
  policyEvidenceCoverage: number
}

export interface RunTrace {
  schemaVersion: '0.1'
  runId: string
  agentId: string
  runtimeAdapter: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: RunStatus
  monetaryCostUsd: number
  toolCalls: number
  policyCheckCount: number
  outputChars: number
  hasError: boolean
  events: Array<{
    name: 'run_started' | 'policy_evidence_recorded' | 'runtime_finished'
    at: string
    detail: string
  }>
}

export interface BenchmarkEntry {
  agentId: string
  reportId: string
  comparable: boolean
  score: number | null
  qualityScore: number | null
  securityScore: number | null
  reliabilityScore: number | null
  p95DurationMs: number | null
  productionGate: ProductionGateDecision
  evidence: string[]
  limitations: string[]
}

const MAX_CASES = 24
const MAX_ASSERTION_TERMS = 12
const MAX_TERM_CHARS = 160

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function durationMs(run: RunRecord): number {
  const start = Date.parse(run.startedAt)
  const finish = Date.parse(run.finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return Number.POSITIVE_INFINITY
  return finish - start
}

function percentile95(values: number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!finite.length) return null
  return finite[Math.max(0, Math.ceil(finite.length * 0.95) - 1)]
}

function average(values: number[]): number | null {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) return null
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

function normalizeTerms(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim().slice(0, MAX_TERM_CHARS))
    .filter(Boolean)
    .slice(0, MAX_ASSERTION_TERMS)
}

function dimensionRate(results: EvaluationCaseResult[], dimension: EvaluationDimension): number | null {
  const selected = results.filter((result) => result.dimension === dimension)
  if (!selected.length) return null
  return selected.filter((result) => result.passed).length / selected.length
}

function assertSecurePolicy(agent: AgentSpec, checks: string[], violations: string[]): void {
  const rules: Array<[boolean, string]> = [
    [agent.modelPolicy.allowPaid === false, 'paid models forbidden'],
    [agent.budgetPolicy.maxMonetarySpendUsd === 0, 'agent monetary budget fixed at 0 USD'],
    [agent.toolPolicy.defaultAction === 'deny' || agent.toolPolicy.defaultAction === 'approval', 'tool default is deny/approval gated'],
    [agent.approvalPolicy.financial === 'deny', 'financial actions denied'],
    [agent.approvalPolicy.externalWrite !== 'allow', 'external writes are not auto-allowed'],
    [agent.approvalPolicy.delete !== 'allow', 'delete is not auto-allowed'],
    [agent.approvalPolicy.securityChange !== 'allow', 'security changes are not auto-allowed'],
    [agent.evaluationPolicy.requiredBeforeProduction === true, 'evaluation required before production'],
    [agent.evaluationPolicy.securityTestsRequired === true, 'security tests required'],
  ]
  for (const [passed, label] of rules) {
    if (passed) checks.push(label)
    else violations.push(label)
  }
}

export function validateEvaluationSuite(suite: EvaluationSuite): EvaluationSuite {
  if (suite.schemaVersion !== '0.1') throw new Error('EVAL_SCHEMA_UNSUPPORTED')
  if (!suite.agentId.trim()) throw new Error('EVAL_AGENT_REQUIRED')
  if (suite.cases.length < 1 || suite.cases.length > MAX_CASES) throw new Error('EVAL_CASE_COUNT_INVALID')
  const ids = new Set<string>()
  const cases = suite.cases.map((test) => {
    if (!/^[A-Za-z0-9._:-]{1,100}$/u.test(test.id) || ids.has(test.id)) throw new Error('EVAL_CASE_ID_INVALID')
    ids.add(test.id)
    if (!['quality', 'security', 'reliability'].includes(test.dimension)) throw new Error('EVAL_DIMENSION_INVALID')
    if (test.required !== true) throw new Error('EVAL_REQUIRED_CASE_ONLY')
    if (test.source.kind === 'run' && !test.source.runId.trim()) throw new Error('EVAL_RUN_ID_REQUIRED')
    const assertions: EvaluationAssertions = {
      ...test.assertions,
      outputIncludes: normalizeTerms(test.assertions.outputIncludes),
      outputExcludes: normalizeTerms(test.assertions.outputExcludes),
    }
    if (assertions.maxToolCalls !== undefined) assertions.maxToolCalls = Math.max(0, Math.min(100, Math.floor(assertions.maxToolCalls)))
    if (assertions.maxDurationMs !== undefined) assertions.maxDurationMs = Math.max(1, Math.min(3_600_000, Math.floor(assertions.maxDurationMs)))
    return { ...test, title: test.title.trim().slice(0, 160) || test.id, assertions }
  })
  return { ...suite, name: suite.name.trim().slice(0, 160) || 'Evaluation Suite', cases }
}

export function buildBaselineEvaluationSuite(agent: AgentSpec, runs: RunRecord[]): EvaluationSuite {
  const agentRuns = runs.filter((run) => run.agentId === agent.id).slice(0, 5)
  const cases: EvaluationCase[] = [
    {
      id: 'secure-agent-policy',
      title: 'Agent Policy Security Contract',
      dimension: 'security',
      required: true,
      source: { kind: 'agent_policy' },
      assertions: { requireSecureAgentPolicy: true },
    },
  ]
  for (const run of agentRuns) {
    cases.push({
      id: `reliability-${run.id}`.slice(0, 100),
      title: `Reliable zero-cost run: ${run.id}`,
      dimension: 'reliability',
      required: true,
      source: { kind: 'run', runId: run.id },
      assertions: {
        requireStatus: 'success',
        requireZeroCost: true,
        requireNoError: true,
        requirePolicyEvidence: true,
        maxToolCalls: agent.budgetPolicy.maxToolCalls,
        maxDurationMs: agent.budgetPolicy.maxRunSeconds * 1000,
      },
    })
  }
  return validateEvaluationSuite({
    schemaVersion: '0.1',
    id: id('eval-suite'),
    name: `Baseline — ${agent.name}`,
    agentId: agent.id,
    createdAt: new Date().toISOString(),
    cases,
  })
}

export function addQualityCaseFromRun(
  suite: EvaluationSuite,
  run: RunRecord,
  title: string,
  outputIncludes: string[],
  outputExcludes: string[],
): EvaluationSuite {
  if (run.agentId !== suite.agentId) throw new Error('EVAL_RUN_AGENT_MISMATCH')
  if (suite.cases.length >= MAX_CASES) throw new Error('EVAL_CASE_LIMIT_REACHED')
  const test: EvaluationCase = {
    id: `quality-${run.id}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 100),
    title: title.trim() || `Quality evidence — ${run.id}`,
    dimension: 'quality',
    required: true,
    source: { kind: 'run', runId: run.id },
    assertions: {
      requireStatus: 'success',
      requireZeroCost: true,
      requireNoError: true,
      outputIncludes,
      outputExcludes,
    },
  }
  return validateEvaluationSuite({ ...suite, cases: [...suite.cases, test] })
}

export function evaluateCase(agent: AgentSpec, runs: RunRecord[], test: EvaluationCase): EvaluationCaseResult {
  const checks: string[] = []
  const violations: string[] = []
  let run: RunRecord | undefined
  let elapsed: number | undefined

  if (test.source.kind === 'agent_policy') {
    if (test.assertions.requireSecureAgentPolicy) assertSecurePolicy(agent, checks, violations)
  } else {
    run = runs.find((item) => item.id === test.source.runId)
    if (!run) {
      violations.push('referenced run not found')
    } else if (run.agentId !== agent.id) {
      violations.push('referenced run belongs to another agent')
    } else {
      elapsed = durationMs(run)
      if (test.assertions.requireStatus !== undefined) {
        if (run.status === test.assertions.requireStatus) checks.push(`status=${run.status}`)
        else violations.push(`status expected ${test.assertions.requireStatus}, got ${run.status}`)
      }
      if (test.assertions.requireZeroCost) {
        if (run.monetaryCostUsd === 0) checks.push('run monetary cost = 0 USD')
        else violations.push(`non-zero monetary cost: ${run.monetaryCostUsd}`)
      }
      if (test.assertions.requireNoError) {
        if (!run.error) checks.push('run has no error')
        else violations.push('run contains an error')
      }
      if (test.assertions.requirePolicyEvidence) {
        if (run.policyChecks.length > 0) checks.push(`policy evidence count=${run.policyChecks.length}`)
        else violations.push('run has no policy-check evidence')
      }
      if (test.assertions.maxToolCalls !== undefined) {
        if (run.toolCalls <= test.assertions.maxToolCalls) checks.push(`tool calls ${run.toolCalls}/${test.assertions.maxToolCalls}`)
        else violations.push(`tool calls exceeded: ${run.toolCalls}/${test.assertions.maxToolCalls}`)
      }
      if (test.assertions.maxDurationMs !== undefined) {
        if (elapsed <= test.assertions.maxDurationMs) checks.push(`duration ${elapsed}ms <= ${test.assertions.maxDurationMs}ms`)
        else violations.push(`duration exceeded: ${elapsed}ms > ${test.assertions.maxDurationMs}ms`)
      }
      const haystack = run.output.toLocaleLowerCase()
      for (const term of normalizeTerms(test.assertions.outputIncludes)) {
        if (haystack.includes(term.toLocaleLowerCase())) checks.push(`output includes required term: ${term}`)
        else violations.push(`output missing required term: ${term}`)
      }
      for (const term of normalizeTerms(test.assertions.outputExcludes)) {
        if (!haystack.includes(term.toLocaleLowerCase())) checks.push(`output excludes forbidden term: ${term}`)
        else violations.push(`output contains forbidden term: ${term}`)
      }
    }
  }

  return {
    caseId: test.id,
    title: test.title,
    dimension: test.dimension,
    passed: violations.length === 0,
    runId: run?.id,
    durationMs: elapsed,
    checks,
    violations,
  }
}

export function evaluateSuite(agent: AgentSpec, runs: RunRecord[], rawSuite: EvaluationSuite): EvaluationReport {
  const suite = validateEvaluationSuite(rawSuite)
  if (suite.agentId !== agent.id) throw new Error('EVAL_SUITE_AGENT_MISMATCH')
  const caseResults = suite.cases.map((test) => evaluateCase(agent, runs, test))
  const passedCases = caseResults.filter((result) => result.passed).length
  const passRate = caseResults.length ? passedCases / caseResults.length : 0
  const qualityPassRate = dimensionRate(caseResults, 'quality')
  const securityPassRate = dimensionRate(caseResults, 'security')
  const reliabilityPassRate = dimensionRate(caseResults, 'reliability')
  const referencedRuns = [...new Set(caseResults.map((result) => result.runId).filter((value): value is string => Boolean(value)))]
    .map((runId) => runs.find((run) => run.id === runId))
    .filter((run): run is RunRecord => Boolean(run))
  const durations = referencedRuns.map(durationMs)
  const monetaryCostUsd = referencedRuns.reduce((sum, run) => sum + Number(run.monetaryCostUsd), 0)

  const gateChecks: string[] = []
  const gateViolations: string[] = []
  const gate = (condition: boolean, pass: string, fail: string) => (condition ? gateChecks.push(pass) : gateViolations.push(fail))
  gate(suite.cases.length >= 3, 'minimum evidence count met', 'at least 3 evaluation cases required')
  gate(qualityPassRate !== null, 'quality evidence present', 'quality evidence missing')
  gate(securityPassRate !== null, 'security evidence present', 'security evidence missing')
  gate(reliabilityPassRate !== null, 'reliability evidence present', 'reliability evidence missing')
  gate(passRate >= agent.evaluationPolicy.minimumPassRate, `pass rate ${passRate.toFixed(3)} meets threshold`, `pass rate ${passRate.toFixed(3)} below ${agent.evaluationPolicy.minimumPassRate}`)
  gate(monetaryCostUsd === 0, 'evaluated runs monetary cost = 0 USD', `evaluated runs have non-zero cost: ${monetaryCostUsd}`)
  if (agent.evaluationPolicy.securityTestsRequired) {
    gate(securityPassRate === 1, 'all security cases passed', 'security cases must pass 100%')
  }
  gate(caseResults.every((result) => result.passed), 'all required cases passed', 'one or more required cases failed')

  return {
    schemaVersion: '0.1',
    id: id('eval-report'),
    suiteId: suite.id,
    suiteName: suite.name,
    agentId: agent.id,
    createdAt: new Date().toISOString(),
    passedCases,
    totalCases: caseResults.length,
    passRate: clamp01(passRate),
    qualityPassRate,
    securityPassRate,
    reliabilityPassRate,
    averageDurationMs: average(durations),
    p95DurationMs: percentile95(durations),
    monetaryCostUsd,
    productionGate: gateViolations.length === 0 ? 'pass' : 'fail',
    gateChecks,
    gateViolations,
    caseResults,
  }
}

export function buildAgentRunMetrics(agentId: string, runs: RunRecord[]): AgentRunMetrics {
  const selected = runs.filter((run) => run.agentId === agentId)
  const count = selected.length
  const rate = (status: RunStatus) => count ? selected.filter((run) => run.status === status).length / count : 0
  const durations = selected.map(durationMs)
  return {
    agentId,
    runCount: count,
    successRate: rate('success'),
    blockedRate: rate('blocked'),
    failureRate: rate('failed'),
    averageDurationMs: average(durations),
    p95DurationMs: percentile95(durations),
    totalToolCalls: selected.reduce((sum, run) => sum + run.toolCalls, 0),
    monetaryCostUsd: selected.reduce((sum, run) => sum + Number(run.monetaryCostUsd), 0),
    policyEvidenceCoverage: count ? selected.filter((run) => run.policyChecks.length > 0).length / count : 0,
  }
}

export function buildRunTrace(run: RunRecord): RunTrace {
  const elapsed = durationMs(run)
  return {
    schemaVersion: '0.1',
    runId: run.id,
    agentId: run.agentId,
    runtimeAdapter: run.runtimeAdapter,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: elapsed,
    status: run.status,
    monetaryCostUsd: Number(run.monetaryCostUsd),
    toolCalls: run.toolCalls,
    policyCheckCount: run.policyChecks.length,
    outputChars: run.output.length,
    hasError: Boolean(run.error),
    events: [
      { name: 'run_started', at: run.startedAt, detail: `runtime=${run.runtimeAdapter}` },
      { name: 'policy_evidence_recorded', at: run.finishedAt, detail: `checks=${run.policyChecks.length}; tools=${run.toolCalls}; cost=${run.monetaryCostUsd}` },
      { name: 'runtime_finished', at: run.finishedAt, detail: `status=${run.status}; outputChars=${run.output.length}; hasError=${Boolean(run.error)}` },
    ],
  }
}

export function buildBenchmarkArena(reports: EvaluationReport[]): BenchmarkEntry[] {
  const latest = new Map<string, EvaluationReport>()
  for (const report of [...reports].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))) {
    if (!latest.has(report.agentId)) latest.set(report.agentId, report)
  }
  return [...latest.values()].map((report) => {
    const evidence: string[] = []
    const limitations: string[] = []
    if (report.qualityPassRate !== null) evidence.push('quality evidence')
    else limitations.push('missing quality evidence')
    if (report.securityPassRate !== null) evidence.push('security evidence')
    else limitations.push('missing security evidence')
    if (report.reliabilityPassRate !== null) evidence.push('reliability evidence')
    else limitations.push('missing reliability evidence')
    if (report.monetaryCostUsd === 0) evidence.push('zero monetary cost evidence')
    else limitations.push('non-zero monetary cost')
    const comparable = limitations.length === 0
    const qualityScore = report.qualityPassRate === null ? null : report.qualityPassRate * 100
    const securityScore = report.securityPassRate === null ? null : report.securityPassRate * 100
    const reliabilityScore = report.reliabilityPassRate === null ? null : report.reliabilityPassRate * 100
    const score = comparable
      ? (qualityScore as number) * 0.5 + (securityScore as number) * 0.3 + (reliabilityScore as number) * 0.2
      : null
    return {
      agentId: report.agentId,
      reportId: report.id,
      comparable,
      score,
      qualityScore,
      securityScore,
      reliabilityScore,
      p95DurationMs: report.p95DurationMs,
      productionGate: report.productionGate,
      evidence,
      limitations,
    }
  }).sort((a, b) => {
    if (a.comparable !== b.comparable) return a.comparable ? -1 : 1
    return (b.score ?? -1) - (a.score ?? -1)
  })
}
