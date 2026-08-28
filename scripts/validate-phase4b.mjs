import fs from 'node:fs'

const required = [
  'src/core/teamOrchestrator.ts',
  'src/components/TeamOrchestrationCenter.tsx',
  'src/team-orchestration.css',
  'docs/PHASE_4B_SUPERVISOR_TEAMS.md',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 4B file: ${file}`)
}

const core = fs.readFileSync('src/core/teamOrchestrator.ts', 'utf8')
const ui = fs.readFileSync('src/components/TeamOrchestrationCenter.tsx', 'utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx', 'utf8')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

const invariants = [
  "export type TeamExecutionMode = 'sequential' | 'parallel'",
  "queued_for_phone_safety",
  'MAX_WORKERS = 6',
  'MAX_MEMORY_ITEMS_PER_TEAM = 24',
  'MAX_HANDOFF_CHARS = 1_600',
  'MAX_SHARED_CONTEXT_CHARS = 5_000',
  'MAX_SUPERVISOR_CONTEXT_CHARS = 8_000',
  'Promise.all(workers.map',
  "worker.runtime.adapter === 'local-qwen-webgpu'",
  'WebGPU workers serialized to protect phone GPU/RAM',
  'executeWorkflowAgent',
  'monetaryCostUsd: 0',
  'run.toolCalls !== 0',
  'run.monetaryCostUsd !== 0',
  'private chain-of-thought: not transferred',
  'supervisor synthesis: completed',
]
for (const needle of invariants) {
  if (!core.includes(needle)) throw new Error(`Phase 4B invariant missing: ${needle}`)
}

for (const forbidden of ['executeBuiltinTool(', 'callMcpTool(', "from './toolSdk'", "from './mcpClient'"]) {
  if (core.includes(forbidden)) throw new Error(`Team orchestrator must not auto-run tools/MCP: ${forbidden}`)
}

if (!core.includes('agent.budgetPolicy.maxMonetarySpendUsd !== 0')) {
  throw new Error('Supervisor teams must reject agents with non-zero budget.')
}
if (!core.includes('agent.modelPolicy.allowPaid !== false')) {
  throw new Error('Supervisor teams must reject paid-model permission.')
}
if (!ui.includes('Supervisor Team')) throw new Error('Supervisor Team UI is missing.')
if (!ui.includes('Queue (طابور)')) throw new Error('Phone-safe queue behavior must be explained in UI.')
if (!toolCenter.includes('<TeamOrchestrationCenter')) throw new Error('Supervisor Team UI is not exposed in the factory.')

const dependencies = Object.keys(pkg.dependencies ?? {})
const forbiddenFrameworks = dependencies.filter((name) => /langgraph|crewai|autogen|temporal|bullmq|inngest/iu.test(name))
if (forbiddenFrameworks.length > 0) {
  throw new Error(`Phase 4B must not add a heavy orchestration framework: ${forbiddenFrameworks.join(', ')}`)
}

console.log('Phase 4B supervisor-team validation: PASS')
console.log('Supervisor synthesis: enabled')
console.log('Sequential + parallel fan-out/fan-in: enabled')
console.log('WebGPU parallel workers: queued for phone safety')
console.log('Shared team memory: local + bounded')
console.log('Automatic tools/MCP: forbidden')
console.log('Mandatory spend: 0 USD')
