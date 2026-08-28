import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const required = [
  'src/core/workflowCore.ts',
  'src/components/WorkflowCenter.tsx',
  'src/workflow.css',
  'docs/WORKFLOWS_MULTI_AGENT.md',
]

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing Phase 4 file: ${file}`)
}

const core = fs.readFileSync(path.join(root, 'src/core/workflowCore.ts'), 'utf8')
const center = fs.readFileSync(path.join(root, 'src/components/WorkflowCenter.tsx'), 'utf8')
const toolCenter = fs.readFileSync(path.join(root, 'src/components/ToolCenter.tsx'), 'utf8')
const storage = fs.readFileSync(path.join(root, 'src/core/storage.ts'), 'utf8')
const docs = fs.readFileSync(path.join(root, 'docs/WORKFLOWS_MULTI_AGENT.md'), 'utf8')

if (!core.includes("export type WorkflowMode = 'sequential' | 'parallel'")) throw new Error('Sequential/parallel workflow modes are missing')
if (!core.includes('const MAX_WORKERS = 4')) throw new Error('Mobile worker limit must remain 4 until reviewed')
if (!core.includes('evaluateZeroCostGate(agent)')) throw new Error('Every workflow participant must pass the Zero-Cost Gate')
if (!core.includes('monetaryCostUsd: 0')) throw new Error('Workflow runs must explicitly report monetaryCostUsd=0')
if (!core.includes("stage: 'supervisor-to-worker' | 'worker-to-supervisor'")) throw new Error('Workflow handoff stages are missing')
if (!core.includes('TEAM_MEMORY_KEY')) throw new Error('Shared Team Memory storage is missing')
if (!core.includes('clearTeamMemory(workflowId)')) throw new Error('Workflow deletion must remove orphan team memory')
if (!core.includes('Promise.all(workers.map')) throw new Error('Parallel Local Demo scheduling path is missing')
if (!core.includes("'parallel-mobile-safe-serialized-gpu'")) throw new Error('Mobile-safe serialized WebGPU scheduling marker is missing')
if (!core.includes('if (workflow.mode === \'parallel\' && !hasGpuWorker)')) throw new Error('True parallel scheduling must be restricted away from the GPU-worker path')
if (!core.includes('sharedSnapshotForParallel')) throw new Error('Parallel workers must use a stable pre-worker team-memory snapshot')
if (!core.includes('لا تستدع أدوات تلقائياً')) throw new Error('Automatic workflow tool execution must remain disabled in Phase 4 core')
if (!center.includes('Supervisor Agent') || !center.includes('Worker Agents')) throw new Error('Supervisor/Worker mobile UI is missing')
if (!toolCenter.includes('<WorkflowCenter')) throw new Error('Workflow Center is not exposed by the app capability surface')
if (!storage.includes('AGENT_REGISTRY_EVENT')) throw new Error('Workflow UI needs same-tab Agent Registry synchronization')
if (!docs.includes('Shared Team Memory') || !docs.includes('Handoffs')) throw new Error('Phase 4 architecture documentation is incomplete')

console.log('Phase 4 workflows & multi-agent validation: PASS')
console.log('Workflow modes: sequential + parallel')
console.log('Supervisor/worker orchestration: present')
console.log('Worker limit: 4')
console.log('Shared Team Memory + handoffs: present')
console.log('Parallel WebGPU: mobile-safe serialized')
console.log('Automatic tool execution: disabled')
console.log('Mandatory monetary spend: 0 USD')
