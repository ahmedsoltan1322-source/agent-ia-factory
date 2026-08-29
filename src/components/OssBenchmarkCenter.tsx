import { useMemo, useState } from 'react'
import {
  benchmarkOssCandidate,
  deleteOssBenchmark,
  loadOssBenchmarks,
  parseOssNpmAuditSummary,
  parseOssStaticScanReport,
  saveOssBenchmark,
  type OssBenchmarkResult,
  type OssNpmAuditSummary,
  type OssStaticScanReportV2,
} from '../core/ossBenchmark'
import type { OssCandidate, OssDecision } from '../core/ossHarvester'

interface Props {
  candidates: OssCandidate[]
  onNotice: (message: string) => void
}

const decisionLabels: Record<OssDecision, string> = {
  USE: 'USE',
  ADAPT: 'ADAPT',
  STUDY: 'STUDY',
  WATCH: 'WATCH',
  REJECT: 'REJECT',
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    OSS_BENCHMARK_REPORT_SCHEMA_UNSUPPORTED: 'Static Scan Report ليست من Artifact v2 الخاصة بـPhase 6B.',
    OSS_BENCHMARK_CANDIDATE_REPORT_MISMATCH: 'التقرير لا يخص Candidate (المرشح) المحددة.',
    OSS_BENCHMARK_REPORT_JSON_INVALID: 'ملف Static Scan ليس JSON صالحاً.',
    OSS_BENCHMARK_AUDIT_JSON_INVALID: 'ملف npm audit ليس JSON صالحاً.',
    OSS_BENCHMARK_SAVE_APPROVAL_REQUIRED: 'يلزم Human Approval (موافقة بشرية) قبل حفظ نتيجة Benchmark.',
    OSS_BENCHMARK_DELETE_APPROVAL_REQUIRED: 'يلزم Human Approval قبل حذف نتيجة Benchmark.',
  }
  return labels[message] ?? `OSS Benchmark (اختبار المصادر المفتوحة): ${message}`
}

