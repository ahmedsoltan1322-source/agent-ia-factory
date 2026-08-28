import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const required = [
  'src/core/mcpClient.ts',
  'src/components/McpCenter.tsx',
  'docs/MCP_SECURITY.md',
]

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    throw new Error(`Missing Phase 3 MCP file: ${file}`)
  }
}

const client = fs.readFileSync(path.join(root, 'src/core/mcpClient.ts'), 'utf8')
const center = fs.readFileSync(path.join(root, 'src/components/McpCenter.tsx'), 'utf8')
const toolCenter = fs.readFileSync(path.join(root, 'src/components/ToolCenter.tsx'), 'utf8')
const docs = fs.readFileSync(path.join(root, 'docs/MCP_SECURITY.md'), 'utf8')

const requiredClientMarkers = [
  "MCP_PROTOCOL_VERSION = '2026-07-28'",
  "credentials: 'omit'",
  "redirect: 'error'",
  "referrerPolicy: 'no-referrer'",
  "cache: 'no-store'",
  "'MCP-Protocol-Version': MCP_PROTOCOL_VERSION",
  "'Mcp-Method': method",
  "headers['Mcp-Name'] = name",
  "'io.modelcontextprotocol/protocolVersion'",
  "'io.modelcontextprotocol/clientInfo'",
  "'io.modelcontextprotocol/clientCapabilities'",
  "Every remote MCP tools/call requires explicit human approval.",
  "agent.toolPolicy.allowedTools",
  "MCP_AUTH_REQUIRED_NOT_SUPPORTED_YET",
  "MCP_INPUT_REQUIRED_NEEDS_FUTURE_EXPLICIT_UI_FLOW",
]

for (const marker of requiredClientMarkers) {
  if (!client.includes(marker)) throw new Error(`MCP security marker missing: ${marker}`)
}

if (!client.includes("url.protocol !== 'https:'")) {
  throw new Error('Remote MCP endpoints must be HTTPS-only')
}

if (!client.includes('url.username || url.password')) {
  throw new Error('MCP URL embedded credentials must be blocked')
}

if (!client.includes('url.search || url.hash')) {
  throw new Error('MCP URL query/fragment secret-leak gate is missing')
}

if (!client.includes("risk: 'external_write'")) {
  throw new Error('Remote MCP tools must default to external_write risk')
}

if (client.includes('Authorization:') || client.includes("'Authorization'") || client.includes('Bearer ')) {
  throw new Error('Phase 3 MCP must not store or emit authorization secrets')
}

if (!center.includes('Discover & List Tools') || !center.includes('Remote MCP Approval Required')) {
  throw new Error('MCP manual discovery or approval UI is missing')
}

if (!toolCenter.includes('<McpCenter')) {
  throw new Error('MCP Center is not integrated into Tool Center')
}

if (!docs.includes('Mandatory Human Approval') || !docs.includes('No URL Secrets') || !docs.includes('Authentication Deferred')) {
  throw new Error('MCP security documentation is incomplete')
}

console.log('Phase 3 MCP security validation: PASS')
console.log('Protocol: 2026-07-28')
console.log('Remote transport: HTTPS Streamable HTTP only')
console.log('Remote tools: deny-by-default + per-call human approval')
console.log('Browser credentials: omitted')
console.log('OAuth/tokens: intentionally unsupported until secure vault phase')
