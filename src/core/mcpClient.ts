import { evaluateToolGate, type ToolDefinition, type ToolGateResult } from './toolSdk'
import type { AgentSpec } from './types'

export const MCP_PROTOCOL_VERSION = '2026-07-28' as const

const SERVER_STORAGE_KEY = 'agent-ia-factory.mcp-servers.v1'
const CALL_LOG_KEY = 'agent-ia-factory.mcp-calls.v1'
const MAX_SERVERS = 12
const MAX_TOOLS_PER_SERVER = 100
const MAX_RESPONSE_CHARS = 1_000_000
const MAX_TOOL_INPUT_CHARS = 32_000
const MAX_TOOL_OUTPUT_CHARS = 80_000
const REQUEST_TIMEOUT_MS = 15_000

export interface McpServerDescriptor {
  id: string
  name: string
  endpoint: string
  protocolVersion: typeof MCP_PROTOCOL_VERSION
  enabled: boolean
  createdAt: string
}

export interface McpRemoteTool {
  serverId: string
  serverName: string
  id: string
  name: string
  description: string
  inputSchema?: unknown
}

export interface McpCallRecord {
  id: string
  agentId: string
  serverId: string
  serverName: string
  toolId: string
  remoteToolName: string
  input: string
  output: string
  status: 'success' | 'blocked' | 'denied' | 'failed'
  approvedByHuman: boolean
  callIndex: number
  monetaryCostUsd: 0
  createdAt: string
  checks: string[]
  error?: string
}

interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: string | number
  result: unknown
}

interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: string | number | null
  error: {
    code?: number
    message?: string
    data?: unknown
  }
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function readJsonArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    const value = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value as T[] : []
  } catch {
    return []
  }
}

function writeJsonArray<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

function isBlockedIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!match) return false
  const parts = match.slice(1).map(Number)
  if (parts.some((part) => part < 0 || part > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a >= 224) return true
  return false
}

export function normalizeAndValidateMcpEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('MCP_ENDPOINT_INVALID_URL')
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
    throw new Error('MCP_ENDPOINT_HTTPS_REQUIRED')
  }
  if (url.username || url.password) throw new Error('MCP_ENDPOINT_EMBEDDED_CREDENTIALS_BLOCKED')
  if (url.search || url.hash) throw new Error('MCP_ENDPOINT_QUERY_OR_FRAGMENT_BLOCKED')
  if (isBlockedIpv4(url.hostname) && !isLoopbackHostname(url.hostname)) {
    throw new Error('MCP_ENDPOINT_PRIVATE_NETWORK_BLOCKED')
  }
  if (url.hostname.includes(':') && !isLoopbackHostname(url.hostname)) {
    throw new Error('MCP_ENDPOINT_IPV6_REQUIRES_FUTURE_REVIEW')
  }

  url.pathname = url.pathname.replace(/\/{2,}/g, '/')
  return url.toString()
}

export function loadMcpServers(): McpServerDescriptor[] {
  return readJsonArray<McpServerDescriptor>(SERVER_STORAGE_KEY)
    .filter((server) => server && typeof server.id === 'string' && typeof server.endpoint === 'string')
    .slice(0, MAX_SERVERS)
}

export function registerMcpServer(name: string, endpoint: string): McpServerDescriptor[] {
  const normalizedEndpoint = normalizeAndValidateMcpEndpoint(endpoint)
  const cleanName = name.trim().slice(0, 100)
  if (!cleanName) throw new Error('MCP_SERVER_NAME_REQUIRED')

  const current = loadMcpServers()
  if (current.some((server) => server.endpoint === normalizedEndpoint)) {
    throw new Error('MCP_SERVER_ALREADY_REGISTERED')
  }
  if (current.length >= MAX_SERVERS) throw new Error('MCP_SERVER_LIMIT_REACHED')

  const server: McpServerDescriptor = {
    id: newId('mcp'),
    name: cleanName,
    endpoint: normalizedEndpoint,
    protocolVersion: MCP_PROTOCOL_VERSION,
    enabled: true,
    createdAt: new Date().toISOString(),
  }
  const next = [server, ...current]
  writeJsonArray(SERVER_STORAGE_KEY, next)
  return next
}

export function setMcpServerEnabled(serverId: string, enabled: boolean): McpServerDescriptor[] {
  const next = loadMcpServers().map((server) => server.id === serverId ? { ...server, enabled } : server)
  writeJsonArray(SERVER_STORAGE_KEY, next)
  return next
}

export function removeMcpServer(serverId: string): McpServerDescriptor[] {
  const next = loadMcpServers().filter((server) => server.id !== serverId)
  writeJsonArray(SERVER_STORAGE_KEY, next)
  return next
}

function requestMeta(): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': {
      name: 'agent-ia-factory',
      title: 'Agent IA Factory',
      version: '0.4.0',
    },
    'io.modelcontextprotocol/clientCapabilities': {},
  }
}

