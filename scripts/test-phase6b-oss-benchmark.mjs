import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../')
      const extensionless = !/\.[A-Za-z0-9]+$/u.test(specifier)
      if (relative && extensionless && context.parentURL?.startsWith('file:')) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL)
        if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
      }
      throw error
    }
  },
})

class MemoryStorage {
  #map = new Map()
  get length() { return this.#map.size }
  clear() { this.#map.clear() }
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null }
  key(index) { return [...this.#map.keys()][index] ?? null }
  removeItem(key) { this.#map.delete(key) }
  setItem(key, value) { this.#map.set(String(key), String(value)) }
  snapshot() { return [...this.#map.entries()].sort(([a], [b]) => a.localeCompare(b)) }
}

globalThis.localStorage = new MemoryStorage()

const benchmark = await import(new URL('../src/core/ossBenchmark.ts', import.meta.url).href)
const storage = await import(new URL('../src/core/storage.ts', import.meta.url).href)

const candidate = {
  id: 42,
  fullName: 'example/good-agent-framework',
  htmlUrl: 'https://github.com/example/good-agent-framework',
  description: 'Example candidate',
  stars: 5000,
  forks: 700,
  openIssues: 20,
  language: 'TypeScript',
  licenseSpdx: 'MIT',
  archived: false,
  disabled: false,
  pushedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  topics: ['agents'],
  scores: { license: 35, maintenance: 25, adoption: 12, repositoryHealth: 10, relevance: 15, total: 97 },
  preliminaryDecision: 'WATCH',
  deepScanStatus: 'pending',
  integrationAllowed: false,
  reasons: ['Static scan required.'],
  discoveredAt: new Date().toISOString(),
}

const cleanReportJson = JSON.stringify({
  schemaVersion: '2',
  repository: candidate.fullName,
  scanMode: 'static-no-candidate-code-execution',
  filesScanned: 900,
  boundedBytesRead: 9_000_000,
  symlinksSkipped: 2,
  executableFilesObserved: 4,
  sourceFilesObserved: 300,
  testFilesObserved: 80,
  ciConfigsObserved: 3,
  readmeObserved: true,
  licenseFiles: ['LICENSE'],
  manifests: ['package.json', 'package-lock.json'],
  secretSignals: [],
  packageSummary: { name: 'good-agent-framework', license: 'MIT', dependency_count: 10, dev_dependency_count: 12, script_names: ['build', 'test'] },
  integrationAllowed: false,
  deepScanDecision: 'manual-review-required',
})
const cleanAuditJson = JSON.stringify({ available: true, parseError: false, vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } })

const report = benchmark.parseOssStaticScanReport(cleanReportJson)
const audit = benchmark.parseOssNpmAuditSummary(cleanAuditJson)
const before = localStorage.snapshot()
const clean = benchmark.benchmarkOssCandidate(candidate, report, audit)
assert.equal(clean.executionSandboxPerformed, false)
assert.equal(clean.candidateCodeExecuted, false)
assert.equal(clean.integrationAllowed, false)
assert.equal(clean.monetaryCostUsd, 0)
assert.equal(clean.decision, 'ADAPT')
assert.ok(clean.score.total >= 80)
assert.equal(clean.hardBlocks.length, 0)
assert.ok(clean.limitations.some((item) => item.includes('USE remains blocked')))
assert.deepEqual(localStorage.snapshot(), before)
assert.equal(storage.loadAgents().length, 0)
assert.equal(storage.loadRuns().length, 0)

const secretReport = benchmark.parseOssStaticScanReport(JSON.stringify({ ...JSON.parse(cleanReportJson), secretSignals: [{ file: 'config.txt', type: 'private-key-header' }] }))
const secretResult = benchmark.benchmarkOssCandidate(candidate, secretReport, audit)
assert.equal(secretResult.decision, 'REJECT')
assert.ok(secretResult.hardBlocks.some((item) => item.includes('secret signals')))

const vulnerableAudit = benchmark.parseOssNpmAuditSummary(JSON.stringify({ available: true, parseError: false, vulnerabilities: { high: 2, critical: 1, total: 3 } }))
const vulnerableResult = benchmark.benchmarkOssCandidate(candidate, report, vulnerableAudit)
assert.equal(vulnerableResult.decision, 'REJECT')
assert.ok(vulnerableResult.hardBlocks.some((item) => item.includes('Critical npm vulnerabilities')))
assert.ok(vulnerableResult.hardBlocks.some((item) => item.includes('High npm vulnerabilities')))

const unavailableAudit = benchmark.parseOssNpmAuditSummary(JSON.stringify({ available: false, reason: 'no-safe-package-lock' }))
const unavailableResult = benchmark.benchmarkOssCandidate(candidate, report, unavailableAudit)
assert.equal(unavailableResult.decision, 'WATCH')
assert.equal(unavailableResult.npmAudit.high, null)

const reviewLicenseCandidate = { ...candidate, licenseSpdx: 'MPL-2.0', scores: { ...candidate.scores, license: 20 } }
const reviewLicenseResult = benchmark.benchmarkOssCandidate(reviewLicenseCandidate, report, audit)
assert.equal(reviewLicenseResult.decision, 'STUDY')

const restrictiveCandidate = { ...candidate, licenseSpdx: 'AGPL-3.0', scores: { ...candidate.scores, license: 5 } }
const restrictiveResult = benchmark.benchmarkOssCandidate(restrictiveCandidate, report, audit)
assert.equal(restrictiveResult.decision, 'STUDY')
assert.ok(restrictiveResult.limitations.some((item) => item.includes('study-only')))

const unknownLicenseCandidate = { ...candidate, licenseSpdx: 'NOASSERTION', scores: { ...candidate.scores, license: 0 } }
const unknownLicenseResult = benchmark.benchmarkOssCandidate(unknownLicenseCandidate, report, audit)
assert.equal(unknownLicenseResult.decision, 'REJECT')

assert.throws(() => benchmark.benchmarkOssCandidate({ ...candidate, fullName: 'other/repo' }, report, audit), /OSS_BENCHMARK_CANDIDATE_REPORT_MISMATCH/)
assert.throws(() => benchmark.parseOssStaticScanReport(JSON.stringify({ ...JSON.parse(cleanReportJson), hiddenTrust: true })), /OSS_BENCHMARK_REPORT_EXTRA_FIELD/)
assert.throws(() => benchmark.parseOssStaticScanReport(JSON.stringify({ ...JSON.parse(cleanReportJson), integrationAllowed: true })), /OSS_BENCHMARK_SCAN_POLICY_INVALID/)
assert.throws(() => benchmark.parseOssNpmAuditSummary(JSON.stringify({ available: true, token: 'hidden' })), /OSS_BENCHMARK_AUDIT_EXTRA_FIELD/)

assert.throws(() => benchmark.saveOssBenchmark(clean, false), /OSS_BENCHMARK_SAVE_APPROVAL_REQUIRED/)
assert.deepEqual(localStorage.snapshot(), before)
const saved = benchmark.saveOssBenchmark(clean, true)
assert.equal(saved.length, 1)
assert.equal(saved[0].integrationAllowed, false)
assert.equal(saved[0].executionSandboxPerformed, false)
assert.equal(saved[0].candidateCodeExecuted, false)
assert.equal(saved[0].decision, 'ADAPT')
assert.equal(storage.loadAgents().length, 0)
assert.equal(storage.loadRuns().length, 0)
assert.ok(!localStorage.snapshot().some(([key]) => key.includes('workflow') || key.includes('tool-calls') || key.includes('adapter-activations')))

assert.throws(() => benchmark.deleteOssBenchmark(candidate.fullName, false), /OSS_BENCHMARK_DELETE_APPROVAL_REQUIRED/)
assert.equal(benchmark.deleteOssBenchmark(candidate.fullName, true).length, 0)

console.log('Phase 6B OSS static sandbox-readiness benchmark smoke: PASS')
console.log('Clean preferred-license evidence: ADAPT, never USE: PASS')
console.log('Secret signal: REJECT fail-closed: PASS')
console.log('High/Critical npm vulnerability: REJECT fail-closed: PASS')
console.log('Unavailable npm audit: WATCH, not assumed safe: PASS')
console.log('Review/restrictive license: STUDY: PASS')
console.log('Unknown license: REJECT: PASS')
console.log('Artifact hidden fields / integrationAllowed injection: rejected')
console.log('Benchmark planning side effects: absent')
console.log('Save/delete evidence: Human Approval required')
console.log('Candidate code execution: false')
console.log('Execution sandbox performed: false')
console.log('Integration allowed: false')
console.log('Mandatory additional spend: 0 USD')
