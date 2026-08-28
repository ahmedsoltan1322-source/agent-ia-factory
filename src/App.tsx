import { FormEvent, useMemo, useState } from 'react'
import { createDefaultAgent } from './core/createAgent'
import { LocalDemoRuntimeAdapter } from './core/runtime'
import { clearRuns, deleteAgent, loadAgents, loadRuns, saveAgent, saveRun } from './core/storage'
import type { AgentSpec, RunRecord } from './core/types'

const runtime = new LocalDemoRuntimeAdapter()

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ar', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function statusLabel(status: RunRecord['status']): string {
  if (status === 'success') return 'ناجح'
  if (status === 'blocked') return 'ممنوع بالسياسة'
  return 'فشل'
}

export default function App() {
  const [agents, setAgents] = useState<AgentSpec[]>(() => loadAgents())
  const [runs, setRuns] = useState<RunRecord[]>(() => loadRuns())
  const [selectedAgentId, setSelectedAgentId] = useState<string>(() => loadAgents()[0]?.id ?? '')
  const [name, setName] = useState('وكيل التجربة')
  const [instructions, setInstructions] = useState('نفذ المهمة بأمان، لا تدفع أي مبلغ، ولا تتجاوز الصلاحيات.')
  const [task, setTask] = useState('اختبر دورة تشغيل الوكيل وأعطني حالة التنفيذ.')
  const [isRunning, setIsRunning] = useState(false)
  const [notice, setNotice] = useState('')

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )

  function handleCreateAgent(event: FormEvent) {
    event.preventDefault()
    const agent = createDefaultAgent(name, instructions)
    setAgents(saveAgent(agent))
    setSelectedAgentId(agent.id)
    setNotice(`تم إنشاء Agent (الوكيل): ${agent.name}`)
  }

  function handleDeleteAgent(agentId: string) {
    const next = deleteAgent(agentId)
    setAgents(next)
    if (selectedAgentId === agentId) {
      setSelectedAgentId(next[0]?.id ?? '')
    }
    setNotice('تم حذف الوكيل من الهاتف.')
  }

  async function handleRun() {
    if (!selectedAgent) {
      setNotice('أنشئ Agent (وكيلاً) أو اختر وكيلاً أولاً.')
      return
    }

    setIsRunning(true)
    setNotice('جاري فحص Policy Engine (محرك السياسات) ثم التشغيل المحلي...')
    try {
      const run = await runtime.execute(selectedAgent, { task })
      setRuns(saveRun(run))
      setNotice(run.status === 'success' ? 'اكتمل Run (التشغيل) بنجاح وتكلفته 0$.' : run.output || run.error || 'انتهى التشغيل.')
    } finally {
      setIsRunning(false)
    }
  }

  function handleClearRuns() {
    clearRuns()
    setRuns([])
    setNotice('تم مسح سجل التشغيل المحلي.')
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Agent IA Factory</p>
          <h1>مصنع وكلاء الذكاء الاصطناعي</h1>
          <p className="subtitle">Phase 1 (المرحلة الأولى) — Mobile-First (الهاتف أولاً) وZero-Cost-First (المجاني أولاً)</p>
        </div>
        <div className="cost-badge" aria-label="التكلفة الحالية">
          <span>التكلفة</span>
          <strong>$0.00</strong>
        </div>
      </header>

      <main className="layout">
        {notice && <div className="notice" role="status">{notice}</div>}

        <section className="card">
          <div className="card-heading">
            <div>
              <p className="section-kicker">Agent Builder (منشئ الوكلاء)</p>
              <h2>أنشئ أول وكيل من الهاتف</h2>
            </div>
            <span className="safe-pill">0$ إلزامي</span>
          </div>

          <form onSubmit={handleCreateAgent} className="form-grid">
            <label>
              اسم Agent (الوكيل)
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
            </label>
            <label>
              Instructions (التعليمات)
              <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={4} />
            </label>
            <button className="primary-button" type="submit">+ إنشاء Agent (وكيل)</button>
          </form>
        </section>

        <section className="card">
          <div className="card-heading">
            <div>
              <p className="section-kicker">Agent Registry (سجل الوكلاء)</p>
              <h2>وكلاؤك</h2>
            </div>
            <span className="count-pill">{agents.length}</span>
          </div>

          {agents.length === 0 ? (
            <p className="empty-state">لا يوجد وكلاء بعد. أنشئ أول Agent (وكيل) من الأعلى.</p>
          ) : (
            <div className="agent-list">
              {agents.map((agent) => (
                <article className={`agent-item ${agent.id === selectedAgentId ? 'selected' : ''}`} key={agent.id}>
                  <button className="agent-select" type="button" onClick={() => setSelectedAgentId(agent.id)}>
                    <strong>{agent.name}</strong>
                    <small>Runtime (محرك التشغيل): {agent.runtime.adapter} · الحد المالي: ${agent.budgetPolicy.maxMonetarySpendUsd}</small>
                  </button>
                  <button className="danger-button" type="button" onClick={() => handleDeleteAgent(agent.id)} aria-label={`حذف ${agent.name}`}>حذف</button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="card runner-card">
          <div className="card-heading">
            <div>
              <p className="section-kicker">Run Console (لوحة التشغيل)</p>
              <h2>{selectedAgent ? selectedAgent.name : 'اختر وكيلاً'}</h2>
            </div>
            <span className="local-pill">Local (محلي)</span>
          </div>

          <label>
            Task (المهمة)
            <textarea value={task} onChange={(event) => setTask(event.target.value)} rows={4} />
          </label>

          <div className="policy-grid">
            <div><span>Paid Models (نماذج مدفوعة)</span><strong>ممنوعة</strong></div>
            <div><span>External Tools (أدوات خارجية)</span><strong>ممنوعة افتراضياً</strong></div>
            <div><span>Maximum Spend (أقصى إنفاق)</span><strong>$0</strong></div>
            <div><span>Storage (التخزين)</span><strong>على الهاتف</strong></div>
          </div>

          <button className="run-button" type="button" disabled={!selectedAgent || isRunning} onClick={handleRun}>
            {isRunning ? 'جاري التشغيل...' : '▶ تشغيل Agent (الوكيل)'}
          </button>

          <p className="disclaimer">المحرك الحالي Local Demo Runtime (محرك محلي تجريبي) لا يدّعي أنه LLM (نموذج لغوي). هدفه إثبات دورة الوكيل والأمان والتكلفة قبل تركيب نموذج ذكاء محلي.</p>
        </section>

        <section className="card">
          <div className="card-heading">
            <div>
              <p className="section-kicker">Run Log (سجل التشغيل)</p>
              <h2>آخر العمليات</h2>
            </div>
            {runs.length > 0 && <button className="text-button" type="button" onClick={handleClearRuns}>مسح السجل</button>}
          </div>

          {runs.length === 0 ? (
            <p className="empty-state">لا توجد عمليات تشغيل بعد.</p>
          ) : (
            <div className="run-list">
              {runs.map((run) => (
                <article className="run-item" key={run.id}>
                  <div className="run-meta">
                    <span className={`status status-${run.status}`}>{statusLabel(run.status)}</span>
                    <span>{formatDate(run.finishedAt)}</span>
                    <span>التكلفة ${run.monetaryCostUsd.toFixed(2)}</span>
                  </div>
                  <strong>{run.task}</strong>
                  <pre>{run.output || run.error}</pre>
                  <details>
                    <summary>Policy Checks (فحوص السياسات)</summary>
                    <ul>{run.policyChecks.map((check) => <li key={check}>{check}</li>)}</ul>
                  </details>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="card install-card">
          <p className="section-kicker">Phone-Only Mode (وضع الهاتف فقط)</p>
          <h2>ثبّت المصنع على شاشة هاتفك</h2>
          <p>على iPhone: افتح الموقع في Safari (سفاري) ← زر المشاركة ← Add to Home Screen (إضافة إلى الشاشة الرئيسية).</p>
        </section>
      </main>
    </div>
  )
}
