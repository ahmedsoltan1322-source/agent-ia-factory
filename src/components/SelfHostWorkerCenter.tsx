import { useRef, useState } from 'react'
import { LOCAL_TENANT_ID, type DurableJob } from '../core/deploymentEngine'
import {
  applyLocalWorkerReceipt,
  claimLocalDurableJob,
  loadDurableJobs,
} from '../core/deploymentStorage'
import { saveRun } from '../core/storage'
import {
  MAX_WORKER_RECEIPT_CHARS,
  REFERENCE_WORKER_ID,
  WORKER_PROTOCOL,
  buildPortableWorkerBundle,
  exportWorkerBundle,
  importWorkerReceipt,
} from '../core/workerProtocol'
import type { AgentSpec } from '../core/types'

interface Props {
  agents: AgentSpec[]
  onNotice: (message: string) => void
}

function downloadJson(name: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
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

export default function SelfHostWorkerCenter({ agents, onNotice }: Props) {
  const receiptInput = useRef<HTMLInputElement>(null)
  const [lastBundle, setLastBundle] = useState<{ jobId: string; expiresAt: string } | null>(null)
  const [lastReceipt, setLastReceipt] = useState<{ jobId: string; status: string } | null>(null)

  function handlePrepareBundle(): void {
    const now = new Date().toISOString()
    try {
      const candidate = nextClaimableJob(loadDurableJobs(), now)
      if (!candidate) {
        onNotice('لا توجد Durable Job (مهمة قابلة للاستئناف) جاهزة الآن. أضف مهمة أولاً من Phase 9A.')
        return
      }
      if (candidate.kind !== 'agent_run' || !candidate.payload.agentId) {
        onNotice('Reference Worker (العامل المرجعي) في Phase 9B يدعم agent_run فقط. لم يتم Claim (حجز) أي شيء.')
        return
      }
      const agent = agents.find((item) => item.id === candidate.payload.agentId)
      if (!workerCompatibleAgent(agent)) {
        onNotice('المهمة التالية ليست متوافقة مع Reference Worker: يلزم local-demo مع Tools مغلقة وميزانية 0$. لم يتم Claim أي شيء.')
        return
      }

      const claimed = claimLocalDurableJob(REFERENCE_WORKER_ID, now, 5 * 60_000)
      if (!claimed.claimed?.lease) throw new Error('WORKER_CLAIM_RACE_LOST')
      if (claimed.claimed.id !== candidate.id) throw new Error('WORKER_CLAIM_ORDER_CHANGED')
      const bundle = buildPortableWorkerBundle(claimed.claimed, agent, LOCAL_TENANT_ID, now)
      const raw = exportWorkerBundle(bundle)
      downloadJson(`agent-ia-worker-${bundle.job.id}.json`, raw)
      setLastBundle({ jobId: bundle.job.id, expiresAt: bundle.expiresAt })
      onNotice('تم إنشاء Worker Bundle (حزمة العامل) يدويًا. الملف حساس لأنه يحتوي Task (المهمة) وLease Token (رمز الحجز). لا توجد مزامنة أو شبكة تلقائية.')
    } catch (error) {
      onNotice(`تعذر تجهيز Worker Bundle: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function handleReceiptFile(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      if (file.size > MAX_WORKER_RECEIPT_CHARS) throw new Error('WORKER_RECEIPT_FILE_TOO_LARGE')
      const raw = await file.text()
      const receipt = importWorkerReceipt(raw)
      const applied = applyLocalWorkerReceipt(receipt)
      saveRun(applied.receipt.run)
      setLastReceipt({ jobId: applied.job.id, status: applied.job.status })
      onNotice(`تم قبول Worker Receipt (إيصال العامل) بعد مطابقة Tenant/Job/Worker/Lease. حالة Job الآن: ${applied.job.status}. وحُفظ Run (التشغيل) محليًا.`)
    } catch (error) {
      onNotice(`تم رفض Worker Receipt: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (receiptInput.current) receiptInput.current.value = ''
    }
  }

  return (
    <section className="card worker-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 9B — Self-Host Worker Foundation (أساس العامل ذاتي الاستضافة)</p>
          <h2>Portable Worker Protocol (بروتوكول عامل قابل للنقل)</h2>
        </div>
        <span className="safe-pill">0$ + Offline File</span>
      </div>

      <p className="worker-disclosure">
        الهاتف هو Control Plane (طبقة التحكم). النقل في 9B يدوي بملف فقط: لا Server (خادم) إلزامي، لا Cloud (سحابة)، لا Telemetry (قياس عن بعد)، ولا Credentials (بيانات دخول). Reference Worker يشغّل local-demo فقط لإثبات مسار Worker حقيقي دون ادعاء أنه LLM.
      </p>

      <div className="worker-facts">
        <div><span>Protocol (البروتوكول)</span><strong>{WORKER_PROTOCOL}</strong></div>
        <div><span>Worker ID</span><strong>{REFERENCE_WORKER_ID}</strong></div>
        <div><span>Transport (النقل)</span><strong>offline-file</strong></div>
        <div><span>Concurrency (التوازي)</span><strong>1 Job</strong></div>
        <div><span>Network (الشبكة)</span><strong>ممنوعة تلقائيًا</strong></div>
        <div><span>Tools (الأدوات)</span><strong>ممنوعة تلقائيًا</strong></div>
      </div>

      <div className="worker-actions">
        <button type="button" onClick={handlePrepareBundle}>Prepare Worker Bundle (حضّر حزمة العامل)</button>
        <button type="button" className="secondary-button" onClick={() => receiptInput.current?.click()}>
          Import Worker Receipt (استورد إيصال العامل)
        </button>
        <input
          ref={receiptInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => void handleReceiptFile(event.target.files?.[0])}
        />
      </div>

      <div className="worker-status-grid">
        <div>
          <span>آخر Bundle (حزمة)</span>
          <strong>{lastBundle ? lastBundle.jobId : 'لا يوجد'}</strong>
          <small>{lastBundle ? `تنتهي: ${new Date(lastBundle.expiresAt).toLocaleTimeString('ar')}` : 'يتم Claim يدويًا لمدة تصل إلى 5 دقائق.'}</small>
        </div>
        <div>
          <span>آخر Receipt (إيصال)</span>
          <strong>{lastReceipt ? lastReceipt.jobId : 'لا يوجد'}</strong>
          <small>{lastReceipt ? `الحالة: ${lastReceipt.status}` : 'لا يُقبل إلا إذا طابق Lease الحالي قبل انتهائه.'}</small>
        </div>
      </div>

      <p className="worker-warning">
        Security Boundary (حد الأمان): Offline File ليس Authentication (مصادقة) شبكية. امتلاك Bundle يعني امتلاك Lease Token المؤقت، لذلك تعامل معه كملف حساس واحذفه بعد الاستخدام. Phase 9C ستضيف Transport/Auth Adapter (موصل النقل والمصادقة) منفصلًا دون تغيير هذا البروتوكول.
      </p>
    </section>
  )
}
