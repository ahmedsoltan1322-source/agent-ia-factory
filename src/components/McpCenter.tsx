import { useEffect, useMemo, useState } from 'react'
import {
  addMcpServer,
  applyDiscoveredMcpTools,
  callMcpTool,
  deleteMcpServer,
  discoverMcpTools,
  isMcpKillSwitchActive,
  loadMcpServers,
  mcpAgentToolId,
  setMcpKillSwitchActive,
  updateMcpServer,
  type McpServerConfig,
} from '../core/mcpClient'
import { appendMcpAudit, clearMcpAudit, loadMcpAudit, type McpAuditRecord } from '../core/mcpAudit'
import type { ToolRisk } from '../core/toolSdk'
import type { AgentSpec } from '../core/types'

interface Props {
  agent: AgentSpec | null
  onAgentChange: (agent: AgentSpec) => void
  onNotice: (message: string) => void
}

type PendingCall = {
  serverId: string
  toolName: string
  args: Record<string, unknown>
  argsJson: string
}

const riskOptions: Array<{ value: ToolRisk; label: string }> = [
  { value: 'read_only', label: 'Read Only (قراءة فقط)' },
  { value: 'external_write', label: 'External Write (كتابة خارجية)' },
  { value: 'delete', label: 'Delete (حذف)' },
  { value: 'security_change', label: 'Security Change (تغيير أمني)' },
  { value: 'financial', label: 'Financial (مالي — ممنوع في 0$)' },
]

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('MCP_KILL_SWITCH_ACTIVE')) return 'MCP Kill Switch (زر إيقاف MCP) مفعّل. لا يمكن إجراء اتصالات خارجية.'
  if (message.includes('MCP_HTTPS_REQUIRED')) return 'لأمان الهاتف، MCP في هذه المرحلة يقبل HTTPS فقط.'
  if (message.includes('MCP_URL_CREDENTIALS_FORBIDDEN')) return 'لا تضع username/password داخل URL. الأسرار غير مسموحة في عنوان MCP.'
  if (message.includes('MCP_URL_QUERY_FORBIDDEN')) return 'Query Parameters (معاملات الرابط) ممنوعة في عنوان MCP حتى لا تتسرب مفاتيح أو رموز وصول.'
  if (message.includes('MCP_URL_FRAGMENT_FORBIDDEN')) return 'Fragment (جزء الرابط بعد #) ممنوع في عنوان MCP.'
  if (message.includes('MCP_LOCAL_HOSTNAME_FORBIDDEN') || message.includes('MCP_RAW_IP_FORBIDDEN')) return 'العناوين المحلية أو IP المباشرة ممنوعة في MCP الخارجي لحماية شبكة الجهاز.'
  if (message.includes('MCP_SERVER_NOT_TRUSTED')) return 'يجب Trust (الثقة) بالخادم صراحة قبل الاتصال به.'
  if (message.includes('MCP_PROTOCOL_VERSION_MISMATCH')) return 'الخادم لم يتفاوض على MCP 2026-07-28، لذلك أُغلق الاتصال بأمان.'
  if (message.includes('Failed to fetch')) return 'تعذر الاتصال بالخادم من المتصفح. قد يكون الخادم غير متاح أو يمنع CORS (الوصول من المتصفح).'
  return `MCP Error (خطأ MCP): ${message}`
}

