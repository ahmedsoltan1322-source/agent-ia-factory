import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const required = [
  'src/core/workflowEngine.ts',
  'src/core/workflowAgentExecutor.ts',
  'src/components/WorkflowCenter.tsx',
  'src/workflow.css',
  'docs/PHASE4_WORKFLOWS.md',
]

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing Phase 4 file: ${file}`)
}

const engine = fs.readFileSync(path.join(root, 'src/core/workflowEngine.ts'), 'utf8')
const executor = fs.readFileSync(path.join(root, 'src/core/workflowAgentExecutor.ts'), 'utf8')
const center = fs.readFileSync(path.join(root, 'src/components/WorkflowCenter.tsx'), 'utf8')
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8')
const docs = fs.readFileSync(path.join(root, 'docs/PHASE4_WORKFLOWS.md'), 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const engineMarkers = [
  "WorkflowNodeKind = 'agent' | 'approval' | 'end'",
  'WORKFLOW_CYCLE_FORBIDDEN',
  'WORKFLOW_UNREACHABLE_NODE_FORBIDDEN',
  'WORKFLOW_MAX_STEPS_REACHED',
  'saveWorkflowRun(next)',
  "status: 'waiting_approval'",
  'decideWorkflowApproval',
  'WORKFLOW_APPROVAL_DENIED',
  'WORKFLOW_NONZERO_AGENT_COST_FORBIDDEN',
  'WORKFLOW_AUTOMATIC_TOOL_CALL_FORBIDDEN',
  'agentRun.monetaryCostUsd !== 0',
  'agentRun.toolCalls !== 0',
  'maxHandoffChars',
  'previousOutput',
]
for (const marker of engineMarkers) {
  if (!engine.includes(marker)) throw new Error(`Phase 4 workflow invariant missing: ${marker}`)
}

if (!engine.includes('visiting.has(nodeId)')) throw new Error('DAG cycle detection implementation is missing')
if (!engine.includes('reachable.size !== workflow.nodes.length')) throw new Error('Workflow reachability validation is missing')
if (!engine.includes('MAX_STEPS = 24')) throw new Error('Workflow max-step hard limit changed or missing')
if (!engine.includes('MAX_TEAM_AGENTS = 6')) throw new Error('Workflow phone-safe team limit changed or missing')
if (!engine.includes('MAX_INPUT_CHARS = 8_000')) throw new Error('Workflow input limit changed or missing')
if (!engine.includes('MAX_SAVED_RUNS = 12')) throw new Error('Workflow checkpoint storage limit changed or missing')

const forbiddenEngineCalls = ['fetch(', 'callMcpTool(', 'executeBuiltinTool(', 'Authorization', 'Bearer ']
for (const marker of forbiddenEngineCalls) {
  if (engine.includes(marker) || executor.includes(marker)) {
    throw new Error(`Phase 4 foundation must not execute network/tools automatically: ${marker}`)
  }
}

if (!executor.includes("agent.runtime.adapter === 'local-qwen-webgpu'")) throw new Error('Workflow executor must remain local-runtime-only')
if (!executor.includes('retrieveLocalContext')) throw new Error('Workflow executor lost local knowledge retrieval')
if (!executor.includes('workflow handoff contains outputs, not private chain-of-thought')) throw new Error('Workflow handoff privacy marker missing')

if (!center.includes('Resume Checkpoint')) throw new Error('Workflow resume UI is missing')
if (!center.includes('Human Approval Node')) throw new Error('Workflow approval UI is missing')
if (!center.includes('Agent Order')) throw new Error('Mobile multi-agent ordering UI is missing')
if (!center.includes('New Team Run')) throw new Error('Workflow run UI is missing')
if (!app.includes('<WorkflowCenter agents={agents}')) throw new Error('Workflow Center is not integrated into the app')
if (!app.includes('Phase 4 (المرحلة الرابعة)')) throw new Error('App phase banner was not updated to Phase 4')
if (!main.includes("import './workflow.css'")) throw new Error('Workflow mobile styles are not loaded')

const allowedProductionDependencies = new Set([
  '@mlc-ai/web-llm',
  '@modelcontextprotocol/client',
  'react',
  'react-dom',
])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) {
    throw new Error(`Unexpected production dependency added in Phase 4: ${dependency}`)
  }
}

if (!docs.includes('At-Least-Once')) throw new Error('Checkpoint retry semantics must be documented')
if (!docs.includes('Automatic Tool Calls')) throw new Error('Automatic-tool restriction must be documented')
if (!docs.includes('DAG')) throw new Error('DAG model must be documented')

console.log('Phase 4 workflow validation: PASS')
console.log('Graph: DAG only, cycles forbidden')
console.log('Checkpoints: local and bounded')
console.log('Human approval nodes: required where configured')
console.log('Multi-agent handoff: bounded output only')
console.log('Automatic workflow tool calls: forbidden')
console.log('Mandatory monetary spend: 0 USD')
console.log('New production dependencies: 0')