function parseSsePayload(text: string, expectedId: string): JsonRpcResponse {
  const events = text.split(/\r?\n\r?\n/u)
  for (const event of events) {
    const data = event
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim()
    if (!data || data === '[DONE]') continue
    try {
      const parsed = JSON.parse(data) as JsonRpcResponse
      if (String(parsed.id) === expectedId) return parsed
    } catch {
      // Ignore unrelated/non-JSON SSE events; the matching JSON-RPC result is required below.
    }
  }
  throw new Error('MCP_SSE_MATCHING_RESPONSE_NOT_FOUND')
}

function parseRpcResponse(text: string, contentType: string, expectedId: string): JsonRpcResponse {
  if (!text.trim()) throw new Error('MCP_EMPTY_RESPONSE')
  if (text.length > MAX_RESPONSE_CHARS) throw new Error('MCP_RESPONSE_TOO_LARGE')

  if (contentType.includes('text/event-stream')) return parseSsePayload(text, expectedId)

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('MCP_RESPONSE_NOT_JSON')
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed]
  const matching = candidates.find((item) => {
    if (!item || typeof item !== 'object') return false
    const response = item as Partial<JsonRpcResponse>
    return response.jsonrpc === '2.0' && String(response.id) === expectedId
  })
  if (!matching) throw new Error('MCP_MATCHING_RESPONSE_NOT_FOUND')
  return matching as JsonRpcResponse
}

async function mcpRequest(
  server: McpServerDescriptor,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  if (!server.enabled) throw new Error('MCP_SERVER_DISABLED')
  const endpoint = normalizeAndValidateMcpEndpoint(server.endpoint)
  const requestId = newId('rpc')
  const name = typeof params.name === 'string' ? params.name : undefined
  if (name && !/^[A-Za-z0-9._:/-]{1,128}$/u.test(name)) throw new Error('MCP_TOOL_NAME_UNSAFE_FOR_HEADER')

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort('MCP_REQUEST_TIMEOUT'), REQUEST_TIMEOUT_MS)

  try {
    const body = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params: {
        ...params,
        _meta: requestMeta(),
      },
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      'Mcp-Method': method,
    }
    if (name) headers['Mcp-Name'] = name

    const response = await fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const declaredLength = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_CHARS) {
      throw new Error('MCP_RESPONSE_TOO_LARGE')
    }

    const text = await response.text()
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('MCP_AUTH_REQUIRED_NOT_SUPPORTED_YET')
      }
      throw new Error(`MCP_HTTP_${response.status}:${text.slice(0, 500)}`)
    }

    const rpc = parseRpcResponse(text, response.headers.get('content-type') ?? '', requestId)
    if ('error' in rpc) {
      throw new Error(`MCP_RPC_${rpc.error.code ?? 'ERROR'}:${rpc.error.message ?? 'Unknown MCP error'}`)
    }
    return rpc.result
  } catch (error) {
    if (controller.signal.aborted) throw new Error('MCP_REQUEST_TIMEOUT')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function discoverMcpServer(server: McpServerDescriptor): Promise<unknown> {
  return mcpRequest(server, 'server/discover')
}

function normalizeRemoteTool(server: McpServerDescriptor, value: unknown): McpRemoteTool | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.name !== 'string' || !/^[A-Za-z0-9._:/-]{1,128}$/u.test(raw.name)) return null
  const description = typeof raw.description === 'string' ? raw.description.slice(0, 2_000) : 'Remote MCP tool (أداة MCP بعيدة)'
  return {
    serverId: server.id,
    serverName: server.name,
    id: `mcp:${server.id}:${raw.name}`,
    name: raw.name,
    description,
    inputSchema: raw.inputSchema,
  }
}

export async function listMcpTools(server: McpServerDescriptor): Promise<McpRemoteTool[]> {
  const result = await mcpRequest(server, 'tools/list')
  if (!result || typeof result !== 'object') throw new Error('MCP_TOOLS_LIST_INVALID')
  const rawTools = (result as Record<string, unknown>).tools
  if (!Array.isArray(rawTools)) throw new Error('MCP_TOOLS_LIST_INVALID')

  return rawTools
    .slice(0, MAX_TOOLS_PER_SERVER)
    .map((tool) => normalizeRemoteTool(server, tool))
    .filter((tool): tool is McpRemoteTool => tool !== null)
}

export function mcpToolDefinition(tool: McpRemoteTool): ToolDefinition {
  return {
    id: tool.id,
    name: `${tool.name} — ${tool.serverName}`,
    description: tool.description,
    risk: 'external_write',
    scopes: ['network:mcp', `mcp-server:${tool.serverId}`, `mcp-tool:${tool.name}`],
    inputHint: 'JSON object only. Remote MCP calls always require explicit human approval.',
    execute: () => {
      throw new Error('MCP_TOOL_MUST_USE_SECURE_MCP_EXECUTOR')
    },
  }
}

function parseArguments(input: string): Record<string, unknown> {
  const trimmed = input.trim()
  if (trimmed.length > MAX_TOOL_INPUT_CHARS) throw new Error('MCP_TOOL_INPUT_TOO_LARGE')
  let parsed: unknown
  try {
    parsed = trimmed ? JSON.parse(trimmed) : {}
  } catch {
    throw new Error('MCP_TOOL_INPUT_MUST_BE_JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP_TOOL_INPUT_MUST_BE_OBJECT')
  }
  return parsed as Record<string, unknown>
}

