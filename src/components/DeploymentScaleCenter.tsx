import { useMemo, useRef, useState } from 'react'
import {
  LOCAL_TENANT_ID,
  summarizeDurableQueue,
  type DurableJob,
} from '../core/deploymentEngine'
import {
  CLAIM_RATE_LIMIT,
  ENQUEUE_RATE_LIMIT,
  cancelLocalDurableJob,
  claimLocalDurableJob,
  completeLocalDurableJob,
  exportFactoryBackup,
  importFactoryBackup,
  loadDurableJobs,
  restoreFactoryBackup,
  enqueueLocalDurableJob,
} from '../core/deploymentStorage'
import type { AgentSpec } from '../core/types'

interface Props {
  agents: AgentSpec[]
  onNotice: (message: string) => void
}

function statusLabel(status: DurableJob['status']): string {
  if (status === 'pending') return 'في الطابور'
  if (status === 'leased') return 'محجوز للتنفيذ'
  if (status === 'retry_wait') return 'ينتظر إعادة المحاولة'
  if (status === 'succeeded') return 'مكتمل'
  if (status === 'failed') return 'فشل نهائي'
  return 'ملغى'
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

export default function DeploymentScaleCenter({ agents, onNotice }: Props) {
  const [jobs, setJobs] = useState<DurableJob[]>(() => loadDurableJobs())
  const [agentId, setAgentId] = useState(() => agents[0]?.id ?? '')
  const [task, setTask] = useState('نفّذ هذه المهمة عند بدء Worker (العامل) يدويًا.')
  const [activeLease, setActiveLease] = useState<{ jobId: string; token: string } | null>(null)
  const restoreInput = useRef<HTMLInputElement>(null)

  const summary = useMemo(() => summarizeDurableQueue(jobs, LOCAL_TENANT_ID), [jobs])

  function refresh(): void {
    setJobs(loadDurableJobs())
  }

  function handleEnqueue(): void {
    if (!agentId) {
      onNotice('أنشئ Agent (وكيلاً) أولاً قبل إضافة Durable Job (مهمة قابلة للاستئناف).')
      return
    }
    try {
      const idempotencyKey = `agent:${agentId}:${task.trim().slice(0, 80).replace(/[^A-Za-z0-9._:-]+/gu, '-').replace(/^-+|-+$/g, '') || 'task'}`.slice(0, 160)
      const result = enqueueLocalDurableJob({
        kind: 'agent_run',
        idempotencyKey,
        payload: { agentId, task },
      })
      setJobs(result.jobs)
      onNotice(result.deduplicated
        ? 'Idempotency (منع التكرار) أعادت نفس Job الموجودة؛ لم تُنشأ نسخة مكررة.'
        : 'تم حفظ Durable Job (المهمة القابلة للاستئناف) محليًا. لن تُشغّل تلقائيًا دون أمر بشري.')
    } catch (error) {
      onNotice(`تعذر إضافة Job (المهمة): ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function handleClaim(): void {
    try {
      const result = claimLocalDurableJob('phone-foreground-worker')
      setJobs(result.jobs)
      if (!result.claimed?.lease) {
        setActiveLease(null)
        onNotice('لا توجد Job جاهزة للاستئناف الآن.')
        return
      }
      setActiveLease({ jobId: result.claimed.id, token: result.claimed.lease.token })
      onNotice('تم Lease (حجز) المهمة التالية لمدة محدودة. هذا تجهيز يدوي فقط؛ لا يوجد Auto-Execution (تشغيل تلقائي) في Phase 9A.')
    } catch (error) {
      onNotice(`تعذر Claim (حجز) المهمة: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function handleComplete(ok: boolean): void {
    if (!activeLease) return
    try {
      const job = completeLocalDurableJob(
        activeLease.jobId,
        activeLease.token,
        ok ? { ok: true } : { ok: false, errorCode: 'MANUAL_RETRY' },
      )
      setActiveLease(null)
      refresh()
      onNotice(ok
        ? `تم تسجيل Job ${job.id} كمكتملة.`
        : `تم تسجيل محاولة فاشلة بأمان؛ الحالة الجديدة: ${statusLabel(job.status)}.`)
    } catch (error) {
      onNotice(`تعذر إغلاق Lease (الحجز): ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function handleCancel(jobId: string): void {
    try {
      setJobs(cancelLocalDurableJob(jobId))
      if (activeLease?.jobId === jobId) setActiveLease(null)
      onNotice('تم إلغاء Durable Job محليًا.')
    } catch (error) {
      onNotice(`تعذر إلغاء Job: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function handleBackup(): void {
    try {
      const backup = exportFactoryBackup()
      const stamp = new Date().toISOString().slice(0, 10)
      downloadJson(`agent-ia-factory-backup-${stamp}.json`, backup)
      onNotice('تم إنشاء Backup (نسخة احتياطية) محلية فقط. احتفظ بالملف في مكان آمن لأنه قد يحتوي محتوى ذاكرتك ومعرفتك.')
    } catch (error) {
      onNotice(`تعذر إنشاء Backup: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function handleRestoreFile(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      if (file.size > 4_000_000) throw new Error('BACKUP_FILE_TOO_LARGE')
      const raw = await file.text()
      const backup = importFactoryBackup(raw)
      const restored = restoreFactoryBackup(backup, 'merge')
      refresh()
      onNotice(`Restore (الاستعادة) نجحت بنمط Merge (دمج): ${restored} مفاتيح مصنع. لم يتم حذف البيانات الحالية غير الموجودة في النسخة.`)
    } catch (error) {
      onNotice(`رفض Restore (الاستعادة): ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (restoreInput.current) restoreInput.current.value = ''
    }
  }

  return (
    <section className="card deployment-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 9A — Deployment & Scale (النشر والتوسع)</p>
          <h2>Durable Jobs + Backup/Restore</h2>
        </div>
        <span className="safe-pill">0$ إلزامي</span>
      </div>

      <p className="deployment-disclosure">
        Phone-Local (محلي على الهاتف) الآن. Schema (المخطط) مفصول بـTenant (مساحة المستخدم) من اليوم، لكن لا ندّعي Multi-Tenant Runtime فعليًا قبل Self-Host Worker (عامل الاستضافة الذاتية). لا توجد Job تُنفذ تلقائيًا في Phase 9A.
      </p>

      <div className="deployment-facts">
        <div><span>Tenant Boundary (حدود المساحة)</span><strong>{LOCAL_TENANT_ID}</strong></div>
        <div><span>Queue (الطابور)</span><strong>{summary.total} Job</strong></div>
        <div><span>Pending / Retry</span><strong>{summary.pending + summary.retryWait}</strong></div>
        <div><span>Leased (محجوز)</span><strong>{summary.leased}</strong></div>
        <div><span>Enqueue Rate Limit</span><strong>{ENQUEUE_RATE_LIMIT.maxEvents} / 5 دقائق</strong></div>
        <div><span>Claim Rate Limit</span><strong>{CLAIM_RATE_LIMIT.maxEvents} / دقيقة</strong></div>
      </div>

      <div className="deployment-form">
        <label>
          Agent (الوكيل)
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            <option value="">اختر وكيلاً</option>
            {agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        <label>
          Durable Task (المهمة القابلة للاستئناف)
          <textarea value={task} onChange={(event) => setTask(event.target.value)} rows={3} maxLength={5_000} />
        </label>
        <div className="deployment-actions">
          <button className="primary-button" type="button" onClick={handleEnqueue}>+ أضف إلى Queue (الطابور)</button>
          <button className="text-button" type="button" onClick={handleClaim}>Claim Next (حضّر التالية)</button>
        </div>
      </div>

      {activeLease && (
        <div className="lease-banner">
          <strong>Lease Active (حجز نشط)</strong>
          <span>لا يعني أن Agent اشتغل؛ سجّل النتيجة فقط بعد تنفيذ المهمة فعليًا/اختبارها.</span>
          <div className="deployment-actions">
            <button className="primary-button" type="button" onClick={() => handleComplete(true)}>سجّل نجاح</button>
            <button className="danger-button" type="button" onClick={() => handleComplete(false)}>سجّل فشل/Retry</button>
          </div>
        </div>
      )}

      <div className="deployment-job-list">
        {jobs.length === 0 ? <p className="empty-state">لا توجد Durable Jobs بعد.</p> : jobs.slice(0, 12).map((job) => (
          <article className="deployment-job" key={job.id}>
            <div>
              <strong>{statusLabel(job.status)}</strong>
              <small>{job.kind} · attempts {job.attempts}/{job.maxAttempts} · $0</small>
            </div>
            <p>{job.payload.task}</p>
            {!['succeeded', 'failed', 'cancelled'].includes(job.status) && (
              <button className="text-button" type="button" onClick={() => handleCancel(job.id)}>إلغاء</button>
            )}
          </article>
        ))}
      </div>

      <div className="backup-panel">
        <div>
          <h3>Factory Backup (نسخة المصنع)</h3>
          <p>النسخة تُنشأ على جهازك فقط ولا تُرفع تلقائيًا. قد تحتوي Agents/Memory/Knowledge/Logs، لذلك عاملها كملف حساس.</p>
        </div>
        <div className="deployment-actions">
          <button className="primary-button" type="button" onClick={handleBackup}>↓ Export Backup (تصدير نسخة)</button>
          <button className="text-button" type="button" onClick={() => restoreInput.current?.click()}>↑ Restore Merge (استعادة بالدمج)</button>
          <input
            ref={restoreInput}
            className="deployment-file-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void handleRestoreFile(event.target.files?.[0])}
          />
        </div>
      </div>
    </section>
  )
}
