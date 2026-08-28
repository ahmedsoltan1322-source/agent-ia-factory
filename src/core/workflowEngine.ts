import type { AgentSpec, RunRecord } from './types'

export type WorkflowNodeKind = 'agent' | 'approval' | 'end'
export type WorkflowEdgeWhen = 'success' | 'approved'
export type WorkflowRunStatus = 'ready' | 'running' | 'waiting_approval' | 'success' | 'blocked' | 'failed'
export type WorkflowStepStatus = 'success' | 'waiting_approval' | 'approved' | 'denied' | 'blocked' | 'failed'

export interface WorkflowAgentNode {
  id: string
  kind: 'agent'
  label: string
  agentId: string
}

export interface WorkflowApprovalNode {
  id: string
  kind: 'approval'
  label: string
  prompt: string
}

export interface WorkflowEndNode {
  id: string
  kind: 'end'
  label: string
}

export type WorkflowNode = WorkflowAgentNode | WorkflowApprovalNode | WorkflowEndNode

export interface WorkflowEdge {
  from: string
  to: string
  when: WorkflowEdgeWhen
}

export interface WorkflowDefinition {
  schemaVersion: '0.1'
  id: string
  name: string
  createdAt: string
  entryNodeId: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  limits: {
    maxSteps: number
    maxHandoffChars: number
  }
}

export interface WorkflowStepRecord {
  nodeId: string
  nodeKind: WorkflowNodeKind
  label: string
  status: WorkflowStepStatus
  agentId?: string
  agentRunId?: string
  input?: string
  output?: string
  startedAt: string
  finishedAt: string
  checks: string[]
  error?: string
}

export interface WorkflowRun {
  id: string
  workflowId: string
  status: WorkflowRunStatus
  currentNodeId: string | null
  pendingApprovalNodeId?: string
  originalInput: string
  previousOutput: string
  stepCount: number
  steps: WorkflowStepRecord[]
  monetaryCostUsd: 0
  createdAt: string
  updatedAt: string
  error?: string
}

export type WorkflowAgentExecutor = (agent: AgentSpec, task: string) => Promise<RunRecord>

const WORKFLOWS_KEY = 'agent-ia-factory.workflows.v1'
const WORKFLOW_RUNS_KEY = 'agent-ia-factory.workflow-runs.v1'
const MAX_WORKFLOWS = 20
const MAX_SAVED_RUNS = 12
const MAX_NODES = 40
const MAX_EDGES = 60
const MAX_STEPS = 24
const MAX_INPUT_CHARS = 8_000
const MAX_STEP_TEXT_CHARS = 6_000
const MAX_HANDOFF_CHARS = 8_000
const MAX_TEAM_AGENTS = 6

function now(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    const value = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value as T[] : []
  } catch {
    return []
  }
}

function writeArray<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function cleanText(value: string, limit: number): string {
  return value.replace(/\u0000/gu, '').trim().slice(0, limit)
}

function assertSafeId(value: string, label: string): void {
  if (!/^[A-Za-z0-9._:-]{1,120}$/u.test(value)) {
    throw new Error(`WORKFLOW_INVALID_${label.toUpperCase()}_ID`)
  }
}

