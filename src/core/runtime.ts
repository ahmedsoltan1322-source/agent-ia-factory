import type { AgentRunInput, AgentSpec, RunRecord, RuntimeAdapter } from './types'
import { evaluateZeroCostGate } from './zeroCostGate'

function newRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export class LocalDemoRuntimeAdapter implements RuntimeAdapter {
  readonly id = 'local-demo'

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

    const cleanTask = input.task.trim()
    if (!cleanTask) {
      return {
        id: newRunId(),
        agentId: agent.id,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: 'failed',
        runtimeAdapter: this.id,
        task: input.task,
        output: '',
        monetaryCostUsd: 0,
        toolCalls: 0,
        policyChecks: policy.checks,
        error: 'المهمة فارغة.',
      }
    }

    // Phase 1 uses an intentionally deterministic local adapter.
    // It validates the full Agent lifecycle without pretending to be an LLM.
    const output = [
      `الوكيل: ${agent.name}`,
      `المهمة: ${cleanTask}`,
      '',
      'تم تنفيذ أول دورة تشغيل محلية بنجاح.',
      'هذا Runtime (محرك التشغيل) تجريبي وحتمي ولا يدّعي أنه نموذج ذكاء اصطناعي.',
      'الخطوة التالية هي استبداله بـ Local Model Adapter (موصل نموذج محلي) مع بقاء نفس Agent Spec (مواصفات الوكيل) وبوابة 0$.',
    ].join('\n')

    return {
      id: newRunId(),
      agentId: agent.id,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'success',
      runtimeAdapter: this.id,
      task: cleanTask,
      output,
      monetaryCostUsd: 0,
      toolCalls: 0,
      policyChecks: policy.checks,
    }
  }
}
