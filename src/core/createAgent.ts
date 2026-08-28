import type { AgentSpec, RuntimeAdapterId } from './types'

function slugify(value: string): string {
  const ascii = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  return ascii || `agent-${Date.now()}`
}

export function createDefaultAgent(
  name: string,
  instructions: string,
  runtimeAdapter: RuntimeAdapterId = 'local-demo',
): AgentSpec {
  return {
    specVersion: '0.1',
    id: `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || 'وكيل جديد',
    description: 'Agent (وكيل) أنشئ من واجهة الهاتف في Phase 1 (المرحلة الأولى).',
    instructions: instructions.trim() || 'نفذ المهمة بوضوح وأمان ولا تتجاوز الصلاحيات.',
    runtime: {
      adapter: runtimeAdapter,
    },
    modelPolicy: {
      mode: 'local_only',
      allowPaid: false,
    },
    toolPolicy: {
      defaultAction: 'deny',
      allowedTools: [],
    },
    memoryPolicy: {
      session: true,
      longTerm: false,
      shared: false,
    },
    approvalPolicy: {
      externalWrite: 'ask',
      delete: 'ask',
      financial: 'deny',
      securityChange: 'ask',
    },
    budgetPolicy: {
      maxMonetarySpendUsd: 0,
      maxRunSeconds: 60,
      maxToolCalls: 10,
    },
    evaluationPolicy: {
      requiredBeforeProduction: true,
      minimumPassRate: 0.95,
      securityTestsRequired: true,
    },
  }
}
