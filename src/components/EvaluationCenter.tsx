import { useMemo, useState } from 'react'
import {
  addQualityCaseFromRun,
  buildAgentRunMetrics,
  buildBaselineEvaluationSuite,
  buildBenchmarkArena,
  buildRunTrace,
  evaluateSuite,
  type EvaluationSuite,
} from '../core/evaluationEngine'
import {
  clearEvaluationEvidence,
  deleteEvaluationSuite,
  exportEvaluationEvidence,
  loadEvaluationReports,
  loadEvaluationSuites,
  saveEvaluationReport,
  saveEvaluationSuite,
} from '../core/evaluationStorage'
import type { AgentSpec, RunRecord } from '../core/types'

interface Props {
  agents: AgentSpec[]
  runs: RunRecord[]
  onNotice: (message: string) => void
}

function percent(value: number | null): string {
  return value === null ? 'لا دليل' : `${(value * 100).toFixed(0)}%`
}

function duration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value < 1000 ? `${value.toFixed(0)} ms` : `${(value / 1000).toFixed(2)} s`
}

function downloadJson(name: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function EvaluationCenter({ agents, runs, onNotice }: Props) {
  const [suites, setSuites] = useState<EvaluationSuite[]>(() => loadEvaluationSuites())
  const [reports, setReports] = useState(() => loadEvaluationReports())
  const [selectedAgentId, setSelectedAgentId] = useState(() => agents[0]?.id ?? '')
  const [selectedSuiteId, setSelectedSuiteId] = useState(() => loadEvaluationSuites()[0]?.id ?? '')
  const [qualityRunId, setQualityRunId] = useState('')
  const [qualityTitle, setQualityTitle] = useState('تحقق جودة المخرجات')
  const [mustInclude, setMustInclude] = useState('')
  const [mustExclude, setMustExclude] = useState('')

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  )
  const agentRuns = useMemo(
    () => selectedAgent ? runs.filter((run) => run.agentId === selectedAgent.id) : [],
    [runs, selectedAgent],
  )
  const selectedSuite = useMemo(
    () => suites.find((suite) => suite.id === selectedSuiteId) ?? suites.find((suite) => suite.agentId === selectedAgent?.id) ?? null,
    [suites, selectedSuiteId, selectedAgent],
  )
  const latestReport = useMemo(
    () => selectedAgent ? reports.find((report) => report.agentId === selectedAgent.id) ?? null : null,
    [reports, selectedAgent],
  )
  const metrics = useMemo(
    () => selectedAgent ? buildAgentRunMetrics(selectedAgent.id, runs) : null,
    [selectedAgent, runs],
  )
  const arena = useMemo(() => buildBenchmarkArena(reports), [reports])
  const traces = useMemo(() => agentRuns.slice(0, 5).map(buildRunTrace), [agentRuns])

  function buildBaseline() {
    if (!selectedAgent) return
    try {
      const suite = buildBaselineEvaluationSuite(selectedAgent, runs)
      setSuites(saveEvaluationSuite(suite))
      setSelectedSuiteId(suite.id)
      setQualityRunId(agentRuns[0]?.id ?? '')
      onNotice(`تم إنشاء Eval Suite (حزمة تقييم) محلية بـ${suite.cases.length} حالات. بوابة الإنتاج لن تمر دون Quality + Security + Reliability.`)
    } catch (error) {
      onNotice(`تعذر إنشاء التقييم: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function addQuality() {
    if (!selectedSuite || !selectedAgent) return
    const run = agentRuns.find((item) => item.id === qualityRunId)
    if (!run) {
      onNotice('اختر Run (تشغيلاً) مسجلاً لإضافة دليل جودة.')
      return
    }
    try {
      const next = addQualityCaseFromRun(
        selectedSuite,
        run,
        qualityTitle,
        mustInclude.split('\n').map((value) => value.trim()).filter(Boolean),
        mustExclude.split('\n').map((value) => value.trim()).filter(Boolean),
      )
      setSuites(saveEvaluationSuite(next))
      setSelectedSuiteId(next.id)
      onNotice('تمت إضافة Quality Case (حالة جودة) مرتبطة بتشغيل حقيقي. لا توجد درجة LLM ذاتية أو ادعاء بلا دليل.')
    } catch (error) {
      onNotice(`تعذر إضافة حالة الجودة: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function runEvaluation() {
    if (!selectedAgent || !selectedSuite) return
    try {
      const report = evaluateSuite(selectedAgent, runs, selectedSuite)
      setReports(saveEvaluationReport(report))
      onNotice(report.productionGate === 'pass'
        ? `Production Gate (بوابة الإنتاج) اجتازت: ${(report.passRate * 100).toFixed(0)}% مع Security كاملة و0$.`
        : `Production Gate مرفوضة: ${report.gateViolations.join(' | ')}`)
    } catch (error) {
      onNotice(`Evaluation (التقييم) فشل مغلقاً: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function removeSuite() {
    if (!selectedSuite) return
    const next = deleteEvaluationSuite(selectedSuite.id)
    setSuites(next)
    setSelectedSuiteId(next[0]?.id ?? '')
    onNotice('تم حذف Eval Suite المحلية. تقارير التقييم السابقة تبقى كدليل مستقل حتى تمسح Evidence صراحة.')
  }

  function clearEvidence() {
    clearEvaluationEvidence()
    setSuites([])
    setReports([])
    setSelectedSuiteId('')
    onNotice('تم مسح Evaluation Evidence (أدلة التقييم) المحلية.')
  }

  return (
    <section className="card eval-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 8 — Evals & Observability (التقييم والمراقبة)</p>
          <h2>Production Gate + Benchmark Arena</h2>
        </div>
        <span className="safe-pill">Evidence, not vibes</span>
      </div>

      <p className="disclaimer">
        لا نمنح الوكيل درجة اعتماد لأنه "يبدو جيداً". Eval (التقييم) يعتمد على Runs (تشغيلات) حقيقية وسياسات قابلة للفحص. Traces (التتبعات) تحفظ Metadata فقط: لا Task، لا Output، ولا Chain-of-Thought (سلسلة التفكير).
      </p>

      <label>
        Agent (الوكيل)
        <select value={selectedAgent?.id ?? ''} onChange={(event) => {
          setSelectedAgentId(event.target.value)
          const first = suites.find((suite) => suite.agentId === event.target.value)
          setSelectedSuiteId(first?.id ?? '')
          setQualityRunId(runs.find((run) => run.agentId === event.target.value)?.id ?? '')
        }}>
          {agents.length === 0 && <option value="">لا يوجد وكلاء</option>}
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
      </label>

      {metrics && (
        <div className="eval-metrics">
          <div><span>Runs (التشغيلات)</span><strong>{metrics.runCount}</strong></div>
          <div><span>Success (النجاح)</span><strong>{percent(metrics.successRate)}</strong></div>
          <div><span>Blocked (المحجوب)</span><strong>{percent(metrics.blockedRate)}</strong></div>
          <div><span>Failure (الفشل)</span><strong>{percent(metrics.failureRate)}</strong></div>
          <div><span>P95 Latency</span><strong>{duration(metrics.p95DurationMs)}</strong></div>
          <div><span>Policy Evidence</span><strong>{percent(metrics.policyEvidenceCoverage)}</strong></div>
          <div><span>Tool Calls</span><strong>{metrics.totalToolCalls}</strong></div>
          <div><span>Monetary Cost</span><strong>${metrics.monetaryCostUsd.toFixed(2)}</strong></div>
        </div>
      )}

      <div className="eval-actions">
        <button className="primary-button" type="button" disabled={!selectedAgent} onClick={buildBaseline}>＋ Build Baseline Eval (إنشاء تقييم أساسي)</button>
        {selectedSuite && <button className="text-button" type="button" onClick={removeSuite}>حذف الحزمة</button>}
      </div>

      {selectedSuite && (
        <div className="eval-suite">
          <div className="card-heading">
            <div><h3>{selectedSuite.name}</h3><small>{selectedSuite.cases.length} Cases (حالات)</small></div>
            <select value={selectedSuite.id} onChange={(event) => setSelectedSuiteId(event.target.value)}>
              {suites.filter((suite) => suite.agentId === selectedAgent?.id).map((suite) => <option key={suite.id} value={suite.id}>{suite.name}</option>)}
            </select>
          </div>

          <div className="eval-case-list">
            {selectedSuite.cases.map((test) => (
              <article key={test.id} className="eval-case">
                <span className={`eval-dimension eval-${test.dimension}`}>{test.dimension}</span>
                <strong>{test.title}</strong>
                <small>{test.source.kind === 'run' ? `Run: ${test.source.runId}` : 'Agent Policy Contract'}</small>
              </article>
            ))}
          </div>

          <div className="eval-quality-builder">
            <h4>Quality Evidence (دليل الجودة)</h4>
            <p className="disclaimer">أضف شروطاً يمكن التحقق منها على Output مسجل. اكتب كل عبارة في سطر. ترك القائمتين فارغتين لا يعطي دليلاً مفيداً للجودة.</p>
            <label>Run (التشغيل)
              <select value={qualityRunId} onChange={(event) => setQualityRunId(event.target.value)}>
                <option value="">اختر تشغيلاً</option>
                {agentRuns.map((run) => <option key={run.id} value={run.id}>{run.status} · {run.task.slice(0, 70)}</option>)}
              </select>
            </label>
            <label>عنوان الاختبار<input value={qualityTitle} maxLength={160} onChange={(event) => setQualityTitle(event.target.value)} /></label>
            <label>Must Include (يجب أن يحتوي)<textarea rows={3} value={mustInclude} onChange={(event) => setMustInclude(event.target.value)} /></label>
            <label>Must Not Include (يجب ألا يحتوي)<textarea rows={3} value={mustExclude} onChange={(event) => setMustExclude(event.target.value)} /></label>
            <button className="primary-button" type="button" disabled={!qualityRunId || (!mustInclude.trim() && !mustExclude.trim())} onClick={addQuality}>＋ Add Quality Case</button>
          </div>

          <button className="run-button" type="button" onClick={runEvaluation}>▶ Run Evaluation (تشغيل التقييم)</button>
        </div>
      )}

      {latestReport && (
        <div className={`eval-report gate-${latestReport.productionGate}`}>
          <div className="card-heading">
            <div>
              <p className="section-kicker">Production Gate (بوابة الإنتاج)</p>
              <h3>{latestReport.productionGate === 'pass' ? 'PASS — مجتاز' : 'FAIL — مرفوض'}</h3>
            </div>
            <strong>{(latestReport.passRate * 100).toFixed(0)}%</strong>
          </div>
          <div className="eval-metrics">
            <div><span>Quality</span><strong>{percent(latestReport.qualityPassRate)}</strong></div>
            <div><span>Security</span><strong>{percent(latestReport.securityPassRate)}</strong></div>
            <div><span>Reliability</span><strong>{percent(latestReport.reliabilityPassRate)}</strong></div>
            <div><span>P95</span><strong>{duration(latestReport.p95DurationMs)}</strong></div>
            <div><span>Cost</span><strong>${latestReport.monetaryCostUsd.toFixed(2)}</strong></div>
          </div>
          {latestReport.gateViolations.length > 0 && <ul>{latestReport.gateViolations.map((item) => <li key={item}>{item}</li>)}</ul>}
          <details><summary>Case Results (نتائج الحالات)</summary>
            {latestReport.caseResults.map((result) => <div className="eval-result" key={result.caseId}><strong>{result.passed ? '✓' : '✗'} {result.title}</strong><small>{result.violations.join(' · ') || result.checks.join(' · ')}</small></div>)}
          </details>
        </div>
      )}

      <div className="eval-arena">
        <div className="card-heading"><div><p className="section-kicker">Benchmark Arena (ساحة الاختبارات)</p><h3>مقارنة قائمة على الأدلة</h3></div><span className="count-pill">{arena.length}</span></div>
        {arena.length === 0 ? <p className="empty-state">لا توجد تقارير بعد.</p> : arena.map((entry, index) => {
          const agent = agents.find((item) => item.id === entry.agentId)
          return <article className="arena-row" key={entry.reportId}>
            <strong>{entry.comparable ? `#${index + 1}` : '—'} {agent?.name ?? entry.agentId}</strong>
            <span>{entry.comparable ? `Score ${entry.score?.toFixed(1)}` : 'غير قابل للمقارنة بعد'}</span>
            <small>Q {entry.qualityScore?.toFixed(0) ?? '—'} · S {entry.securityScore?.toFixed(0) ?? '—'} · R {entry.reliabilityScore?.toFixed(0) ?? '—'} · Gate {entry.productionGate}</small>
            {entry.limitations.length > 0 && <small>{entry.limitations.join(' · ')}</small>}
          </article>
        })}
      </div>

      {traces.length > 0 && <details className="eval-traces"><summary>Observability Traces (تتبعات المراقبة) — Metadata only</summary>
        {traces.map((trace) => <article key={trace.runId} className="trace-row"><strong>{trace.status} · {duration(trace.durationMs)}</strong><small>{trace.runtimeAdapter} · policy checks {trace.policyCheckCount} · tools {trace.toolCalls} · output chars {trace.outputChars} · cost ${trace.monetaryCostUsd.toFixed(2)}</small></article>)}
      </details>}

      <div className="eval-actions">
        <button className="text-button" type="button" disabled={!reports.length && !suites.length} onClick={() => downloadJson('agent-ia-factory-evaluation-evidence.json', exportEvaluationEvidence())}>Export Evidence (تصدير الأدلة)</button>
        <button className="danger-button" type="button" disabled={!reports.length && !suites.length} onClick={clearEvidence}>مسح الأدلة</button>
      </div>
    </section>
  )
}
