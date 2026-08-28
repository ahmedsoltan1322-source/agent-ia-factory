import { LocalQwenWebGpuRuntimeAdapter } from './localQwenRuntime'
import { LocalDemoRuntimeAdapter } from './runtime'
import type { AgentSpec, RunRecord, RuntimeAdapter } from './types'

export type WorkflowMode = 'sequential' | 'parallel'
export type WorkflowActualExecution = 'sequential' | 'parallel' | 'queued_for_phone_safety'

export interface TeamSpec {
  id: string
  name: string
  supervisorAgentId: string
  workerAgentIds: string[]
  mode: WorkflowMode
  sharedMemory: boolean
  maxSteps: number
  createdAt: string
  updatedAt: string
}

export interface TeamMemoryItem {
  id: string
  teamId: string
  agentId: string
  role: 'worker' | 'supervisor'
  content: string
  createdAt: string
}

export interface HandoffRecord {
  id: string
  fromAgentId: string | 'user'
  toAgentId: string
  summary: string
  createdAt: string
}

export interface WorkflowAgentRun {
  role: 'worker' | 'supervisor'
  agentId: string
  run: RunRecord
}

export interface WorkflowRunRecord {
  id: string
  teamId: string
  task: string
  requestedMode: WorkflowMode
  actualExecution: WorkflowActualExecution
  startedAt: string
  finishedAt: string
  status: 'success' | 'partial' | 'blocked' | 'failed'
  agentRuns: WorkflowAgentRun[]
  handoffs: HandoffRecord[]
  finalOutput: string
  monetaryCostUsd: 0
  checks: string[]
  error?: string
}

export interface WorkflowRunOptions {
  team: TeamSpec
  agents: AgentSpec[]
  task: string
}

const TEAMS_KEY = 'agent-ia-factory.teams.v1'
const TEAM_MEMORY_KEY = 'agent-ia-factory.team-memory.v1'
const WORKFLOW_RUNS_KEY = 'agent-ia-factory.workflow-runs.v1'
const MAX_TEAMS = 24
const MAX_WORKERS = 6
const MIN_WORKERS = 1
const MAX_WORKFLOW_STEPS = 12
const MAX_TEAM_MEMORY_ITEMS = 40
const MAX_TEAM_MEMORY_PER_TEAM = 24
const MAX_MEMORY_ITEM_CHARS = 1_200
const MAX_HANDOFF_CHARS = 1_600
const MAX_TEAM_CONTEXT_CHARS = 6_000
const MAX_SUPERVISOR_CONTEXT_CHARS = 8_000
const MAX_STORED_WORKFLOW_RUNS = 40

const demoRuntime = new LocalDemoRuntimeAdapter()
const qwenRuntime = new LocalQwenWebGpuRuntimeAdapter()

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function safeParseArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T[] : []
  } catch {
    return []
  }
}

function runtimeFor(agent: AgentSpec): RuntimeAdapter {
  return agent.runtime.adapter === 'local-qwen-webgpu' ? qwenRuntime : demoRuntime
}

