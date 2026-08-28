import { evaluateToolGate, type ToolDefinition, type ToolGateResult, type ToolRisk } from './toolSdk'
import type { AgentSpec } from './types'

export type McpTransport = 'local_mock' | 'streamable_http' | 'stdio'
export type McpServerKind = 'local_test' | 'external'

export interface McpToolDescriptor {
  id: string
  name: string
  description: string
  risk: ToolRisk
  scopes: string[]
  inputHint: string
}

export interface McpServerDescriptor {
  id: string
  name: string
  description: string
  protocol: 'mcp'
  transport: McpTransport
  kind: McpServerKind
  networkAccess: boolean
  enabledByDefault: false
  endpoint?: string
  tools: McpToolDescriptor[]
}

export interface McpGateResult extends ToolGateResult {
  serverChecks: string[]
}

export interface McpCallRecord {
  id: string
  agentId: string
  serverId: string
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

const MCP_LOG_KEY = 'agent-ia-factory.mcp-calls.v1'
const MAX_MCP_LOG = 120

const LOCAL_SANDBOX: McpServerDescriptor = {
  id: 'mcp.local-sandbox',
  name: 'Local MCP Sandbox (مختبر MCP المحلي)',
  description: 'خادم MCP تجريبي داخل المتصفح لا يستعمل الشبكة ولا الأسرار. هدفه اختبار الحوكمة قبل أي خادم خارجي.',
  protocol: 'mcp',
  transport: 'local_mock',
  kind: 'local_test',
  networkAccess: false,
  enabledByDefault: false,
  tools: [
    {
      id: 'mcp.local-sandbox.echo',
      name: 'MCP Echo (إرجاع النص)',
      description: 'يعيد النص نفسه من داخل مختبر MCP المحلي.',
      risk: 'read_only',
      scopes: ['mcp:local', 'text:read'],
      inputHint: 'اكتب نصاً لاختبار مسار MCP المحلي.',
    },
    {
      id: 'mcp.local-sandbox.normalize',
      name: 'MCP Normalize (تنظيف النص)',
      description: 'ينظف المسافات والأسطر محلياً لإثبات استدعاء أداة MCP دون شبكة.',
      risk: 'read_only',
      scopes: ['mcp:local', 'text:read'],
      inputHint: 'اكتب نصاً يحتوي مسافات أو أسطر زائدة.',
    },
  ],
}

const MCP_SERVERS: McpServerDescriptor[] = [LOCAL_SANDBOX]

function newId(): string {
  return `mcpcall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readLog(): McpCallRecord[] {
  try {
    const raw = localStorage.getItem(MCP_LOG_KEY)
    return raw ? JSON.parse(raw) as McpCallRecord[] : []
  } catch {
    return []
  }
}

function saveRecord(record: McpCallRecord): void {
  const next = [record, ...readLog()].slice(0, MAX_MCP_LOG)
  localStorage.setItem(MCP_LOG_KEY, JSON.stringify(next))
}

export function listMcpServers(): McpServerDescriptor[] {
  return MCP_SERVERS.map((server) => ({ ...server, tools: server.tools.map((tool) => ({ ...tool })) }))
}

export function getMcpServer(serverId: string): McpServerDescriptor | null {
  return MCP_SERVERS.find((server) => server.id === serverId) ?? null
}

export function loadMcpCallLog(agentId?: string): McpCallRecord[] {
  const all = readLog()
  return agentId ? all.filter((record) => record.agentId === agentId) : all
}

export function clearMcpCallLog(agentId: string): void {
  localStorage.setItem(MCP_LOG_KEY, JSON.stringify(readLog().filter((record) => record.agentId !== agentId)))
}

export function validateMcpServerDescriptor(server: McpServerDescriptor): string[] {
  const errors: string[] = []
  if (!server.id.startsWith('mcp.')) errors.push('server id must start with mcp.')
  if (server.protocol !== 'mcp') errors.push('protocol must be mcp')
  if (server.enabledByDefault !== false) errors.push('MCP servers must be disabled by default')
  if (server.kind === 'local_test' && server.networkAccess) errors.push('local_test server cannot request network access')
  if (server.transport === 'local_mock' && server.endpoint) errors.push('local_mock server must not define an endpoint')
  if (server.transport !== 'local_mock' && !server.endpoint) errors.push('external transport must declare an endpoint')
  if (server.tools.length === 0) errors.push('server must declare at least one tool')
  const ids = new Set<string>()
  for (const tool of server.tools) {
    if (!tool.id.startsWith(`${server.id}.`)) errors.push(`tool ${tool.id} must be namespaced under server id`)
    if (ids.has(tool.id)) errors.push(`duplicate tool id: ${tool.id}`)
    ids.add(tool.id)
  }
  return errors
}

export function evaluateMcpGate(
  agent: AgentSpec,
  server: McpServerDescriptor,
  tool: McpToolDescriptor,
  approvedByHuman = false,
  callIndex = 0,
): McpGateResult {
  const serverChecks = [
    `mcp server: ${server.id}`,
    `transport: ${server.transport}`,
    `network access: ${server.networkAccess}`,
    `enabled by default: ${server.enabledByDefault}`,
  ]

  const descriptorErrors = validateMcpServerDescriptor(server)
  if (descriptorErrors.length > 0) {
    return {
      status: 'blocked',
      reason: `Invalid MCP server descriptor: ${descriptorErrors.join('; ')}`,
      checks: [...serverChecks, ...descriptorErrors.map((error) => `descriptor: ${error}`)],
      serverChecks,
    }
  }

  if (server.transport !== 'local_mock' || server.kind !== 'local_test' || server.networkAccess) {
    return {
      status: 'blocked',
      reason: 'External MCP transports are disabled in Phase 3B. Only the local sandbox may execute.',
      checks: [...serverChecks, 'external MCP transport gate: blocked'],
      serverChecks,
    }
  }
  serverChecks.push('local MCP transport gate: allowed')

  const toolDefinition: ToolDefinition = {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    risk: tool.risk,
    scopes: tool.scopes,
    inputHint: tool.inputHint,
    execute: () => '',
  }
  const toolGate = evaluateToolGate(agent, toolDefinition, approvedByHuman, callIndex)
  return {
    ...toolGate,
    checks: [...serverChecks, ...toolGate.checks],
    serverChecks,
  }
}

function executeLocalSandbox(toolId: string, input: string): string {
  if (toolId === 'mcp.local-sandbox.echo') return input
  if (toolId === 'mcp.local-sandbox.normalize') return input.trim().replace(/\s+/gu, ' ')
  throw new Error('UNKNOWN_LOCAL_MCP_TOOL')
}

export async function executeMcpTool(
  agent: AgentSpec,
  serverId: string,
  toolId: string,
  input: string,
  approvedByHuman = false,
  callIndex = 0,
): Promise<{ record: McpCallRecord; gate: McpGateResult }> {
  const server = getMcpServer(serverId)
  const tool = server?.tools.find((item) => item.id === toolId) ?? null

  if (!server || !tool) {
    const gate: McpGateResult = {
      status: 'blocked',
      reason: 'Unknown MCP server or tool.',
      checks: ['MCP registry lookup: blocked'],
      serverChecks: ['MCP registry lookup: missing'],
    }
    const record: McpCallRecord = {
      id: newId(), agentId: agent.id, serverId, toolId, input, output: '', status: 'blocked', approvedByHuman,
      monetaryCostUsd: 0, createdAt: new Date().toISOString(), checks: gate.checks, error: gate.reason,
    }
    saveRecord(record)
    return { record, gate }
  }

  const gate = evaluateMcpGate(agent, server, tool, approvedByHuman, callIndex)
  if (gate.status !== 'allowed') {
    const record: McpCallRecord = {
      id: newId(), agentId: agent.id, serverId, toolId, input, output: '',
      status: gate.status === 'approval_required' ? 'denied' : 'blocked', approvedByHuman,
      monetaryCostUsd: 0, createdAt: new Date().toISOString(), checks: gate.checks, error: gate.reason,
    }
    if (gate.status === 'blocked') saveRecord(record)
    return { record, gate }
  }

  try {
    const output = executeLocalSandbox(toolId, input)
    const record: McpCallRecord = {
      id: newId(), agentId: agent.id, serverId, toolId, input, output, status: 'success', approvedByHuman,
      monetaryCostUsd: 0, createdAt: new Date().toISOString(), checks: [...gate.checks, 'MCP execution: completed in local sandbox'],
    }
    saveRecord(record)
    return { record, gate }
  } catch (error) {
    const record: McpCallRecord = {
      id: newId(), agentId: agent.id, serverId, toolId, input, output: '', status: 'failed', approvedByHuman,
      monetaryCostUsd: 0, createdAt: new Date().toISOString(), checks: gate.checks,
      error: error instanceof Error ? error.message : String(error),
    }
    saveRecord(record)
    return { record, gate }
  }
}
