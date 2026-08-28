import { useEffect, useMemo, useState } from 'react'
import {
  buildLinearTeamWorkflow,
  clearWorkflowRuns,
  createWorkflowRun,
  decideWorkflowApproval,
  deleteWorkflow,
  loadWorkflowRuns,
  loadWorkflows,
  runWorkflowUntilPause,
  saveWorkflow,
  type WorkflowRun,
} from '../core/workflowEngine'
import { executeWorkflowAgent } from '../core/workflowAgentExecutor'
import type { AgentSpec } from '../core/types'

interface Props {
  agents: AgentSpec[]
  onNotice: (message: string) => void
}

const MAX_TEAM_AGENTS = 6

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ar', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function runStatusLabel(status: WorkflowRun['status']): string {
  if (status === 'ready') return 'جاهز/قابل للاستئناف'
  if (status === 'running') return 'قيد التشغيل'
  if (status === 'waiting_approval') return 'بانتظار الموافقة'
  if (status === 'success') return 'مكتمل'
  if (status === 'blocked') return 'موقوف بالسياسة'
  return 'فشل'
}

function friendlyWorkflowError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    WORKFLOW_TEAM_REQUIRES_TWO_AGENTS: 'يلزم Agentان (وكيلان) مختلفان على الأقل لإنشاء Multi-Agent Workflow (سير عمل متعدد الوكلاء).',
    WORKFLOW_TEAM_TOO_LARGE: 'الحد الحالي للفريق هو 6 وكلاء لحماية موارد الهاتف.',
    WORKFLOW_INPUT_REQUIRED: 'اكتب المهمة الأصلية قبل تشغيل Workflow (سير العمل).',
    WORKFLOW_NOT_WAITING_FOR_APPROVAL: 'لا توجد عقدة موافقة معلقة لهذا التشغيل.',
  }
  return labels[message] ?? `Workflow Error (خطأ سير العمل): ${message}`
}

