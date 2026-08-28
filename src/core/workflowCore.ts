import { LocalQwenWebGpuRuntimeAdapter } from './localQwenRuntime'
import { buildAugmentedTask, rememberSuccessfulRun, retrieveLocalContext } from './memoryKnowledge'
import { LocalDemoRuntimeAdapter } from './runtime'
import type { AgentSpec, RunRecord } from './types'
import { evaluateZeroCostGate } from './zeroCostGate'

export type WorkflowMode = 'sequential' | 'parallel'

export interface WorkflowDefinition {
  id: string
  name: string
  mode: WorkflowMode
  supervisorAgentId: string
  workerAgentIds: string[]
  createdAt: string
}

export interface WorkflowStep {
  id: string
  stage: 'planning' | 'worker' | 'synthesis'
  agentId: string
  status: RunRecord['status']
  task: string
  output: string
  error?: string
  startedAt: string
  finishedAt: string
}

export interface WorkflowHandoff {
  id: string
  fromAgentId: string
  toAgentId: string
  stage: 'supervisor-to-worker' | 'worker-to-supervisor'
  summary: string
  createdAt: string
}

export interface TeamMemoryItem {
  id: string
  workflowId: string
  sourceAgentId: string
  text: string
  createdAt: string
}

export interface WorkflowRun {
  id: string
  workflowId: string
  task: string
  mode: WorkflowMode
  status: 'success' | 'failed' | 'blocked'
  scheduling: 'sequential' | 'parallel-local-demo' | 'parallel-mobile-safe-serialized-gpu'
  steps: WorkflowStep[]
  handoffs: WorkflowHandoff[]
  finalOutput: string
  error?: string
  monetaryCostUsd: 0
  startedAt: string
  finishedAt: string
}

const WORKFLOWS_KEY = 'agent-ia-factory.workflows.v1'
const WORKFLOW_RUNS_KEY = 'agent-ia-factory.workflow-runs.v1'
const TEAM_MEMORY_KEY = 'agent-ia-factory.team-memory.v1'
const MAX_WORKERS = 4
const MAX_WORKFLOWS = 30
const MAX_WORKFLOW_RUNS = 40
const MAX_TEAM_MEMORY_ITEMS = 80

const demoRuntime = new LocalDemoRuntimeAdapter()
const qwenRuntime = new LocalQwenWebGpuRuntimeAdapter()

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadWorkflows(): WorkflowDefinition[] {
  return readJson<WorkflowDefinition[]>(WORKFLOWS_KEY, [])
}

export function saveWorkflow(workflow: WorkflowDefinition): WorkflowDefinition[] {
  const next = [workflow, ...loadWorkflows().filter((item) => item.id !== workflow.id)].slice(0, MAX_WORKFLOWS)
  writeJson(WORKFLOWS_KEY, next)
  return next
}

export function createWorkflow(
  name: string,
  mode: WorkflowMode,
  supervisorAgentId: string,
  workerAgentIds: string[],
): WorkflowDefinition {
  const uniqueWorkers = [...new Set(workerAgentIds)].filter((agentId) => agentId && agentId !== supervisorAgentId).slice(0, MAX_WORKERS)
  if (!supervisorAgentId) throw new Error('WORKFLOW_SUPERVISOR_REQUIRED')
  if (uniqueWorkers.length === 0) throw new Error('WORKFLOW_WORKER_REQUIRED')

  return {
    id: id('workflow'),
    name: name.trim().slice(0, 120) || 'Workflow',
    mode,
    supervisorAgentId,
    workerAgentIds: uniqueWorkers,
    createdAt: new Date().toISOString(),
  }
}

export function deleteWorkflow(workflowId: string): WorkflowDefinition[] {
  const next = loadWorkflows().filter((workflow) => workflow.id !== workflowId)
  writeJson(WORKFLOWS_KEY, next)
  return next
}

export function loadWorkflowRuns(workflowId?: string): WorkflowRun[] {
  const all = readJson<WorkflowRun[]>(WORKFLOW_RUNS_KEY, [])
  return workflowId ? all.filter((run) => run.workflowId === workflowId) : all
}

function saveWorkflowRun(run: WorkflowRun): void {
  const next = [run, ...loadWorkflowRuns()].slice(0, MAX_WORKFLOW_RUNS)
  writeJson(WORKFLOW_RUNS_KEY, next)
}

export function loadTeamMemory(workflowId: string): TeamMemoryItem[] {
  return readJson<TeamMemoryItem[]>(TEAM_MEMORY_KEY, []).filter((item) => item.workflowId === workflowId)
}

function addTeamMemory(workflowId: string, sourceAgentId: string, text: string): void {
  const all = readJson<TeamMemoryItem[]>(TEAM_MEMORY_KEY, [])
  const item: TeamMemoryItem = {
    id: id('team-memory'),
    workflowId,
    sourceAgentId,
    text: text.trim().slice(0, 3_000),
    createdAt: new Date().toISOString(),
  }
  const own = [item, ...all.filter((entry) => entry.workflowId === workflowId)].slice(0, MAX_TEAM_MEMORY_ITEMS)
  const others = all.filter((entry) => entry.workflowId !== workflowId)
  writeJson(TEAM_MEMORY_KEY, [...own, ...others])
}

