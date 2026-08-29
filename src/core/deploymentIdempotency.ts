import type { DurableJobKind } from './deploymentEngine'

const REFERENCE = /^[A-Za-z0-9._:-]{1,120}$/u

function stableUnicodeHash(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (const character of value.normalize('NFC')) {
    const codePoint = character.codePointAt(0) ?? 0
    first ^= codePoint
    first = Math.imul(first, 0x01000193)
    second ^= codePoint + 0x7ed55d16 + (second << 6) + (second >>> 2)
    second = Math.imul(second, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`
}

export function buildDurableIdempotencyKey(kind: DurableJobKind, referenceIdRaw: string, taskRaw: string): string {
  if (!['agent_run', 'workflow_run'].includes(kind)) throw new Error('IDEMPOTENCY_KIND_INVALID')
  const referenceId = referenceIdRaw.trim()
  if (!REFERENCE.test(referenceId)) throw new Error('IDEMPOTENCY_REFERENCE_INVALID')
  const task = taskRaw.trim().normalize('NFC')
  if (!task || task.length > 5_000) throw new Error('IDEMPOTENCY_TASK_INVALID')
  const hash = stableUnicodeHash(`${kind}\u0000${referenceId}\u0000${task}`)
  return `${kind}:${referenceId}:${hash}:${task.length}`.slice(0, 160)
}
