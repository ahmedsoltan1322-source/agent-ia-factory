import { LocalQwenWebGpuRuntimeAdapter } from './localQwenRuntime'
import { buildAugmentedTask, retrieveLocalContext } from './memoryKnowledge'
import { LocalDemoRuntimeAdapter } from './runtime'
import { saveRun } from './storage'
import type { AgentSpec, RunRecord } from './types'

const demoRuntime = new LocalDemoRuntimeAdapter()
const qwenRuntime = new LocalQwenWebGpuRuntimeAdapter()

export async function executeWorkflowAgent(agent: AgentSpec, task: string): Promise<RunRecord> {
  const originalTask = task.trim()
  if (!originalTask) throw new Error('WORKFLOW_AGENT_TASK_EMPTY')

  // Phase 4 reads bounded local long-term/knowledge context, but intentionally
  // does not expose another agent's private reasoning. Only explicit prior output
  // included by Workflow Engine is handed off.
  const retrieved = retrieveLocalContext(agent.id, originalTask, 4)
  const augmentedTask = buildAugmentedTask(originalTask, [], retrieved)
  const runtime = agent.runtime.adapter === 'local-qwen-webgpu' ? qwenRuntime : demoRuntime
  const run = await runtime.execute(agent, { task: augmentedTask })

  const workflowRun: RunRecord = {
    ...run,
    task: originalTask,
    policyChecks: [
      ...run.policyChecks,
      `workflow local context hits: ${retrieved.length}`,
      'workflow execution: local runtime only',
      'workflow automatic tool execution: disabled',
      'workflow handoff contains outputs, not private chain-of-thought',
    ],
  }

  saveRun(workflowRun)
  return workflowRun
}