export function clearTeamMemory(workflowId: string): void {
  const next = readJson<TeamMemoryItem[]>(TEAM_MEMORY_KEY, []).filter((item) => item.workflowId !== workflowId)
  writeJson(TEAM_MEMORY_KEY, next)
}

function agentById(agents: AgentSpec[], agentId: string): AgentSpec {
  const agent = agents.find((item) => item.id === agentId)
  if (!agent) throw new Error(`WORKFLOW_AGENT_MISSING:${agentId}`)
  return agent
}

function validateWorkflow(workflow: WorkflowDefinition, agents: AgentSpec[]): void {
  const supervisor = agentById(agents, workflow.supervisorAgentId)
  const workers = workflow.workerAgentIds.map((agentId) => agentById(agents, agentId))
  if (workers.length === 0 || workers.length > MAX_WORKERS) throw new Error('WORKFLOW_WORKER_COUNT_INVALID')

  for (const agent of [supervisor, ...workers]) {
    const gate = evaluateZeroCostGate(agent)
    if (!gate.allowed) throw new Error(`WORKFLOW_ZERO_COST_BLOCKED:${agent.id}:${gate.violations.join('|')}`)
  }
}

async function executeAgent(agent: AgentSpec, task: string): Promise<RunRecord> {
  const runtime = agent.runtime.adapter === 'local-qwen-webgpu' ? qwenRuntime : demoRuntime
  return runtime.execute(agent, { task })
}

function toStep(stage: WorkflowStep['stage'], run: RunRecord): WorkflowStep {
  return {
    id: id('workflow-step'),
    stage,
    agentId: run.agentId,
    status: run.status,
    task: run.task,
    output: run.output,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  }
}

function teamContext(workflowId: string, limit = 10): string {
  const items = loadTeamMemory(workflowId).slice(0, limit)
  if (items.length === 0) return 'No shared team memory yet.'
  return items.map((item, index) => `${index + 1}. [agent=${item.sourceAgentId}] ${item.text}`).join('\n\n')
}

