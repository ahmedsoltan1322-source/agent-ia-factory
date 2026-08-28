import { useMemo, useState } from 'react'
import {
  clearTeamMemory,
  clearWorkflowRuns,
  createTeam,
  deleteTeam,
  loadTeamMemory,
  loadTeams,
  loadWorkflowRuns,
  runTeamWorkflow,
  saveTeam,
  validateTeam,
  type TeamSpec,
  type WorkflowMode,
  type WorkflowRunRecord,
} from '../core/workflowEngine'
import type { AgentSpec } from '../core/types'

interface Props {
  agents: AgentSpec[]
  onNotice: (message: string) => void
}

function modeLabel(mode: WorkflowMode): string {
  return mode === 'parallel' ? 'Parallel (متوازي)' : 'Sequential (تسلسلي)'
}

function actualModeLabel(mode: WorkflowRunRecord['actualExecution']): string {
  if (mode === 'parallel') return 'Parallel فعلي (متوازي)'
  if (mode === 'queued_for_phone_safety') return 'Queue for Phone Safety (طابور لحماية الهاتف)'
  return 'Sequential (تسلسلي)'
}

function statusLabel(status: WorkflowRunRecord['status']): string {
  if (status === 'success') return 'ناجح'
  if (status === 'partial') return 'جزئي'
  if (status === 'blocked') return 'ممنوع'
  return 'فشل'
}

function agentName(agents: AgentSpec[], id: string): string {
  return agents.find((agent) => agent.id === id)?.name ?? id
}

