import fs from 'node:fs'

const requiredFiles = [
  'src/core/mcpRegistry.ts',
  'src/components/McpCenter.tsx',
  'src/mcp.css',
]

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 3B file: ${file}`)
}

const registry = fs.readFileSync('src/core/mcpRegistry.ts', 'utf8')
const center = fs.readFileSync('src/components/McpCenter.tsx', 'utf8')
const tools = fs.readFileSync('src/core/toolSdk.ts', 'utf8')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

const mustContain = [
  "export type McpTransport = 'local_mock' | 'streamable_http' | 'stdio'",
  "enabledByDefault: false",
  "networkAccess: false",
  "server.transport !== 'local_mock'",
  "External MCP transports are disabled in Phase 3B",
  'evaluateToolGate(agent, toolDefinition',
  "monetaryCostUsd: 0",
  "agent-ia-factory.mcp-calls.v1",
]

for (const needle of mustContain) {
  if (!registry.includes(needle)) throw new Error(`Phase 3B MCP security invariant missing: ${needle}`)
}

if (!tools.includes("if (!agent.toolPolicy.allowedTools.includes(tool.id))")) {
  throw new Error('Shared tool allowlist gate is missing.')
}

if (!center.includes('Local only · Deny external')) {
  throw new Error('MCP UI must clearly show that external MCP is denied in Phase 3B.')
}

if (!center.includes('toggleTool(tool.id)')) {
  throw new Error('MCP tools must use the per-agent tool allowlist UI.')
}

const productionDeps = Object.keys(pkg.dependencies ?? {})
const forbiddenMcpRuntimeDeps = productionDeps.filter((name) => name.includes('modelcontextprotocol'))
if (forbiddenMcpRuntimeDeps.length > 0) {
  throw new Error(`Phase 3B must not add an external MCP runtime dependency yet: ${forbiddenMcpRuntimeDeps.join(', ')}`)
}

console.log('Phase 3B secure MCP validation: PASS')
