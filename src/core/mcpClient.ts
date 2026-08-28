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
const REQUEST_TIMEOUT_MS = 10_000
const MAX_SERVER_COUNT = 12
const MAX_DISCOVERED_TOOLS = 100
const MAX_MCP_ARGUMENT_CHARS = 32_000
const MAX_MCP_RESPONSE_BYTES = 1_500_000

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

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true

  // IPv6 literals are blocked in this first remote-MCP phase. A later explicit
  // LAN/self-host mode can add reviewed IPv6/private-network support.
  if (host.includes(':')) return true

  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host)
  if (!match) return false
  const [a, b] = match.slice(1).map(Number)
  if ([a, b].some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true

  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
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
  if (isPrivateOrLocalHostname(url.hostname)) throw new Error('MCP_PRIVATE_NETWORK_FORBIDDEN')
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

function limitMcpResponseBody(
  response: Response,
  controller: AbortController,
  cleanup: () => void,
): Response {
  const declaredLength = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_RESPONSE_BYTES) {
    controller.abort('MCP_RESPONSE_TOO_LARGE')
    cleanup()
    throw new Error('MCP_RESPONSE_TOO_LARGE')
  }

  if (!response.body) {
    cleanup()
    return response
  }

  const reader = response.body.getReader()
  let receivedBytes = 0

  const boundedBody = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          cleanup()
          streamController.close()
          return
        }

        receivedBytes += value.byteLength
        if (receivedBytes > MAX_MCP_RESPONSE_BYTES) {
          controller.abort('MCP_RESPONSE_TOO_LARGE')
          try {
            await reader.cancel('MCP_RESPONSE_TOO_LARGE')
          } catch {
            // The connection is already being aborted; cancellation is best-effort.
          }
          cleanup()
          streamController.error(new Error('MCP_RESPONSE_TOO_LARGE'))
          return
        }

        streamController.enqueue(value)
      } catch (error) {
        cleanup()
        streamController.error(error)
      }
    },
    async cancel(reason) {
      cleanup()
      try {
        await reader.cancel(reason)
      } catch {
        // Remote cancellation failures are intentionally contained.
      }
    },
  })

  return new Response(boundedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function createTimedFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController()
    const upstreamSignal = init?.signal
    let timeout: number | null = null
    let cleaned = false

    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      if (timeout !== null) window.clearTimeout(timeout)
      upstreamSignal?.removeEventListener('abort', abortFromUpstream)
    }

    const abortFromUpstream = () => {
      controller.abort(upstreamSignal?.reason)
      cleanup()
    }

    upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true })
    timeout = window.setTimeout(() => {
      controller.abort('MCP_REQUEST_TIMEOUT')
      cleanup()
    }, REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
        mode: 'cors',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      })
      return limitMcpResponseBody(response, controller, cleanup)
    } catch (error) {
      cleanup()
      throw error
    }
  }
}

async function withMcpClient<T>(server: McpServerConfig, action: (client: McpVendorClient) => Promise<T>): Promise<T> {
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

export function applyDiscoveredMcpTools(server: McpServerConfig, tools: McpDiscoveredTool[]): McpServerConfig {
  const policies = { ...server.toolPolicies }
  for (const tool of tools.slice(0, MAX_DISCOVERED_TOOLS)) {
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

function blockedMcpResult(reason: string, checks: string[], error: string): McpCallResult {
  return {
    status: 'blocked',
    output: '',
    monetaryCostUsd: 0,
    gate: { status: 'blocked', reason, checks },
    error,
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
    return blockedMcpResult('MCP server is not trusted.', ['mcp trust gate: blocked'], 'MCP_SERVER_NOT_TRUSTED')
  }

  const policy = server.toolPolicies[toolName]
  if (!policy || !policy.enabled) {
    return blockedMcpResult('MCP tool is not enabled.', ['mcp tool policy: disabled'], 'MCP_TOOL_NOT_ENABLED')
  }

  let argsJson: string
  try {
    argsJson = JSON.stringify(args)
  } catch {
    return blockedMcpResult('MCP arguments must be serializable JSON.', ['mcp argument serialization: blocked'], 'MCP_ARGUMENTS_NOT_SERIALIZABLE')
  }
  if (argsJson.length > MAX_MCP_ARGUMENT_CHARS) {
    return blockedMcpResult(
      'MCP arguments exceed the phone-safe size limit.',
      [`mcp argument characters: ${argsJson.length}`, `mcp argument maximum: ${MAX_MCP_ARGUMENT_CHARS}`],
      'MCP_ARGUMENTS_TOO_LARGE',
    )
  }

  const gate = evaluateToolGate(agent, syntheticToolDefinition(server, policy), approvedByHuman, callIndex)
  if (gate.status === 'blocked') {
    return { status: 'blocked', output: '', monetaryCostUsd: 0, gate, error: gate.reason }
  }

  // Remote MCP is a network boundary. Even a tool labelled read_only can leak
  // user data through its arguments, so every remote call requires a fresh,
  // explicit human approval in this phase.
  if (!approvedByHuman) {
    const approvalGate: ToolGateResult = {
      status: 'approval_required',
      reason: 'Every remote MCP tool call requires explicit human approval.',
      checks: [...gate.checks, 'remote MCP mandatory human approval: required'],
    }
    return {
      status: 'approval_required',
      output: '',
      monetaryCostUsd: 0,
      gate: approvalGate,
      error: approvalGate.reason,
    }
  }

  if (gate.status !== 'allowed') {
    return { status: 'blocked', output: '', monetaryCostUsd: 0, gate, error: gate.reason }
  }

  const approvedGate: ToolGateResult = {
    ...gate,
    checks: [...gate.checks, 'remote MCP mandatory human approval: granted'],
  }

  try {
    const result = await withMcpClient(server, (client) => client.callTool({ name: toolName, arguments: args }))
    return {
      status: 'success',
      output: JSON.stringify(result, null, 2).slice(0, 40_000),
      monetaryCostUsd: 0,
      gate: {
        ...approvedGate,
        checks: [
          ...approvedGate.checks,
          'MCP transport: HTTPS Streamable HTTP',
          'MCP cookies: omitted',
          'MCP referrer: omitted',
          'MCP redirects: blocked',
          'MCP response bytes: bounded',
          'MCP reconnect retries: 0',
        ],
      },
    }
  } catch (error) {
    return {
      status: 'failed',
      output: '',
      monetaryCostUsd: 0,
      gate: approvedGate,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
