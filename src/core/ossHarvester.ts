export type OssDecision = 'USE' | 'ADAPT' | 'STUDY' | 'WATCH' | 'REJECT'
export type DeepScanStatus = 'pending' | 'passed' | 'failed'

export interface OssCandidate {
  id: number
  fullName: string
  htmlUrl: string
  description: string
  stars: number
  forks: number
  openIssues: number
  language: string
  licenseSpdx: string
  archived: boolean
  disabled: boolean
  pushedAt: string
  updatedAt: string
  topics: string[]
  scores: {
    license: number
    maintenance: number
    adoption: number
    repositoryHealth: number
    relevance: number
    total: number
  }
  preliminaryDecision: OssDecision
  deepScanStatus: DeepScanStatus
  integrationAllowed: false
  reasons: string[]
  discoveredAt: string
}

interface GitHubSearchItem {
  id: number
  full_name: string
  html_url: string
  description: string | null
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  language: string | null
  license: { spdx_id?: string | null } | null
  archived: boolean
  disabled: boolean
  pushed_at: string
  updated_at: string
  topics?: string[]
}

interface GitHubSearchResponse {
  total_count: number
  incomplete_results: boolean
  items: GitHubSearchItem[]
}

const WATCHLIST_KEY = 'agent-ia-factory.oss-watchlist.v1'
const MAX_SAVED = 60
const MAX_RESULTS = 12
const MAX_RESPONSE_BYTES = 2_000_000
const REQUEST_TIMEOUT_MS = 10_000
const GITHUB_API_ORIGIN = 'https://api.github.com'
const PREFERRED_LICENSES = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause'])
const REVIEW_LICENSES = new Set(['ISC', 'MPL-2.0', 'LGPL-2.1', 'LGPL-3.0', 'GPL-2.0', 'GPL-3.0'])
const RESTRICTIVE_LICENSES = new Set(['AGPL-3.0', 'SSPL-1.0', 'BUSL-1.1'])

function now(): string { return new Date().toISOString() }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)) }

function readWatchlist(): OssCandidate[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SAVED) as OssCandidate[] : []
  } catch {
    return []
  }
}

function writeWatchlist(items: OssCandidate[]): void {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items.slice(0, MAX_SAVED)))
}

function licenseScore(spdx: string): number {
  if (PREFERRED_LICENSES.has(spdx)) return 35
  if (REVIEW_LICENSES.has(spdx)) return 20
  if (RESTRICTIVE_LICENSES.has(spdx)) return 5
  return 0
}

function maintenanceScore(pushedAt: string): number {
  const pushed = new Date(pushedAt).getTime()
  if (!Number.isFinite(pushed)) return 0
  const ageDays = (Date.now() - pushed) / 86_400_000
  if (ageDays <= 30) return 25
  if (ageDays <= 90) return 22
  if (ageDays <= 180) return 18
  if (ageDays <= 365) return 13
  if (ageDays <= 730) return 7
  return 2
}

function adoptionScore(stars: number, forks: number): number {
  const starScore = stars >= 20_000 ? 11 : stars >= 5_000 ? 9 : stars >= 1_000 ? 7 : stars >= 250 ? 5 : stars >= 50 ? 3 : 1
  const forkScore = forks >= 2_000 ? 4 : forks >= 500 ? 3 : forks >= 100 ? 2 : forks >= 20 ? 1 : 0
  return clamp(starScore + forkScore, 0, 15)
}

function healthScore(item: GitHubSearchItem): number {
  let score = 10
  if (item.archived) score -= 8
  if (item.disabled) score -= 10
  if (item.open_issues_count > 5_000) score -= 2
  return clamp(score, 0, 10)
}

function relevanceScore(item: GitHubSearchItem, query: string): number {
  const terms = query.toLowerCase().split(/\s+/u).filter((term) => term.length >= 2).slice(0, 8)
  if (terms.length === 0) return 5
  const haystack = `${item.full_name} ${item.description ?? ''} ${(item.topics ?? []).join(' ')}`.toLowerCase()
  const hits = terms.filter((term) => haystack.includes(term)).length
  return clamp(Math.round((hits / terms.length) * 15), 0, 15)
}

