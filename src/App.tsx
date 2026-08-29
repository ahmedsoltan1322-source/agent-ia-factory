import { FormEvent, useMemo, useState } from 'react'
import FactoryCenter from './components/FactoryCenter'
import MemoryKnowledgePanel from './components/MemoryKnowledgePanel'
import ToolCenter from './components/ToolCenter'
import WorkflowCenter from './components/WorkflowCenter'
import { createDefaultAgent } from './core/createAgent'
import { localModelClient, isWebGpuAvailable, type LocalModelProgress, type LocalModelState } from './core/localModelClient'
import { LocalQwenWebGpuRuntimeAdapter } from './core/localQwenRuntime'
import {
  buildAugmentedTask,
  rememberSuccessfulRun,
  retrieveLocalContext,
  type SessionMemoryItem,
} from './core/memoryKnowledge'
import { LocalDemoRuntimeAdapter } from './core/runtime'
import { clearRuns, deleteAgent, loadAgents, loadRuns, saveAgent, saveRun } from './core/storage'
import type { AgentSpec, RunRecord, RuntimeAdapterId } from './core/types'

const demoRuntime = new LocalDemoRuntimeAdapter()
const qwenRuntime = new LocalQwenWebGpuRuntimeAdapter()

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

function runtimeLabel(runtime: RuntimeAdapterId): string {
  return runtime === 'local-qwen-webgpu'
    ? 'Qwen3 0.6B عبر WebLLM (ذكاء محلي حقيقي)'
    : 'Local Demo (محرك تجريبي محلي)'
}

function progressPercent(progress: LocalModelProgress): number | null {
  if (typeof progress.progress === 'number' && Number.isFinite(progress.progress)) {
    return Math.max(0, Math.min(100, progress.progress))
  }
  return null
}

function friendlyModelError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('WEBGPU_UNAVAILABLE')) {
    return 'WebGPU (تسريع الرسوميات في المتصفح) غير متاح على هذا الجهاز أو المتصفح.'
  }
  return `تعذر تحميل Local AI (الذكاء المحلي): ${message}`
}

