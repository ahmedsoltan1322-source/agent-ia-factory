import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

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
  await client.connect(transport)
  return client as McpVendorClient
}
