import { validateEvaluationSuite, type EvaluationReport, type EvaluationSuite } from './evaluationEngine'

const SUITES_KEY = 'agent-ia-factory.eval-suites.v1'
const REPORTS_KEY = 'agent-ia-factory.eval-reports.v1'
const MAX_SUITES = 20
const MAX_REPORTS = 50
const MAX_JSON_CHARS = 1_500_000

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw || raw.length > MAX_JSON_CHARS) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function writeArray<T>(key: string, value: T[]): void {
  const encoded = JSON.stringify(value)
  if (encoded.length > MAX_JSON_CHARS) throw new Error('EVAL_LOCAL_STORAGE_LIMIT')
  localStorage.setItem(key, encoded)
}

export function loadEvaluationSuites(): EvaluationSuite[] {
  return readArray<EvaluationSuite>(SUITES_KEY)
    .flatMap((suite) => {
      try { return [validateEvaluationSuite(suite)] } catch { return [] }
    })
    .slice(0, MAX_SUITES)
}

export function saveEvaluationSuite(suite: EvaluationSuite): EvaluationSuite[] {
  const safe = validateEvaluationSuite(suite)
  const next = [safe, ...loadEvaluationSuites().filter((item) => item.id !== safe.id)].slice(0, MAX_SUITES)
  writeArray(SUITES_KEY, next)
  return next
}

export function deleteEvaluationSuite(suiteId: string): EvaluationSuite[] {
  const next = loadEvaluationSuites().filter((suite) => suite.id !== suiteId)
  writeArray(SUITES_KEY, next)
  return next
}

export function loadEvaluationReports(): EvaluationReport[] {
  return readArray<EvaluationReport>(REPORTS_KEY)
    .filter((report) => report?.schemaVersion === '0.1' && typeof report.id === 'string' && typeof report.agentId === 'string')
    .slice(0, MAX_REPORTS)
}

export function saveEvaluationReport(report: EvaluationReport): EvaluationReport[] {
  const next = [report, ...loadEvaluationReports().filter((item) => item.id !== report.id)].slice(0, MAX_REPORTS)
  writeArray(REPORTS_KEY, next)
  return next
}

export function clearEvaluationEvidence(): void {
  localStorage.removeItem(SUITES_KEY)
  localStorage.removeItem(REPORTS_KEY)
}

export function exportEvaluationEvidence(): string {
  return JSON.stringify({
    schemaVersion: '0.1',
    exportedAt: new Date().toISOString(),
    suites: loadEvaluationSuites(),
    reports: loadEvaluationReports(),
  }, null, 2)
}