export default function McpCenter({ agent, onAgentChange, onNotice }: Props) {
  const [servers, setServers] = useState<McpServerConfig[]>(() => loadMcpServers())
  const [serverName, setServerName] = useState('MCP Server')
  const [serverUrl, setServerUrl] = useState('')
  const [selectedServerId, setSelectedServerId] = useState(() => loadMcpServers()[0]?.id ?? '')
  const [selectedToolName, setSelectedToolName] = useState('')
  const [argsJson, setArgsJson] = useState('{}')
  const [isBusy, setIsBusy] = useState(false)
  const [pending, setPending] = useState<PendingCall | null>(null)
  const [audit, setAudit] = useState<McpAuditRecord[]>([])
  const [killSwitch, setKillSwitch] = useState(() => isMcpKillSwitchActive())

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedServerId) ?? null,
    [servers, selectedServerId],
  )
  const tools = useMemo(
    () => selectedServer ? Object.values(selectedServer.toolPolicies).sort((a, b) => a.name.localeCompare(b.name)) : [],
    [selectedServer],
  )

  useEffect(() => {
    setAudit(agent ? loadMcpAudit(agent.id) : [])
    setPending(null)
  }, [agent?.id])

  useEffect(() => {
    if (!tools.some((tool) => tool.name === selectedToolName)) {
      setSelectedToolName(tools[0]?.name ?? '')
    }
  }, [selectedServerId, tools.length, selectedToolName, tools])

  function persistServer(server: McpServerConfig) {
    const next = updateMcpServer(server)
    setServers(next)
    setSelectedServerId(server.id)
  }

  function handleKillSwitch(active: boolean) {
    setMcpKillSwitchActive(active)
    setKillSwitch(active)
    setPending(null)
    onNotice(active
      ? 'تم تفعيل MCP Kill Switch (زر الإيقاف). كل الاتصالات الخارجية MCP ممنوعة فوراً.'
      : 'تم إلغاء MCP Kill Switch. ما زالت الثقة والصلاحيات والموافقة البشرية مطلوبة قبل أي اتصال.')
  }

  function handleAddServer() {
    try {
      const next = addMcpServer(serverName, serverUrl)
      setServers(next)
      setSelectedServerId(next[0]?.id ?? '')
      setServerUrl('')
      onNotice('تم حفظ MCP Server (خادم MCP) محلياً كغير موثوق. لن يتم أي اتصال حتى تمنحه Trust (ثقة) صريحة.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function handleTrust(server: McpServerConfig, trusted: boolean) {
    persistServer({ ...server, trusted })
    onNotice(trusted
      ? 'تم تعليم الخادم Trusted (موثوقاً) للاتصال فقط. أدواته ما زالت Disabled (معطلة) حتى تراجعها.'
      : 'تم سحب Trust (الثقة) من الخادم؛ لن يتصل به المصنع.')
  }

  async function handleDiscover(server: McpServerConfig) {
    setIsBusy(true)
    onNotice('جاري MCP Discovery (اكتشاف أدوات الخادم) عبر HTTPS مع بروتوكول 2026-07-28 وحدود الاتصال الأمنية...')
    try {
      const discovered = await discoverMcpTools(server)
      const updated = applyDiscoveredMcpTools(server, discovered)
      persistServer(updated)
      onNotice(`اكتُشفت ${discovered.length} MCP Tools (أدوات). بقيت كلها غير مفعلة افتراضياً حتى تصنف الخطر وتسمح بها.`)
    } catch (error) {
      onNotice(friendlyError(error))
    } finally {
      setIsBusy(false)
    }
  }

  function handleToolPolicy(server: McpServerConfig, toolName: string, patch: { risk?: ToolRisk; enabled?: boolean }) {
    const existing = server.toolPolicies[toolName]
    if (!existing) return
    persistServer({
      ...server,
      toolPolicies: {
        ...server.toolPolicies,
        [toolName]: { ...existing, ...patch },
      },
    })
  }

  function toggleAgentTool(server: McpServerConfig, toolName: string) {
    if (!agent) return
    const id = mcpAgentToolId(server.id, toolName)
    const allowed = agent.toolPolicy.allowedTools.includes(id)
    onAgentChange({
      ...agent,
      toolPolicy: {
        ...agent.toolPolicy,
        allowedTools: allowed
          ? agent.toolPolicy.allowedTools.filter((value) => value !== id)
          : [...agent.toolPolicy.allowedTools, id],
      },
    })
  }

  function parseArgs(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(argsJson) as unknown
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        onNotice('Arguments (المعاملات) يجب أن تكون JSON Object (كائن JSON).')
        return null
      }
      return parsed as Record<string, unknown>
    } catch {
      onNotice('JSON غير صالح في Arguments (المعاملات).')
      return null
    }
  }

  async function executeCall(request: PendingCall, approvedByHuman: boolean) {
    if (!agent) return
    const server = servers.find((item) => item.id === request.serverId)
    if (!server) return

    setIsBusy(true)
    try {
      const result = await callMcpTool(agent, server, request.toolName, request.args, approvedByHuman, 0)
      if (result.status === 'approval_required' && !approvedByHuman) {
        setPending(request)
        onNotice('كل MCP Tool Call (استدعاء أداة MCP خارجية) يحتاج Human Approval (موافقة بشرية) قبل الإرسال في Phase 3C.')
        return
      }

      setPending(null)
      setAudit(appendMcpAudit({
        agentId: agent.id,
        serverId: server.id,
        serverUrl: server.url,
        toolName: request.toolName,
        argsJson: request.argsJson,
        status: result.status,
        output: result.output,
        approvedByHuman,
        checks: result.gate.checks,
        error: result.error,
      }))

      if (result.status === 'success') {
        onNotice('MCP Tool Call نجح بعد الموافقة البشرية وSecurity Gate (بوابة الأمان)، وتكلفته المسجلة 0$.')
      } else {
        onNotice(friendlyError(result.error || 'MCP_CALL_BLOCKED'))
      }
    } finally {
      setIsBusy(false)
    }
  }

  async function requestCall() {
    if (!agent || !selectedServer || !selectedToolName) return
    const args = parseArgs()
    if (!args) return
    await executeCall({
      serverId: selectedServer.id,
      toolName: selectedToolName,
      args,
      argsJson: JSON.stringify(args),
    }, false)
  }

  function handleDeleteServer(serverId: string) {
    const next = deleteMcpServer(serverId)
    setServers(next)
    setSelectedServerId(next[0]?.id ?? '')
    onNotice('تم حذف MCP Server (خادم MCP) من Registry (السجل) المحلي. لا تُحذف سجلات التدقيق تلقائياً.')
  }

  function handleClearAudit() {
    if (!agent) return
    clearMcpAudit(agent.id)
    setAudit([])
    onNotice('تم مسح MCP Audit Log (سجل تدقيق MCP) لهذا الوكيل.')
  }

  return (
    <section className="card mcp-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">MCP Client (عميل MCP)</p>
          <h2>Remote Tools (أدوات خارجية) خلف Security Gate</h2>
        </div>
        <span className="local-pill">2026-07-28 · HTTPS only</span>
      </div>

      <div className="mcp-warning">
        <strong>{killSwitch ? 'MCP Kill Switch مفعّل — الاتصالات متوقفة.' : 'لا يوجد اتصال تلقائي.'}</strong>
        <span>إضافة URL لا تعني الثقة. Discovery يحتاج Trust، وكل Tool تبقى Disabled حتى تفعيلها وتصنيف خطرها وإضافتها إلى Allowlist الخاصة بالوكيل. وكل استدعاء خارجي يحتاج موافقتك.</span>
        <div className="approval-actions">
          {killSwitch ? (
            <button className="primary-button" type="button" onClick={() => handleKillSwitch(false)}>إلغاء Kill Switch (إعادة السماح)</button>
          ) : (
            <button className="danger-button" type="button" onClick={() => handleKillSwitch(true)}>⛔ تفعيل Kill Switch (إيقاف MCP)</button>
          )}
        </div>
      </div>

      <div className="mcp-add-grid">
        <label>اسم الخادم<input value={serverName} onChange={(event) => setServerName(event.target.value)} maxLength={120} /></label>
        <label>MCP HTTPS URL<input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://example.com/mcp" /></label>
        <button className="primary-button" type="button" disabled={!serverUrl.trim()} onClick={handleAddServer}>+ إضافة بدون اتصال</button>
      </div>

      {servers.length > 0 && (
        <div className="mcp-server-list">
          {servers.map((server) => (
            <article className={`mcp-server ${server.id === selectedServerId ? 'selected' : ''}`} key={server.id}>
              <button className="agent-select" type="button" onClick={() => setSelectedServerId(server.id)}>
                <strong>{server.name}</strong>
                <small>{server.url}</small>
                <small>{server.trusted ? 'Trusted (موثوق)' : 'Untrusted (غير موثوق)'} · {Object.keys(server.toolPolicies).length} tools</small>
              </button>
              <div className="mcp-server-actions">
                <label className="trust-toggle"><input type="checkbox" checked={server.trusted} onChange={(event) => handleTrust(server, event.target.checked)} /> Trust</label>
                <button className="text-button" type="button" disabled={killSwitch || !server.trusted || isBusy} onClick={() => handleDiscover(server)}>Discover</button>
                <button className="danger-button" type="button" onClick={() => handleDeleteServer(server.id)}>حذف</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedServer && tools.length > 0 && (
        <div className="mcp-tools">
          <strong className="mini-title">Discovered Tools (الأدوات المكتشفة)</strong>
          {tools.map((tool) => {
            const agentToolId = mcpAgentToolId(selectedServer.id, tool.name)
            const agentAllowed = Boolean(agent?.toolPolicy.allowedTools.includes(agentToolId))
            return (
              <article className="mcp-tool" key={tool.name}>
                <div>
                  <strong>{tool.name}</strong>
                  <p>{tool.description || 'بدون وصف من الخادم.'}</p>
                </div>
                <label>Risk (الخطر)
                  <select value={tool.risk} onChange={(event) => handleToolPolicy(selectedServer, tool.name, { risk: event.target.value as ToolRisk })}>
                    {riskOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="trust-toggle"><input type="checkbox" checked={tool.enabled} onChange={(event) => handleToolPolicy(selectedServer, tool.name, { enabled: event.target.checked })} /> Enable on server policy</label>
                <label className="trust-toggle"><input type="checkbox" disabled={!agent || !tool.enabled} checked={agentAllowed} onChange={() => toggleAgentTool(selectedServer, tool.name)} /> Allow for selected Agent</label>
              </article>
            )
          })}
        </div>
      )}

      {agent && selectedServer && tools.length > 0 && (
        <div className="mcp-console">
          <label>Tool (الأداة)
            <select value={selectedToolName} onChange={(event) => setSelectedToolName(event.target.value)}>
              {tools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
            </select>
          </label>
          <label>Arguments JSON (معاملات JSON)<textarea rows={4} value={argsJson} onChange={(event) => setArgsJson(event.target.value)} /></label>
          <button className="primary-button" type="button" disabled={killSwitch || isBusy || !selectedToolName} onClick={requestCall}>▶ Request MCP Tool Call</button>
        </div>
      )}

      {pending && (
        <div className="approval-box" role="alert">
          <strong>Human Approval Required (موافقة بشرية مطلوبة)</strong>
          <p>Server: {servers.find((server) => server.id === pending.serverId)?.name}</p>
          <p>Tool: {pending.toolName}</p>
          <pre>{pending.argsJson}</pre>
          <div className="approval-actions">
            <button className="primary-button" type="button" disabled={killSwitch} onClick={() => executeCall(pending, true)}>✓ موافقة وإرسال للخادم</button>
            <button className="danger-button" type="button" onClick={() => { setPending(null); onNotice('تم رفض MCP Tool Call ولم يُرسل إلى الخادم.') }}>✕ رفض</button>
          </div>
        </div>
      )}

      <div className="tool-log-heading">
        <strong>MCP Audit Log (سجل تدقيق MCP)</strong>
        {audit.length > 0 && <button className="text-button" type="button" onClick={handleClearAudit}>مسح السجل</button>}
      </div>
      {audit.length === 0 ? <p className="empty-state">لا توجد استدعاءات MCP مسجلة لهذا الوكيل.</p> : (
        <div className="tool-log-list">
          {audit.slice(0, 8).map((record) => (
            <article className="tool-log-item" key={record.id}>
              <div className="run-meta"><span>{record.status}</span><span>{record.toolName}</span><span>0$</span>{record.approvedByHuman && <span>Human Approved</span>}</div>
              <pre>{record.output || record.error}</pre>
              <details><summary>Security Checks</summary><ul>{record.checks.map((check) => <li key={check}>{check}</li>)}</ul></details>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
