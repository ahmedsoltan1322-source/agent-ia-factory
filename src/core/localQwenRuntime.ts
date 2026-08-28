import { localModelClient } from './localModelClient'
import type { AgentRunInput, AgentSpec, RunRecord, RuntimeAdapter } from './types'
import { evaluateZeroCostGate } from './zeroCostGate'

function newRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export class LocalQwenWebGpuRuntimeAdapter implements RuntimeAdapter {
  readonly id = 'local-qwen-webgpu' as const

  async execute(agent: AgentSpec, input: AgentRunInput): Promise<RunRecord> {
    const startedAt = new Date().toISOString()
    const policy = evaluateZeroCostGate(agent)

    if (!policy.allowed) {
      return {
        id: newRunId(),
        agentId: agent.id,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: 'blocked',
        runtimeAdapter: this.id,
        task: input.task,
        output: `تم منع التشغيل بواسطة Policy Engine (محرك السياسات): ${policy.violations.join(' | ')}`,
        monetaryCostUsd: 0,
        toolCalls: 0,
        policyChecks: policy.checks,
      }
    }

    const task = input.task.trim()
    if (!task) {
      return {
        id: newRunId(),
        agentId: agent.id,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: 'failed',
        runtimeAdapter: this.id,
        task,
        output: '',
        monetaryCostUsd: 0,
        toolCalls: 0,
        policyChecks: policy.checks,
        error: 'المهمة فارغة.',
      }
    }

    if (!localModelClient.isReady()) {
      return {
        id: newRunId(),
        agentId: agent.id,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: 'failed',
        runtimeAdapter: this.id,
        task,
        output: '',
        monetaryCostUsd: 0,
        toolCalls: 0,
        policyChecks: policy.checks,
        error: 'Local AI (الذكاء المحلي) غير محمّل. اضغط زر تنزيل/تحميل النموذج أولاً.',
      }
    }

    try {
      const output = await localModelClient.generate(agent.instructions, task, 256)
      return {
        id: newRunId(),
        agentId: agent.id,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: 'success',
        runtimeAdapter: this.id,
        task,
        output,
        monetaryCostUsd: 0,
        toolCalls: 0,
        policyChecks: [
          ...policy.checks,
          'generation executed locally with WebGPU',
          'prompt sent to no paid model API',
        ],
      }
    } catch (error) {
      return {
        id: newRunId(),
        agentId: agent.id,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: 'failed',
        runtimeAdapter: this.id,
        task,
        output: '',
        monetaryCostUsd: 0,
        toolCalls: 0,
        policyChecks: policy.checks,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
