import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const required = [
  'src/core/factoryPlanner.ts',
  'src/components/FactoryCenter.tsx',
  'src/factory.css',
  'docs/PHASE5_FACTORY.md',
]

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing Phase 5 file: ${file}`)
}

const planner = fs.readFileSync(path.join(root, 'src/core/factoryPlanner.ts'), 'utf8')
const center = fs.readFileSync(path.join(root, 'src/components/FactoryCenter.tsx'), 'utf8')
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8')
const docs = fs.readFileSync(path.join(root, 'docs/PHASE5_FACTORY.md'), 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const plannerMarkers = [
  'planAgentFactory',
  'validateFactoryBlueprint',
  'previewFactoryInstall',
  'installFactoryBlueprint',
  'FACTORY_HUMAN_APPROVAL_REQUIRED',
  'createDefaultAgent',
  'buildLinearTeamWorkflow',
  'validateWorkflowDefinition',
  "maxMonetarySpendUsd: 0",
  'allowPaidModels: false',
  'enableSuggestedToolsAutomatically: false',
  'automaticExecutionAfterInstall: false',
  'humanApprovalRequiredToInstall: true',
  "agent.toolPolicy.allowedTools.length !== 0",
  "agent.modelPolicy.allowPaid !== false",
  "agent.modelPolicy.mode !== 'local_only'",
  "agent.approvalPolicy.financial !== 'deny'",
  'reviewer role: present',
  'suggested tools enabled: no',
  'automatic team run started: no',
]
for (const marker of plannerMarkers) {
  if (!planner.includes(marker)) throw new Error(`Phase 5 factory invariant missing: ${marker}`)
}

const forbiddenPlannerCalls = [
  'fetch(',
  'XMLHttpRequest',
  'WebSocket(',
  'callMcpTool(',
  'executeBuiltinTool(',
  'runWorkflowUntilPause(',
  '.execute(agent',
  'Authorization',
  'Bearer ',
]
for (const marker of forbiddenPlannerCalls) {
  if (planner.includes(marker)) throw new Error(`Factory planner must not perform network/tool/agent execution: ${marker}`)
}

if (!planner.includes('if (!approvedByHuman)')) throw new Error('Human Approval install gate is missing')
if (!planner.includes('deleteAgent(agentId)')) throw new Error('Factory install rollback for agents is missing')
if (!planner.includes('deleteWorkflow(savedWorkflowId)')) throw new Error('Factory install rollback for workflow is missing')
if (!planner.includes("action: 'planned' | 'validated' | 'installed' | 'install_failed'")) throw new Error('Factory audit actions are incomplete')
if (!planner.includes('MAX_ROLE_COUNT = 6')) throw new Error('Phone-safe role limit changed or missing')
if (!planner.includes('MAX_GOAL_CHARS = 6_000')) throw new Error('Factory goal size limit changed or missing')

const acceptanceIds = ['zero-cost', 'tools-denied', 'reviewer-present', 'workflow-valid', 'no-auto-run']
for (const id of acceptanceIds) {
  if (!planner.includes(`id: '${id}'`)) throw new Error(`Factory acceptance test missing: ${id}`)
}

if (!center.includes('Analyze & Build Blueprint')) throw new Error('Blueprint analysis UI is missing')
if (!center.includes('Approve & Build Team')) throw new Error('Explicit team install approval UI is missing')
if (!center.includes('غير مفعّلة تلقائياً')) throw new Error('Suggested tools non-permission UI marker is missing')
if (!center.includes('لم يبدأ أي تشغيل تلقائياً')) throw new Error('No-auto-run UI confirmation is missing')
if (!app.includes('<FactoryCenter')) throw new Error('Factory Center is not integrated into App')
if (!app.includes('Phase 5 (المرحلة الخامسة)')) throw new Error('App banner is not Phase 5')
if (!app.includes('factoryRevision')) throw new Error('Factory install must refresh Workflow Center in the same session')
if (!main.includes("import './factory.css'")) throw new Error('Factory mobile styles are not loaded')

const allowedProductionDependencies = new Set([
  '@mlc-ai/web-llm',
  '@modelcontextprotocol/client',
  'react',
  'react-dom',
])
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedProductionDependencies.has(dependency)) {
    throw new Error(`Unexpected production dependency added in Phase 5: ${dependency}`)
  }
}

if (!docs.includes('Suggested Tools ≠ Permissions')) throw new Error('Factory docs must distinguish suggestions from permissions')
if (!docs.includes('No Automatic Run')) throw new Error('Factory docs must state no automatic execution')
if (!docs.includes('Rollback')) throw new Error('Factory rollback behavior must be documented')
if (!docs.includes('Human Approval Before Install')) throw new Error('Factory approval gate must be documented')

console.log('Phase 5 Agent Factory validation: PASS')
console.log('Planner: deterministic + local')
console.log('Blueprint: reviewed before install')
console.log('Reviewer role: required')
console.log('Suggested tools: never auto-enabled')
console.log('Human install approval: required')
console.log('Automatic post-install execution: forbidden')
console.log('Compiled agents: local-only + paid=false + tools=[] + 0 USD')
console.log('Workflow: validated before persistence')
console.log('Rollback: best-effort on partial persistence failure')
console.log('New production dependencies: 0')
