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
    if (selectedAgentId === agentId) {
      setSelectedAgentId(next[0]?.id ?? '')
    }
    setNotice('تم حذف الوكيل من الهاتف. ذاكرته الطويلة تبقى حتى تحذفها صراحة من Memory & Knowledge (الذاكرة والمعرفة).')
  }

  async function handleLoadLocalAi() {
    if (!webGpuAvailable) {
      setModelState('error')
      setNotice('WebGPU (تسريع الرسوميات في المتصفح) غير متاح؛ استعمل Local Demo حالياً.')
      return
    }

    setModelState('loading')
    setModelProgress({})
    setNotice('بدأ تنزيل Local AI (الذكاء المحلي). لن يبدأ هذا التنزيل تلقائياً في المستقبل دون اختيارك.')

    try {
      await localModelClient.load((progress) => setModelProgress(progress))
      setModelState('ready')
      setNotice('Local AI (الذكاء المحلي) جاهز. التوليد يتم داخل جهازك وتكلفة النموذج 0$.')
    } catch (error) {
      setModelState('error')
      setNotice(friendlyModelError(error))
    }
  }

  async function handleRun() {
    if (!selectedAgent) {
      setNotice('أنشئ Agent (وكيلاً) أو اختر وكيلاً أولاً.')
      return
    }

    if (selectedAgent.runtime.adapter === 'local-qwen-webgpu' && !localModelClient.isReady()) {
      setNotice('هذا الوكيل يستعمل Local AI (ذكاء محلي). حمّل النموذج أولاً من بطاقة Local AI.')
      return
    }

    const originalTask = task.trim()
    if (!originalTask) {
      setNotice('اكتب Task (المهمة) أولاً.')
      return
    }

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
          <p className="subtitle">Phase 8 (المرحلة الثامنة) — Evals & Observability (التقييم والمراقبة) فوق Agent Factory وSafe Browser وWorkflows/Multi-Agent وZero-Cost-First</p>
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
            <button className="primary-button" type="submit">+ إنشاء Agent (وكيل)</button>
          </form>
        </section>

        <section className="card ai-card">
          <div className="card-heading">
            <div>
              <p className="section-kicker">Local AI (الذكاء المحلي)</p>
              <h2>Qwen3 0.6B على جهازك</h2>
            </div>
            <span className={modelState === 'ready' ? 'safe-pill' : 'local-pill'}>
              {modelState === 'ready' ? 'جاهز' : modelState === 'loading' ? 'جاري التحميل' : 'اختياري'}
            </span>
          </div>

          <div className="local-ai-facts">
            <div><span>WebGPU (تسريع المتصفح)</span><strong>{webGpuAvailable ? 'متاح' : 'غير متاح'}</strong></div>
            <div><span>Engine (المحرك)</span><strong>WebLLM 0.2.82</strong></div>
            <div><span>Model (النموذج)</span><strong>Qwen3‑0.6B q4f16_1</strong></div>
            <div><span>VRAM (الذاكرة الرسومية المقدرة)</span><strong>≈ 1.4 GB</strong></div>
            <div><span>Download (التنزيل)</span><strong>مئات MB — مرة أولى</strong></div>
            <div><span>تكلفة النموذج</span><strong>$0</strong></div>
          </div>

          {modelState === 'loading' && (
            <div className="progress-wrap" aria-live="polite">
              <div className="progress-track"><div className="progress-fill" style={{ width: `${percent ?? 8}%` }} /></div>
              <small>{percent !== null ? `${percent.toFixed(0)}%` : modelProgress.status || 'جاري تجهيز ملفات النموذج...'}</small>
            </div>
          )}

          <button
            className="primary-button"
            type="button"
            disabled={!webGpuAvailable || modelState === 'loading' || modelState === 'ready'}
            onClick={handleLoadLocalAi}
          >
            {modelState === 'ready' ? '✓ Local AI جاهز' : modelState === 'loading' ? 'جاري التنزيل...' : '↓ Download Local AI (تنزيل الذكاء المحلي)'}
          </button>

          <p className="disclaimer">
            لن يبدأ تنزيل النموذج تلقائياً. الضغط على الزر هو موافقتك على تنزيل ملفات WebLLM/Qwen المفتوحة المصدر من مستودعاتها العامة. بعد التحميل، نص المهمة يُعالَج محلياً عبر WebGPU ولا يُرسل إلى API (واجهة برمجية) مدفوعة.
          </p>
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
            <p className="empty-state">لا يوجد وكلاء بعد. استعمل Agent Factory في الأعلى أو أنشئ وكيلاً يدوياً.</p>
          ) : (
            <div className="agent-list">
              {agents.map((agent) => (
                <article className={`agent-item ${agent.id === selectedAgentId ? 'selected' : ''}`} key={agent.id}>
                  <button className="agent-select" type="button" onClick={() => setSelectedAgentId(agent.id)}>
                    <strong>{agent.name}</strong>
                    <small>{runtimeLabel(agent.runtime.adapter)} · الحد المالي: ${agent.budgetPolicy.maxMonetarySpendUsd} · tools: {agent.toolPolicy.allowedTools.length}</small>
                  </button>
                  <button className="danger-button" type="button" onClick={() => handleDeleteAgent(agent.id)} aria-label={`حذف ${agent.name}`}>حذف</button>
                </article>
              ))}
            </div>
          )}
        </section>

        <MemoryKnowledgePanel
          agentId={selectedAgentId}
          sessionMemory={sessionMemory}
          revision={memoryRevision}
          onClearSession={handleClearSession}
          onNotice={setNotice}
        />

        <ToolCenter
          agent={selectedAgent}
          onAgentChange={handleAgentChange}
          onNotice={setNotice}
        />

        <WorkflowCenter agents={agents} onNotice={setNotice} />

        <section className="card runner-card">
          <div className="card-heading">
            <div>
              <p className="section-kicker">Run Console (لوحة التشغيل)</p>
              <h2>{selectedAgent ? selectedAgent.name : 'اختر وكيلاً'}</h2>
            </div>
            <span className="local-pill">Local RAG (استرجاع محلي)</span>
          </div>

          {selectedAgent && <p className="runtime-summary">{runtimeLabel(selectedAgent.runtime.adapter)}</p>}

          <label>
            Task (المهمة)
            <textarea value={task} onChange={(event) => setTask(event.target.value)} rows={4} />
          </label>

          <div className="policy-grid">
            <div><span>Paid Models (نماذج مدفوعة)</span><strong>ممنوعة</strong></div>
            <div><span>Automatic Tools (أدوات تلقائية)</span><strong>موقوفة في Security Baseline</strong></div>
            <div><span>Maximum Spend (أقصى إنفاق)</span><strong>$0</strong></div>
            <div><span>Tool Policy (سياسة الأدوات)</span><strong>Allowlist + Approval</strong></div>
          </div>

          <button className="run-button" type="button" disabled={!selectedAgent || isRunning} onClick={handleRun}>
            {isRunning ? 'جاري التشغيل...' : '▶ تشغيل Agent (الوكيل) مع الذاكرة'}
          </button>

          <p className="disclaimer">
            التشغيل يبقى اختياراً منفصلاً وتحت بوابات 0$ والأمان والموافقة البشرية. Phase 8 تضيف Evaluation (التقييم) وProduction Gate (بوابة الإنتاج) بعد التشغيل، ولا تمنح أدوات أو صلاحيات جديدة تلقائياً.
          </p>
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
