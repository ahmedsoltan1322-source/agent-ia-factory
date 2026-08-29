import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './memory.css'
import './tool.css'
import './mcp.css'
import './workflow.css'
import './team-orchestration.css'
import './factory.css'
import './factory-intelligence.css'
import './oss-harvester.css'
import './browser-agent.css'
import './browser-write.css'
import './browser-upload.css'
import './evaluation.css'
import './deployment.css'
import './worker.css'
import './transport.css'
import './template-exchange.css'
import './community-catalog.css'
import './tool-marketplace.css'
import './adapter-sdk.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