export default function WorkflowCenter({ agents, onNotice }: Props) {
  const [workflows, setWorkflows] = useState(() => loadWorkflows())
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(() => loadWorkflows()[0]?.id ?? '')
  const [runs, setRuns] = useState<WorkflowRun[]>(() => loadWorkflowRuns())
  const [workflowName, setWorkflowName] = useState('فريق الوكلاء')
  const [teamAgentIds, setTeamAgentIds] = useState<string[]>(() => agents.slice(0, 2).map((agent) => agent.id))
  const [approvalBetween, setApprovalBetween] = useState(true)
  const [input, setInput] = useState('حل المهمة على مراحل، وراجع ناتج كل وكيل قبل تسليمه للوكيل التالي.')
  const [isRunning, setIsRunning] = useState(false)

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [workflows, selectedWorkflowId],
  )
  const selectedRuns = useMemo(
    () => selectedWorkflow ? runs.filter((run) => run.workflowId === selectedWorkflow.id) : [],
    [runs, selectedWorkflow],
  )
  const activeRun = selectedRuns[0] ?? null

  useEffect(() => {
    setTeamAgentIds((current) => {
      const valid = current.filter((id) => agents.some((agent) => agent.id === id))
      if (valid.length >= 2) return valid.slice(0, MAX_TEAM_AGENTS)
      const additions = agents.map((agent) => agent.id).filter((id) => !valid.includes(id))
      return [...valid, ...additions].slice(0, Math.min(2, agents.length))
    })
  }, [agents])

  function refreshRuns(workflowId?: string) {
    setRuns(loadWorkflowRuns())
    if (workflowId) setSelectedWorkflowId(workflowId)
  }

  function updateTeamSlot(index: number, agentId: string) {
    setTeamAgentIds((current) => current.map((value, slot) => slot === index ? agentId : value))
  }

  function addTeamSlot() {
    if (teamAgentIds.length >= MAX_TEAM_AGENTS) {
      onNotice('الحد الحالي 6 Agents (وكلاء) في Workflow واحد لحماية موارد الهاتف.')
      return
    }
    const nextAgent = agents.find((agent) => !teamAgentIds.includes(agent.id))
    if (!nextAgent) {
      onNotice('لا يوجد Agent إضافي غير مستخدم. أنشئ وكيلاً جديداً أولاً.')
      return
    }
    setTeamAgentIds((current) => [...current, nextAgent.id])
  }

  function removeTeamSlot(index: number) {
    setTeamAgentIds((current) => current.filter((_, slot) => slot !== index))
  }

  function moveTeamSlot(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= teamAgentIds.length) return
    setTeamAgentIds((current) => {
      const copy = [...current]
      ;[copy[index], copy[target]] = [copy[target], copy[index]]
      return copy
    })
  }

  function handleCreateWorkflow() {
    try {
      const workflow = buildLinearTeamWorkflow(workflowName, teamAgentIds, approvalBetween)
      const next = saveWorkflow(workflow)
      setWorkflows(next)
      setSelectedWorkflowId(workflow.id)
      refreshRuns(workflow.id)
      onNotice(`تم إنشاء Workflow (سير العمل) من ${teamAgentIds.length} Agents (وكلاء) مع DAG + Checkpoints (نقاط حفظ)، بتكلفة إلزامية 0$.`)
    } catch (error) {
      onNotice(friendlyWorkflowError(error))
    }
  }

  function handleDeleteWorkflow() {
    if (!selectedWorkflow) return
    clearWorkflowRuns(selectedWorkflow.id)
    const next = deleteWorkflow(selectedWorkflow.id)
    setWorkflows(next)
    setSelectedWorkflowId(next[0]?.id ?? '')
    setRuns(loadWorkflowRuns())
    onNotice('تم حذف Workflow (سير العمل) وCheckpoints (نقاط الحفظ) المحلية التابعة له.')
  }

  async function executeRun(run: WorkflowRun) {
    if (!selectedWorkflow) return
    setIsRunning(true)
    onNotice('Workflow يعمل محلياً. سيتوقف تلقائياً عند Human Approval Node (عقدة الموافقة البشرية) أو عند أي بوابة أمان.')
    try {
      const result = await runWorkflowUntilPause(selectedWorkflow, run, agents, executeWorkflowAgent)
      refreshRuns(selectedWorkflow.id)
      if (result.status === 'waiting_approval') {
        onNotice('توقف Workflow عند Checkpoint (نقطة حفظ) وينتظر موافقتك قبل Handoff (التسليم) التالي.')
      } else if (result.status === 'success') {
        onNotice('اكتمل Multi-Agent Workflow (سير العمل متعدد الوكلاء) بنجاح. التكلفة المسجلة 0$.')
      } else if (result.status === 'blocked' || result.status === 'failed') {
        onNotice(result.error || 'توقف Workflow بسبب بوابة أمان أو خطأ.')
      }
    } catch (error) {
      onNotice(friendlyWorkflowError(error))
    } finally {
      setIsRunning(false)
    }
  }

  async function handleNewRun() {
    if (!selectedWorkflow) {
      onNotice('أنشئ أو اختر Workflow (سير عمل) أولاً.')
      return
    }
    try {
      const run = createWorkflowRun(selectedWorkflow, input)
      refreshRuns(selectedWorkflow.id)
      await executeRun(run)
    } catch (error) {
      onNotice(friendlyWorkflowError(error))
    }
  }

  async function handleResume() {
    if (!activeRun || !selectedWorkflow) return
    if (activeRun.status === 'waiting_approval') {
      onNotice('هذا Checkpoint يحتاج قرار موافقة أولاً.')
      return
    }
    if (!['ready', 'running'].includes(activeRun.status)) {
      onNotice('هذا التشغيل انتهى. ابدأ Run (تشغيلاً) جديداً.')
      return
    }
    await executeRun(activeRun)
  }

  async function handleApproval(approved: boolean) {
    if (!activeRun || !selectedWorkflow) return
    try {
      const decided = decideWorkflowApproval(selectedWorkflow, activeRun, approved)
      refreshRuns(selectedWorkflow.id)
      if (!approved) {
        onNotice('رفضت Handoff (التسليم). أُوقف Workflow بأمان وحُفظ القرار في Checkpoint.')
        return
      }
      onNotice('تمت الموافقة. سيستأنف Workflow من Checkpoint المحفوظ.')
      await executeRun(decided)
    } catch (error) {
      onNotice(friendlyWorkflowError(error))
    }
  }

  function handleClearRuns() {
    if (!selectedWorkflow) return
    clearWorkflowRuns(selectedWorkflow.id)
    refreshRuns(selectedWorkflow.id)
    onNotice('تم مسح Workflow Runs (سجلات سير العمل) لهذا Workflow فقط.')
  }

  return (
    <section className="card workflow-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 4 — Workflows & Multi-Agent (سير العمل وتعدد الوكلاء)</p>
          <h2>Team Workflow (سير عمل فريق)</h2>
        </div>
        <span className="safe-pill">DAG · 0$</span>
      </div>

      <p className="disclaimer">
        هذه النسخة تشغّل Agents (الوكلاء) بالتتابع داخل DAG بلا دورات، وتحفظ Checkpoint بعد كل عقدة. Handoff ينقل النتيجة العملية فقط؛ Automatic Tool Calls (استدعاءات الأدوات التلقائية) ممنوعة في الأساس الحالي.
      </p>

      <div className="workflow-builder">
        <label>
          Workflow Name (اسم سير العمل)
          <input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} maxLength={120} />
        </label>

        <strong className="mini-title">Agent Order (ترتيب الوكلاء)</strong>
        {teamAgentIds.map((agentId, index) => (
          <div className="workflow-agent-slot" key={`${index}-${agentId}`}>
            <span>{index + 1}</span>
            <select value={agentId} onChange={(event) => updateTeamSlot(index, event.target.value)}>
              <option value="">اختر Agent (وكيلاً)</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id} disabled={teamAgentIds.includes(agent.id) && agent.id !== agentId}>
                  {agent.name}
                </option>
              ))}
            </select>
            <button className="text-button" type="button" onClick={() => moveTeamSlot(index, -1)} disabled={index === 0}>↑</button>
            <button className="text-button" type="button" onClick={() => moveTeamSlot(index, 1)} disabled={index === teamAgentIds.length - 1}>↓</button>
            <button className="danger-button" type="button" onClick={() => removeTeamSlot(index)} disabled={teamAgentIds.length <= 2}>×</button>
          </div>
        ))}

        <div className="workflow-builder-actions">
          <button className="text-button" type="button" onClick={addTeamSlot} disabled={agents.length <= teamAgentIds.length || teamAgentIds.length >= MAX_TEAM_AGENTS}>+ Agent</button>
          <label className="workflow-check">
            <input type="checkbox" checked={approvalBetween} onChange={(event) => setApprovalBetween(event.target.checked)} />
            Human Approval (موافقة بشرية) بين كل Agent وآخر
          </label>
        </div>

        <button className="primary-button" type="button" disabled={teamAgentIds.length < 2} onClick={handleCreateWorkflow}>
          + إنشاء Workflow (سير العمل)
        </button>
      </div>

      {workflows.length > 0 && (
        <div className="workflow-registry">
          <div className="card-heading compact-heading">
            <strong>Workflow Registry (سجل سير العمل)</strong>
            <span className="count-pill">{workflows.length}</span>
          </div>
          <select value={selectedWorkflowId} onChange={(event) => { setSelectedWorkflowId(event.target.value); setRuns(loadWorkflowRuns()) }}>
            {workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}
          </select>
          {selectedWorkflow && (
            <div className="workflow-facts">
              <span>Nodes (العقد): {selectedWorkflow.nodes.length}</span>
              <span>Agents: {selectedWorkflow.nodes.filter((node) => node.kind === 'agent').length}</span>
              <span>Approval Nodes: {selectedWorkflow.nodes.filter((node) => node.kind === 'approval').length}</span>
              <span>Max Steps: {selectedWorkflow.limits.maxSteps}</span>
            </div>
          )}
        </div>
      )}

      {selectedWorkflow && (
        <div className="workflow-console">
          <label>
            Original Task (المهمة الأصلية)
            <textarea rows={4} value={input} onChange={(event) => setInput(event.target.value)} maxLength={8000} />
          </label>
          <div className="workflow-run-actions">
            <button className="run-button" type="button" disabled={isRunning || !input.trim()} onClick={handleNewRun}>▶ New Team Run (تشغيل فريق جديد)</button>
            {activeRun && ['ready', 'running'].includes(activeRun.status) && (
              <button className="primary-button" type="button" disabled={isRunning} onClick={handleResume}>↻ Resume Checkpoint (استئناف)</button>
            )}
            <button className="danger-button" type="button" disabled={isRunning} onClick={handleDeleteWorkflow}>حذف Workflow</button>
          </div>
        </div>
      )}

      {activeRun?.status === 'waiting_approval' && (
        <div className="approval-box" role="alert">
          <strong>Human Approval Node (عقدة موافقة بشرية)</strong>
          <p>تم حفظ Checkpoint. راجع آخر Agent Output (نتيجة الوكيل) قبل التسليم للوكيل التالي.</p>
          <pre>{activeRun.previousOutput}</pre>
          <div className="approval-actions">
            <button className="primary-button" type="button" disabled={isRunning} onClick={() => handleApproval(true)}>✓ موافقة واستئناف</button>
            <button className="danger-button" type="button" disabled={isRunning} onClick={() => handleApproval(false)}>✕ رفض وإيقاف</button>
          </div>
        </div>
      )}

      <div className="tool-log-heading">
        <strong>Workflow Run Log (سجل سير العمل)</strong>
        {selectedRuns.length > 0 && <button className="text-button" type="button" onClick={handleClearRuns}>مسح السجل</button>}
      </div>

      {selectedRuns.length === 0 ? (
        <p className="empty-state">لا توجد Team Runs (تشغيلات فريق) لهذا Workflow بعد.</p>
      ) : (
        <div className="workflow-runs">
          {selectedRuns.slice(0, 6).map((run) => (
            <article className="workflow-run" key={run.id}>
              <div className="run-meta">
                <span className={`status status-${run.status === 'success' ? 'success' : run.status === 'blocked' ? 'blocked' : 'failed'}`}>{runStatusLabel(run.status)}</span>
                <span>{formatDate(run.updatedAt)}</span>
                <span>{run.stepCount} steps</span>
                <span>التكلفة ${run.monetaryCostUsd.toFixed(2)}</span>
              </div>
              <strong>{run.originalInput}</strong>
              {run.error && <pre>{run.error}</pre>}
              <details>
                <summary>Steps & Handoffs (الخطوات والتسليمات)</summary>
                <div className="workflow-step-list">
                  {run.steps.map((step, index) => (
                    <div className="workflow-step" key={`${step.nodeId}-${index}`}>
                      <strong>{index + 1}. {step.label}</strong>
                      <span>{step.nodeKind} · {step.status}</span>
                      {step.output && <pre>{step.output}</pre>}
                      {step.error && <pre>{step.error}</pre>}
                    </div>
                  ))}
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