export function validateWorkflowDefinition(workflow: WorkflowDefinition): string[] {
  const checks: string[] = []
  if (workflow.schemaVersion !== '0.1') throw new Error('WORKFLOW_SCHEMA_VERSION_UNSUPPORTED')
  if (!workflow.name.trim()) throw new Error('WORKFLOW_NAME_REQUIRED')
  if (workflow.nodes.length < 2 || workflow.nodes.length > MAX_NODES) throw new Error('WORKFLOW_NODE_COUNT_INVALID')
  if (workflow.edges.length < 1 || workflow.edges.length > MAX_EDGES) throw new Error('WORKFLOW_EDGE_COUNT_INVALID')
  if (!Number.isInteger(workflow.limits.maxSteps) || workflow.limits.maxSteps < 1 || workflow.limits.maxSteps > MAX_STEPS) {
    throw new Error('WORKFLOW_MAX_STEPS_INVALID')
  }
  if (!Number.isInteger(workflow.limits.maxHandoffChars) || workflow.limits.maxHandoffChars < 500 || workflow.limits.maxHandoffChars > MAX_HANDOFF_CHARS) {
    throw new Error('WORKFLOW_HANDOFF_LIMIT_INVALID')
  }

  assertSafeId(workflow.id, 'workflow')
  assertSafeId(workflow.entryNodeId, 'entry')

  const nodeMap = new Map<string, WorkflowNode>()
  for (const node of workflow.nodes) {
    assertSafeId(node.id, 'node')
    if (nodeMap.has(node.id)) throw new Error('WORKFLOW_DUPLICATE_NODE_ID')
    if (!node.label.trim()) throw new Error('WORKFLOW_NODE_LABEL_REQUIRED')
    if (node.kind === 'agent' && !node.agentId.trim()) throw new Error('WORKFLOW_AGENT_ID_REQUIRED')
    if (node.kind === 'approval' && !node.prompt.trim()) throw new Error('WORKFLOW_APPROVAL_PROMPT_REQUIRED')
    nodeMap.set(node.id, node)
  }

  if (!nodeMap.has(workflow.entryNodeId)) throw new Error('WORKFLOW_ENTRY_NODE_MISSING')
  if (!workflow.nodes.some((node) => node.kind === 'end')) throw new Error('WORKFLOW_END_NODE_REQUIRED')

  const outgoing = new Map<string, WorkflowEdge[]>()
  for (const edge of workflow.edges) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) throw new Error('WORKFLOW_EDGE_NODE_MISSING')
    if (edge.from === edge.to) throw new Error('WORKFLOW_SELF_EDGE_FORBIDDEN')
    const fromNode = nodeMap.get(edge.from)!
    if (fromNode.kind === 'end') throw new Error('WORKFLOW_END_NODE_HAS_EDGE')
    if (fromNode.kind === 'agent' && edge.when !== 'success') throw new Error('WORKFLOW_AGENT_EDGE_INVALID')
    if (fromNode.kind === 'approval' && edge.when !== 'approved') throw new Error('WORKFLOW_APPROVAL_EDGE_INVALID')
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge])
  }

  for (const node of workflow.nodes) {
    const edges = outgoing.get(node.id) ?? []
    if (node.kind === 'end') {
      if (edges.length !== 0) throw new Error('WORKFLOW_END_NODE_HAS_EDGE')
      continue
    }
    if (edges.length !== 1) throw new Error('WORKFLOW_NODE_REQUIRES_ONE_OUTGOING_EDGE')
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) throw new Error('WORKFLOW_CYCLE_FORBIDDEN')
    if (visited.has(nodeId)) return
    visiting.add(nodeId)
    for (const edge of outgoing.get(nodeId) ?? []) visit(edge.to)
    visiting.delete(nodeId)
    visited.add(nodeId)
  }
  for (const node of workflow.nodes) visit(node.id)

  const reachable = new Set<string>()
  const walk = (nodeId: string) => {
    if (reachable.has(nodeId)) return
    reachable.add(nodeId)
    for (const edge of outgoing.get(nodeId) ?? []) walk(edge.to)
  }
  walk(workflow.entryNodeId)
  if (reachable.size !== workflow.nodes.length) throw new Error('WORKFLOW_UNREACHABLE_NODE_FORBIDDEN')

  checks.push('workflow schema: valid')
  checks.push('graph: directed and acyclic')
  checks.push('all nodes: reachable from entry')
  checks.push(`node count: ${workflow.nodes.length}/${MAX_NODES}`)
  checks.push(`max steps: ${workflow.limits.maxSteps}/${MAX_STEPS}`)
  checks.push(`handoff limit: ${workflow.limits.maxHandoffChars} chars`)
  checks.push('automatic tool execution: disabled in Phase 4 foundation')
  checks.push('mandatory monetary spend: 0 USD')
  return checks
}

export function loadWorkflows(): WorkflowDefinition[] {
  return readArray<WorkflowDefinition>(WORKFLOWS_KEY).slice(0, MAX_WORKFLOWS)
}

export function saveWorkflow(workflow: WorkflowDefinition): WorkflowDefinition[] {
  validateWorkflowDefinition(workflow)
  const next = [workflow, ...loadWorkflows().filter((item) => item.id !== workflow.id)].slice(0, MAX_WORKFLOWS)
  writeArray(WORKFLOWS_KEY, next)
  return next
}

