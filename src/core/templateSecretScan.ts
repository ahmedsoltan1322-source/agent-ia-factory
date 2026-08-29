const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u,
  /\bgh[pousr]_[A-Za-z0-9]{24,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}={0,2}\b/iu,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd)\s*[:=]\s*["']?[A-Za-z0-9._~+\/-]{16,}/iu,
]

function visit(value: unknown, depth: number): void {
  if (depth > 12) throw new Error('TEMPLATE_SECRET_SCAN_DEPTH_LIMIT')
  if (typeof value === 'string') {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) throw new Error('TEMPLATE_SECRET_LIKE_CONTENT')
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) visit(item, depth + 1)
    return
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) visit(item, depth + 1)
  }
}

export function assertNoTemplateSecretLikeContent(value: unknown): void {
  visit(value, 0)
}