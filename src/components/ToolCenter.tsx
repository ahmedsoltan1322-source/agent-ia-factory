import AdapterSdkCenter from './AdapterSdkCenter'
import AuthenticatedWorkerCenter from './AuthenticatedWorkerCenter'
import BrowserAgentCenter from './BrowserAgentCenter'
import BrowserUploadCenter from './BrowserUploadCenter'
import BrowserWriteCenter from './BrowserWriteCenter'
import CommunityCatalogCenter from './CommunityCatalogCenter'
import DeploymentScaleCenter from './DeploymentScaleCenter'
import EvaluationCenter from './EvaluationCenter'
import McpCenter from './McpCenter'
import LocalToolCenter from './LocalToolCenter'
import OssHarvesterCenter from './OssHarvesterCenter'
import SelfHostWorkerCenter from './SelfHostWorkerCenter'
import TeamOrchestrationCenter from './TeamOrchestrationCenter'
import TemplateExchangeCenter from './TemplateExchangeCenter'
import ToolMarketplaceCenter from './ToolMarketplaceCenter'
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
      <BrowserWriteCenter onNotice={props.onNotice} />
      <BrowserUploadCenter onNotice={props.onNotice} />
      <EvaluationCenter agents={agents} runs={runs} onNotice={props.onNotice} />
      <DeploymentScaleCenter agents={agents} onNotice={props.onNotice} />
      <SelfHostWorkerCenter agents={agents} onNotice={props.onNotice} />
      <AuthenticatedWorkerCenter agents={agents} onNotice={props.onNotice} />
      <TemplateExchangeCenter onAgentChange={props.onAgentChange} onNotice={props.onNotice} />
      <CommunityCatalogCenter onNotice={props.onNotice} />
      <ToolMarketplaceCenter onNotice={props.onNotice} />
      <AdapterSdkCenter agent={props.agent} onAgentChange={props.onAgentChange} onNotice={props.onNotice} />
    </>
  )
}
