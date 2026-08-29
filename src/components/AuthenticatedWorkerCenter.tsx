import { useState } from 'react'
import { LOCAL_TENANT_ID, type DurableJob } from '../core/deploymentEngine.ts'
import { applyLocalWorkerReceipt, claimLocalDurableJob, loadDurableJobs } from '../core/deploymentStorage'
import { saveRun } from '../core/storage'
import { validateWorkerTransportSecret } from '../core/workerAuth.ts'
import { executeWorkerBundleOverAuthenticatedHttps, validateAuthenticatedWorkerEndpoint } from '../core/workerTransport.ts'
import {
  REFERENCE_WORKER_ID,
  buildPortableWorkerBundle,
  type PortableWorkerBundle,
} from '../core/workerProtocol.ts'
import type { AgentSpec } from '../core/types'

interface Props {
  agents: AgentSpec[]
  onNotice: (message: string) => void
}

function nextClaimableJob(jobs: DurableJob[], now: string): DurableJob | null {
  const nowMs = Date.parse(now)
  return jobs
    .filter((job) => job.tenantId === LOCAL_TENANT_ID)
    .filter((job) => ['pending', 'retry_wait'].includes(job.status))
    .filter((job) => job.attempts < job.maxAttempts && Date.parse(job.nextAttemptAt) <= nowMs)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0] ?? null
}

function workerCompatibleAgent(agent: AgentSpec | undefined): agent is AgentSpec {
  return Boolean(
    agent
    && agent.runtime.adapter === 'local-demo'
    && agent.modelPolicy.allowPaid === false
    && agent.budgetPolicy.maxMonetarySpendUsd === 0
    && agent.toolPolicy.defaultAction === 'deny'
    && agent.toolPolicy.allowedTools.length === 0,
  )
}