export default function App() {
  const [agents, setAgents] = useState<AgentSpec[]>(() => loadAgents())
  const [runs, setRuns] = useState<RunRecord[]>(() => loadRuns())
  const [selectedAgentId, setSelectedAgentId] = useState<string>(() => loadAgents()[0]?.id ?? '')
  const [name, setName] = useState('وكيل التجربة')
  const [instructions, setInstructions] = useState('نفذ المهمة بأمان، لا تدفع أي مبلغ، ولا تتجاوز الصلاحيات.')
  const [runtimeChoice, setRuntimeChoice] = useState<RuntimeAdapterId>('local-demo')
  const [task, setTask] = useState('اختبر دورة تشغيل الوكيل وأعطني حالة التنفيذ.')
  const [isRunning, setIsRunning] = useState(false)
  const [notice, setNotice] = useState('')
  const [modelState, setModelState] = useState<LocalModelState>(() => localModelClient.isReady() ? 'ready' : 'idle')
  const [modelProgress, setModelProgress] = useState<LocalModelProgress>({})
  const [sessionMemoryByAgent, setSessionMemoryByAgent] = useState<Record<string, SessionMemoryItem[]>>({})
  const [memoryRevision, setMemoryRevision] = useState(0)

  const webGpuAvailable = useMemo(() => isWebGpuAvailable(), [])
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )
  const sessionMemory = selectedAgentId ? sessionMemoryByAgent[selectedAgentId] ?? [] : []
  const percent = progressPercent(modelProgress)

  function handleCreateAgent(event: FormEvent) {
    event.preventDefault()
    const agent = createDefaultAgent(name, instructions, runtimeChoice)
    setAgents(saveAgent(agent))
    setSelectedAgentId(agent.id)
    setNotice(`تم إنشاء Agent (الوكيل): ${agent.name}`)
  }

  function handleFactoryAgentsChange(next: AgentSpec[]) {
    setAgents(next)
    if (!selectedAgentId && next[0]) setSelectedAgentId(next[0].id)
  }

  function handleAgentChange(agent: AgentSpec) {
    setAgents(saveAgent(agent))
    setNotice('تم تحديث Tool Permissions (صلاحيات الأدوات) وحفظها محلياً لهذا الوكيل.')
  }

  function handleDeleteAgent(agentId: string) {
    const next = deleteAgent(agentId)
    setAgents(next)
    setSessionMemoryByAgent((current) => {
      const copy = { ...current }
      delete copy[agentId]
      return copy
    })
    if (selectedAgentId === agentId) setSelectedAgentId(next[0]?.id ?? '')
    setNotice('تم حذف Agent (الوكيل) محلياً من الهاتف.')
  }

  async function handleActivateLocalAi() {
    if (!webGpuAvailable) {
      setNotice('WebGPU غير متاح. سيبقى Local Demo (المحرك التجريبي المحلي) هو المسار الآمن الافتراضي.')
      return
    }
    setModelState('loading')
    setNotice('جاري تحميل Qwen3 0.6B محلياً إلى المتصفح. قد يكون التنزيل كبيراً، لكنه لا يستخدم API مدفوعة.')
    try {
      await localModelClient.load((progress) => {
        setModelProgress(progress)
      })
      setModelState('ready')
      setNotice('Local AI جاهز على الجهاز بتكلفة 0$. يمكنك الآن اختيار Qwen3 عند إنشاء Agent جديد.')
    } catch (error) {
      setModelState('error')
      setNotice(friendlyModelError(error))
    }
  }

  async function handleRun() {
    if (!selectedAgent || !task.trim()) return
    const originalTask = task.trim()
    const retrieved = retrieveLocalContext(selectedAgent.id, originalTask, 6)
    const augmentedTask = buildAugmentedTask(originalTask, sessionMemory, retrieved)

    setIsRunning(true)
    setNotice(`جاري فحص Policy Engine (محرك السياسات) والتشغيل المحلي مع ${retrieved.length} Context Hits (مقاطع سياق)...`)
    try {
      const runtime = selectedAgent.runtime.adapter === 'local-qwen-webgpu' ? qwenRuntime : demoRuntime
      const run = await runtime.execute(selectedAgent, { task: augmentedTask })
      const displayRun: RunRecord = {
        ...run,
        task: originalTask,
        policyChecks: [
          ...run.policyChecks,
          `local memory/RAG context hits: ${retrieved.length}`,
          'knowledge retrieval executed on-device',
          `allowed tool count: ${selectedAgent.toolPolicy.allowedTools.length}`,
          'automatic tool execution: disabled by factory security baseline',
        ],
      }
      setRuns(saveRun(displayRun))

      if (displayRun.status === 'success') {
        const sessionItem: SessionMemoryItem = {
          task: originalTask.slice(0, 900),
          output: displayRun.output.slice(0, 1_800),
          createdAt: new Date().toISOString(),
        }
        setSessionMemoryByAgent((current) => ({
          ...current,
          [selectedAgent.id]: [...(current[selectedAgent.id] ?? []), sessionItem].slice(-8),
        }))

        try {
          rememberSuccessfulRun(selectedAgent.id, originalTask, displayRun.output)
          setMemoryRevision((value) => value + 1)
        } catch {
          setNotice('اكتمل التشغيل بنجاح، لكن مساحة الذاكرة الطويلة المحلية لم تسمح بحفظ نسخة إضافية من النتيجة.')
          return
        }

        setNotice(`اكتمل Run (التشغيل) بنجاح بتكلفة 0$. استُرجع ${retrieved.length} مقطعاً محلياً وحُفظت النتيجة في الذاكرة.`)
      } else {
        setNotice(displayRun.output || displayRun.error || 'انتهى التشغيل.')
      }
    } finally {
      setIsRunning(false)
    }
  }

  function handleClearRuns() {
    clearRuns()
    setRuns([])
    setNotice('تم مسح سجل التشغيل المحلي.')
  }

  function handleClearSession() {
    if (!selectedAgentId) return
    setSessionMemoryByAgent((current) => ({
      ...current,
      [selectedAgentId]: [],
    }))
    setMemoryRevision((value) => value + 1)
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Agent IA Factory</p>
          <h1>مصنع وكلاء الذكاء الاصطناعي</h1>
          <p className="subtitle">Phase 10 (المرحلة العاشرة) — Ecosystem (النظام البيئي): قوالب موثقة، ثقة ناشرين، وسوق أدوات آمن فوق المصنع كاملًا وZero-Cost-First</p>
        </div>
        <div className="cost-badge" aria-label="التكلفة الحالية">
          <span>التكلفة</span>
          <strong>$0.00</strong>
        </div>
      </header>

      <main className="layout">
        {notice && <div className="notice" role="status">{notice}</div>}

        <FactoryCenter
          onAgentsChange={handleFactoryAgentsChange}
          onNotice={setNotice}
          localAiReady={modelState === 'ready' || localModelClient.isReady()}
        />

        <section className="card">
          <div className="card-heading">
            <div>
              <p className="section-kicker">Manual Agent Builder (منشئ الوكلاء اليدوي)</p>
              <h2>أنشئ وكيلاً يدويًا من الهاتف</h2>
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
            <label>
              Runtime (محرك التشغيل)
              <select value={runtimeChoice} onChange={(event) => setRuntimeChoice(event.target.value as RuntimeAdapterId)}>
                <option value="local-demo">Local Demo (محرك تجريبي محلي) — لا تنزيل</option>
                <option value="local-qwen-webgpu">Qwen3 0.6B (كيوِن 3) عبر WebLLM — تنزيل كبير اختياري</option>
              </select>
            </label>
            <button type="submit">أنشئ Agent (الوكيل)</button>
          </form>
        </section>

        <section className="card">
          <div className="card-heading">
            <div>
              <p className="section-kicker">Local AI (الذكاء المحلي)</p>
              <h2>Qwen3 0.6B اختياري على الجهاز</h2>
            </div>
            <span className="safe-pill">لا API · لا دفع</span>
          </div>
          <p className="muted">
            التنزيل لا يبدأ تلقائياً. اضغط الزر فقط إذا أردت تنزيل النموذج إلى Cache (ذاكرة التخزين) في المتصفح.
            على iPhone/Safari يبقى هذا المسار تجريبياً حتى نجتاز Benchmark (اختبار الأداء) على الجهاز الحقيقي.
          </p>
          <div className="model-state">
            <span>WebGPU: <strong>{webGpuAvailable ? 'متاح' : 'غير متاح'}</strong></span>
            <span>Model: <strong>{modelState}</strong></span>
            {percent !== null && <span>Progress: <strong>{percent.toFixed(0)}%</strong></span>}
          </div>
          {modelProgress.text && <p className="muted progress-text">{modelProgress.text}</p>}
          <button
            type="button"
            className="secondary"
            disabled={!webGpuAvailable || modelState === 'loading' || modelState === 'ready'}
            onClick={handleActivateLocalAi}
          >
            {modelState === 'ready' ? 'Local AI جاهز' : modelState === 'loading' ? 'جاري التحميل…' : 'حمّل Local AI بإرادتي'}
          </button>
        </section>

        <section className="card">
          <div className="card-heading">
            <div>
              <p className="section-kicker">Agent Registry (سجل الوكلاء)</p>
              <h2>الوكلاء المحفوظون على الهاتف</h2>
            </div>
            <span className="safe-pill">Local Storage (تخزين محلي)</span>
          </div>
          {agents.length === 0 ? (
            <p className="empty-state">لا يوجد Agent بعد. أنشئ أول وكيل بالأعلى.</p>
          ) : (
            <div className="agent-list">
              {agents.map((agent) => (
                <article key={agent.id} className={selectedAgentId === agent.id ? 'agent-item selected' : 'agent-item'}>
                  <button className="agent-select" type="button" onClick={() => setSelectedAgentId(agent.id)}>
                    <strong>{agent.name}</strong>
                    <span>{runtimeLabel(agent.runtime.adapter)}</span>
                    <span>الحد المالي: ${agent.budgetPolicy.maxMonetarySpendUsd.toFixed(2)}</span>
                  </button>
                  <button className="danger" type="button" onClick={() => handleDeleteAgent(agent.id)}>حذف</button>
                </article>
              ))}
            </div>
          )}
        </section>

        <ToolCenter agent={selectedAgent} onAgentChange={handleAgentChange} onNotice={setNotice} />

        <WorkflowCenter
          agents={agents}
          executeAgent={async (agent, workflowTask) => {
            const runtime = agent.runtime.adapter === 'local-qwen-webgpu' ? qwenRuntime : demoRuntime
            const run = await runtime.execute(agent, { task: workflowTask })
            setRuns(saveRun(run))
            return run
          }}
          onNotice={setNotice}
        />

        <MemoryKnowledgePanel
          agent={selectedAgent}
          sessionMemory={sessionMemory}
          onClearSession={handleClearSession}
          onNotice={setNotice}
          revision={memoryRevision}
        />

        <section className="card">
          <div className="card-heading">
            <div>
              <p className="section-kicker">Run (التشغيل)</p>
              <h2>شغّل Agent المحدد</h2>
            </div>
            <span className="safe-pill">Policy Gate (بوابة السياسة)</span>
          </div>
          <label>
            Task (المهمة)
            <textarea value={task} onChange={(event) => setTask(event.target.value)} rows={4} />
          </label>
          <button type="button" onClick={handleRun} disabled={!selectedAgent || isRunning}>
            {isRunning ? 'جاري التشغيل…' : 'شغّل محلياً'}
          </button>
          {!selectedAgent && <p className="empty-state">اختر Agent أولاً.</p>}
        </section>

        <section className="card">
          <div className="card-heading">
            <div>
              <p className="section-kicker">Run Log (سجل التشغيل)</p>
              <h2>ما حدث فعلاً</h2>
            </div>
            <button type="button" className="secondary" onClick={handleClearRuns}>مسح السجل</button>
          </div>
          {runs.length === 0 ? (
            <p className="empty-state">لا توجد عمليات تشغيل بعد.</p>
          ) : (
            <div className="run-list">
              {runs.map((run) => (
                <article className="run-item" key={run.id}>
                  <div className="run-topline">
                    <strong>{statusLabel(run.status)}</strong>
                    <span>{formatDate(run.createdAt)}</span>
                  </div>
                  <p>{run.output}</p>
                  <div className="run-meta">
                    <span>Runtime: {run.runtimeAdapter}</span>
                    <span>Cost: ${run.monetaryCostUsd.toFixed(2)}</span>
                    <span>Policy checks: {run.policyChecks.length}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
