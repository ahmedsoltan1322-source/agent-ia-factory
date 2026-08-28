import { executeWorkflowAgent } from './workflowAgentExecutor'
import type { AgentSpec, RunRecord } from './types'

export type TeamExecutionMode = 'sequential' | 'parallel'
export type TeamActualExecution = 'sequential' | 'parallel' | 'queued_for_phone_safety'

export interface SupervisorTeam {
  id: string
  name: string
  supervisorAgentId: string
  workerAgentIds: string[]
  mode: TeamExecutionMode
  sharedMemory: boolean
  createdAt: string
  updatedAt: string
}

export interface SupervisorTeamMemoryItem {
  id: string
  teamId: string
  agentId: string
  role: 'worker' | 'supervisor'
  content: string
  createdAt: string
}

export interface TeamHandoff {
  id: string
  fromAgentId: string
  toAgentId: string
  content: string
  createdAt: string
}

export interface TeamAgentRun {
  role: 'worker' | 'supervisor'
  agentId: string
  run: RunRecord
}

export interface SupervisorTeamRun {
  id: string
  teamId: string
  originalTask: string
  requestedMode: TeamExecutionMode
  actualExecution: TeamActualExecution
  status: 'success' | 'partial' | 'blocked' | 'failed'
  agentRuns: TeamAgentRun[]
  handoffs: TeamHandoff[]
  finalOutput: string
  monetaryCostUsd: 0
  checks: string[]
  createdAt: string
  finishedAt: string
  error?: string
}

const TEAMS_KEY = 'agent-ia-factory.supervisor-teams.v1'
const MEMORY_KEY = 'agent-ia-factory.supervisor-team-memory.v1'
const RUNS_KEY = 'agent-ia-factory.supervisor-team-runs.v1'
const MAX_TEAMS = 20
const MAX_WORKERS = 6
const MAX_RUNS = 20
const MAX_MEMORY_ITEMS_PER_TEAM = 24
const MAX_GLOBAL_MEMORY_ITEMS = 120
const MAX_MEMORY_ITEM_CHARS = 1_200
const MAX_HANDOFF_CHARS = 1_600
const MAX_SHARED_CONTEXT_CHARS = 5_000
const MAX_WORKER_RESULT_CHARS = 1_400
const MAX_SUPERVISOR_CONTEXT_CHARS = 8_000

