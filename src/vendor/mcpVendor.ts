import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

export const MCP_MODERN_PROTOCOL_VERSION = '2026-07-28' as const

export interface McpVendorTool {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpVendorClient {
  listTools(): Promise<{ tools: McpVendorTool[] }>
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<unknown>
  close(): Promise<void>
}

export async function connectMcpBrowserClient(
  url: URL,
  fetchImpl: typeof fetch,
): Promise<McpVendorClient> {
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: fetchImpl,
    requestInit: {
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
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

  const client = new Client(
    {
      name: 'agent-ia-factory-browser',
      version: '0.6.0',
    },
    {
      versionNegotiation: {
        mode: { pin: MCP_MODERN_PROTOCOL_VERSION },
      },
    },
  )

  await client.connect(transport)
  if (client.getNegotiatedProtocolVersion() !== MCP_MODERN_PROTOCOL_VERSION) {
    try {
      await client.close()
    } catch {
      // Closing a rejected connection is best effort only.
    }
    throw new Error('MCP_PROTOCOL_VERSION_MISMATCH')
  }
  return client as McpVendorClient
}
