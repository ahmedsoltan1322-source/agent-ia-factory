import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const required = [
  'src/core/mcpClient.ts',
  'src/core/mcpAudit.ts',
  'src/vendor/mcpVendor.ts',
  'src/components/McpCenter.tsx',
  'src/mcp.css',
  'docs/MCP_SECURITY.md',
]

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing MCP file: ${file}`)
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const tsconfig = fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8')
const core = fs.readFileSync(path.join(root, 'src/core/mcpClient.ts'), 'utf8')
const vendor = fs.readFileSync(path.join(root, 'src/vendor/mcpVendor.ts'), 'utf8')
const center = fs.readFileSync(path.join(root, 'src/components/McpCenter.tsx'), 'utf8')
const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8')

if (pkg.dependencies?.['@modelcontextprotocol/client'] !== '2.0.0') {
  throw new Error('MCP client must remain exactly pinned to @modelcontextprotocol/client 2.0.0 until reviewed')
}
if (pkg.devDependencies?.['@types/node'] !== '26.4.0') {
  throw new Error('MCP TypeScript requirement expects pinned @types/node 26.4.0 in this phase')
}
if (!tsconfig.includes('"node"')) throw new Error('Node declaration types required by MCP published types are missing')

if (core.includes("from '@modelcontextprotocol/client'")) {
  throw new Error('MCP SDK must not be statically imported by the app core; keep it behind lazy vendor boundary')
}
if (!core.includes("await import('../vendor/mcpVendor')")) throw new Error('Lazy MCP vendor import is missing')
if (!vendor.includes("from '@modelcontextprotocol/client'")) throw new Error('MCP vendor boundary does not import the official client')
if (vendor.includes("@modelcontextprotocol/client/stdio")) throw new Error('stdio transport is forbidden in the browser PWA')

if (!vendor.includes("MCP_MODERN_PROTOCOL_VERSION = '2026-07-28'")) throw new Error('MCP 2026-07-28 pin constant is missing')
if (!vendor.includes('versionNegotiation')) throw new Error('Explicit MCP version negotiation is required')
if (!vendor.includes('mode: { pin: MCP_MODERN_PROTOCOL_VERSION }')) throw new Error('MCP client must pin 2026-07-28 without legacy fallback')
if (!vendor.includes('getNegotiatedProtocolVersion()')) throw new Error('Negotiated MCP version must be verified after connect')

if (!core.includes("url.protocol !== 'https:'")) throw new Error('HTTPS-only MCP URL gate is missing')
if (!core.includes("MCP_URL_QUERY_FORBIDDEN")) throw new Error('MCP URL query strings must be forbidden')
if (!core.includes("MCP_LOCAL_HOSTNAME_FORBIDDEN")) throw new Error('MCP local hostnames must be forbidden')
if (!core.includes("MCP_RAW_IP_FORBIDDEN")) throw new Error('MCP raw IP endpoints must be forbidden')
if (!core.includes("credentials: 'omit'")) throw new Error('MCP browser requests must omit cookies/ambient credentials')
if (!core.includes("redirect: 'error'")) throw new Error('MCP browser redirects must be blocked')
if (!core.includes("referrerPolicy: 'no-referrer'")) throw new Error('MCP browser requests must omit referrer data')
if (!core.includes('REQUEST_TIMEOUT_MS = 10_000')) throw new Error('MCP request timeout safety limit changed or missing')
if (!vendor.includes('maxRetries: 0')) throw new Error('MCP SSE reconnect retries must remain disabled in this phase')
if (!vendor.includes("onInsufficientScope: 'throw'")) throw new Error('Automatic scope escalation must be disabled')
if (!vendor.includes('maxStepUpRetries: 0')) throw new Error('Automatic step-up retries must remain disabled')

if (!core.includes('trusted: false')) throw new Error('New MCP servers must start untrusted')
if (!core.includes('endpointChanged ? false : server.trusted')) throw new Error('Changing an MCP endpoint must revoke server trust')
if (!core.includes('endpointChanged ? {} : server.toolPolicies')) throw new Error('Changing an MCP endpoint must clear discovered tool policies')
if (!core.includes("risk: 'external_write'")) throw new Error('Newly discovered MCP tools must receive conservative external_write risk')
if (!core.includes('enabled: false')) throw new Error('Discovered MCP tools must remain disabled by default')
if (!core.includes('evaluateToolGate')) throw new Error('MCP calls must pass through the shared Tool Security Gate')
if (!core.includes('Every external MCP tool call requires explicit human approval')) throw new Error('External MCP calls must require explicit human approval')
if (!core.includes('MCP_KILL_SWITCH_KEY')) throw new Error('MCP Kill Switch storage key is missing')
if (!core.includes("MCP_KILL_SWITCH_ACTIVE")) throw new Error('MCP Kill Switch execution gate is missing')
if (!core.includes('MAX_ARGUMENT_CHARS = 32_000')) throw new Error('MCP argument size limit is missing')
if (!core.includes('MAX_SCHEMA_CHARS = 64_000')) throw new Error('MCP schema size limit is missing')

if (!center.includes('Allow for selected Agent')) throw new Error('Per-agent MCP allowlist control is missing')
if (!center.includes('Human Approval Required')) throw new Error('MCP Human Approval UI is missing')
if (!center.includes('Kill Switch')) throw new Error('MCP Kill Switch UI is missing')
if (!vite.includes("'**/mcpVendor-*.js'")) throw new Error('MCP vendor chunk must stay outside PWA install-time precache')

console.log('MCP browser security validation: PASS')
console.log('Official MCP client: 2.0.0 pinned')
console.log('Protocol: 2026-07-28 pinned, no legacy fallback')
console.log('Transport: HTTPS Streamable HTTP only')
console.log('stdio: forbidden')
console.log('New servers: untrusted')
console.log('Endpoint mutation: revokes trust + clears tool policies')
console.log('Discovered tools: disabled + conservative risk')
console.log('Shared Tool Security Gate: required')
console.log('Every remote call: explicit human approval')
console.log('Kill Switch: required')
console.log('Automatic auth escalation/reconnect: disabled')
