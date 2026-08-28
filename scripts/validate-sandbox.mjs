import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const required = ['src/core/toolSandbox.ts', 'docs/TOOL_SANDBOX.md']
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing sandbox file: ${file}`)
}

const sandbox = fs.readFileSync(path.join(root, 'src/core/toolSandbox.ts'), 'utf8')
const toolSdk = fs.readFileSync(path.join(root, 'src/core/toolSdk.ts'), 'utf8')
const docs = fs.readFileSync(path.join(root, 'docs/TOOL_SANDBOX.md'), 'utf8')

if (!sandbox.includes('maxInputChars: 20_000')) throw new Error('Tool sandbox input limit changed or missing')
if (!sandbox.includes('maxOutputChars: 40_000')) throw new Error('Tool sandbox output limit changed or missing')
if (!sandbox.includes('timeoutMs: 5_000')) throw new Error('Tool sandbox timeout changed or missing')

const scopes = ['text:read', 'memory:read', 'memory:write-local', 'memory:delete']
for (const scope of scopes) {
  if (!sandbox.includes(`'${scope}'`)) throw new Error(`Expected built-in sandbox scope missing: ${scope}`)
}

if (sandbox.includes('fetch(') || sandbox.includes('XMLHttpRequest') || sandbox.includes('WebSocket(')) {
  throw new Error('Built-in capability sandbox must not introduce network primitives')
}
if (sandbox.includes('eval(') || sandbox.includes('new Function(')) {
  throw new Error('Dynamic code execution is forbidden in the built-in tool sandbox')
}
if (!sandbox.includes("tool.risk === 'financial'")) throw new Error('Sandbox defense-in-depth financial block missing')
if (!sandbox.includes('OUTPUT_TRUNCATED_BY_TOOL_SANDBOX')) throw new Error('Sandbox output bound marker missing')
if (!toolSdk.includes('executeBuiltinInCapabilitySandbox')) throw new Error('Built-in tool execution does not pass through capability sandbox')
if (!toolSdk.includes('ToolSandboxError')) throw new Error('Sandbox failures are not represented in the tool audit path')

if (!docs.includes('ليس') || !docs.includes('OS Sandbox') || !docs.includes('Worker/iframe')) {
  throw new Error('Sandbox documentation must explicitly avoid overstating isolation and describe stronger future isolation')
}

console.log('Tool capability sandbox validation: PASS')
console.log('Input limit: 20,000 chars')
console.log('Output limit: 40,000 chars')
console.log('Execution budget: 5,000 ms')
console.log('Built-in network primitives: none')
console.log('Untrusted third-party code: not supported in-process')
