import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { evaluateToolGate, type ToolDefinition, type ToolGateResult, type ToolRisk } from './toolSdk'
import type { AgentSpec } from './types'

export interface McpToolPolicy {
  name: string
  description?: string
  risk: ToolRisk
  enabled: boolean
}

export interface McpServerConfig {
  id: string
  name: string
  url: string
  trusted: boolean
  createdAt: string
  toolPolicies: Record<string, McpToolPolicy>
}

export interface McpDiscoveredTool {
  name: string
  description: string
  inputSchema?: unknown
}

export interface McpCallResult {
  status: 'success' | 'blocked' | 'approval_required' | 'failed'
  output: string
  monetaryCostUsd: 0
  gate: ToolGateResult
  error?: string
}

const MCP_SERVERS_KEY = 'agent-ia-factory.mcp-servers.v1'
const REQUEST_TIMEOUT_MS = 10_000
const MAX_SERVER_COUNT = 12
const MAX_DISCOVERED_TOOLS = 100

function newId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(MCP_SERVERS_KEY)
    return raw ? JSON.parse(raw) as McpServerConfig[] : []
  } catch {
    return []
  }
}

function writeServers(servers: McpServerConfig[]): void {
  localStorage.setItem(MCP_SERVERS_KEY, JSON.stringify(servers.slice(0, MAX_SERVER_COUNT)))
}

export function validateMcpServerUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('MCP_URL_INVALID')
  }

  if (url.protocol !== 'https:') throw new Error('MCP_HTTPS_REQUIRED')
  if (url.username || url.password) throw new Error('MCP_URL_CREDENTIALS_FORBIDDEN')
  if (url.hash) throw new Error('MCP_URL_FRAGMENT_FORBIDDEN')
  if (url.href.length > 2_000) throw new Error('MCP_URL_TOO_LONG')

  return url
}

export function loadMcpServers(): McpServerConfig[] {
  return readServers()
}

export function addMcpServer(name: string, rawUrl: string): McpServerConfig[] {
  const url = validateMcpServerUrl(rawUrl)
  const current = readServers()
  if (current.some((server) => server.url === url.href)) throw new Error('MCP_SERVER_ALREADY_EXISTS')
  if (current.length >= MAX_SERVER_COUNT) throw new Error('MCP_SERVER_LIMIT_REACHED')

  const server: McpServerConfig = {
    id: newId(),
    name: name.trim().slice(0, 120) || url.hostname,
    url: url.href,
    trusted: false,
    createdAt: new Date().toISOString(),
    toolPolicies: {},
  }
  const next = [server, ...current]
  writeServers(next)
  return next
}

export function updateMcpServer(server: McpServerConfig): McpServerConfig[] {
  validateMcpServerUrl(server.url)
  const next = [server, ...readServers().filter((item) => item.id !== server.id)]
  writeServers(next)
  return next
}

export function deleteMcpServer(serverId: string): McpServerConfig[] {
  const next = readServers().filter((server) => server.id !== serverId)
  writeServers(next)
  return next
}

export function mcpAgentToolId(serverId: string, toolName: string): string {
  return `mcp:${serverId}:${toolName}`
}

function createTimedFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort('MCP_REQUEST_TIMEOUT'), REQUEST_TIMEOUT_MS)
    const upstreamSignal = init?.signal
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason)
    upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true })

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      })
    } finally {
      window.clearTimeout(timeout)
      upstreamSignal?.removeEventListener('abort', abortFromUpstream)
    }
  }
}

async function withMcpClient<T>(server: McpServerConfig, action: (client: Client) => Promise<T>): Promise<T> {
  if (!server.trusted) throw new Error('MCP_SERVER_NOT_TRUSTED')
  const url = validateMcpServerUrl(server.url)

  const transport = new StreamableHTTPClientTransport(url, {
    fetch: createTimedFetch(),
    requestInit: {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    },
    reconnectionOptions: {
      maxReconnectionDelay: 1_000,
      initialReconnectionDelay: 250,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 0,
    },
    onInsufficientScope: 'throw',
    maxStepUpRetries: 0,
  })

  const client = new Client({
    name: 'agent-ia-factory-browser',
    version: '0.5.0',
  })

  try {
    await client.connect(transport)
    return await action(client)
  } finally {
    try {
      await client.close()
    } catch {
      // A failed remote close must not turn a completed local security decision
      // into an unhandled UI failure.
    }
  }
}

export async function discoverMcpTools(server: McpServerConfig): Promise<McpDiscoveredTool[]> {
  return withMcpClient(server, async (client) => {
    const result = await client.listTools()
    return result.tools.slice(0, MAX_DISCOVERED_TOOLS).map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema,
    }))
  })
}

export function applyDiscoveredMcpTools(
  server: McpServerConfig,
  tools: McpDiscoveredTool[],
): McpServerConfig {
  const policies = { ...server.toolPolicies }
  for (const tool of tools.slice(0, MAX_DISCOVERED_TOOLS)) {
    const existing = policies[tool.name]
    policies[tool.name] = existing ?? {
      name: tool.name,
      description: tool.description,
      risk: 'external_write',
      enabled: false,
    }
  }
  return { ...server, toolPolicies: policies }
}

function syntheticToolDefinition(server: McpServerConfig, policy: McpToolPolicy): ToolDefinition {
  return {
    id: mcpAgentToolId(server.id, policy.name),
    name: `MCP: ${policy.name}`,
    description: policy.description ?? 'Remote MCP tool',
    risk: policy.risk,
    scopes: [`mcp:server:${server.id}`, `mcp:tool:${policy.name}`],
    inputHint: 'JSON object only',
    execute: () => '',
  }
}

export async function callMcpTool(
  agent: AgentSpec,
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  approvedByHuman = false,
  callIndex = 0,
): Promise<McpCallResult> {
  if (!server.trusted) {
    return {
      status: 'blocked',
      output: '',
      monetaryCostUsd: 0,
      gate: { status: 'blocked', reason: 'MCP server is not trusted.', checks: ['mcp trust gate: blocked'] },
      error: 'MCP_SERVER_NOT_TRUSTED',
    }
  }

  const policy = server.toolPolicies[toolName]
  if (!policy || !policy.enabled) {
    return {
      status: 'blocked',
      output: '',
      monetaryCostUsd: 0,
      gate: { status: 'blocked', reason: 'MCP tool is not enabled.', checks: ['mcp tool policy: disabled'] },
      error: 'MCP_TOOL_NOT_ENABLED',
    }
  }

  const gate = evaluateToolGate(agent, syntheticToolDefinition(server, policy), approvedByHuman, callIndex)
  if (gate.status !== 'allowed') {
    return {
      status: gate.status === 'approval_required' ? 'approval_required' : 'blocked',
      output: '',
      monetaryCostUsd: 0,
      gate,
      error: gate.reason,
    }
  }

  try {
    const result = await withMcpClient(server, (client) => client.callTool({
      name: toolName,
      arguments: args,
    }))

    return {
      status: 'success',
      output: JSON.stringify(result, null, 2).slice(0, 40_000),
      monetaryCostUsd: 0,
      gate: {
        ...gate,
        checks: [...gate.checks, 'MCP transport: HTTPS Streamable HTTP', 'MCP cookies: omitted', 'MCP reconnect retries: 0'],
      },
    }
  } catch (error) {
    return {
      status: 'failed',
      output: '',
      monetaryCostUsd: 0,
      gate,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
