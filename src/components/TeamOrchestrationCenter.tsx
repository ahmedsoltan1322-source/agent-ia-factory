import { useMemo, useState } from 'react'
import {
  clearSupervisorTeamMemory,
  clearSupervisorTeamRuns,
  createSupervisorTeam,
  deleteSupervisorTeam,
  loadSupervisorTeamMemory,
  loadSupervisorTeamRuns,
  loadSupervisorTeams,
  runSupervisorTeam,
  saveSupervisorTeam,
  validateSupervisorTeam,
  type SupervisorTeam,
  type SupervisorTeamRun,
  type TeamExecutionMode,
} from '../core/teamOrchestrator'
import type { AgentSpec } from '../core/types'

interface Props {
  agents: AgentSpec[]
  onNotice: (message: string) => void
}

function modeLabel(mode: TeamExecutionMode): string {
  return mode === 'parallel' ? 'Parallel (متوازي)' : 'Sequential (تسلسلي)'
}

function actualLabel(mode: SupervisorTeamRun['actualExecution']): string {
  if (mode === 'parallel') return 'Parallel فعلي'
  if (mode === 'queued_for_phone_safety') return 'Queued (طابور لحماية الهاتف)'
  return 'Sequential (تسلسلي)'
}

function agentName(agents: AgentSpec[], id: string): string {
  return agents.find((agent) => agent.id === id)?.name ?? id
}

