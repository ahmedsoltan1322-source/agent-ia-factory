import { addLongTermMemory, clearAllAgentMemory, retrieveLocalContext } from './memoryKnowledge'
import type { AgentSpec, ApprovalDecision } from './types'

export type ToolRisk = 'read_only' | 'local_write' | 'external_write' | 'delete' | 'financial' | 'security_change'

export interface ToolDefinition {
  id: string
  name: string
  description: string
  risk: ToolRisk
  scopes: string[]
  inputHint: string
  execute: (context: ToolExecutionContext, input: string) => Promise<string> | string
}

export interface ToolExecutionContext {
  agent: AgentSpec
}

export type ToolGateStatus = 'allowed' | 'approval_required' | 'blocked'

export interface ToolGateResult {
  status: ToolGateStatus
  reason: string
  checks: string[]
}

export interface ToolCallRecord {
  id: string
  agentId: string
  toolId: string
  input: string
  output: string
  status: 'success' | 'blocked' | 'denied' | 'failed'
  approvedByHuman: boolean
  monetaryCostUsd: 0
  createdAt: string
  checks: string[]
  error?: string
}

const TOOL_LOG_KEY = 'agent-ia-factory.tool-calls.v1'
const MAX_TOOL_LOG = 120

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readToolLog(): ToolCallRecord[] {
  try {
    const raw = localStorage.getItem(TOOL_LOG_KEY)
    return raw ? JSON.parse(raw) as ToolCallRecord[] : []
  } catch {
    return []
  }
}

function saveToolRecord(record: ToolCallRecord): ToolCallRecord[] {
  const next = [record, ...readToolLog()].slice(0, MAX_TOOL_LOG)
  localStorage.setItem(TOOL_LOG_KEY, JSON.stringify(next))
  return next
}

function approvalDecisionForRisk(agent: AgentSpec, risk: ToolRisk): ApprovalDecision | 'allow' {
  if (risk === 'read_only' || risk === 'local_write') return 'allow'
  if (risk === 'external_write') return agent.approvalPolicy.externalWrite
  if (risk === 'delete') return agent.approvalPolicy.delete
  if (risk === 'financial') return agent.approvalPolicy.financial
  return agent.approvalPolicy.securityChange
}

export function evaluateToolGate(agent: AgentSpec, tool: ToolDefinition, approvedByHuman = false): ToolGateResult {
  const checks = [
    `tool id: ${tool.id}`,
    `tool risk: ${tool.risk}`,
    `max monetary spend: ${agent.budgetPolicy.maxMonetarySpendUsd} USD`,
  ]

  if (!agent.toolPolicy.allowedTools.includes(tool.id)) {
    return {
      status: 'blocked',
      reason: 'Tool is not in agent.toolPolicy.allowedTools.',
      checks: [...checks, 'tool allowlist: blocked'],
    }
  }
  checks.push('tool allowlist: allowed')

  if (tool.risk === 'financial') {
    return {
      status: 'blocked',
      reason: 'Financial tools are blocked while mandatory monetary spend is 0 USD.',
      checks: [...checks, 'zero-cost financial gate: blocked'],
    }
  }

  const decision = approvalDecisionForRisk(agent, tool.risk)
  checks.push(`approval policy decision: ${decision}`)

  if (decision === 'deny') {
    return { status: 'blocked', reason: `Agent approval policy denies ${tool.risk} tools.`, checks }
  }

  if (decision === 'ask' && !approvedByHuman) {
    return {
      status: 'approval_required',
      reason: `Human approval is required for ${tool.risk}.`,
      checks,
    }
  }

  if (decision === 'ask' && approvedByHuman) checks.push('human approval: granted')
  return { status: 'allowed', reason: 'Tool call is allowed by current policies.', checks }
}