export function deleteWorkflow(workflowId: string): WorkflowDefinition[] {
  const next = loadWorkflows().filter((workflow) => workflow.id !== workflowId)
  writeArray(WORKFLOWS_KEY, next)
  return next
}

export function loadWorkflowRuns(workflowId?: string): WorkflowRun[] {
  const runs = readArray<WorkflowRun>(WORKFLOW_RUNS_KEY).slice(0, MAX_SAVED_RUNS)
  return workflowId ? runs.filter((run) => run.workflowId === workflowId) : runs
}

export function saveWorkflowRun(run: WorkflowRun): WorkflowRun[] {
  if (run.monetaryCostUsd !== 0) throw new Error('WORKFLOW_NONZERO_COST_FORBIDDEN')
  const next = [run, ...loadWorkflowRuns().filter((item) => item.id !== run.id)].slice(0, MAX_SAVED_RUNS)
  writeArray(WORKFLOW_RUNS_KEY, next)
  return next
}

export function clearWorkflowRuns(workflowId: string): WorkflowRun[] {
  const next = loadWorkflowRuns().filter((run) => run.workflowId !== workflowId)
  writeArray(WORKFLOW_RUNS_KEY, next)
  return next
}

export function buildLinearTeamWorkflow(
  name: string,
  rawAgentIds: string[],
  requireApprovalBetweenAgents = true,
): WorkflowDefinition {
  const agentIds = [...new Set(rawAgentIds.filter(Boolean))]
  if (agentIds.length < 2) throw new Error('WORKFLOW_TEAM_REQUIRES_TWO_AGENTS')
  if (agentIds.length > MAX_TEAM_AGENTS) throw new Error('WORKFLOW_TEAM_TOO_LARGE')

  const id = newId('workflow')
  const nodes: WorkflowNode[] = []
  const edges: WorkflowEdge[] = []

  for (let index = 0; index < agentIds.length; index += 1) {
    const agentNodeId = `agent-${index + 1}`
    nodes.push({ id: agentNodeId, kind: 'agent', label: `Agent ${index + 1}`, agentId: agentIds[index] })

    if (index < agentIds.length - 1 && requireApprovalBetweenAgents) {
      const approvalNodeId = `approval-${index + 1}`
      nodes.push({
        id: approvalNodeId,
        kind: 'approval',
        label: `Approval ${index + 1}`,
        prompt: `راجع ناتج Agent ${index + 1} قبل تسليمه إلى Agent ${index + 2}.`,
      })
      edges.push({ from: agentNodeId, to: approvalNodeId, when: 'success' })
      edges.push({ from: approvalNodeId, to: `agent-${index + 2}`, when: 'approved' })
    } else if (index < agentIds.length - 1) {
      edges.push({ from: agentNodeId, to: `agent-${index + 2}`, when: 'success' })
    }
  }

  const endId = 'end'
  nodes.push({ id: endId, kind: 'end', label: 'Completed' })
  edges.push({ from: `agent-${agentIds.length}`, to: endId, when: 'success' })

  const workflow: WorkflowDefinition = {
    schemaVersion: '0.1',
    id,
    name: cleanText(name, 120) || 'Multi-Agent Workflow',
    createdAt: now(),
    entryNodeId: 'agent-1',
    nodes,
    edges,
    limits: {
      maxSteps: Math.min(MAX_STEPS, nodes.length + 2),
      maxHandoffChars: 6_000,
    },
  }
  validateWorkflowDefinition(workflow)
  return workflow
}