function addHandoff(
  handoffs: WorkflowHandoff[],
  fromAgentId: string,
  toAgentId: string,
  stage: WorkflowHandoff['stage'],
  summary: string,
): void {
  handoffs.push({
    id: id('handoff'),
    fromAgentId,
    toAgentId,
    stage,
    summary: summary.slice(0, 2_500),
    createdAt: new Date().toISOString(),
  })
}

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  agents: AgentSpec[],
  task: string,
): Promise<WorkflowRun> {
  const startedAt = new Date().toISOString()
  const cleanTask = task.trim()
  const steps: WorkflowStep[] = []
  const handoffs: WorkflowHandoff[] = []

  const blocked = (error: string): WorkflowRun => ({
    id: id('workflow-run'), workflowId: workflow.id, task: cleanTask, mode: workflow.mode,
    status: 'blocked', scheduling: 'sequential', steps, handoffs, finalOutput: '', error,
    monetaryCostUsd: 0, startedAt, finishedAt: new Date().toISOString(),
  })

  if (!cleanTask) {
    const result = blocked('WORKFLOW_TASK_EMPTY')
    saveWorkflowRun(result)
    return result
  }

  try {
    validateWorkflow(workflow, agents)
  } catch (error) {
    const result = blocked(error instanceof Error ? error.message : String(error))
    saveWorkflowRun(result)
    return result
  }

  const supervisor = agentById(agents, workflow.supervisorAgentId)
  const workers = workflow.workerAgentIds.map((agentId) => agentById(agents, agentId))
  const hasGpuWorker = workers.some((worker) => worker.runtime.adapter === 'local-qwen-webgpu')
  const scheduling: WorkflowRun['scheduling'] = workflow.mode === 'sequential'
    ? 'sequential'
    : hasGpuWorker
      ? 'parallel-mobile-safe-serialized-gpu'
      : 'parallel-local-demo'

  const planTask = [
    'أنت Supervisor Agent (الوكيل المشرف). ضع خطة عمل موجزة توزع المهمة على العمال المحددين دون استدعاء أدوات تلقائياً.',
    `[USER TASK]\n${cleanTask}`,
    `[WORKERS]\n${workers.map((worker, index) => `${index + 1}. ${worker.name} (${worker.id})`).join('\n')}`,
    `[SHARED TEAM MEMORY]\n${teamContext(workflow.id, 6)}`,
  ].join('\n\n')

  const planRun = await executeAgent(supervisor, planTask)
  steps.push(toStep('planning', planRun))
  if (planRun.status !== 'success') {
    const result: WorkflowRun = {
      id: id('workflow-run'), workflowId: workflow.id, task: cleanTask, mode: workflow.mode,
      status: 'failed', scheduling, steps, handoffs, finalOutput: '',
      error: planRun.error || planRun.output || 'SUPERVISOR_PLANNING_FAILED',
      monetaryCostUsd: 0, startedAt, finishedAt: new Date().toISOString(),
    }
    saveWorkflowRun(result)
    return result
  }
  addTeamMemory(workflow.id, supervisor.id, `Supervisor plan:\n${planRun.output}`)

  const sharedSnapshotForParallel = teamContext(workflow.id, 8)

  const runWorker = async (worker: AgentSpec, workerIndex: number, fixedTeamContext?: string) => {
    addHandoff(handoffs, supervisor.id, worker.id, 'supervisor-to-worker', planRun.output)
    const retrieved = retrieveLocalContext(worker.id, cleanTask, 4)
    const localContext = buildAugmentedTask(cleanTask, [], retrieved)
    const context = fixedTeamContext ?? teamContext(workflow.id, 10)
    const workerTask = [
      `أنت Worker Agent (وكيل عامل) رقم ${workerIndex + 1}. نفذ الجزء الأنسب لك من الخطة وأعد نتيجة عملية موجزة للمشرف.`,
      `[ORIGINAL TASK]\n${cleanTask}`,
      `[SUPERVISOR PLAN]\n${planRun.output}`,
      `[YOUR LOCAL CONTEXT]\n${localContext}`,
      `[SHARED TEAM MEMORY]\n${context}`,
      'لا تستدع أدوات تلقائياً في هذه المرحلة.',
    ].join('\n\n')
    const run = await executeAgent(worker, workerTask)
    steps.push(toStep('worker', run))
    if (run.status === 'success') {
      addTeamMemory(workflow.id, worker.id, run.output)
      addHandoff(handoffs, worker.id, supervisor.id, 'worker-to-supervisor', run.output)
      try { rememberSuccessfulRun(worker.id, cleanTask, run.output) } catch { /* memory quota does not invalidate workflow result */ }
    }
    return run
  }

  let workerRuns: RunRecord[]
  if (workflow.mode === 'parallel' && !hasGpuWorker) {
    workerRuns = await Promise.all(workers.map((worker, index) => runWorker(worker, index, sharedSnapshotForParallel)))
  } else if (workflow.mode === 'parallel') {
    // Logical parallelism: each worker sees the same pre-worker snapshot, but GPU
    // generation is serialized to avoid multiple concurrent WebGPU generations on phones.
    workerRuns = []
    for (const [index, worker] of workers.entries()) {
      workerRuns.push(await runWorker(worker, index, sharedSnapshotForParallel))
    }
  } else {
    workerRuns = []
    for (const [index, worker] of workers.entries()) {
      workerRuns.push(await runWorker(worker, index))
    }
  }

  const successfulWorkers = workerRuns.filter((run) => run.status === 'success')
  if (successfulWorkers.length === 0) {
    const result: WorkflowRun = {
      id: id('workflow-run'), workflowId: workflow.id, task: cleanTask, mode: workflow.mode,
      status: 'failed', scheduling, steps, handoffs, finalOutput: '',
      error: 'ALL_WORKERS_FAILED', monetaryCostUsd: 0, startedAt, finishedAt: new Date().toISOString(),
    }
    saveWorkflowRun(result)
    return result
  }

  const synthesisTask = [
    'أنت Supervisor Agent. اجمع نتائج العمال التالية في جواب نهائي واحد للمستخدم. اذكر فقط ما تدعمه النتائج، ولا تدّع أن عاملاً نجح إن كان فاشلاً.',
    `[ORIGINAL TASK]\n${cleanTask}`,
    `[WORKER RESULTS]\n${workerRuns.map((run, index) => `Worker ${index + 1} (${run.status}):\n${run.output || run.error}`).join('\n\n')}`,
    `[SHARED TEAM MEMORY]\n${teamContext(workflow.id, 12)}`,
  ].join('\n\n')

  const synthesisRun = await executeAgent(supervisor, synthesisTask)
  steps.push(toStep('synthesis', synthesisRun))
  if (synthesisRun.status === 'success') {
    addTeamMemory(workflow.id, supervisor.id, `Final synthesis:\n${synthesisRun.output}`)
    try { rememberSuccessfulRun(supervisor.id, cleanTask, synthesisRun.output) } catch { /* non-fatal */ }
  }

  const result: WorkflowRun = {
    id: id('workflow-run'), workflowId: workflow.id, task: cleanTask, mode: workflow.mode,
    status: synthesisRun.status === 'success' ? 'success' : 'failed', scheduling,
    steps, handoffs, finalOutput: synthesisRun.output,
    error: synthesisRun.status === 'success' ? undefined : synthesisRun.error || 'SUPERVISOR_SYNTHESIS_FAILED',
    monetaryCostUsd: 0, startedAt, finishedAt: new Date().toISOString(),
  }
  saveWorkflowRun(result)
  return result
}
