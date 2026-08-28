export type ApprovalDecision = 'deny' | 'ask' | 'allow'

export type RuntimeAdapterId = 'local-demo' | 'local-qwen-webgpu'

export interface AgentSpec {
  specVersion: '0.1'
  id: string
  name: string
  description: string
  instructions: string
  runtime: {
    adapter: RuntimeAdapterId
  }
  modelPolicy: {
    mode: 'local_only' | 'free_only' | 'auto'
    allowPaid: false
  }
  toolPolicy: {
    defaultAction: 'deny' | 'approval'
    allowedTools: string[]
  }
  memoryPolicy: {
    session: boolean
    longTerm: boolean
    shared: boolean
  }
  approvalPolicy: {
    externalWrite: ApprovalDecision
    delete: Exclude<ApprovalDecision, 'allow'>
    financial: Exclude<ApprovalDecision, 'allow'>
    securityChange: Exclude<ApprovalDecision, 'allow'>
  }
  budgetPolicy: {
    maxMonetarySpendUsd: 0
    maxRunSeconds: number
    maxToolCalls: number
  }
  evaluationPolicy: {
    requiredBeforeProduction: true
    minimumPassRate: number
    securityTestsRequired: boolean
  }
}

export interface AgentRunInput {
  task: string
}

export type RunStatus = 'success' | 'blocked' | 'failed'

export interface RunRecord {
  id: string
  agentId: string
  startedAt: string
  finishedAt: string
  status: RunStatus
  runtimeAdapter: string
  task: string
  output: string
  monetaryCostUsd: 0
  toolCalls: number
  policyChecks: string[]
  error?: string
}

export interface RuntimeAdapter {
  readonly id: RuntimeAdapterId
  execute(agent: AgentSpec, input: AgentRunInput): Promise<RunRecord>
}
