import type { AgentSpec, RuntimeAdapterId } from './types'

export interface PolicyResult {
  allowed: boolean
  checks: string[]
  violations: string[]
}

const ZERO_COST_RUNTIMES = new Set<RuntimeAdapterId>([
  'local-demo',
  'local-qwen-webgpu',
])

export function evaluateZeroCostGate(agent: AgentSpec): PolicyResult {
  const checks: string[] = []
  const violations: string[] = []

  checks.push('budget.maxMonetarySpendUsd == 0')
  if (agent.budgetPolicy.maxMonetarySpendUsd !== 0) {
    violations.push('الميزانية النقدية يجب أن تبقى 0$ في الوضع الحالي.')
  }

  checks.push('modelPolicy.allowPaid == false')
  if (agent.modelPolicy.allowPaid !== false) {
    violations.push('النماذج المدفوعة غير مسموحة في Zero-Cost Mode (وضع التكلفة الصفرية).')
  }

  checks.push('runtime.adapter is in the zero-cost allowlist')
  if (!ZERO_COST_RUNTIMES.has(agent.runtime.adapter)) {
    violations.push('محرك التشغيل غير موجود في قائمة Zero-Cost (التكلفة الصفرية) المسموح بها.')
  }

  checks.push('resource limits are positive and bounded')
  if (agent.budgetPolicy.maxRunSeconds < 1 || agent.budgetPolicy.maxRunSeconds > 300) {
    violations.push('مدة التشغيل يجب أن تكون بين 1 و300 ثانية في Phase 1.')
  }
  if (agent.budgetPolicy.maxToolCalls < 0 || agent.budgetPolicy.maxToolCalls > 30) {
    violations.push('عدد استدعاءات الأدوات يجب ألا يتجاوز 30 في Phase 1.')
  }

  return {
    allowed: violations.length === 0,
    checks,
    violations,
  }
}
