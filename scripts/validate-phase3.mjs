import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()

const required = [
  'src/core/toolSdk.ts',
  'src/components/ToolCenter.tsx',
  'src/tool.css',
  'docs/TOOLS_SECURITY.md',
]

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    throw new Error(`Missing Phase 3 file: ${file}`)
  }
}

const toolSdk = fs.readFileSync(path.join(root, 'src/core/toolSdk.ts'), 'utf8')
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const createAgent = fs.readFileSync(path.join(root, 'src/core/createAgent.ts'), 'utf8')
const docs = fs.readFileSync(path.join(root, 'docs/TOOLS_SECURITY.md'), 'utf8')

const requiredToolIds = [
  'local.text.stats',
  'local.memory.search',
  'local.memory.add',
  'local.memory.clear',
]

for (const toolId of requiredToolIds) {
  if (!toolSdk.includes(`id: '${toolId}'`)) {
    throw new Error(`Required built-in tool is missing: ${toolId}`)
  }
}

if (!createAgent.includes('allowedTools: []')) {
  throw new Error('Deny-by-default policy requires new agents to start with an empty tool allowlist')
}

if (!toolSdk.includes('agent.toolPolicy.allowedTools.includes(tool.id)')) {
  throw new Error('Tool allowlist gate is missing')
}

if (!toolSdk.includes('callIndex >= agent.budgetPolicy.maxToolCalls')) {
  throw new Error('maxToolCalls enforcement is missing')
}

if (!toolSdk.includes("tool.risk === 'financial'")) {
  throw new Error('Zero-cost financial tool gate is missing')
}

if (!toolSdk.includes("decision === 'ask' && !approvedByHuman")) {
  throw new Error('Human approval gate is missing')
}

if (!toolSdk.includes("input.trim() !== 'DELETE'")) {
  throw new Error('Destructive local memory tool requires an explicit delete confirmation token')
}

if (toolSdk.includes('fetch(') || toolSdk.includes('XMLHttpRequest') || toolSdk.includes('WebSocket(')) {
  throw new Error('Phase 3 security foundation must not introduce network-capable built-in tools')
}

if (!app.includes('<ToolCenter') || !app.includes('automatic tool execution: disabled')) {
  throw new Error('Tool Center or automatic-execution safety marker is missing from App')
}

if (!docs.includes('Deny by Default') || !docs.includes('Human Approval')) {
  throw new Error('Phase 3 security documentation must explain deny-by-default and human approval')
}

console.log('Phase 3 tool security validation: PASS')
console.log('New-agent tool allowlist: empty')
console.log('Built-in network tools: none')
console.log('Financial tools under zero-cost policy: blocked')
console.log('Delete tools: human approval required')
console.log('maxToolCalls enforcement: present')