export default function AuthenticatedWorkerCenter({ agents, onNotice }: Props) {
  const [endpoint, setEndpoint] = useState('')
  const [secret, setSecret] = useState('')
  const [activeBundle, setActiveBundle] = useState<PortableWorkerBundle | null>(null)
  const [sending, setSending] = useState(false)
  const [lastSuccess, setLastSuccess] = useState<string | null>(null)

  async function sendBundle(bundle: PortableWorkerBundle): Promise<void> {
    if (Date.now() >= Date.parse(bundle.expiresAt)) {
      setActiveBundle(null)
      onNotice('انتهى Lease (الحجز) قبل الإرسال. لا يُعاد استخدام Bundle منتهية؛ اترك Job تُستعاد عبر Durable Queue.')
      return
    }
    setSending(true)
    try {
      const receipt = await executeWorkerBundleOverAuthenticatedHttps(endpoint, secret, bundle)
      const applied = applyLocalWorkerReceipt(receipt)
      saveRun(applied.receipt.run)
      setLastSuccess(applied.job.id)
      setActiveBundle(null)
      onNotice(`نجح Authenticated Transport (النقل الموثّق). تم التحقق من التوقيع وربط Receipt بالـLease، وحالة Job: ${applied.job.status}.`)
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error)
      setActiveBundle(bundle)
      onNotice(`لم تُحسم نتيجة النقل: ${code}. لن يحدث Auto-Retry (إعادة تلقائية). إن بقي Lease صالحًا يمكنك الضغط يدويًا على Retry Same Bundle (أعد نفس الحزمة).`)
    } finally {
      setSending(false)
    }
  }

  async function handlePrepareAndSend(): Promise<void> {
    const now = new Date().toISOString()
    try {
      validateAuthenticatedWorkerEndpoint(endpoint)
      validateWorkerTransportSecret(secret)
      const candidate = nextClaimableJob(loadDurableJobs(), now)
      if (!candidate) {
        onNotice('لا توجد Durable Job (مهمة قابلة للاستئناف) جاهزة للإرسال الآن.')
        return
      }
      if (candidate.kind !== 'agent_run' || !candidate.payload.agentId) {
        onNotice('Authenticated Reference Worker يدعم agent_run فقط. لم يتم Claim (حجز) أي Job.')
        return
      }
      const agent = agents.find((item) => item.id === candidate.payload.agentId)
      if (!workerCompatibleAgent(agent)) {
        onNotice('Agent التالية غير متوافقة: يلزم local-demo وTools مغلقة وميزانية 0$. لم يتم Claim أي Job.')
        return
      }

      const claimed = claimLocalDurableJob(REFERENCE_WORKER_ID, now, 5 * 60_000)
      if (!claimed.claimed?.lease) throw new Error('WORKER_TRANSPORT_CLAIM_RACE_LOST')
      if (claimed.claimed.id !== candidate.id) throw new Error('WORKER_TRANSPORT_CLAIM_ORDER_CHANGED')
      const bundle = buildPortableWorkerBundle(claimed.claimed, agent, LOCAL_TENANT_ID, now)
      setActiveBundle(bundle)
      await sendBundle(bundle)
    } catch (error) {
      onNotice(`تعذر بدء Authenticated Transport: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <section className="card transport-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 9C — Authenticated Transport (النقل الموثّق)</p>
          <h2>الهاتف ↔ Self-Host Worker عبر HTTPS موقّع</h2>
        </div>
        <span className="safe-pill">Manual + HMAC-SHA256 + 0$</span>
      </div>

      <p className="transport-disclosure">
        لا اتصال في الخلفية. لا Ping تلقائي. لا Retry تلقائي. الشبكة تُستخدم فقط عند ضغطك زر الإرسال. كل Request (طلب) وResponse (رد) مربوطان بتوقيع HMAC-SHA256 وNonce ضد Replay، والـSecret يبقى داخل Memory (ذاكرة الصفحة) فقط ولا يُحفظ في localStorage أو GitHub.
      </p>

      <div className="transport-form">
        <label>
          <span>Worker HTTPS Endpoint (عنوان العامل)</span>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://worker.example.com"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
          />
        </label>
        <label>
          <span>Pairing Secret (سر الاقتران) — 32-byte Base64URL</span>
          <input
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="لا يُحفظ"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </label>
      </div>

      <div className="transport-actions">
        <button type="button" disabled={sending || !endpoint.trim() || !secret.trim()} onClick={() => void handlePrepareAndSend()}>
          {sending ? 'Sending… (جارٍ الإرسال)' : 'Send Next Job (أرسل المهمة التالية)'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={sending || !activeBundle || !endpoint.trim() || !secret.trim()}
          onClick={() => activeBundle && void sendBundle(activeBundle)}
        >
          Retry Same Bundle (أعد نفس الحزمة يدويًا)
        </button>
        <button type="button" className="secondary-button" onClick={() => setSecret('')} disabled={!secret}>
          Clear Secret (امسح السر من الذاكرة)
        </button>
      </div>

      <div className="transport-status-grid">
        <div>
          <span>Uncertain Bundle (حزمة غير محسومة)</span>
          <strong>{activeBundle?.bundleId ?? 'لا يوجد'}</strong>
          <small>{activeBundle ? `Lease حتى ${new Date(activeBundle.expiresAt).toLocaleTimeString('ar')}` : 'لا توجد إعادة تلقائية مخفية.'}</small>
        </div>
        <div>
          <span>آخر Job مؤكدة</span>
          <strong>{lastSuccess ?? 'لا يوجد'}</strong>
          <small>لا تُسجل كنجاح إلا بعد Signed Receipt (إيصال موقّع) صالح.</small>
        </div>
      </div>

      <p className="transport-warning">
        Self-Host Boundary (حد الاستضافة): الخادم المرجعي يستمع على 127.0.0.1 فقط. تعريضه للإنترنت يتطلب HTTPS Reverse Proxy موثوقًا وAllowed Origin مضبوطًا. لا تضع Pairing Secret في URL أو GitHub أو ملفات المشروع.
      </p>
    </section>
  )
}
