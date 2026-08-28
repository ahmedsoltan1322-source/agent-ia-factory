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
import './oss-harvester.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
