import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync('src/core/evaluationEngine.ts', 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
  },
  fileName: 'evaluationEngine.ts',
}).outputText
const engine = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`)

const agent = {
  specVersion: '0.1',
  id: 'agent-eval-smoke',
  name: 'Eval Smoke Agent',
  description: 'test',
  instructions: 'test',
  runtime: { adapter: 'local-demo' },
  modelPolicy: { mode: 'local_only', allowPaid: false },
  toolPolicy: { defaultAction: 'deny', allowedTools: [] },
  memoryPolicy: { session: true, longTerm: false, shared: false },
  approvalPolicy: { externalWrite: 'ask', delete: 'ask', financial: 'deny', securityChange: 'ask' },
  budgetPolicy: { maxMonetarySpendUsd: 0, maxRunSeconds: 60, maxToolCalls: 10 },
  evaluationPolicy: { requiredBeforeProduction: true, minimumPassRate: 0.95, securityTestsRequired: true },
}

function run(id, output, startedAt, finishedAt) {
  return {
    id,
    agentId: agent.id,
    startedAt,
    finishedAt,
    status: 'success',
    runtimeAdapter: 'local-demo',
    task: `private-task-${id}`,
    output,
    monetaryCostUsd: 0,
    toolCalls: 0,
    policyChecks: ['zero-cost gate', 'paid models disabled'],
  }
}

const runs = [
  run('run-a', 'QUALITY_OK safe answer', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.100Z'),
  run('run-b', 'second safe answer', '2026-08-28T00:01:00.000Z', '2026-08-28T00:01:00.200Z'),
]

const baseline = engine.buildBaselineEvaluationSuite(agent, runs)
assert.equal(baseline.cases.length, 3)
const incomplete = engine.evaluateSuite(agent, runs, baseline)
assert.equal(incomplete.productionGate, 'fail')
assert.ok(incomplete.gateViolations.includes('quality evidence missing'))

const completeSuite = engine.addQualityCaseFromRun(baseline, runs[0], 'Quality marker', ['QUALITY_OK'], ['FORBIDDEN_MARKER'])
const report = engine.evaluateSuite(agent, runs, completeSuite)
assert.equal(report.productionGate, 'pass')
assert.equal(report.passRate, 1)
assert.equal(report.securityPassRate, 1)
assert.equal(report.qualityPassRate, 1)
assert.equal(report.reliabilityPassRate, 1)
assert.equal(report.monetaryCostUsd, 0)

const costlyRuns = runs.map((item, index) => index === 0 ? { ...item, monetaryCostUsd: 1 } : item)
const costly = engine.evaluateSuite(agent, costlyRuns, completeSuite)
assert.equal(costly.productionGate, 'fail')
assert.ok(costly.gateViolations.some((item) => item.includes('non-zero cost')))

const insecureAgent = { ...agent, modelPolicy: { ...agent.modelPolicy, allowPaid: true } }
const insecure = engine.evaluateSuite(insecureAgent, runs, completeSuite)
assert.equal(insecure.productionGate, 'fail')
assert.ok(insecure.caseResults.some((item) => item.dimension === 'security' && !item.passed))

const metrics = engine.buildAgentRunMetrics(agent.id, runs)
assert.equal(metrics.runCount, 2)
assert.equal(metrics.successRate, 1)
assert.equal(metrics.monetaryCostUsd, 0)
assert.equal(metrics.policyEvidenceCoverage, 1)

const trace = engine.buildRunTrace({ ...runs[0], task: 'ULTRA_PRIVATE_TASK', output: 'ULTRA_PRIVATE_OUTPUT' })
const serializedTrace = JSON.stringify(trace)
assert.ok(!serializedTrace.includes('ULTRA_PRIVATE_TASK'))
assert.ok(!serializedTrace.includes('ULTRA_PRIVATE_OUTPUT'))
assert.equal(trace.outputChars, 'ULTRA_PRIVATE_OUTPUT'.length)
assert.equal(trace.policyCheckCount, 2)

const arena = engine.buildBenchmarkArena([incomplete, report])
assert.equal(arena.length, 1)
assert.equal(arena[0].comparable, true)
assert.equal(arena[0].score, 100)
assert.equal(arena[0].productionGate, 'pass')

console.log('Phase 8 deterministic eval smoke: PASS')
console.log('Production gate requires quality + security + reliability: PASS')
console.log('Security-required cases must pass 100%: PASS')
console.log('Zero-cost gate rejects non-zero evaluated run: PASS')
console.log('Observability trace excludes task/output content: PASS')
console.log('Benchmark ranking requires complete evidence: PASS')
