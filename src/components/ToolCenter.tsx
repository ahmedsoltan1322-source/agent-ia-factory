import McpCenter from './McpCenter'
import LocalToolCenter from './LocalToolCenter'
import WorkflowCenter from './WorkflowCenter'
import type { AgentSpec } from '../core/types'

interface Props {
  agent: AgentSpec | null
  onAgentChange: (agent: AgentSpec) => void
  onNotice: (message: string) => void
}

export default function ToolCenter(props: Props) {
  return (
    <>
      <LocalToolCenter {...props} />
      <McpCenter {...props} />
      <WorkflowCenter onNotice={props.onNotice} />
    </>
  )
}
