import { evaluateToolGate, type ToolDefinition, type ToolGateResult, type ToolRisk } from './toolSdk'
import type { AgentSpec } from './types'
import type { McpVendorClient } from '../vendor/mcpVendor'

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
const MCP_KILL_SWITCH_KEY = 'agent-ia-factory.mcp-kill-switch.v1'
const REQUEST_TIMEOUT_MS = 10_000
const MAX_SERVER_COUNT = 12
const MAX_DISCOVERED_TOOLS = 100
const MAX_ARGUMENT_CHARS = 32_000
const MAX_OUTPUT_CHARS = 40_000
const MAX_SCHEMA_CHARS = 64_000

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

function isIpv4Literal(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
}

export function isMcpKillSwitchActive(): boolean {
  try {
    return localStorage.getItem(MCP_KILL_SWITCH_KEY) === '1'
  } catch {
    return true
  }
}

export function setMcpKillSwitchActive(active: boolean): void {
  localStorage.setItem(MCP_KILL_SWITCH_KEY, active ? '1' : '0')
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
  if (url.search) throw new Error('MCP_URL_QUERY_FORBIDDEN')
  if (url.hash) throw new Error('MCP_URL_FRAGMENT_FORBIDDEN')
  if (url.href.length > 2_000) throw new Error('MCP_URL_TOO_LONG')

  const hostname = url.hostname.toLowerCase()
  if (isLocalHostname(hostname)) throw new Error('MCP_LOCAL_HOSTNAME_FORBIDDEN')
  if (isIpv4Literal(hostname) || hostname.includes(':')) throw new Error('MCP_RAW_IP_FORBIDDEN')

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
  const normalizedUrl = validateMcpServerUrl(server.url).href
  const current = readServers()
  const previous = current.find((item) => item.id === server.id)
  const endpointChanged = Boolean(previous && previous.url !== normalizedUrl)

  const safeServer: McpServerConfig = {
    ...server,
    url: normalizedUrl,
    trusted: endpointChanged ? false : server.trusted,
    toolPolicies: endpointChanged ? {} : server.toolPolicies,
  }

  const next = [safeServer, ...current.filter((item) => item.id !== server.id)]
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
    if (isMcpKillSwitchActive()) throw new Error('MCP_KILL_SWITCH_ACTIVE')

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
        referrerPolicy: 'no-referrer',
      })
    } finally {
      window.clearTimeout(timeout)
      upstreamSignal?.removeEventListener('abort', abortFromUpstream)
    }
  }
}

async function withMcpClient<T>(server: McpServerConfig, action: (client: McpVendorClient) => Promise<T>): Promise<T> {
  if (isMcpKillSwitchActive()) throw new Error('MCP_KILL_SWITCH_ACTIVE')
  if (!server.trusted) throw new Error('MCP_SERVER_NOT_TRUSTED')
  const url = validateMcpServerUrl(server.url)
  const { connectMcpBrowserClient } = await import('../vendor/mcpVendor')
  const client = await connectMcpBrowserClient(url, createTimedFetch())

  try {
    return await action(client)
  } finally {
    try {
      await client.close()
    } catch {
      // Remote close failures are intentionally contained.
    }
  }
}

function safeInputSchema(schema: unknown): unknown {
  if (schema === undefined) return undefined
  try {
    const encoded = JSON.stringify(schema)
    return encoded.length <= MAX_SCHEMA_CHARS ? schema : undefined
  } catch {
    return undefined
  }
}

function isSafeToolName(name: string): boolean {
  return /^[A-Za-z0-9._:/-]{1,128}$/u.test(name)
}

export async function discoverMcpTools(server: McpServerConfig): Promise<McpDiscoveredTool[]> {
  return withMcpClient(server, async (client) => {
    const result = await client.listTools()
    return result.tools
      .slice(0, MAX_DISCOVERED_TOOLS)
      .filter((tool) => isSafeToolName(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: (tool.description ?? '').slice(0, 2_000),
        inputSchema: safeInputSchema(tool.inputSchema),
      }))
  })
}

