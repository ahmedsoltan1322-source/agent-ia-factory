export interface McpAuditRecord {
  id: string
  agentId: string
  serverId: string
  serverUrl: string
  toolName: string
  argsJson: string
  status: 'success' | 'blocked' | 'approval_required' | 'failed'
  output: string
  approvedByHuman: boolean
  monetaryCostUsd: 0
  checks: string[]
  error?: string
  createdAt: string
}

const KEY = 'agent-ia-factory.mcp-audit.v1'
const MAX_RECORDS = 120

function readAll(): McpAuditRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as McpAuditRecord[] : []
  } catch {
    return []
  }
}

export function loadMcpAudit(agentId?: string): McpAuditRecord[] {
  const all = readAll()
  return agentId ? all.filter((record) => record.agentId === agentId) : all
}

export function appendMcpAudit(record: Omit<McpAuditRecord, 'id' | 'createdAt' | 'monetaryCostUsd'>): McpAuditRecord[] {
  const complete: McpAuditRecord = {
    ...record,
    id: `mcpaudit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    monetaryCostUsd: 0,
    createdAt: new Date().toISOString(),
  }
  const next = [complete, ...readAll()].slice(0, MAX_RECORDS)
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function clearMcpAudit(agentId: string): void {
  const next = readAll().filter((record) => record.agentId !== agentId)
  localStorage.setItem(KEY, JSON.stringify(next))
}
