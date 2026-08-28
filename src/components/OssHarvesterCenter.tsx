import { useMemo, useState } from 'react'
import {
  deleteOssCandidate,
  discoverOssRepositories,
  exportOssWatchlist,
  loadOssWatchlist,
  saveOssCandidate,
  type OssCandidate,
  type OssDecision,
} from '../core/ossHarvester'

interface Props {
  onNotice: (message: string) => void
}

const decisionLabels: Record<OssDecision, string> = {
  USE: 'USE (مرشح للاستخدام بعد كل البوابات)',
  ADAPT: 'ADAPT (تكييف/موصل)',
  STUDY: 'STUDY (للدراسة)',
  WATCH: 'WATCH (مراقبة)',
  REJECT: 'REJECT (مرفوض)',
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    OSS_QUERY_REQUIRED: 'اكتب ما الذي تبحث عنه في GitHub أولاً.',
    OSS_GITHUB_RATE_LIMITED: 'GitHub أوقف البحث العام مؤقتاً بسبب Rate Limit (حد الطلبات). أعد المحاولة لاحقاً.',
    OSS_GITHUB_TIMEOUT: 'انتهت مهلة بحث GitHub قبل وصول الرد.',
    OSS_GITHUB_RESPONSE_TOO_LARGE: 'رد GitHub تجاوز حد الحماية المخصص للهاتف.',
  }
  return labels[message] ?? `OSS Harvester (جامع المصادر المفتوحة): ${message}`
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('ar', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function downloadWatchlist(): void {
  const blob = new Blob([exportOssWatchlist()], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'agent-ia-factory-oss-watchlist.json'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function OssHarvesterCenter({ onNotice }: Props) {
  const [query, setQuery] = useState('AI agent framework MCP orchestration')
  const [results, setResults] = useState<OssCandidate[]>([])
  const [watchlist, setWatchlist] = useState<OssCandidate[]>(() => loadOssWatchlist())
  const [searching, setSearching] = useState(false)

  const savedNames = useMemo(() => new Set(watchlist.map((item) => item.fullName)), [watchlist])

  async function search() {
    if (!query.trim()) {
      onNotice(friendlyError(new Error('OSS_QUERY_REQUIRED')))
      return
    }
    setSearching(true)
    onNotice('جاري Discovery (الاكتشاف) من GitHub العام. لا يوجد Token ولا API مدفوع، ولا يتم تنزيل أو تشغيل كود أي مشروع.')
    try {
      const found = await discoverOssRepositories(query)
      setResults(found)
      onNotice(`اكتشف OSS Harvester ${found.length} مستودعاً. القرارات أولية فقط، وكل Integration (دمج) محجوب حتى Deep Scan (الفحص العميق).`)
    } catch (error) {
      onNotice(friendlyError(error))
    } finally {
      setSearching(false)
    }
  }

  function save(candidate: OssCandidate) {
    setWatchlist(saveOssCandidate(candidate))
    onNotice(`تم حفظ ${candidate.fullName} في Watchlist (قائمة المراقبة). Integration يبقى محجوباً حتى الفحص العميق.`)
  }

  function remove(fullName: string) {
    setWatchlist(deleteOssCandidate(fullName))
    onNotice(`تم حذف ${fullName} من Watchlist المحلية.`)
  }

  function openRepository(candidate: OssCandidate) {
    const url = new URL(candidate.htmlUrl)
    if (url.origin !== 'https://github.com') {
      onNotice('تم منع فتح رابط غير تابع لـGitHub.')
      return
    }
    window.open(url.href, '_blank', 'noopener,noreferrer')
  }

  function renderCandidate(candidate: OssCandidate, saved = false) {
    return (
      <article className="oss-candidate" key={`${saved ? 'saved' : 'found'}-${candidate.fullName}`}>
        <div className="oss-candidate-head">
          <div>
            <strong>{candidate.fullName}</strong>
            <small>{candidate.language} · ⭐ {compactNumber(candidate.stars)} · Forks {compactNumber(candidate.forks)}</small>
          </div>
          <span className={`oss-decision decision-${candidate.preliminaryDecision.toLowerCase()}`}>
            {decisionLabels[candidate.preliminaryDecision]}
          </span>
        </div>

        {candidate.description && <p>{candidate.description}</p>}

        <div className="oss-score-grid">
          <div><span>Total Score</span><strong>{candidate.scores.total}/100</strong></div>
          <div><span>License</span><strong>{candidate.licenseSpdx}</strong></div>
          <div><span>License Score</span><strong>{candidate.scores.license}/35</strong></div>
          <div><span>Maintenance</span><strong>{candidate.scores.maintenance}/25</strong></div>
          <div><span>Adoption</span><strong>{candidate.scores.adoption}/15</strong></div>
          <div><span>Relevance</span><strong>{candidate.scores.relevance}/15</strong></div>
        </div>

        <div className="oss-gates">
          <span>Deep Scan: <strong>Pending (معلّق)</strong></span>
          <span>Integration: <strong>Blocked (ممنوع)</strong></span>
          <span>Last Push: <strong>{new Date(candidate.pushedAt).toLocaleDateString('ar')}</strong></span>
        </div>

        <details>
          <summary>Why this decision? (لماذا هذا القرار؟)</summary>
          <ul>{candidate.reasons.map((reason, index) => <li key={`${candidate.id}-${index}`}>{reason}</li>)}</ul>
          <p className="disclaimer">الدرجة لا تعني أن المشروع آمن. USE الحقيقي لا يصدر إلا بعد License Verification + Vulnerability/Dependency Scan + Secret Scan + Sandbox Test + Pinned Version + Rollback Plan.</p>
        </details>

        <div className="oss-actions">
          <button className="text-button" type="button" onClick={() => openRepository(candidate)}>فتح GitHub</button>
          {saved ? (
            <button className="danger-button" type="button" onClick={() => remove(candidate.fullName)}>حذف من Watchlist</button>
          ) : (
            <button className="primary-button" type="button" disabled={savedNames.has(candidate.fullName)} onClick={() => save(candidate)}>
              {savedNames.has(candidate.fullName) ? '✓ محفوظ' : '+ حفظ للمراجعة'}
            </button>
          )}
        </div>
      </article>
    )
  }

  return (
    <section className="card oss-harvester-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 6 — OSS Harvester (جامع المصادر المفتوحة)</p>
          <h2>ابحث في GitHub، قيّم، ثم افحص قبل الدمج</h2>
        </div>
        <span className="safe-pill">No Auto-Integration</span>
      </div>

      <p className="disclaimer">
        البحث يبدأ فقط عندما تضغط الزر. Harvester يقرأ Metadata (بيانات المستودع) العامة من GitHub ويعطي Preliminary Score (درجة أولية). لا ينزّل ولا يشغّل كوداً، ولا يمنح USE نهائياً، ولا يدمج أي مشروع تلقائياً.
      </p>

      <div className="oss-search-row">
        <label>
          Search GitHub (البحث في غيت هب)
          <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={160} placeholder="مثال: browser agent MCP" />
        </label>
        <button className="primary-button" type="button" disabled={searching || query.trim().length < 2} onClick={search}>
          {searching ? 'جاري البحث...' : '⌕ Discover OSS (اكتشاف المشاريع)'}
        </button>
      </div>

      <div className="oss-policy-strip">
        <span>Preferred Licenses: MIT / Apache-2.0 / BSD</span>
        <span>Results: ≤ 12</span>
        <span>Mandatory Spend: $0</span>
        <span>Deep Scan قبل أي Integration</span>
      </div>

      {results.length > 0 && (
        <div className="oss-section">
          <h3>Discovery Results (نتائج الاكتشاف)</h3>
          <div className="oss-list">{results.map((candidate) => renderCandidate(candidate))}</div>
        </div>
      )}

      <div className="oss-section">
        <div className="oss-section-head">
          <div>
            <h3>Watchlist (قائمة المراقبة)</h3>
            <small>{watchlist.length} مشروع محفوظ محلياً</small>
          </div>
          {watchlist.length > 0 && <button className="text-button" type="button" onClick={downloadWatchlist}>Export JSON (تصدير)</button>}
        </div>

        {watchlist.length === 0 ? (
          <p className="empty-state">لا توجد مشاريع محفوظة بعد.</p>
        ) : (
          <div className="oss-list">{watchlist.map((candidate) => renderCandidate(candidate, true))}</div>
        )}
      </div>

      <div className="oss-deep-scan-note">
        <strong>Deep Scan (الفحص العميق)</strong>
        <p>في هذه المرحلة يتم عبر GitHub Actions (فحوص غيت هب) منفصلة وآمنة: Checkout بدون Credentials، لا Install، لا Scripts، لا Tests لكود الطرف الثالث. النتيجة تبقى تقرير مراجعة فقط ولا تغيّر `integrationAllowed=false` تلقائياً.</p>
      </div>
    </section>
  )
}
