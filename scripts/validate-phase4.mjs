import fs from 'node:fs'

const required = [
  'src/core/workflowEngine.ts',
  'src/components/WorkflowCenter.tsx',
  'src/workflow.css',
  'docs/PHASE_4_WORKFLOWS.md',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 4A file: ${file}`)
}

const engine = fs.readFileSync('src/core/workflowEngine.ts', 'utf8')
const center = fs.readFileSync('src/components/WorkflowCenter.tsx', 'utf8')
const toolCenter = fs.readFileSync('src/components/ToolCenter.tsx', 'utf8')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

const requiredEngineInvariants = [
  "export type WorkflowMode = 'sequential' | 'parallel'",
  "queued_for_phone_safety",
  'MAX_WORKERS = 6',
  'MAX_WORKFLOW_STEPS = 12',
  'MAX_TEAM_MEMORY_PER_TEAM = 24',
  'MAX_TEAM_CONTEXT_CHARS = 6_000',
  'MAX_SUPERVISOR_CONTEXT_CHARS = 8_000',
  'monetaryCostUsd: 0',
  'automatic Tool/MCP execution: disabled in Phase 4A',
  "agent.runtime.adapter === 'local-qwen-webgpu'",
  'Promise.all(workers.map(executeOne))',
  'parallel local WebGPU generations serialized for phone GPU/RAM safety',
  'Shared Team Memory',
  'Handoff',
]
for (const needle of requiredEngineInvariants) {
  if (!engine.includes(needle)) throw new Error(`Phase 4A invariant missing: ${needle}`)
}

const forbiddenAutomaticToolCalls = [
  'executeBuiltinTool(',
  'callMcpTool(',
  "from './mcpClient'",
  "from './toolSdk'",
]
for (const needle of forbiddenAutomaticToolCalls) {
  if (engine.includes(needle)) throw new Error(`Workflow Engine must not auto-execute tools/MCP in Phase 4A: ${needle}`)
}

if (!engine.includes("agent.budgetPolicy.maxMonetarySpendUsd !== 0")) {
  throw new Error('Workflow team validation must reject non-zero agent budgets.')
}
if (!engine.includes("agent.modelPolicy.allowPaid !== false")) {
  throw new Error('Workflow team validation must reject paid-model permission.')
}
if (!engine.includes('workerAgentIds: [...new Set')) {
  throw new Error('Workflow worker IDs must be deduplicated and bounded.')
}
if (!center.includes('Queue for Phone Safety')) {
  throw new Error('Phone-safe queued parallel behavior must be visible in the UI.')
}
if (!center.includes('حتى 6')) {
  throw new Error('Worker limit must be visible in the UI.')
}
if (!toolCenter.includes('<WorkflowCenter')) {
  throw new Error('Workflow Center is not exposed in the factory UI.')
}

const productionDeps = Object.keys(pkg.dependencies ?? {})
const disallowedWorkflowFrameworks = productionDeps.filter((name) =>
  /langgraph|crewai|autogen|temporal|bullmq|inngest/iu.test(name),
)
if (disallowedWorkflowFrameworks.length > 0) {
  throw new Error(`Phase 4A must not add a heavy workflow framework yet: ${disallowedWorkflowFrameworks.join(', ')}`)
}

console.log('Phase 4A workflow validation: PASS')
console.log('Modes: sequential + logical parallel')
console.log('Local WebGPU parallelism: queued for phone safety')
console.log('Supervisor + worker handoffs: enabled')
console.log('Shared team memory: local and bounded')
console.log('Automatic tools/MCP: disabled')
console.log('Mandatory spend: 0 USD')
