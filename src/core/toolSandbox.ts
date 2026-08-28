import type { ToolDefinition, ToolExecutionContext } from './toolSdk'

export interface ToolSandboxResult {
  output: string
  checks: string[]
}

export class ToolSandboxError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ToolSandboxError'
  }
}

export const TOOL_SANDBOX_LIMITS = {
  maxInputChars: 20_000,
  maxOutputChars: 40_000,
  timeoutMs: 5_000,
} as const

const ALLOWED_BUILTIN_SCOPES = new Set([
  'text:read',
  'memory:read',
  'memory:write-local',
  'memory:delete',
])

function assertToolCapabilities(tool: ToolDefinition): string[] {
  const checks: string[] = []

  if (tool.risk === 'financial') {
    throw new ToolSandboxError('SANDBOX_FINANCIAL_FORBIDDEN', 'Financial tool execution is forbidden in the zero-cost capability sandbox.')
  }
  checks.push('sandbox financial capability: absent')

  for (const scope of tool.scopes) {
    if (!ALLOWED_BUILTIN_SCOPES.has(scope)) {
      throw new ToolSandboxError('SANDBOX_SCOPE_FORBIDDEN', `Built-in tool scope is not allowed by the capability sandbox: ${scope}`)
    }
  }
  checks.push(`sandbox scopes: ${tool.scopes.join(', ') || 'none'}`)

  return checks
}

export async function executeBuiltinInCapabilitySandbox(
  tool: ToolDefinition,
  context: ToolExecutionContext,
  input: string,
): Promise<ToolSandboxResult> {
  const checks = assertToolCapabilities(tool)

  if (input.length > TOOL_SANDBOX_LIMITS.maxInputChars) {
    throw new ToolSandboxError(
      'SANDBOX_INPUT_TOO_LARGE',
      `Tool input exceeds ${TOOL_SANDBOX_LIMITS.maxInputChars} characters.`,
    )
  }
  checks.push(`sandbox input chars: ${input.length}/${TOOL_SANDBOX_LIMITS.maxInputChars}`)

  let timeoutId: number | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new ToolSandboxError('SANDBOX_TIMEOUT', `Tool exceeded ${TOOL_SANDBOX_LIMITS.timeoutMs}ms execution budget.`))
    }, TOOL_SANDBOX_LIMITS.timeoutMs)
  })

  try {
    const raw = await Promise.race([
      Promise.resolve(tool.execute(context, input)),
      timeout,
    ])
    const output = String(raw ?? '')

    if (output.length > TOOL_SANDBOX_LIMITS.maxOutputChars) {
      checks.push(`sandbox output truncated: ${output.length}/${TOOL_SANDBOX_LIMITS.maxOutputChars}`)
      return {
        output: `${output.slice(0, TOOL_SANDBOX_LIMITS.maxOutputChars)}\n[OUTPUT_TRUNCATED_BY_TOOL_SANDBOX]`,
        checks,
      }
    }

    checks.push(`sandbox output chars: ${output.length}/${TOOL_SANDBOX_LIMITS.maxOutputChars}`)
    checks.push(`sandbox execution budget: ${TOOL_SANDBOX_LIMITS.timeoutMs}ms`)
    return { output, checks }
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  }
}