export default function OssBenchmarkCenter({ candidates, onNotice }: Props) {
  const [selectedRepository, setSelectedRepository] = useState(candidates[0]?.fullName ?? '')
  const [staticReport, setStaticReport] = useState<OssStaticScanReportV2 | null>(null)
  const [npmAudit, setNpmAudit] = useState<OssNpmAuditSummary | null>(null)
  const [result, setResult] = useState<OssBenchmarkResult | null>(null)
  const [saveApproved, setSaveApproved] = useState(false)
  const [deleteApproved, setDeleteApproved] = useState(false)
  const [revision, setRevision] = useState(0)

  const saved = useMemo(() => {
    void revision
    return loadOssBenchmarks()
  }, [revision])
  const candidate = candidates.find((item) => item.fullName === selectedRepository) ?? null

  async function importStatic(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      const parsed = parseOssStaticScanReport(await file.text())
      setStaticReport(parsed)
      setResult(null)
      onNotice(`Static Scan Artifact v2 loaded for ${parsed.repository}. لا كود تم تشغيله.`)
    } catch (error) {
      setStaticReport(null)
      setResult(null)
      onNotice(friendlyError(error))
    }
  }

  async function importAudit(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      const parsed = parseOssNpmAuditSummary(await file.text())
      setNpmAudit(parsed)
      setResult(null)
      onNotice(parsed.available ? 'NPM Audit evidence loaded.' : `NPM Audit غير متاحة: ${parsed.reason ?? 'not applicable'}.`)
    } catch (error) {
      setNpmAudit(null)
      setResult(null)
      onNotice(friendlyError(error))
    }
  }

  function runBenchmark(): void {
    if (!candidate || !staticReport || !npmAudit) return
    try {
      const next = benchmarkOssCandidate(candidate, staticReport, npmAudit)
      setResult(next)
      setSaveApproved(false)
      onNotice(`Static Sandbox Readiness Benchmark اكتملت: ${next.score.total}/100 → ${next.decision}. Integration بقيت ممنوعة.`)
    } catch (error) {
      setResult(null)
      onNotice(friendlyError(error))
    }
  }

  function saveResult(): void {
    if (!result) return
    try {
      saveOssBenchmark(result, saveApproved)
      setSaveApproved(false)
      setRevision((value) => value + 1)
      onNotice('تم حفظ Benchmark Evidence محلياً. هذا لا يغيّر integrationAllowed=false.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function removeSaved(repository: string): void {
    try {
      deleteOssBenchmark(repository, deleteApproved)
      setDeleteApproved(false)
      setRevision((value) => value + 1)
      onNotice('تم حذف نتيجة Benchmark المحلية فقط.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  return (
    <section className="oss-benchmark" dir="rtl">
      <div className="oss-benchmark-head">
        <div>
          <span className="phase-pill">Phase 6B</span>
          <h3>Static Sandbox Readiness Benchmark (اختبار جاهزية العزل الساكن)</h3>
        </div>
        <span className="safe-pill">No Candidate Code Execution · $0</span>
      </div>

      <p className="disclaimer">
        هذه المرحلة لا تشغّل كود المشروع ولا Tests الخاصة به. هي تحوّل Artifact الفحص الساكن إلى Evidence + Score + Decision قابلة للمراجعة. `executionSandboxPerformed=false` و`integrationAllowed=false` دائماً؛ لذلك USE النهائي يبقى مقفلاً.
      </p>

      {candidates.length === 0 ? (
        <p className="empty-state">احفظ Candidate في Watchlist أولاً، ثم شغّل OSS Candidate Deep Scan من GitHub Actions واستورد Artifact.</p>
      ) : (
        <>
          <label>
            Candidate (المرشح)
            <select value={selectedRepository} onChange={(event) => { setSelectedRepository(event.target.value); setStaticReport(null); setNpmAudit(null); setResult(null) }}>
              {candidates.map((item) => <option key={item.fullName} value={item.fullName}>{item.fullName}</option>)}
            </select>
          </label>

          <div className="oss-benchmark-imports">
            <label className="file-button">
              Import oss-static-report.json
              <input type="file" accept="application/json,.json" onChange={(event) => void importStatic(event.target.files?.[0])} />
            </label>
            <label className="file-button">
              Import npm-audit-summary.json
              <input type="file" accept="application/json,.json" onChange={(event) => void importAudit(event.target.files?.[0])} />
            </label>
          </div>

          <div className="oss-benchmark-evidence-state">
            <span>Static report: <strong>{staticReport ? 'Loaded' : 'Missing'}</strong></span>
            <span>NPM audit: <strong>{npmAudit ? (npmAudit.available ? 'Loaded' : 'Not applicable') : 'Missing'}</strong></span>
            <span>Execution sandbox: <strong>NOT PERFORMED</strong></span>
            <span>Integration: <strong>BLOCKED</strong></span>
          </div>

          <button className="primary-button" type="button" disabled={!candidate || !staticReport || !npmAudit} onClick={runBenchmark}>
            Run Static Benchmark (شغّل التقييم الساكن)
          </button>
        </>
      )}

      {result && (
        <div className="oss-benchmark-result">
          <div className="oss-benchmark-score">
            <strong>{result.score.total}/100</strong>
            <span className={`oss-decision decision-${result.decision.toLowerCase()}`}>{decisionLabels[result.decision]}</span>
          </div>
          <div className="oss-score-grid">
            <div><span>Isolation Evidence</span><strong>{result.score.isolationEvidence}/20</strong></div>
            <div><span>Static Coverage</span><strong>{result.score.staticCoverage}/20</strong></div>
            <div><span>Security Signals</span><strong>{result.score.securitySignals}/30</strong></div>
            <div><span>Supply Chain</span><strong>{result.score.supplyChain}/20</strong></div>
            <div><span>Project Health</span><strong>{result.score.projectHealth}/10</strong></div>
            <div><span>Mandatory Spend</span><strong>$0</strong></div>
          </div>

          <div className="oss-benchmark-observations">
            <span>Source files observed: <strong>{result.staticReport.sourceFilesObserved}</strong></span>
            <span>Test files observed: <strong>{result.staticReport.testFilesObserved}</strong></span>
            <span>CI configs observed: <strong>{result.staticReport.ciConfigsObserved}</strong></span>
            <span>Secret signals: <strong>{result.staticReport.secretSignalCount}</strong></span>
            <span>NPM high: <strong>{result.npmAudit.high ?? 'unknown'}</strong></span>
            <span>NPM critical: <strong>{result.npmAudit.critical ?? 'unknown'}</strong></span>
          </div>

          {result.hardBlocks.length > 0 && <div className="approval-box"><strong>Hard Blocks (موانع قاطعة)</strong><ul>{result.hardBlocks.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          <details open>
            <summary>Evidence (الأدلة)</summary>
            <ul>{result.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
          </details>
          <details>
            <summary>Limitations (الحدود)</summary>
            <ul>{result.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
          </details>

          <div className="oss-benchmark-save">
            <label><input type="checkbox" checked={saveApproved} onChange={(event) => setSaveApproved(event.target.checked)} /> أوافق على حفظ Evidence محلياً فقط؛ لا دمج ولا تشغيل ولا تفعيل.</label>
            <button type="button" disabled={!saveApproved} onClick={saveResult}>Save Benchmark Evidence</button>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div className="oss-benchmark-saved">
          <h4>Saved Benchmark Evidence</h4>
          {saved.map((item) => (
            <article key={item.id}>
              <div><strong>{item.repository}</strong><small>{item.score.total}/100 · {item.decision} · executionSandbox=false · integration=false</small></div>
              <details><summary>Evidence & limitations</summary><ul>{item.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul><ul>{item.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></details>
            </article>
          ))}
          <label><input type="checkbox" checked={deleteApproved} onChange={(event) => setDeleteApproved(event.target.checked)} /> موافقة حذف نتيجة محلية</label>
          <select defaultValue="" onChange={(event) => { if (event.target.value) removeSaved(event.target.value); event.target.value = '' }}>
            <option value="">اختر نتيجة لحذفها بعد الموافقة</option>
            {saved.map((item) => <option key={item.repository} value={item.repository}>{item.repository}</option>)}
          </select>
        </div>
      )}
    </section>
  )
}