const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    id: 'local.text.stats',
    name: 'Text Stats (إحصاء النص)',
    description: 'يحسب الكلمات والأسطر والحروف محلياً دون شبكة.',
    risk: 'read_only',
    scopes: ['text:read'],
    inputHint: 'أدخل النص الذي تريد إحصاءه.',
    execute: (_context, input) => {
      const text = input.trim()
      const words = text ? text.split(/\s+/u).length : 0
      const lines = text ? text.split(/\r?\n/u).length : 0
      return `characters=${text.length}; words=${words}; lines=${lines}`
    },
  },
  {
    id: 'local.memory.search',
    name: 'Memory Search (بحث الذاكرة)',
    description: 'يبحث في ذاكرة ومعرفة الوكيل محلياً فقط.',
    risk: 'read_only',
    scopes: ['memory:read'],
    inputHint: 'اكتب ما تريد البحث عنه في ذاكرة الوكيل.',
    execute: (context, input) => {
      const hits = retrieveLocalContext(context.agent.id, input, 5)
      if (hits.length === 0) return 'No relevant local memory or knowledge found.'
      return hits.map((hit, index) => `${index + 1}. [${hit.label}] score=${hit.score.toFixed(2)}\n${hit.text}`).join('\n\n')
    },
  },
  {
    id: 'local.memory.add',
    name: 'Add Memory (إضافة ذاكرة)',
    description: 'يحفظ ملاحظة في Long-Term Memory على الجهاز.',
    risk: 'local_write',
    scopes: ['memory:write-local'],
    inputHint: 'اكتب الذاكرة التي تريد حفظها على الجهاز.',
    execute: (context, input) => {
      const next = addLongTermMemory(context.agent.id, input, 'manual')
      return `Saved locally. Agent long-term memory items=${next.length}`
    },
  },
  {
    id: 'local.memory.clear',
    name: 'Clear Agent Memory (حذف ذاكرة الوكيل)',
    description: 'يحذف الذاكرة الطويلة وملفات المعرفة لهذا الوكيل. يتطلب موافقة بشرية.',
    risk: 'delete',
    scopes: ['memory:delete'],
    inputHint: 'اكتب DELETE للتأكيد ثم وافق يدوياً.',
    execute: (context, input) => {
      if (input.trim() !== 'DELETE') throw new Error('DELETE_CONFIRMATION_TEXT_REQUIRED')
      clearAllAgentMemory(context.agent.id)
      return 'Agent long-term memory and knowledge were deleted locally.'
    },
  },
]

export function listBuiltinTools(): ToolDefinition[] {
  return [...BUILTIN_TOOLS]
}

export function getBuiltinTool(toolId: string): ToolDefinition | null {
  return BUILTIN_TOOLS.find((tool) => tool.id === toolId) ?? null
}

export function loadToolCallLog(agentId?: string): ToolCallRecord[] {
  const all = readToolLog()
  return agentId ? all.filter((record) => record.agentId === agentId) : all
}

export function clearToolCallLog(agentId: string): void {
  const next = readToolLog().filter((record) => record.agentId !== agentId)
  localStorage.setItem(TOOL_LOG_KEY, JSON.stringify(next))
}

export async function executeBuiltinTool(
  agent: AgentSpec,
  toolId: string,
  input: string,
  approvedByHuman = false,
): Promise<{ record: ToolCallRecord; gate: ToolGateResult }> {
  const tool = getBuiltinTool(toolId)
  if (!tool) {
    const gate: ToolGateResult = { status: 'blocked', reason: 'Unknown tool.', checks: ['tool registry: missing'] }
    const record: ToolCallRecord = {
      id: newId('toolcall'),
      agentId: agent.id,
      toolId,
      input,
      output: '',
      status: 'blocked',
      approvedByHuman,
      monetaryCostUsd: 0,
      createdAt: new Date().toISOString(),
      checks: gate.checks,
      error: gate.reason,
    }
    saveToolRecord(record)
    return { record, gate }
  }

  const gate = evaluateToolGate(agent, tool, approvedByHuman)
  if (gate.status !== 'allowed') {
    const record: ToolCallRecord = {
      id: newId('toolcall'),
      agentId: agent.id,
      toolId,
      input,
      output: '',
      status: gate.status === 'approval_required' ? 'denied' : 'blocked',
      approvedByHuman,
      monetaryCostUsd: 0,
      createdAt: new Date().toISOString(),
      checks: gate.checks,
      error: gate.reason,
    }
    if (gate.status === 'blocked') saveToolRecord(record)
    return { record, gate }
  }

  try {
    const output = await tool.execute({ agent }, input)
    const record: ToolCallRecord = {
      id: newId('toolcall'),
      agentId: agent.id,
      toolId,
      input,
      output,
      status: 'success',
      approvedByHuman,
      monetaryCostUsd: 0,
      createdAt: new Date().toISOString(),
      checks: [...gate.checks, 'tool execution: completed locally'],
    }
    saveToolRecord(record)
    return { record, gate }
  } catch (error) {
    const record: ToolCallRecord = {
      id: newId('toolcall'),
      agentId: agent.id,
      toolId,
      input,
      output: '',
      status: 'failed',
      approvedByHuman,
      monetaryCostUsd: 0,
      createdAt: new Date().toISOString(),
      checks: gate.checks,
      error: error instanceof Error ? error.message : String(error),
    }
    saveToolRecord(record)
    return { record, gate }
  }
}
