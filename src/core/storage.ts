import type { AgentSpec, RunRecord } from './types'

const AGENTS_KEY = 'agent-ia-factory.agents.v1'
const RUNS_KEY = 'agent-ia-factory.runs.v1'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadAgents(): AgentSpec[] {
  return readJson<AgentSpec[]>(AGENTS_KEY, [])
}

export function saveAgent(agent: AgentSpec): AgentSpec[] {
  const current = loadAgents()
  const next = [agent, ...current.filter((item) => item.id !== agent.id)]
  writeJson(AGENTS_KEY, next)
  return next
}

export function deleteAgent(agentId: string): AgentSpec[] {
  const next = loadAgents().filter((item) => item.id !== agentId)
  writeJson(AGENTS_KEY, next)
  return next
}

export function loadRuns(): RunRecord[] {
  return readJson<RunRecord[]>(RUNS_KEY, [])
}

export function saveRun(run: RunRecord): RunRecord[] {
  const next = [run, ...loadRuns()].slice(0, 100)
  writeJson(RUNS_KEY, next)
  return next
}

export function clearRuns(): void {
  localStorage.removeItem(RUNS_KEY)
}