function now(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function writeArray<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function cleanText(value: string, limit: number): string {
  const cleaned = value.replace(/\u0000/gu, '').trim()
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, Math.max(0, limit - 1))}…`
}

function getAgent(agents: AgentSpec[], id: string): AgentSpec | null {
  return agents.find((agent) => agent.id === id) ?? null
}

function validateZeroCostAgent(agent: AgentSpec): string | null {
  if (agent.budgetPolicy.maxMonetarySpendUsd !== 0) return `NONZERO_BUDGET:${agent.id}`
  if (agent.modelPolicy.allowPaid !== false) return `PAID_MODEL_PERMISSION:${agent.id}`
  return null
}

export function validateSupervisorTeam(team: SupervisorTeam, agents: AgentSpec[]): string[] {
  const errors: string[] = []
  const workerIds = [...new Set(team.workerAgentIds)]
  if (!team.id.trim()) errors.push('TEAM_ID_REQUIRED')
  if (!team.name.trim()) errors.push('TEAM_NAME_REQUIRED')
  if (!getAgent(agents, team.supervisorAgentId)) errors.push('SUPERVISOR_AGENT_MISSING')
  if (workerIds.length < 1) errors.push('WORKER_REQUIRED')
  if (workerIds.length > MAX_WORKERS) errors.push('TOO_MANY_WORKERS')
  if (workerIds.includes(team.supervisorAgentId)) errors.push('SUPERVISOR_CANNOT_BE_WORKER')
  for (const workerId of workerIds) {
    if (!getAgent(agents, workerId)) errors.push(`WORKER_AGENT_MISSING:${workerId}`)
  }
  const members = [team.supervisorAgentId, ...workerIds]
    .map((id) => getAgent(agents, id))
    .filter((agent): agent is AgentSpec => Boolean(agent))
  for (const agent of members) {
    const zeroCostError = validateZeroCostAgent(agent)
    if (zeroCostError) errors.push(zeroCostError)
  }
  return errors
}

export function createSupervisorTeam(input: Omit<SupervisorTeam, 'id' | 'createdAt' | 'updatedAt'>): SupervisorTeam {
  const timestamp = now()
  return {
    ...input,
    id: newId('svteam'),
    name: cleanText(input.name, 120) || 'Supervisor Team',
    workerAgentIds: [...new Set(input.workerAgentIds)].slice(0, MAX_WORKERS),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function loadSupervisorTeams(): SupervisorTeam[] {
  return readArray<SupervisorTeam>(TEAMS_KEY).slice(0, MAX_TEAMS)
}

export function saveSupervisorTeam(team: SupervisorTeam): SupervisorTeam[] {
  const safe: SupervisorTeam = {
    ...team,
    name: cleanText(team.name, 120),
    workerAgentIds: [...new Set(team.workerAgentIds)].slice(0, MAX_WORKERS),
    updatedAt: now(),
  }
  const next = [safe, ...loadSupervisorTeams().filter((item) => item.id !== safe.id)].slice(0, MAX_TEAMS)
  writeArray(TEAMS_KEY, next)
  return next
}

export function deleteSupervisorTeam(teamId: string): SupervisorTeam[] {
  const next = loadSupervisorTeams().filter((team) => team.id !== teamId)
  writeArray(TEAMS_KEY, next)
  writeArray(MEMORY_KEY, readArray<SupervisorTeamMemoryItem>(MEMORY_KEY).filter((item) => item.teamId !== teamId))
  writeArray(RUNS_KEY, readArray<SupervisorTeamRun>(RUNS_KEY).filter((run) => run.teamId !== teamId))
  return next
}

export function loadSupervisorTeamMemory(teamId: string): SupervisorTeamMemoryItem[] {
  return readArray<SupervisorTeamMemoryItem>(MEMORY_KEY)
    .filter((item) => item.teamId === teamId)
    .slice(-MAX_MEMORY_ITEMS_PER_TEAM)
}

export function clearSupervisorTeamMemory(teamId: string): void {
  writeArray(MEMORY_KEY, readArray<SupervisorTeamMemoryItem>(MEMORY_KEY).filter((item) => item.teamId !== teamId))
}

function remember(team: SupervisorTeam, agentId: string, role: SupervisorTeamMemoryItem['role'], rawContent: string): void {
  if (!team.sharedMemory) return
  const content = cleanText(rawContent, MAX_MEMORY_ITEM_CHARS)
  if (!content) return
  const all = readArray<SupervisorTeamMemoryItem>(MEMORY_KEY)
  const currentTeam = all.filter((item) => item.teamId === team.id)
  const others = all.filter((item) => item.teamId !== team.id)
  const nextForTeam = [...currentTeam, {
    id: newId('svmem'),
    teamId: team.id,
    agentId,
    role,
    content,
    createdAt: now(),
  }].slice(-MAX_MEMORY_ITEMS_PER_TEAM)
  writeArray(MEMORY_KEY, [...others, ...nextForTeam].slice(-MAX_GLOBAL_MEMORY_ITEMS))
}

function sharedMemoryContext(team: SupervisorTeam): string {
  if (!team.sharedMemory) return ''
  const content = loadSupervisorTeamMemory(team.id)
    .slice(-8)
    .map((item) => `[${item.role}:${item.agentId}] ${cleanText(item.content, 650)}`)
    .join('\n')
  return cleanText(content, MAX_SHARED_CONTEXT_CHARS)
}

function buildIndependentWorkerTask(team: SupervisorTeam, worker: AgentSpec, originalTask: string): string {
  const sections = [
    `Team (الفريق): ${team.name}`,
    `Role (الدور): Independent Worker (عامل مستقل) — ${worker.name}`,
    `Original Task (المهمة الأصلية):\n${cleanText(originalTask, 6_000)}`,
    'اعمل بصورة مستقلة. قدم مساهمتك العملية فقط ليجمعها Supervisor (المشرف). لا تستدعِ Tools أو MCP تلقائياً ولا تعرض سلسلة التفكير الخاصة.',
  ]
  const memory = sharedMemoryContext(team)
  if (memory) sections.push(`Shared Team Memory (ذاكرة الفريق المشتركة):\n${memory}`)
  return sections.join('\n\n')
}

function buildSequentialWorkerTask(
  team: SupervisorTeam,
  worker: AgentSpec,
  originalTask: string,
  previousOutput: string,
): string {
  const sections = [
    `Team (الفريق): ${team.name}`,
    `Role (الدور): Sequential Worker (عامل تسلسلي) — ${worker.name}`,
    `Original Task (المهمة الأصلية):\n${cleanText(originalTask, 6_000)}`,
  ]
  if (previousOutput) sections.push(`Previous Handoff (التسليم السابق):\n${cleanText(previousOutput, MAX_HANDOFF_CHARS)}`)
  const memory = sharedMemoryContext(team)
  if (memory) sections.push(`Shared Team Memory (ذاكرة الفريق المشتركة):\n${memory}`)
  sections.push('أكمل العمل انطلاقاً من المعطيات السابقة. لا تستدعِ Tools أو MCP تلقائياً ولا تعرض سلسلة التفكير الخاصة.')
  return sections.join('\n\n')
}

function buildSupervisorTask(team: SupervisorTeam, supervisor: AgentSpec, originalTask: string, workerRuns: TeamAgentRun[]): string {
  const evidence = workerRuns.map((item, index) => {
    const output = item.run.output || item.run.error || 'No output'
    return `Worker ${index + 1} — ${item.agentId} — ${item.run.status}:\n${cleanText(output, MAX_WORKER_RESULT_CHARS)}`
  }).join('\n\n')
  const sections = [
    `Team (الفريق): ${team.name}`,
    `Role (الدور): Supervisor Agent (الوكيل المشرف) — ${supervisor.name}`,
    `Original Task (المهمة الأصلية):\n${cleanText(originalTask, 6_000)}`,
    `Worker Evidence (نتائج العمال):\n${cleanText(evidence, MAX_SUPERVISOR_CONTEXT_CHARS)}`,
    'ادمج النتائج، اذكر التعارضات المهمة إن وجدت، وقدّم Final Output (النتيجة النهائية) العملية. لا تستدعِ Tools أو MCP تلقائياً ولا تعرض سلسلة التفكير الخاصة.',
  ]
  const memory = sharedMemoryContext(team)
  if (memory) sections.push(`Shared Team Memory (ذاكرة الفريق المشتركة):\n${memory}`)
  return sections.join('\n\n')
}

function validateAgentRun(run: RunRecord): string | null {
  if (run.monetaryCostUsd !== 0) return 'TEAM_NONZERO_AGENT_COST_FORBIDDEN'
  if (run.toolCalls !== 0) return 'TEAM_AUTOMATIC_TOOL_CALL_FORBIDDEN'
  return null
}

async function executeWorker(agent: AgentSpec, task: string): Promise<RunRecord> {
  const run = await executeWorkflowAgent(agent, task)
  const violation = validateAgentRun(run)
  if (violation) throw new Error(violation)
  return run
}

function makeHandoff(fromAgentId: string, toAgentId: string, output: string): TeamHandoff {
  return {
    id: newId('svhandoff'),
    fromAgentId,
    toAgentId,
    content: cleanText(output, MAX_HANDOFF_CHARS),
    createdAt: now(),
  }
}

export function loadSupervisorTeamRuns(teamId?: string): SupervisorTeamRun[] {
  const all = readArray<SupervisorTeamRun>(RUNS_KEY).slice(0, MAX_RUNS)
  return teamId ? all.filter((run) => run.teamId === teamId) : all
}

export function clearSupervisorTeamRuns(teamId: string): void {
  writeArray(RUNS_KEY, readArray<SupervisorTeamRun>(RUNS_KEY).filter((run) => run.teamId !== teamId))
}

function saveRun(run: SupervisorTeamRun): void {
  if (run.monetaryCostUsd !== 0) throw new Error('TEAM_NONZERO_COST_FORBIDDEN')
  const next = [run, ...readArray<SupervisorTeamRun>(RUNS_KEY).filter((item) => item.id !== run.id)].slice(0, MAX_RUNS)
  writeArray(RUNS_KEY, next)
}

export async function runSupervisorTeam(
  team: SupervisorTeam,
  agents: AgentSpec[],
  rawTask: string,
): Promise<SupervisorTeamRun> {
  const createdAt = now()
  const originalTask = cleanText(rawTask, 8_000)
  const checks = [
    'team orchestration: local only',
    'automatic Tool/MCP execution: disabled',
    'mandatory monetary spend: 0 USD',
    `requested mode: ${team.mode}`,
    `shared team memory: ${team.sharedMemory}`,
  ]
  const errors = validateSupervisorTeam(team, agents)
  if (!originalTask) errors.push('TEAM_TASK_REQUIRED')

  const blocked = (error: string): SupervisorTeamRun => {
    const run: SupervisorTeamRun = {
      id: newId('svrun'), teamId: team.id, originalTask, requestedMode: team.mode,
      actualExecution: 'sequential', status: 'blocked', agentRuns: [], handoffs: [], finalOutput: '',
      monetaryCostUsd: 0, checks: [...checks, ...errors.map((value) => `validation: ${value}`)],
      createdAt, finishedAt: now(), error,
    }
    saveRun(run)
    return run
  }
  if (errors.length > 0) return blocked(errors.join(' | '))

  const supervisor = getAgent(agents, team.supervisorAgentId)!
  const workers = team.workerAgentIds.map((id) => getAgent(agents, id)!).slice(0, MAX_WORKERS)
  const hasQwenWorker = workers.some((worker) => worker.runtime.adapter === 'local-qwen-webgpu')
  const actualExecution: TeamActualExecution = team.mode === 'sequential'
    ? 'sequential'
    : hasQwenWorker ? 'queued_for_phone_safety' : 'parallel'
  checks.push(`actual execution: ${actualExecution}`)
  if (hasQwenWorker && team.mode === 'parallel') {
    checks.push('WebGPU workers serialized to protect phone GPU/RAM')
  }

  const workerRuns: TeamAgentRun[] = []
  const handoffs: TeamHandoff[] = []

  try {
    if (team.mode === 'sequential') {
      let previousOutput = ''
      for (const worker of workers) {
        const run = await executeWorker(worker, buildSequentialWorkerTask(team, worker, originalTask, previousOutput))
        workerRuns.push({ role: 'worker', agentId: worker.id, run })
        const output = run.output || run.error || ''
        remember(team, worker.id, 'worker', output)
        previousOutput = output
        handoffs.push(makeHandoff(worker.id, supervisor.id, output))
        if (run.status !== 'success') break
      }
    } else if (actualExecution === 'parallel') {
      const results = await Promise.all(workers.map(async (worker) => {
        const run = await executeWorker(worker, buildIndependentWorkerTask(team, worker, originalTask))
        return { role: 'worker' as const, agentId: worker.id, run }
      }))
      for (const item of results) {
        workerRuns.push(item)
        const output = item.run.output || item.run.error || ''
        remember(team, item.agentId, 'worker', output)
        handoffs.push(makeHandoff(item.agentId, supervisor.id, output))
      }
    } else {
      for (const worker of workers) {
        const run = await executeWorker(worker, buildIndependentWorkerTask(team, worker, originalTask))
        workerRuns.push({ role: 'worker', agentId: worker.id, run })
        const output = run.output || run.error || ''
        remember(team, worker.id, 'worker', output)
        handoffs.push(makeHandoff(worker.id, supervisor.id, output))
      }
    }

    const supervisorRun = await executeWorkflowAgent(
      supervisor,
      buildSupervisorTask(team, supervisor, originalTask, workerRuns),
    )
    const supervisorViolation = validateAgentRun(supervisorRun)
    if (supervisorViolation) throw new Error(supervisorViolation)
    const allRuns: TeamAgentRun[] = [...workerRuns, { role: 'supervisor', agentId: supervisor.id, run: supervisorRun }]
    remember(team, supervisor.id, 'supervisor', supervisorRun.output || supervisorRun.error || '')

    const workerFailures = workerRuns.filter((item) => item.run.status !== 'success').length
    const status: SupervisorTeamRun['status'] = supervisorRun.status === 'success'
      ? workerFailures > 0 ? 'partial' : 'success'
      : workerRuns.some((item) => item.run.status === 'success') ? 'partial' : 'failed'

    const result: SupervisorTeamRun = {
      id: newId('svrun'), teamId: team.id, originalTask, requestedMode: team.mode, actualExecution,
      status, agentRuns: allRuns, handoffs, finalOutput: supervisorRun.output || supervisorRun.error || '',
      monetaryCostUsd: 0,
      checks: [
        ...checks,
        `worker count: ${workers.length}`,
        `worker failures: ${workerFailures}`,
        `handoff count: ${handoffs.length}`,
        'supervisor synthesis: completed',
        'private chain-of-thought: not transferred',
      ],
      createdAt,
      finishedAt: now(),
      error: supervisorRun.status === 'success' ? undefined : supervisorRun.error,
    }
    saveRun(result)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const result: SupervisorTeamRun = {
      id: newId('svrun'), teamId: team.id, originalTask, requestedMode: team.mode, actualExecution,
      status: workerRuns.some((item) => item.run.status === 'success') ? 'partial' : 'failed',
      agentRuns: workerRuns, handoffs, finalOutput: '', monetaryCostUsd: 0,
      checks: [...checks, 'orchestrator error contained locally'], createdAt, finishedAt: now(), error: message,
    }
    saveRun(result)
    return result
  }
}