function compact(value: string, maxChars: number): string {
  const normalized = value.trim().replace(/\s+/gu, ' ')
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`
}

function agentById(agents: AgentSpec[], id: string): AgentSpec | null {
  return agents.find((agent) => agent.id === id) ?? null
}

function teamMemoryContext(teamId: string): string {
  const items = loadTeamMemory(teamId).slice(-8)
  if (items.length === 0) return ''
  const text = items
    .map((item) => `[${item.role}] ${compact(item.content, 700)}`)
    .join('\n')
  return compact(text, MAX_TEAM_CONTEXT_CHARS)
}

function workerTask(originalTask: string, team: TeamSpec, worker: AgentSpec, handoff?: HandoffRecord): string {
  const sections = [
    `Team Workflow (سير عمل الفريق): ${team.name}`,
    `Role (الدور): Worker Agent (وكيل عامل) — ${worker.name}`,
    `Original Task (المهمة الأصلية): ${originalTask}`,
    'نفّذ دورك فقط. لا تستدعِ Tools (أدوات) أو MCP تلقائياً. أعد نتيجة واضحة يمكن تسليمها للوكيل التالي أو المشرف.',
  ]
  if (handoff) sections.push(`Handoff (التسليم السابق): ${handoff.summary}`)
  if (team.sharedMemory) {
    const memory = teamMemoryContext(team.id)
    if (memory) sections.push(`Shared Team Memory (ذاكرة الفريق المشتركة):\n${memory}`)
  }
  return sections.join('\n\n')
}

function parallelWorkerTask(originalTask: string, team: TeamSpec, worker: AgentSpec): string {
  const sections = [
    `Team Workflow (سير عمل الفريق): ${team.name}`,
    `Role (الدور): Independent Worker Agent (وكيل عامل مستقل) — ${worker.name}`,
    `Original Task (المهمة الأصلية): ${originalTask}`,
    'اعمل بصورة مستقلة عن بقية الوكلاء. لا تستدعِ Tools (أدوات) أو MCP تلقائياً. قدّم مساهمتك فقط ليجمعها Supervisor (المشرف).',
  ]
  if (team.sharedMemory) {
    const memory = teamMemoryContext(team.id)
    if (memory) sections.push(`Shared Team Memory (ذاكرة الفريق المشتركة):\n${memory}`)
  }
  return sections.join('\n\n')
}

function supervisorTask(originalTask: string, team: TeamSpec, supervisor: AgentSpec, workerRuns: WorkflowAgentRun[]): string {
  const workerEvidence = workerRuns.map((entry, index) => {
    const result = entry.run.output || entry.run.error || 'No output'
    return `Worker ${index + 1} (${entry.agentId}) [${entry.run.status}]:\n${compact(result, 1_500)}`
  }).join('\n\n')
  const sections = [
    `Team Workflow (سير عمل الفريق): ${team.name}`,
    `Role (الدور): Supervisor Agent (الوكيل المشرف) — ${supervisor.name}`,
    `Original Task (المهمة الأصلية): ${originalTask}`,
    `Worker Results (نتائج الوكلاء):\n${compact(workerEvidence, MAX_SUPERVISOR_CONTEXT_CHARS)}`,
    'اجمع النتائج، عالج التعارضات الواضحة، وقدم Final Answer (النتيجة النهائية). لا تستدعِ Tools أو MCP تلقائياً في Phase 4A.',
  ]
  if (team.sharedMemory) {
    const memory = teamMemoryContext(team.id)
    if (memory) sections.push(`Shared Team Memory (ذاكرة الفريق المشتركة):\n${memory}`)
  }
  return sections.join('\n\n')
}

function recordHandoff(fromAgentId: string | 'user', toAgentId: string, content: string): HandoffRecord {
  return {
    id: createId('handoff'),
    fromAgentId,
    toAgentId,
    summary: compact(content, MAX_HANDOFF_CHARS),
    createdAt: new Date().toISOString(),
  }
}

function validateTeamInternal(team: TeamSpec, agents: AgentSpec[]): string[] {
  const errors: string[] = []
  const workerIds = [...new Set(team.workerAgentIds)]
  const supervisor = agentById(agents, team.supervisorAgentId)

  if (!team.id.trim()) errors.push('Team id is required.')
  if (!team.name.trim()) errors.push('Team name is required.')
  if (!supervisor) errors.push('Supervisor Agent is missing.')
  if (workerIds.length < MIN_WORKERS) errors.push('At least one Worker Agent is required.')
  if (workerIds.length > MAX_WORKERS) errors.push(`Worker count exceeds ${MAX_WORKERS}.`)
  if (workerIds.includes(team.supervisorAgentId)) errors.push('Supervisor cannot also be a Worker in Phase 4A.')
  for (const workerId of workerIds) {
    if (!agentById(agents, workerId)) errors.push(`Worker Agent not found: ${workerId}`)
  }
  if (team.maxSteps < 1 || team.maxSteps > MAX_WORKFLOW_STEPS) errors.push(`maxSteps must be 1-${MAX_WORKFLOW_STEPS}.`)

  const members = [supervisor, ...workerIds.map((id) => agentById(agents, id))].filter((agent): agent is AgentSpec => Boolean(agent))
  for (const agent of members) {
    if (agent.budgetPolicy.maxMonetarySpendUsd !== 0 || agent.modelPolicy.allowPaid !== false) {
      errors.push(`Agent violates Zero-Cost policy: ${agent.name}`)
    }
  }
  return errors
}

export function validateTeam(team: TeamSpec, agents: AgentSpec[]): { valid: boolean; errors: string[] } {
  const errors = validateTeamInternal(team, agents)
  return { valid: errors.length === 0, errors }
}

export function createTeam(input: Omit<TeamSpec, 'id' | 'createdAt' | 'updatedAt'>): TeamSpec {
  const now = new Date().toISOString()
  return {
    ...input,
    workerAgentIds: [...new Set(input.workerAgentIds)].slice(0, MAX_WORKERS),
    maxSteps: Math.max(1, Math.min(MAX_WORKFLOW_STEPS, input.maxSteps)),
    id: createId('team'),
    createdAt: now,
    updatedAt: now,
  }
}

export function loadTeams(): TeamSpec[] {
  return safeParseArray<TeamSpec>(TEAMS_KEY).slice(0, MAX_TEAMS)
}

export function saveTeam(team: TeamSpec): TeamSpec[] {
  const safe: TeamSpec = {
    ...team,
    name: compact(team.name, 120),
    workerAgentIds: [...new Set(team.workerAgentIds)].slice(0, MAX_WORKERS),
    maxSteps: Math.max(1, Math.min(MAX_WORKFLOW_STEPS, team.maxSteps)),
    updatedAt: new Date().toISOString(),
  }
  const next = [safe, ...loadTeams().filter((item) => item.id !== safe.id)].slice(0, MAX_TEAMS)
  localStorage.setItem(TEAMS_KEY, JSON.stringify(next))
  return next
}

export function deleteTeam(teamId: string): TeamSpec[] {
  const next = loadTeams().filter((team) => team.id !== teamId)
  localStorage.setItem(TEAMS_KEY, JSON.stringify(next))
  const remainingMemory = safeParseArray<TeamMemoryItem>(TEAM_MEMORY_KEY).filter((item) => item.teamId !== teamId)
  localStorage.setItem(TEAM_MEMORY_KEY, JSON.stringify(remainingMemory))
  return next
}

export function loadTeamMemory(teamId: string): TeamMemoryItem[] {
  return safeParseArray<TeamMemoryItem>(TEAM_MEMORY_KEY)
    .filter((item) => item.teamId === teamId)
    .slice(-MAX_TEAM_MEMORY_PER_TEAM)
}

export function clearTeamMemory(teamId: string): void {
  const next = safeParseArray<TeamMemoryItem>(TEAM_MEMORY_KEY).filter((item) => item.teamId !== teamId)
  localStorage.setItem(TEAM_MEMORY_KEY, JSON.stringify(next))
}

function rememberTeamResult(team: TeamSpec, agentId: string, role: TeamMemoryItem['role'], content: string): void {
  if (!team.sharedMemory || !content.trim()) return
  const all = safeParseArray<TeamMemoryItem>(TEAM_MEMORY_KEY)
  const item: TeamMemoryItem = {
    id: createId('teammem'),
    teamId: team.id,
    agentId,
    role,
    content: compact(content, MAX_MEMORY_ITEM_CHARS),
    createdAt: new Date().toISOString(),
  }
  const teamItems = [...all.filter((entry) => entry.teamId === team.id), item].slice(-MAX_TEAM_MEMORY_PER_TEAM)
  const otherItems = all.filter((entry) => entry.teamId !== team.id)
  const next = [...otherItems, ...teamItems].slice(-MAX_TEAM_MEMORY_ITEMS)
  localStorage.setItem(TEAM_MEMORY_KEY, JSON.stringify(next))
}

export function loadWorkflowRuns(teamId?: string): WorkflowRunRecord[] {
  const all = safeParseArray<WorkflowRunRecord>(WORKFLOW_RUNS_KEY)
  return (teamId ? all.filter((run) => run.teamId === teamId) : all).slice(0, MAX_STORED_WORKFLOW_RUNS)
}

export function clearWorkflowRuns(teamId?: string): void {
  if (!teamId) {
    localStorage.removeItem(WORKFLOW_RUNS_KEY)
    return
  }
  const next = safeParseArray<WorkflowRunRecord>(WORKFLOW_RUNS_KEY).filter((run) => run.teamId !== teamId)
  localStorage.setItem(WORKFLOW_RUNS_KEY, JSON.stringify(next))
}

function saveWorkflowRun(run: WorkflowRunRecord): WorkflowRunRecord[] {
  const next = [run, ...safeParseArray<WorkflowRunRecord>(WORKFLOW_RUNS_KEY)].slice(0, MAX_STORED_WORKFLOW_RUNS)
  localStorage.setItem(WORKFLOW_RUNS_KEY, JSON.stringify(next))
  return next
}

async function executeWorker(agent: AgentSpec, task: string): Promise<RunRecord> {
  return runtimeFor(agent).execute(agent, { task })
}

export async function runTeamWorkflow(options: WorkflowRunOptions): Promise<WorkflowRunRecord> {
  const { team, agents } = options
  const originalTask = options.task.trim()
  const startedAt = new Date().toISOString()
  const validation = validateTeam(team, agents)
  const checks = [
    'mandatory monetary spend: 0 USD',
    'automatic Tool/MCP execution: disabled in Phase 4A',
    `requested workflow mode: ${team.mode}`,
    `worker count: ${team.workerAgentIds.length}`,
    `shared team memory: ${team.sharedMemory}`,
  ]

  if (!originalTask) {
    const run: WorkflowRunRecord = {
      id: createId('workflow'), teamId: team.id, task: '', requestedMode: team.mode,
      actualExecution: 'sequential', startedAt, finishedAt: new Date().toISOString(), status: 'failed',
      agentRuns: [], handoffs: [], finalOutput: '', monetaryCostUsd: 0, checks, error: 'Workflow task is empty.',
    }
    saveWorkflowRun(run)
    return run
  }

  if (!validation.valid) {
    const run: WorkflowRunRecord = {
      id: createId('workflow'), teamId: team.id, task: originalTask, requestedMode: team.mode,
      actualExecution: 'sequential', startedAt, finishedAt: new Date().toISOString(), status: 'blocked',
      agentRuns: [], handoffs: [], finalOutput: '', monetaryCostUsd: 0,
      checks: [...checks, ...validation.errors.map((error) => `team validation: ${error}`)],
      error: validation.errors.join(' | '),
    }
    saveWorkflowRun(run)
    return run
  }

  const supervisor = agentById(agents, team.supervisorAgentId)!
  const workers = team.workerAgentIds.map((id) => agentById(agents, id)!).slice(0, MAX_WORKERS)
  const usesLocalQwen = [supervisor, ...workers].some((agent) => agent.runtime.adapter === 'local-qwen-webgpu')
  const actualExecution: WorkflowActualExecution = team.mode === 'sequential'
    ? 'sequential'
    : usesLocalQwen ? 'queued_for_phone_safety' : 'parallel'
  checks.push(`actual execution mode: ${actualExecution}`)
  if (team.mode === 'parallel' && usesLocalQwen) {
    checks.push('parallel local WebGPU generations serialized for phone GPU/RAM safety')
  }

  const agentRuns: WorkflowAgentRun[] = []
  const handoffs: HandoffRecord[] = []

  if (team.mode === 'sequential') {
    let priorHandoff: HandoffRecord | undefined
    for (const worker of workers) {
      if (agentRuns.length >= team.maxSteps) break
      const task = workerTask(originalTask, team, worker, priorHandoff)
      const run = await executeWorker(worker, task)
      agentRuns.push({ role: 'worker', agentId: worker.id, run })
      const content = run.output || run.error || 'No output'
      rememberTeamResult(team, worker.id, 'worker', content)
      priorHandoff = recordHandoff(worker.id, supervisor.id, content)
      handoffs.push(priorHandoff)
    }
  } else {
    const executeOne = async (worker: AgentSpec): Promise<WorkflowAgentRun> => {
      const run = await executeWorker(worker, parallelWorkerTask(originalTask, team, worker))
      const content = run.output || run.error || 'No output'
      rememberTeamResult(team, worker.id, 'worker', content)
      return { role: 'worker' as const, agentId: worker.id, run }
    }

    if (actualExecution === 'parallel') {
      const results = await Promise.all(workers.map(executeOne))
      agentRuns.push(...results.slice(0, team.maxSteps))
    } else {
      for (const worker of workers) {
        if (agentRuns.length >= team.maxSteps) break
        agentRuns.push(await executeOne(worker))
      }
    }

    for (const entry of agentRuns) {
      handoffs.push(recordHandoff(entry.agentId, supervisor.id, entry.run.output || entry.run.error || 'No output'))
    }
  }

  if (agentRuns.length < team.maxSteps) {
    const supervisorRun = await runtimeFor(supervisor).execute(supervisor, {
      task: supervisorTask(originalTask, team, supervisor, agentRuns),
    })
    agentRuns.push({ role: 'supervisor', agentId: supervisor.id, run: supervisorRun })
    rememberTeamResult(team, supervisor.id, 'supervisor', supervisorRun.output || supervisorRun.error || '')
  }

  const supervisorEntry = [...agentRuns].reverse().find((entry) => entry.role === 'supervisor')
  const successfulWorkers = agentRuns.filter((entry) => entry.role === 'worker' && entry.run.status === 'success').length
  const failedOrBlocked = agentRuns.filter((entry) => entry.run.status !== 'success').length
  const finalOutput = supervisorEntry?.run.output || supervisorEntry?.run.error || ''
  const status: WorkflowRunRecord['status'] = supervisorEntry?.run.status === 'success'
    ? failedOrBlocked > 0 ? 'partial' : 'success'
    : successfulWorkers > 0 ? 'partial' : failedOrBlocked > 0 ? 'failed' : 'blocked'

  const workflowRun: WorkflowRunRecord = {
    id: createId('workflow'),
    teamId: team.id,
    task: originalTask,
    requestedMode: team.mode,
    actualExecution,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    agentRuns,
    handoffs,
    finalOutput,
    monetaryCostUsd: 0,
    checks: [
      ...checks,
      `worker successes: ${successfulWorkers}/${workers.length}`,
      `handoff count: ${handoffs.length}`,
      `workflow monetary cost: 0 USD`,
    ],
    error: supervisorEntry?.run.status !== 'success' ? supervisorEntry?.run.error : undefined,
  }
  saveWorkflowRun(workflowRun)
  return workflowRun
}