function preliminaryDecision(item: GitHubSearchItem, spdx: string, total: number): { decision: OssDecision; reasons: string[] } {
  const reasons: string[] = []
  if (item.disabled) return { decision: 'REJECT', reasons: ['Repository disabled (المستودع معطل).'] }
  if (item.archived) return { decision: 'REJECT', reasons: ['Repository archived (المستودع مؤرشف).'] }
  if (!spdx || spdx === 'NOASSERTION' || spdx === 'Other') {
    return { decision: 'REJECT', reasons: ['License (الترخيص) غير واضح؛ يمنع الدمج حتى التحقق اليدوي.'] }
  }
  if (RESTRICTIVE_LICENSES.has(spdx)) {
    return { decision: 'STUDY', reasons: [`License ${spdx} يحتاج مراجعة قانونية قوية؛ للدراسة فقط في هذه المرحلة.`] }
  }
  if (REVIEW_LICENSES.has(spdx)) {
    reasons.push(`License ${spdx} ليس ضمن قائمة التراخيص المفضلة ويحتاج مراجعة قبل أي Adapter.`)
    reasons.push('Security deep scan (الفحص الأمني العميق) لم يُنفذ بعد.')
    return { decision: 'STUDY', reasons }
  }
  if (PREFERRED_LICENSES.has(spdx)) {
    reasons.push(`License ${spdx} ضمن قائمة التراخيص المفضلة.`)
    reasons.push('Security deep scan + dependency audit + sandbox test ما زالت مطلوبة قبل USE.')
    return { decision: total >= 55 ? 'WATCH' : 'ADAPT', reasons }
  }
  return { decision: 'REJECT', reasons: [`License ${spdx} غير مصنف في سياسة المصنع الحالية.`] }
}

async function boundedGitHubFetch(path: string): Promise<unknown> {
  if (!path.startsWith('/search/repositories?')) throw new Error('OSS_GITHUB_PATH_FORBIDDEN')
  const url = new URL(path, GITHUB_API_ORIGIN)
  if (url.origin !== GITHUB_API_ORIGIN) throw new Error('OSS_GITHUB_ORIGIN_FORBIDDEN')
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort('OSS_GITHUB_TIMEOUT'), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) throw new Error('OSS_GITHUB_RATE_LIMITED')
      throw new Error(`OSS_GITHUB_HTTP_${response.status}`)
    }
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('OSS_GITHUB_RESPONSE_TOO_LARGE')
    const text = await response.text()
    if (text.length > MAX_RESPONSE_BYTES) throw new Error('OSS_GITHUB_RESPONSE_TOO_LARGE')
    return JSON.parse(text) as unknown
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function discoverOssRepositories(rawQuery: string): Promise<OssCandidate[]> {
  const query = rawQuery.replace(/[\u0000-\u001f]/gu, ' ').trim().slice(0, 160)
  if (query.length < 2) throw new Error('OSS_QUERY_REQUIRED')
  const q = `${query} archived:false fork:false`
  const params = new URLSearchParams({ q, sort: 'stars', order: 'desc', per_page: String(MAX_RESULTS) })
  const payload = await boundedGitHubFetch(`/search/repositories?${params.toString()}`) as Partial<GitHubSearchResponse>
  const items = Array.isArray(payload.items) ? payload.items.slice(0, MAX_RESULTS) : []
  return items.map((item) => {
    const spdx = item.license?.spdx_id?.trim() || 'NOASSERTION'
    const scores = {
      license: licenseScore(spdx),
      maintenance: maintenanceScore(item.pushed_at),
      adoption: adoptionScore(item.stargazers_count, item.forks_count),
      repositoryHealth: healthScore(item),
      relevance: relevanceScore(item, query),
      total: 0,
    }
    scores.total = scores.license + scores.maintenance + scores.adoption + scores.repositoryHealth + scores.relevance
    const decision = preliminaryDecision(item, spdx, scores.total)
    return {
      id: item.id,
      fullName: item.full_name,
      htmlUrl: item.html_url,
      description: (item.description ?? '').slice(0, 800),
      stars: item.stargazers_count,
      forks: item.forks_count,
      openIssues: item.open_issues_count,
      language: item.language ?? 'Unknown',
      licenseSpdx: spdx,
      archived: item.archived,
      disabled: item.disabled,
      pushedAt: item.pushed_at,
      updatedAt: item.updated_at,
      topics: (item.topics ?? []).slice(0, 20),
      scores,
      preliminaryDecision: decision.decision,
      deepScanStatus: 'pending' as const,
      integrationAllowed: false as const,
      reasons: decision.reasons,
      discoveredAt: now(),
    }
  })
}

export function loadOssWatchlist(): OssCandidate[] {
  return readWatchlist()
}

export function saveOssCandidate(candidate: OssCandidate): OssCandidate[] {
  const safe: OssCandidate = { ...candidate, integrationAllowed: false, deepScanStatus: candidate.deepScanStatus ?? 'pending' }
  const next = [safe, ...readWatchlist().filter((item) => item.fullName !== safe.fullName)].slice(0, MAX_SAVED)
  writeWatchlist(next)
  return next
}

export function deleteOssCandidate(fullName: string): OssCandidate[] {
  const next = readWatchlist().filter((item) => item.fullName !== fullName)
  writeWatchlist(next)
  return next
}

export function exportOssWatchlist(): string {
  return JSON.stringify({ schemaVersion: '1', exportedAt: now(), integrationAllowed: false, candidates: readWatchlist() }, null, 2)
}
