import { useEffect, useMemo, useState } from 'react'
import { localModelClient } from '../core/localModelClient'
import { AGENT_REGISTRY_EVENT, loadAgents } from '../core/storage'
import {
  clearTeamMemory,
  createWorkflow,
  deleteWorkflow,
  executeWorkflow,
  loadTeamMemory,
  loadWorkflowRuns,
  loadWorkflows,
  saveWorkflow,
  type WorkflowDefinition,
  type WorkflowMode,
  type WorkflowRun,
} from '../core/workflowCore'
import type { AgentSpec } from '../core/types'

interface Props {
  onNotice: (message: string) => void
}

function agentName(agents: AgentSpec[], id: string): string {
  return agents.find((agent) => agent.id === id)?.name ?? id
}

export default function WorkflowCenter({ onNotice }: Props) {
  const [agents, setAgents] = useState<AgentSpec[]>(() => loadAgents())
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>(() => loadWorkflows())
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(() => loadWorkflows()[0]?.id ?? '')
  const [name, setName] = useState('فريق العمل')
  const [mode, setMode] = useState<WorkflowMode>('sequential')
  const [supervisorId, setSupervisorId] = useState(() => loadAgents()[0]?.id ?? '')
  const [workerIds, setWorkerIds] = useState<string[]>([])
  const [task, setTask] = useState('حل المهمة كفريق، وزع العمل ثم اجمع النتيجة النهائية.')
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<WorkflowRun | null>(null)
  const [teamMemoryCount, setTeamMemoryCount] = useState(0)

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [workflows, selectedWorkflowId],
  )

  useEffect(() => {
    const refresh = () => {
      const next = loadAgents()
      setAgents(next)
      setSupervisorId((current) => current && next.some((agent) => agent.id === current) ? current : next[0]?.id ?? '')
      setWorkerIds((current) => current.filter((id) => next.some((agent) => agent.id === id)))
    }
    window.addEventListener(AGENT_REGISTRY_EVENT, refresh)
    return () => window.removeEventListener(AGENT_REGISTRY_EVENT, refresh)
  }, [])

  useEffect(() => {
    if (!selectedWorkflow) {
      setLastRun(null)
      setTeamMemoryCount(0)
      return
    }
    setLastRun(loadWorkflowRuns(selectedWorkflow.id)[0] ?? null)
    setTeamMemoryCount(loadTeamMemory(selectedWorkflow.id).length)
  }, [selectedWorkflowId, workflows])

  function toggleWorker(agentId: string) {
    setWorkerIds((current) => current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : current.length >= 4 ? current : [...current, agentId])
  }

  function handleCreate() {
    try {
      const workflow = createWorkflow(name, mode, supervisorId, workerIds)
      const next = saveWorkflow(workflow)
      setWorkflows(next)
      setSelectedWorkflowId(workflow.id)
      setWorkerIds([])
      onNotice(`تم إنشاء Workflow (سير العمل): ${workflow.name}. التكلفة القصوى للنماذج في هذا المشروع تبقى 0$.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onNotice(message.includes('SUPERVISOR') ? 'اختر Supervisor Agent (وكيلاً مشرفاً).' : 'اختر Worker Agent (وكيلاً عاملاً) واحداً على الأقل.')
    }
  }

  function handleDelete(workflowId: string) {
    const next = deleteWorkflow(workflowId)
    setWorkflows(next)
    setSelectedWorkflowId(next[0]?.id ?? '')
    onNotice('تم حذف Workflow (سير العمل). Team Memory تبقى مستقلة حتى تمسحها صراحة.')
  }

  async function handleRun() {
    if (!selectedWorkflow) return
    const participants = [selectedWorkflow.supervisorAgentId, ...selectedWorkflow.workerAgentIds]
      .map((id) => agents.find((agent) => agent.id === id))
      .filter((agent): agent is AgentSpec => Boolean(agent))

    const needsLocalAi = participants.some((agent) => agent.runtime.adapter === 'local-qwen-webgpu')
    if (needsLocalAi && !localModelClient.isReady()) {
      onNotice('هذا الفريق يحتوي Agent يستعمل Qwen/WebGPU. حمّل Local AI من البطاقة العليا أولاً، أو استعمل وكلاء Local Demo للاختبار.')
      return
    }

    setRunning(true)
    onNotice('بدأ Workflow Run (تشغيل الفريق): Supervisor planning → Workers → Handoffs → Final synthesis.')
    try {
      const result = await executeWorkflow(selectedWorkflow, agents, task)
      setLastRun(result)
      setTeamMemoryCount(loadTeamMemory(selectedWorkflow.id).length)
      onNotice(result.status === 'success'
        ? `اكتمل Workflow بنجاح. scheduling=${result.scheduling} · cost=$0.00 · handoffs=${result.handoffs.length}`
        : `انتهى Workflow بحالة ${result.status}: ${result.error ?? 'unknown error'}`)
    } finally {
      setRunning(false)
    }
  }

  function handleClearMemory() {
    if (!selectedWorkflow) return
    clearTeamMemory(selectedWorkflow.id)
    setTeamMemoryCount(0)
    onNotice('تم مسح Shared Team Memory (ذاكرة الفريق المشتركة) لهذا Workflow.')
  }

  return (
    <section className="card workflow-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 4 — Workflows & Multi-Agent</p>
          <h2>Workflow Center (مركز سير العمل)</h2>
        </div>
        <span className="safe-pill">0$ · max 4 workers</span>
      </div>

      <div className="workflow-builder">
        <label>اسم Workflow<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
        <label>Mode (الوضع)
          <select value={mode} onChange={(event) => setMode(event.target.value as WorkflowMode)}>
            <option value="sequential">Sequential (تسلسلي)</option>
            <option value="parallel">Parallel (متوازي منطقي آمن للهاتف)</option>
          </select>
        </label>
        <label>Supervisor Agent (الوكيل المشرف)
          <select value={supervisorId} onChange={(event) => { setSupervisorId(event.target.value); setWorkerIds((current) => current.filter((id) => id !== event.target.value)) }}>
            <option value="">— اختر —</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.runtime.adapter}</option>)}
          </select>
        </label>

        <div className="workflow-workers">
          <strong>Worker Agents (الوكلاء العاملون) — حتى 4</strong>
          {agents.filter((agent) => agent.id !== supervisorId).map((agent) => (
            <label className="worker-choice" key={agent.id}>
              <input type="checkbox" checked={workerIds.includes(agent.id)} onChange={() => toggleWorker(agent.id)} />
              <span>{agent.name}<small>{agent.runtime.adapter}</small></span>
            </label>
          ))}
          {agents.length < 2 && <p className="empty-state">أنشئ وكيلاً ثانيًا على الأقل لتكوين فريق.</p>}
        </div>
        <button className="primary-button" type="button" disabled={!supervisorId || workerIds.length === 0} onClick={handleCreate}>+ إنشاء Workflow</button>
      </div>

      {workflows.length > 0 && (
        <div className="workflow-list">
          {workflows.map((workflow) => (
            <article className={`workflow-item ${workflow.id === selectedWorkflowId ? 'selected' : ''}`} key={workflow.id}>
              <button className="agent-select" type="button" onClick={() => setSelectedWorkflowId(workflow.id)}>
                <strong>{workflow.name}</strong>
                <small>{workflow.mode} · Supervisor: {agentName(agents, workflow.supervisorAgentId)} · Workers: {workflow.workerAgentIds.length}</small>
              </button>
              <button className="danger-button" type="button" onClick={() => handleDelete(workflow.id)}>حذف</button>
            </article>
          ))}
        </div>
      )}

      {selectedWorkflow && (
        <div className="workflow-console">
          <div className="workflow-metrics">
            <div><span>Mode</span><strong>{selectedWorkflow.mode}</strong></div>
            <div><span>Workers</span><strong>{selectedWorkflow.workerAgentIds.length}</strong></div>
            <div><span>Team Memory</span><strong>{teamMemoryCount}</strong></div>
            <div><span>Maximum Spend</span><strong>$0</strong></div>
          </div>
          <label>Team Task (مهمة الفريق)<textarea rows={4} value={task} onChange={(event) => setTask(event.target.value)} /></label>
          <button className="run-button" type="button" disabled={running} onClick={handleRun}>{running ? 'جاري تشغيل الفريق...' : '▶ تشغيل Workflow (الفريق)'}</button>
          <button className="text-button" type="button" onClick={handleClearMemory}>مسح Shared Team Memory</button>
          <p className="disclaimer">Parallel مع Local Demo يمكن أن يُجدول بالتوازي فعلياً. إذا استعمل الفريق Qwen/WebGPU، يأخذ العمال نفس snapshot لكن التوليد يُسلسل لحماية ذاكرة الهاتف.</p>
        </div>
      )}

      {lastRun && (
        <div className="workflow-result">
          <div className="run-meta"><span>{lastRun.status}</span><span>{lastRun.scheduling}</span><span>cost $0.00</span><span>{lastRun.handoffs.length} handoffs</span></div>
          <strong>Final Output (النتيجة النهائية)</strong>
          <pre>{lastRun.finalOutput || lastRun.error}</pre>
          <details><summary>Steps (المراحل) — {lastRun.steps.length}</summary>
            <div className="workflow-step-list">{lastRun.steps.map((step) => <div key={step.id}><strong>{step.stage} · {agentName(agents, step.agentId)} · {step.status}</strong><pre>{step.output || step.error}</pre></div>)}</div>
          </details>
          <details><summary>Handoffs (التسليمات) — {lastRun.handoffs.length}</summary>
            <ul>{lastRun.handoffs.map((handoff) => <li key={handoff.id}>{agentName(agents, handoff.fromAgentId)} → {agentName(agents, handoff.toAgentId)} · {handoff.stage}</li>)}</ul>
          </details>
        </div>
      )}
    </section>
  )
}