export function applyDiscoveredMcpTools(server: McpServerConfig, tools: McpDiscoveredTool[]): McpServerConfig {
  const policies = { ...server.toolPolicies }
  for (const tool of tools.slice(0, MAX_DISCOVERED_TOOLS)) {
    if (!isSafeToolName(tool.name)) continue
    policies[tool.name] = policies[tool.name] ?? {
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

function validateArguments(args: Record<string, unknown>): void {
  let encoded: string
  try {
    encoded = JSON.stringify(args)
  } catch {
    throw new Error('MCP_ARGUMENTS_NOT_SERIALIZABLE')
  }
  if (encoded.length > MAX_ARGUMENT_CHARS) throw new Error('MCP_ARGUMENTS_TOO_LARGE')
}

export async function callMcpTool(
  agent: AgentSpec,
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  approvedByHuman = false,
  callIndex = 0,
): Promise<McpCallResult> {
  if (isMcpKillSwitchActive()) {
    return {
      status: 'blocked', output: '', monetaryCostUsd: 0,
      gate: { status: 'blocked', reason: 'MCP Kill Switch is active.', checks: ['MCP kill switch: blocked'] },
      error: 'MCP_KILL_SWITCH_ACTIVE',
    }
  }

  if (!server.trusted) {
    return {
      status: 'blocked', output: '', monetaryCostUsd: 0,
      gate: { status: 'blocked', reason: 'MCP server is not trusted.', checks: ['mcp trust gate: blocked'] },
      error: 'MCP_SERVER_NOT_TRUSTED',
    }
  }

  const policy = server.toolPolicies[toolName]
  if (!policy || !policy.enabled) {
    return {
      status: 'blocked', output: '', monetaryCostUsd: 0,
      gate: { status: 'blocked', reason: 'MCP tool is not enabled.', checks: ['mcp tool policy: disabled'] },
      error: 'MCP_TOOL_NOT_ENABLED',
    }
  }

  if (!isSafeToolName(toolName)) {
    return {
      status: 'blocked', output: '', monetaryCostUsd: 0,
      gate: { status: 'blocked', reason: 'Unsafe MCP tool name.', checks: ['MCP tool-name validation: blocked'] },
      error: 'MCP_TOOL_NAME_INVALID',
    }
  }

  const gate = evaluateToolGate(agent, syntheticToolDefinition(server, policy), approvedByHuman, callIndex)
  if (gate.status !== 'allowed') {
    return {
      status: gate.status === 'approval_required' ? 'approval_required' : 'blocked',
      output: '', monetaryCostUsd: 0, gate, error: gate.reason,
    }
  }

  if (!approvedByHuman) {
    const approvalGate: ToolGateResult = {
      status: 'approval_required',
      reason: 'Every external MCP tool call requires explicit human approval in Phase 3C.',
      checks: [...gate.checks, 'external MCP mandatory human approval: required'],
    }
    return {
      status: 'approval_required', output: '', monetaryCostUsd: 0,
      gate: approvalGate, error: approvalGate.reason,
    }
  }

  try {
    validateArguments(args)
    const result = await withMcpClient(server, (client) => client.callTool({ name: toolName, arguments: args }))
    return {
      status: 'success',
      output: JSON.stringify(result, null, 2).slice(0, MAX_OUTPUT_CHARS),
      monetaryCostUsd: 0,
      gate: {
        ...gate,
        checks: [
          ...gate.checks,
          'external MCP mandatory human approval: granted',
          'MCP protocol: pinned 2026-07-28',
          'MCP transport: HTTPS Streamable HTTP',
          'MCP cookies: omitted',
          'MCP redirects: blocked',
          'MCP referrer: omitted',
          'MCP reconnect retries: 0',
          'mandatory monetary spend: 0 USD',
        ],
      },
    }
  } catch (error) {
    return {
      status: 'failed', output: '', monetaryCostUsd: 0, gate,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
