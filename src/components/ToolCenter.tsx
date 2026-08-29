import BrowserAgentCenter from './BrowserAgentCenter'
import EvaluationCenter from './EvaluationCenter'
import McpCenter from './McpCenter'
import LocalToolCenter from './LocalToolCenter'
import OssHarvesterCenter from './OssHarvesterCenter'
import TeamOrchestrationCenter from './TeamOrchestrationCenter'
import { loadAgents, loadRuns } from '../core/storage'
import type { AgentSpec } from '../core/types'

interface Props {
  agent: AgentSpec | null
  onAgentChange: (agent: AgentSpec) => void
  onNotice: (message: string) => void
}

export default function ToolCenter(props: Props) {
  const agents = loadAgents()
  const runs = loadRuns()

  return (
    <>
      <LocalToolCenter {...props} />
      <McpCenter {...props} />
      <TeamOrchestrationCenter agents={agents} onNotice={props.onNotice} />
      <OssHarvesterCenter onNotice={props.onNotice} />
      <BrowserAgentCenter onNotice={props.onNotice} />
      <EvaluationCenter agents={agents} runs={runs} onNotice={props.onNotice} />
    </>
  )
}