export default function WorkflowCenter({ agents, onNotice }: Props) {
  const [teams, setTeams] = useState<TeamSpec[]>(() => loadTeams())
  const [selectedTeamId, setSelectedTeamId] = useState(() => loadTeams()[0]?.id ?? '')
  const [teamName, setTeamName] = useState('فريق الوكلاء')
  const [supervisorId, setSupervisorId] = useState(() => agents[0]?.id ?? '')
  const [workerIds, setWorkerIds] = useState<string[]>(() => agents[1] ? [agents[1].id] : [])
  const [mode, setMode] = useState<WorkflowMode>('sequential')
  const [sharedMemory, setSharedMemory] = useState(true)
  const [task, setTask] = useState('حل المهمة كفريق، ثم اجعل المشرف يراجع النتائج ويعطيني الجواب النهائي.')
  const [isRunning, setIsRunning] = useState(false)
  const [runs, setRuns] = useState<WorkflowRunRecord[]>(() => loadWorkflowRuns())
  const [revision, setRevision] = useState(0)

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [teams, selectedTeamId],
  )
  const teamRuns = useMemo(
    () => selectedTeam ? runs.filter((run) => run.teamId === selectedTeam.id) : [],
    [runs, selectedTeam],
  )
  const teamMemory = useMemo(
    () => selectedTeam ? loadTeamMemory(selectedTeam.id) : [],
    [selectedTeam, revision],
  )

  function toggleWorker(agentId: string) {
    setWorkerIds((current) => current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId].slice(0, 6))
  }

  function handleCreateTeam() {
    const safeWorkers = workerIds.filter((id) => id !== supervisorId).slice(0, 6)
    if (!supervisorId || safeWorkers.length === 0) {
      onNotice('الفريق يحتاج Supervisor Agent (وكيلاً مشرفاً) وWorker Agent (وكيلاً عاملاً) واحداً على الأقل.')
      return
    }
    const team = createTeam({
      name: teamName,
      supervisorAgentId: supervisorId,
      workerAgentIds: safeWorkers,
      mode,
      sharedMemory,
      maxSteps: Math.min(12, safeWorkers.length + 1),
    })
    const validation = validateTeam(team, agents)
    if (!validation.valid) {
      onNotice(`Team Validation (فحص الفريق) منع الحفظ: ${validation.errors.join(' | ')}`)
      return
    }
    const next = saveTeam(team)
    setTeams(next)
    setSelectedTeamId(team.id)
    setRevision((value) => value + 1)
    onNotice(`تم إنشاء Team (الفريق) «${team.name}» محلياً. عدد الوكلاء: ${safeWorkers.length + 1}، والتكلفة القصوى $0.`)
  }

  function handleDeleteTeam(teamId: string) {
    const next = deleteTeam(teamId)
    setTeams(next)
    setSelectedTeamId(next[0]?.id ?? '')
    setRuns(loadWorkflowRuns())
    setRevision((value) => value + 1)
    onNotice('تم حذف Team (الفريق) وShared Team Memory (ذاكرته المشتركة) من الهاتف.')
  }

  function updateSelectedTeam(patch: Partial<Pick<TeamSpec, 'mode' | 'sharedMemory'>>) {
    if (!selectedTeam) return
    const updated = { ...selectedTeam, ...patch }
    const validation = validateTeam(updated, agents)
    if (!validation.valid) {
      onNotice(`تعذر تحديث الفريق: ${validation.errors.join(' | ')}`)
      return
    }
    const next = saveTeam(updated)
    setTeams(next)
    setRevision((value) => value + 1)
  }

  async function handleRunWorkflow() {
    if (!selectedTeam) {
      onNotice('أنشئ Team (فريقاً) أو اختر فريقاً أولاً.')
      return
    }
    if (!task.trim()) {
      onNotice('اكتب Workflow Task (مهمة سير العمل) أولاً.')
      return
    }

    const validation = validateTeam(selectedTeam, agents)
    if (!validation.valid) {
      onNotice(`Workflow blocked (سير العمل ممنوع): ${validation.errors.join(' | ')}`)
      return
    }

    setIsRunning(true)
    onNotice(`بدأ ${modeLabel(selectedTeam.mode)} Workflow (سير العمل). لا توجد Automatic Tools/MCP (أدوات/MCP تلقائية) في Phase 4A.`)
    try {
      const result = await runTeamWorkflow({ team: selectedTeam, agents, task })
      setRuns(loadWorkflowRuns())
      setRevision((value) => value + 1)
      if (result.status === 'success') {
        onNotice(`اكتمل Team Workflow (سير عمل الفريق) بنجاح. التنفيذ الفعلي: ${actualModeLabel(result.actualExecution)} · التكلفة $0.`)
      } else if (result.status === 'partial') {
        onNotice(`اكتمل Workflow جزئياً. بعض الوكلاء فشلوا أو تعذر تشغيلهم؛ راجع النتائج والسجل. التكلفة $0.`)
      } else {
        onNotice(result.error || 'انتهى Workflow بدون نتيجة ناجحة.')
      }
    } finally {
      setIsRunning(false)
    }
  }

  function handleClearMemory() {
    if (!selectedTeam) return
    clearTeamMemory(selectedTeam.id)
    setRevision((value) => value + 1)
    onNotice('تم مسح Shared Team Memory (ذاكرة الفريق المشتركة) فقط.')
  }

  function handleClearRuns() {
    if (!selectedTeam) return
    clearWorkflowRuns(selectedTeam.id)
    setRuns(loadWorkflowRuns())
    onNotice('تم مسح Workflow Log (سجل سير العمل) لهذا الفريق.')
  }

  return (
    <section className="card workflow-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 4A · Workflows & Multi-Agent (سير العمل وتعدد الوكلاء)</p>
          <h2>Team Workflow Center (مركز سير عمل الفريق)</h2>
        </div>
        <span className="safe-pill">0$ · Local governance</span>
      </div>

      {agents.length < 2 ? (
        <p className="empty-state">أنشئ Agentين (وكيلين) على الأقل: Supervisor (مشرف) وWorker (عامل) لتكوين أول فريق.</p>
      ) : (
        <div className="workflow-builder">
          <label>
            Team Name (اسم الفريق)
            <input value={teamName} onChange={(event) => setTeamName(event.target.value)} maxLength={120} />
          </label>
          <label>
            Supervisor Agent (الوكيل المشرف)
            <select value={supervisorId} onChange={(event) => {
              const next = event.target.value
              setSupervisorId(next)
              setWorkerIds((current) => current.filter((id) => id !== next))
            }}>
              {agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}
            </select>
          </label>
          <label>
            Workflow Mode (نمط سير العمل)
            <select value={mode} onChange={(event) => setMode(event.target.value as WorkflowMode)}>
              <option value="sequential">Sequential (تسلسلي)</option>
              <option value="parallel">Parallel (متوازي)</option>
            </select>
          </label>
          <label className="trust-toggle workflow-memory-toggle">
            <input type="checkbox" checked={sharedMemory} onChange={(event) => setSharedMemory(event.target.checked)} />
            Shared Team Memory (ذاكرة مشتركة للفريق)
          </label>

          <div className="worker-picker">
            <strong>Worker Agents (الوكلاء العاملون) — حتى 6</strong>
            {agents.filter((agent) => agent.id !== supervisorId).map((agent) => (
              <label className="tool-permission" key={agent.id}>
                <input type="checkbox" checked={workerIds.includes(agent.id)} onChange={() => toggleWorker(agent.id)} />
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.runtime.adapter} · Max Spend $0</small>
                </span>
              </label>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={handleCreateTeam}>+ إنشاء Team (فريق)</button>
        </div>
      )}

      {teams.length > 0 && (
        <div className="team-list">
          <strong className="mini-title">Saved Teams (الفرق المحفوظة)</strong>
          {teams.map((team) => (
            <article className={`team-item ${team.id === selectedTeamId ? 'selected' : ''}`} key={team.id}>
              <button className="agent-select" type="button" onClick={() => setSelectedTeamId(team.id)}>
                <strong>{team.name}</strong>
                <small>Supervisor: {agentName(agents, team.supervisorAgentId)} · Workers: {team.workerAgentIds.length} · {modeLabel(team.mode)}</small>
              </button>
              <button className="danger-button" type="button" onClick={() => handleDeleteTeam(team.id)}>حذف</button>
            </article>
          ))}
        </div>
      )}

      {selectedTeam && (
        <div className="workflow-runner">
          <div className="workflow-team-summary">
            <div><span>Supervisor (المشرف)</span><strong>{agentName(agents, selectedTeam.supervisorAgentId)}</strong></div>
            <div><span>Workers (العمال)</span><strong>{selectedTeam.workerAgentIds.length}</strong></div>
            <div><span>Memory (الذاكرة)</span><strong>{selectedTeam.sharedMemory ? `مشتركة · ${teamMemory.length}` : 'موقوفة'}</strong></div>
            <div><span>Max Spend</span><strong>$0</strong></div>
          </div>

          <div className="workflow-controls">
            <label>
              Mode (النمط)
              <select value={selectedTeam.mode} onChange={(event) => updateSelectedTeam({ mode: event.target.value as WorkflowMode })}>
                <option value="sequential">Sequential (تسلسلي)</option>
                <option value="parallel">Parallel (متوازي)</option>
              </select>
            </label>
            <label className="trust-toggle">
              <input type="checkbox" checked={selectedTeam.sharedMemory} onChange={(event) => updateSelectedTeam({ sharedMemory: event.target.checked })} />
              Shared Memory (ذاكرة مشتركة)
            </label>
          </div>

          <label>
            Workflow Task (مهمة الفريق)
            <textarea rows={4} value={task} onChange={(event) => setTask(event.target.value)} />
          </label>

          <button className="run-button" type="button" disabled={isRunning} onClick={handleRunWorkflow}>
            {isRunning ? 'الفريق يعمل...' : '▶ تشغيل Team Workflow (سير عمل الفريق)'}
          </button>

          <p className="disclaimer">
            Parallel (متوازي) يعني استقلال مهام العمال. إذا دخل Qwen/WebGPU المحلي في الفريق، ينفذهم المصنع في Queue (طابور) واحد لحماية RAM/GPU الهاتف. لا Tool أو MCP يُستدعى تلقائياً في Phase 4A.
          </p>

          <div className="workflow-secondary-actions">
            {teamMemory.length > 0 && <button className="text-button" type="button" onClick={handleClearMemory}>مسح ذاكرة الفريق</button>}
            {teamRuns.length > 0 && <button className="text-button" type="button" onClick={handleClearRuns}>مسح سجل الفريق</button>}
          </div>
        </div>
      )}

      {teamRuns.length > 0 && (
        <div className="workflow-run-list">
          <strong className="mini-title">Workflow Log (سجل سير العمل)</strong>
          {teamRuns.slice(0, 8).map((run) => (
            <article className="workflow-run-item" key={run.id}>
              <div className="run-meta">
                <span className={`status status-${run.status === 'success' ? 'success' : run.status === 'blocked' ? 'blocked' : 'failed'}`}>{statusLabel(run.status)}</span>
                <span>{modeLabel(run.requestedMode)}</span>
                <span>{actualModeLabel(run.actualExecution)}</span>
                <span>$0.00</span>
              </div>
              <strong>{run.task}</strong>
              <div className="workflow-agent-results">
                {run.agentRuns.map((entry, index) => (
                  <details key={`${entry.agentId}-${index}`}>
                    <summary>{entry.role === 'supervisor' ? 'Supervisor (المشرف)' : `Worker ${index + 1} (العامل)`} — {agentName(agents, entry.agentId)} — {entry.run.status}</summary>
                    <pre>{entry.run.output || entry.run.error}</pre>
                  </details>
                ))}
              </div>
              {run.handoffs.length > 0 && (
                <details>
                  <summary>Handoffs (التسليمات) — {run.handoffs.length}</summary>
                  <ul>{run.handoffs.map((handoff) => <li key={handoff.id}>{agentName(agents, handoff.fromAgentId)} → {agentName(agents, handoff.toAgentId)}: {handoff.summary}</li>)}</ul>
                </details>
              )}
              <div className="workflow-final-output">
                <strong>Final Output (النتيجة النهائية)</strong>
                <pre>{run.finalOutput || run.error || 'لا توجد نتيجة نهائية.'}</pre>
              </div>
              <details>
                <summary>Workflow Checks (فحوص سير العمل)</summary>
                <ul>{run.checks.map((check) => <li key={check}>{check}</li>)}</ul>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