function formatToolResult(result: unknown): string {
  if (!result || typeof result !== 'object') return String(result ?? '')
  const value = result as Record<string, unknown>
  if (value.resultType === 'input_required') {
    throw new Error('MCP_INPUT_REQUIRED_NEEDS_FUTURE_EXPLICIT_UI_FLOW')
  }

  const content = value.content
  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (!item || typeof item !== 'object') return ''
        const block = item as Record<string, unknown>
        if (block.type === 'text' && typeof block.text === 'string') return block.text
        return JSON.stringify(block)
      })
      .filter(Boolean)
      .join('\n')
    return text.slice(0, MAX_TOOL_OUTPUT_CHARS)
  }
  return JSON.stringify(result).slice(0, MAX_TOOL_OUTPUT_CHARS)
}

function readMcpCallLog(): McpCallRecord[] {
  return readJsonArray<McpCallRecord>(CALL_LOG_KEY).slice(0, 120)
}

function saveMcpCallRecord(record: McpCallRecord): void {
  writeJsonArray(CALL_LOG_KEY, [record, ...readMcpCallLog()].slice(0, 120))
}

export function loadMcpCallLog(agentId?: string): McpCallRecord[] {
  const all = readMcpCallLog()
  return agentId ? all.filter((record) => record.agentId === agentId) : all
}

export function clearMcpCallLog(agentId: string): void {
  writeJsonArray(CALL_LOG_KEY, readMcpCallLog().filter((record) => record.agentId !== agentId))
}

function blockedRecord(
  agent: AgentSpec,
  server: McpServerDescriptor,
  tool: McpRemoteTool,
  input: string,
  approvedByHuman: boolean,
  callIndex: number,
  gate: ToolGateResult,
): McpCallRecord {
  return {
    id: newId('mcpcall'),
    agentId: agent.id,
    serverId: server.id,
    serverName: server.name,
    toolId: tool.id,
    remoteToolName: tool.name,
    input,
    output: '',
    status: gate.status === 'approval_required' ? 'denied' : 'blocked',
    approvedByHuman,
    callIndex,
    monetaryCostUsd: 0,
    createdAt: new Date().toISOString(),
    checks: gate.checks,
    error: gate.reason,
  }
}

export async function executeMcpTool(
  agent: AgentSpec,
  server: McpServerDescriptor,
  tool: McpRemoteTool,
  input: string,
  approvedByHuman = false,
  callIndex = 0,
): Promise<{ record: McpCallRecord; gate: ToolGateResult }> {
  const definition = mcpToolDefinition(tool)
  const baseGate = evaluateToolGate(agent, definition, approvedByHuman, callIndex)

  if (baseGate.status !== 'allowed') {
    const record = blockedRecord(agent, server, tool, input, approvedByHuman, callIndex, baseGate)
    if (baseGate.status === 'blocked') saveMcpCallRecord(record)
    return { record, gate: baseGate }
  }

  if (!approvedByHuman) {
    const gate: ToolGateResult = {
      status: 'approval_required',
      reason: 'Every remote MCP tools/call requires explicit human approval.',
      checks: [...baseGate.checks, 'remote MCP mandatory human approval: required'],
    }
    return { record: blockedRecord(agent, server, tool, input, false, callIndex, gate), gate }
  }

  const checks = [
    ...baseGate.checks,
    'remote MCP mandatory human approval: granted',
    'transport: Streamable HTTP / JSON-RPC 2.0',
    `protocol version: ${MCP_PROTOCOL_VERSION}`,
    'credentials mode: omit',
    'redirects: blocked',
    'mandatory monetary spend: 0 USD',
  ]

  try {
    const args = parseArguments(input)
    const result = await mcpRequest(server, 'tools/call', { name: tool.name, arguments: args })
    const output = formatToolResult(result)
    const record: McpCallRecord = {
      id: newId('mcpcall'),
      agentId: agent.id,
      serverId: server.id,
      serverName: server.name,
      toolId: tool.id,
      remoteToolName: tool.name,
      input,
      output,
      status: 'success',
      approvedByHuman: true,
      callIndex,
      monetaryCostUsd: 0,
      createdAt: new Date().toISOString(),
      checks: [...checks, 'remote MCP execution: completed'],
    }
    saveMcpCallRecord(record)
    return { record, gate: { status: 'allowed', reason: 'Remote MCP call passed all gates.', checks } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const record: McpCallRecord = {
      id: newId('mcpcall'),
      agentId: agent.id,
      serverId: server.id,
      serverName: server.name,
      toolId: tool.id,
      remoteToolName: tool.name,
      input,
      output: '',
      status: 'failed',
      approvedByHuman: true,
      callIndex,
      monetaryCostUsd: 0,
      createdAt: new Date().toISOString(),
      checks,
      error: message,
    }
    saveMcpCallRecord(record)
    return { record, gate: { status: 'allowed', reason: 'Policy allowed the call; transport/tool execution failed.', checks } }
  }
}
