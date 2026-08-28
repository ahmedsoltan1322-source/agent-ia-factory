import fs from 'node:fs'

const required = [
  'src/core/factoryPlanner.ts',
  'src/components/FactoryCenter.tsx',
  'src/factory.css',
  'docs/PHASE5_FACTORY.md',
]
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing Phase 5 file: ${file}`)
}

const core = fs.readFileSync('src/core/factoryPlanner.ts', 'utf8')
const ui = fs.readFileSync('src/components/FactoryCenter.tsx', 'utf8')
const docs = fs.readFileSync('docs/PHASE5_FACTORY.md', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

const invariants = [
  "schemaVersion: '0.2'",
  'MAX_ROLE_COUNT = 6',
  'MIN_ROLE_COUNT = 2',
  'FACTORY_REVIEWER_REQUIRED',
  'maxMonetarySpendUsd: 0',
  'allowPaidModels: false',
  'enableSuggestedToolsAutomatically: false',
  'automaticExecutionAfterInstall: false',
  'humanApprovalRequiredToInstall: true',
  'FACTORY_HUMAN_APPROVAL_REQUIRED',
  "toolPolicy: { defaultAction: 'deny' as const, allowedTools: [] }",
  "financial: 'deny' as const",
  'buildLinearTeamWorkflow',
  'validateWorkflowDefinition',
  "audit(installed.id, 'installed'",
  "audit(blueprint.id, 'install_failed'",
]
for (const needle of invariants) {
  if (!core.includes(needle)) throw new Error(`Phase 5 invariant missing: ${needle}`)
}

for (const forbidden of ['executeWorkflowAgent(', 'runWorkflowUntilPause(', 'callMcpTool(', 'executeBuiltinTool(', "from './mcpClient'", "from './toolSdk'"]) {
  if (core.includes(forbidden)) throw new Error(`Factory planner must not auto-run tools/workflows: ${forbidden}`)
}

if (!ui.includes('Approve & Build Team')) throw new Error('Explicit factory install approval UI is missing.')
if (!ui.includes('allowedTools=[]')) throw new Error('UI must disclose tools-denied default.')
if (!ui.includes('لم يبدأ Run')) throw new Error('UI must disclose no-auto-run behavior.')
if (!app.includes('<FactoryCenter')) throw new Error('FactoryCenter is not exposed in the main application.')
if (!docs.includes('لا يحدث أي تشغيل تلقائي')) throw new Error('Phase 5 docs must state no automatic execution.')

const dependencies = Object.keys(pkg.dependencies ?? {})
const forbiddenFrameworks = dependencies.filter((name) => /crewai|autogen|langgraph|temporal|inngest|bullmq/iu.test(name))
if (forbiddenFrameworks.length > 0) throw new Error(`Phase 5 baseline must not add a heavy orchestration dependency: ${forbiddenFrameworks.join(', ')}`)

console.log('Phase 5 Agent Factory validation: PASS')
console.log('Planner: deterministic + local')
console.log('Reviewer/QA role: required')
console.log('Suggested tools: advisory only')
console.log('Install: explicit Human Approval required')
console.log('Automatic execution after install: forbidden')
console.log('Mandatory spend: 0 USD')
