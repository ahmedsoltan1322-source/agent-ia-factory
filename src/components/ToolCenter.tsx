import McpCenter from './McpCenter'
import LocalToolCenter from './LocalToolCenter'
import OssHarvesterCenter from './OssHarvesterCenter'
import TeamOrchestrationCenter from './TeamOrchestrationCenter'
import { loadAgents } from '../core/storage'
import type { AgentSpec } from '../core/types'

interface Props {
  agent: AgentSpec | null
  onAgentChange: (agent: AgentSpec) => void
  onNotice: (message: string) => void
}

export default function ToolCenter(props: Props) {
  const agents = loadAgents()

  return (
    <>
      <LocalToolCenter {...props} />
      <McpCenter {...props} />
      <TeamOrchestrationCenter agents={agents} onNotice={props.onNotice} />
      <OssHarvesterCenter onNotice={props.onNotice} />
    </>
  )
}