export default function TeamOrchestrationCenter({ agents, onNotice }: Props) {
  const [teams, setTeams] = useState<SupervisorTeam[]>(() => loadSupervisorTeams())
  const [selectedTeamId, setSelectedTeamId] = useState(() => loadSupervisorTeams()[0]?.id ?? '')
  const [name, setName] = useState('فريق المشرف')
  const [supervisorId, setSupervisorId] = useState(() => agents[0]?.id ?? '')
  const [workerIds, setWorkerIds] = useState<string[]>(() => agents[1] ? [agents[1].id] : [])
  const [mode, setMode] = useState<TeamExecutionMode>('parallel')
  const [sharedMemory, setSharedMemory] = useState(true)
  const [task, setTask] = useState('اعملوا كفريق مستقل، ثم اجعل المشرف يجمع النتائج ويخرج أفضل جواب نهائي.')
  const [isRunning, setIsRunning] = useState(false)
  const [runs, setRuns] = useState<SupervisorTeamRun[]>(() => loadSupervisorTeamRuns())
  const [revision, setRevision] = useState(0)

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [teams, selectedTeamId],
  )
  const selectedRuns = useMemo(
    () => selectedTeam ? runs.filter((run) => run.teamId === selectedTeam.id) : [],
    [runs, selectedTeam],
  )
  const memoryCount = useMemo(
    () => selectedTeam ? loadSupervisorTeamMemory(selectedTeam.id).length : 0,
    [selectedTeam, revision],
  )

  function toggleWorker(id: string) {
    setWorkerIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id].slice(0, 6))
  }

  function handleCreateTeam() {
    const workers = workerIds.filter((id) => id !== supervisorId).slice(0, 6)
    const team = createSupervisorTeam({
      name,
      supervisorAgentId: supervisorId,
      workerAgentIds: workers,
      mode,
      sharedMemory,
    })
    const errors = validateSupervisorTeam(team, agents)
    if (errors.length > 0) {
      onNotice(`Team blocked (الفريق ممنوع): ${errors.join(' | ')}`)
      return
    }
    const next = saveSupervisorTeam(team)
    setTeams(next)
    setSelectedTeamId(team.id)
    setRevision((value) => value + 1)
    onNotice(`تم إنشاء Supervisor Team (فريق المشرف) بعدد ${workers.length} Workers. الحد المالي $0.`)
  }

  function updateTeam(patch: Partial<Pick<SupervisorTeam, 'mode' | 'sharedMemory'>>) {
    if (!selectedTeam) return
    const updated = { ...selectedTeam, ...patch }
    const errors = validateSupervisorTeam(updated, agents)
    if (errors.length > 0) {
      onNotice(`تعذر تحديث الفريق: ${errors.join(' | ')}`)
      return
    }
    setTeams(saveSupervisorTeam(updated))
    setRevision((value) => value + 1)
  }

  async function handleRun() {
    if (!selectedTeam) {
      onNotice('أنشئ Supervisor Team (فريق مشرف) أو اختر فريقاً أولاً.')
      return
    }
    if (!task.trim()) {
      onNotice('اكتب Team Task (مهمة الفريق) أولاً.')
      return
    }
    setIsRunning(true)
    onNotice(`بدأ ${modeLabel(selectedTeam.mode)} Team Run. Tools/MCP التلقائية ممنوعة والتكلفة 0$.`)
    try {
      const result = await runSupervisorTeam(selectedTeam, agents, task)
      setRuns(loadSupervisorTeamRuns())
      setRevision((value) => value + 1)
      if (result.status === 'success') {
        onNotice(`اكتمل Team Run بنجاح · ${actualLabel(result.actualExecution)} · التكلفة $0.`)
      } else if (result.status === 'partial') {
        onNotice('اكتمل الفريق جزئياً. بقيت النتائج الناجحة ظاهرة للمراجعة، والتكلفة $0.')
      } else {
        onNotice(result.error || 'تعذر إكمال Team Run.')
      }
    } finally {
      setIsRunning(false)
    }
  }

  function removeTeam(teamId: string) {
    const next = deleteSupervisorTeam(teamId)
    setTeams(next)
    setSelectedTeamId(next[0]?.id ?? '')
    setRuns(loadSupervisorTeamRuns())
    setRevision((value) => value + 1)
    onNotice('تم حذف Supervisor Team وذاكرته وسجله المحلي.')
  }

  return (
    <section className="card supervisor-team-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 4B · Supervisor + Parallel (المشرف + التوازي)</p>
          <h2>Supervisor Team (فريق بإشراف وكيل)</h2>
        </div>
        <span className="safe-pill">Fan-out / Fan-in · $0</span>
      </div>

      <p className="disclaimer">
        هذا النمط مكمل لـDAG Workflow (سير العمل الشبكي) الموجود: Workers يعملون ثم Supervisor يجمع النتائج. إذا استُخدم Qwen/WebGPU في عدة Workers، تتحول المهام المتوازية إلى Queue (طابور) لحماية ذاكرة الهاتف.
      </p>

      {agents.length < 2 ? (
        <p className="empty-state">تحتاج Agentين على الأقل لإنشاء Supervisor Team.</p>
      ) : (
        <div className="supervisor-team-builder">
          <label>Team Name (اسم الفريق)<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
          <label>Supervisor (المشرف)
            <select value={supervisorId} onChange={(event) => {
              const next = event.target.value
              setSupervisorId(next)
              setWorkerIds((current) => current.filter((id) => id !== next))
            }}>
              {agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}
            </select>
          </label>
          <label>Mode (النمط)
            <select value={mode} onChange={(event) => setMode(event.target.value as TeamExecutionMode)}>
              <option value="parallel">Parallel (متوازي)</option>
              <option value="sequential">Sequential (تسلسلي)</option>
            </select>
          </label>
          <label className="trust-toggle"><input type="checkbox" checked={sharedMemory} onChange={(event) => setSharedMemory(event.target.checked)} /> Shared Team Memory (ذاكرة مشتركة)</label>

          <div className="supervisor-worker-list">
            <strong>Worker Agents (الوكلاء العاملون) — حتى 6</strong>
            {agents.filter((agent) => agent.id !== supervisorId).map((agent) => (
              <label className="tool-permission" key={agent.id}>
                <input type="checkbox" checked={workerIds.includes(agent.id)} onChange={() => toggleWorker(agent.id)} />
                <span><strong>{agent.name}</strong><small>{agent.runtime.adapter} · Max Spend $0</small></span>
              </label>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={handleCreateTeam}>+ إنشاء Supervisor Team</button>
        </div>
      )}

      {teams.length > 0 && (
        <div className="supervisor-team-list">
          {teams.map((team) => (
            <article className={`team-item ${team.id === selectedTeamId ? 'selected' : ''}`} key={team.id}>
              <button className="agent-select" type="button" onClick={() => setSelectedTeamId(team.id)}>
                <strong>{team.name}</strong>
                <small>Supervisor: {agentName(agents, team.supervisorAgentId)} · Workers: {team.workerAgentIds.length} · {modeLabel(team.mode)}</small>
              </button>
              <button className="danger-button" type="button" onClick={() => removeTeam(team.id)}>حذف</button>
            </article>
          ))}
        </div>
      )}

      {selectedTeam && (
        <div className="supervisor-team-runner">
          <div className="workflow-team-summary">
            <div><span>Supervisor</span><strong>{agentName(agents, selectedTeam.supervisorAgentId)}</strong></div>
            <div><span>Workers</span><strong>{selectedTeam.workerAgentIds.length}</strong></div>
            <div><span>Shared Memory</span><strong>{selectedTeam.sharedMemory ? memoryCount : 'Off'}</strong></div>
            <div><span>Cost</span><strong>$0</strong></div>
          </div>

          <div className="workflow-controls">
            <label>Mode
              <select value={selectedTeam.mode} onChange={(event) => updateTeam({ mode: event.target.value as TeamExecutionMode })}>
                <option value="parallel">Parallel (متوازي)</option>
                <option value="sequential">Sequential (تسلسلي)</option>
              </select>
            </label>
            <label className="trust-toggle"><input type="checkbox" checked={selectedTeam.sharedMemory} onChange={(event) => updateTeam({ sharedMemory: event.target.checked })} /> Shared Memory</label>
          </div>

          <label>Team Task (مهمة الفريق)<textarea rows={4} value={task} onChange={(event) => setTask(event.target.value)} /></label>
          <button className="run-button" type="button" disabled={isRunning} onClick={handleRun}>{isRunning ? 'الفريق يعمل...' : '▶ تشغيل Supervisor Team'}</button>

          <div className="workflow-secondary-actions">
            {memoryCount > 0 && <button className="text-button" type="button" onClick={() => { clearSupervisorTeamMemory(selectedTeam.id); setRevision((value) => value + 1); onNotice('تم مسح Shared Team Memory.') }}>مسح الذاكرة المشتركة</button>}
            {selectedRuns.length > 0 && <button className="text-button" type="button" onClick={() => { clearSupervisorTeamRuns(selectedTeam.id); setRuns(loadSupervisorTeamRuns()); onNotice('تم مسح Team Run Log.') }}>مسح السجل</button>}
          </div>
        </div>
      )}

      {selectedRuns.length > 0 && (
        <div className="supervisor-run-list">
          {selectedRuns.slice(0, 6).map((run) => (
            <article className="workflow-run-item" key={run.id}>
              <div className="run-meta"><span>{run.status}</span><span>{modeLabel(run.requestedMode)}</span><span>{actualLabel(run.actualExecution)}</span><span>$0.00</span></div>
              <strong>{run.originalTask}</strong>
              {run.agentRuns.map((entry, index) => (
                <details key={`${entry.agentId}-${index}`}>
                  <summary>{entry.role === 'supervisor' ? 'Supervisor' : `Worker ${index + 1}`} — {agentName(agents, entry.agentId)} — {entry.run.status}</summary>
                  <pre>{entry.run.output || entry.run.error}</pre>
                </details>
              ))}
              <div className="workflow-final-output"><strong>Final Output (النتيجة النهائية)</strong><pre>{run.finalOutput || run.error}</pre></div>
              <details><summary>Handoffs & Checks</summary><ul>{run.handoffs.map((item) => <li key={item.id}>{agentName(agents, item.fromAgentId)} → {agentName(agents, item.toAgentId)}: {item.content}</li>)}</ul><ul>{run.checks.map((check) => <li key={check}>{check}</li>)}</ul></details>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
