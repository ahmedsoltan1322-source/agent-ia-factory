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

if (!core.includes("url.protocol !== 'https:'")) throw new Error('HTTPS-only MCP URL gate is missing')
if (!core.includes("credentials: 'omit'")) throw new Error('MCP browser requests must omit cookies/ambient credentials')
if (!core.includes("redirect: 'error'")) throw new Error('MCP browser redirects must be blocked')
if (!core.includes('REQUEST_TIMEOUT_MS = 10_000')) throw new Error('MCP request timeout safety limit changed or missing')
if (!vendor.includes('maxRetries: 0')) throw new Error('MCP SSE reconnect retries must remain disabled in this phase')
if (!vendor.includes("onInsufficientScope: 'throw'")) throw new Error('Automatic scope escalation must be disabled')
if (!vendor.includes('maxStepUpRetries: 0')) throw new Error('Automatic step-up retries must remain disabled')

if (!core.includes('trusted: false')) throw new Error('New MCP servers must start untrusted')
if (!core.includes("risk: 'external_write'")) throw new Error('Newly discovered MCP tools must receive conservative external_write risk')
if (!core.includes('enabled: false')) throw new Error('Discovered MCP tools must remain disabled by default')
if (!core.includes('evaluateToolGate')) throw new Error('MCP calls must pass through the shared Tool Security Gate')
if (!center.includes('Allow for selected Agent')) throw new Error('Per-agent MCP allowlist control is missing')
if (!center.includes('Human Approval Required')) throw new Error('MCP Human Approval UI is missing')
if (!vite.includes("'**/mcpVendor-*.js'")) throw new Error('MCP vendor chunk must stay outside PWA install-time precache')

console.log('MCP browser security validation: PASS')
console.log('Official MCP client: 2.0.0 pinned')
console.log('Transport: HTTPS Streamable HTTP only')
console.log('stdio: forbidden')
console.log('New servers: untrusted')
console.log('Discovered tools: disabled + conservative risk')
console.log('Shared Tool Security Gate: required')
console.log('Automatic auth escalation/reconnect: disabled')