export function createWorkflowRun(workflow: WorkflowDefinition, input: string): WorkflowRun {
  validateWorkflowDefinition(workflow)
  const originalInput = cleanText(input, MAX_INPUT_CHARS)
  if (!originalInput) throw new Error('WORKFLOW_INPUT_REQUIRED')
  const timestamp = now()
  const run: WorkflowRun = {
    id: newId('wfrun'),
    workflowId: workflow.id,
    status: 'ready',
    currentNodeId: workflow.entryNodeId,
    originalInput,
    previousOutput: '',
    stepCount: 0,
    steps: [],
    monetaryCostUsd: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  saveWorkflowRun(run)
  return run
}

function nodeById(workflow: WorkflowDefinition, nodeId: string): WorkflowNode {
  const node = workflow.nodes.find((item) => item.id === nodeId)
  if (!node) throw new Error('WORKFLOW_RUNTIME_NODE_MISSING')
  return node
}

function nextNodeId(workflow: WorkflowDefinition, nodeId: string, when: WorkflowEdgeWhen): string {
  const edge = workflow.edges.find((item) => item.from === nodeId && item.when === when)
  if (!edge) throw new Error('WORKFLOW_RUNTIME_EDGE_MISSING')
  return edge.to
}

function buildAgentTask(workflow: WorkflowDefinition, run: WorkflowRun, node: WorkflowAgentNode): string {
  const original = cleanText(run.originalInput, MAX_INPUT_CHARS)
  const previous = cleanText(run.previousOutput, workflow.limits.maxHandoffChars)
  const sections = [
    `Workflow (سير العمل): ${workflow.name}`,
    `Current Node (العقدة الحالية): ${node.label}`,
    '',
    'Original Task (المهمة الأصلية):',
    original,
  ]
  if (previous) {
    sections.push('', 'Previous Agent Handoff (تسليم الوكيل السابق):', previous)
  }
  sections.push('', 'نفذ دورك حسب تعليمات Agent (الوكيل) الخاصة بك. أعط النتيجة العملية فقط، ولا تعرض سلسلة التفكير الخاصة.')
  return sections.join('\n').slice(0, MAX_INPUT_CHARS + workflow.limits.maxHandoffChars + 800)
}

function checkpoint(run: WorkflowRun): WorkflowRun {
  const next = { ...run, updatedAt: now(), monetaryCostUsd: 0 as const }
  saveWorkflowRun(next)
  return next
}

function terminalFailure(
  run: WorkflowRun,
  node: WorkflowNode,
  status: 'blocked' | 'failed',
  error: string,
  checks: string[],
): WorkflowRun {
  const timestamp = now()
  return checkpoint({
    ...run,
    status,
    currentNodeId: null,
    error,
    stepCount: run.stepCount + 1,
    steps: [...run.steps, {
      nodeId: node.id,
      nodeKind: node.kind,
      label: node.label,
      status,
      startedAt: timestamp,
      finishedAt: timestamp,
      checks,
      error,
    }],
  })
}

export async function runWorkflowUntilPause(
  workflow: WorkflowDefinition,
  sourceRun: WorkflowRun,
  agents: AgentSpec[],
  executor: WorkflowAgentExecutor,
): Promise<WorkflowRun> {
  const validationChecks = validateWorkflowDefinition(workflow)
  if (sourceRun.workflowId !== workflow.id) throw new Error('WORKFLOW_RUN_DEFINITION_MISMATCH')
  if (sourceRun.status === 'waiting_approval' || sourceRun.status === 'success' || sourceRun.status === 'blocked' || sourceRun.status === 'failed') {
    return sourceRun
  }

  let run = checkpoint({ ...sourceRun, status: 'running', error: undefined })

  while (run.currentNodeId) {
    if (run.stepCount >= workflow.limits.maxSteps) {
      const node = nodeById(workflow, run.currentNodeId)
      return terminalFailure(run, node, 'blocked', 'WORKFLOW_MAX_STEPS_REACHED', [...validationChecks, 'workflow step budget: exceeded'])
    }

    const node = nodeById(workflow, run.currentNodeId)
    if (node.kind === 'end') {
      const timestamp = now()
      run = checkpoint({
        ...run,
        status: 'success',
        currentNodeId: null,
        stepCount: run.stepCount + 1,
        steps: [...run.steps, {
          nodeId: node.id,
          nodeKind: node.kind,
          label: node.label,
          status: 'success',
          startedAt: timestamp,
          finishedAt: timestamp,
          checks: [...validationChecks, 'workflow end reached'],
        }],
      })
      return run
    }

    if (node.kind === 'approval') {
      const timestamp = now()
      run = checkpoint({
        ...run,
        status: 'waiting_approval',
        pendingApprovalNodeId: node.id,
        stepCount: run.stepCount + 1,
        steps: [...run.steps, {
          nodeId: node.id,
          nodeKind: node.kind,
          label: node.label,
          status: 'waiting_approval',
          input: cleanText(node.prompt, 1_000),
          startedAt: timestamp,
          finishedAt: timestamp,
          checks: [...validationChecks, 'human approval node: waiting'],
        }],
      })
      return run
    }

    const agent = agents.find((item) => item.id === node.agentId)
    if (!agent) {
      return terminalFailure(run, node, 'blocked', 'WORKFLOW_AGENT_MISSING', [...validationChecks, `missing agent: ${node.agentId}`])
    }

    const task = buildAgentTask(workflow, run, node)
    const startedAt = now()
    let agentRun: RunRecord
    try {
      agentRun = await executor(agent, task)
    } catch (error) {
      return terminalFailure(
        run,
        node,
        'failed',
        error instanceof Error ? error.message : String(error),
        [...validationChecks, 'agent executor: threw error'],
      )
    }

    if (agentRun.monetaryCostUsd !== 0) {
      return terminalFailure(run, node, 'blocked', 'WORKFLOW_NONZERO_AGENT_COST_FORBIDDEN', [...agentRun.policyChecks, 'workflow zero-cost gate: blocked'])
    }
    if (agentRun.toolCalls !== 0) {
      return terminalFailure(run, node, 'blocked', 'WORKFLOW_AUTOMATIC_TOOL_CALL_FORBIDDEN', [...agentRun.policyChecks, 'automatic tool execution: blocked'])
    }
    if (agentRun.status !== 'success') {
      return terminalFailure(
        run,
        node,
        agentRun.status === 'blocked' ? 'blocked' : 'failed',
        agentRun.error || agentRun.output || 'WORKFLOW_AGENT_RUN_FAILED',
        agentRun.policyChecks,
      )
    }

    const output = cleanText(agentRun.output, workflow.limits.maxHandoffChars)
    run = checkpoint({
      ...run,
      status: 'running',
      currentNodeId: nextNodeId(workflow, node.id, 'success'),
      previousOutput: output,
      stepCount: run.stepCount + 1,
      steps: [...run.steps, {
        nodeId: node.id,
        nodeKind: node.kind,
        label: node.label,
        status: 'success',
        agentId: agent.id,
        agentRunId: agentRun.id,
        input: cleanText(task, MAX_STEP_TEXT_CHARS),
        output: cleanText(agentRun.output, MAX_STEP_TEXT_CHARS),
        startedAt,
        finishedAt: now(),
        checks: [
          ...agentRun.policyChecks,
          'workflow handoff: bounded',
          'automatic tool calls: 0',
          'monetary cost: 0 USD',
        ],
      }],
    })
  }

  return checkpoint({ ...run, status: 'failed', error: 'WORKFLOW_NO_CURRENT_NODE' })
}

export function decideWorkflowApproval(
  workflow: WorkflowDefinition,
  sourceRun: WorkflowRun,
  approved: boolean,
): WorkflowRun {
  validateWorkflowDefinition(workflow)
  if (sourceRun.status !== 'waiting_approval' || !sourceRun.currentNodeId || !sourceRun.pendingApprovalNodeId) {
    throw new Error('WORKFLOW_NOT_WAITING_FOR_APPROVAL')
  }
  if (sourceRun.currentNodeId !== sourceRun.pendingApprovalNodeId) throw new Error('WORKFLOW_APPROVAL_STATE_MISMATCH')

  const node = nodeById(workflow, sourceRun.currentNodeId)
  if (node.kind !== 'approval') throw new Error('WORKFLOW_PENDING_NODE_NOT_APPROVAL')

  const steps = [...sourceRun.steps]
  const lastIndex = steps.map((step) => step.nodeId).lastIndexOf(node.id)
  if (lastIndex < 0 || steps[lastIndex].status !== 'waiting_approval') throw new Error('WORKFLOW_APPROVAL_CHECKPOINT_MISSING')
  steps[lastIndex] = {
    ...steps[lastIndex],
    status: approved ? 'approved' : 'denied',
    finishedAt: now(),
    checks: [...steps[lastIndex].checks, approved ? 'human decision: approved' : 'human decision: denied'],
  }

  if (!approved) {
    return checkpoint({
      ...sourceRun,
      status: 'blocked',
      currentNodeId: null,
      pendingApprovalNodeId: undefined,
      steps,
      error: 'WORKFLOW_APPROVAL_DENIED',
    })
  }

  return checkpoint({
    ...sourceRun,
    status: 'ready',
    currentNodeId: nextNodeId(workflow, node.id, 'approved'),
    pendingApprovalNodeId: undefined,
    steps,
    error: undefined,
  })
}
