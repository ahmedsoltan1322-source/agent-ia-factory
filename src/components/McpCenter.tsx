import { useEffect, useMemo, useState } from 'react'
import {
  clearMcpCallLog,
  discoverMcpServer,
  executeMcpTool,
  listMcpTools,
  loadMcpCallLog,
  loadMcpServers,
  registerMcpServer,
  removeMcpServer,
  setMcpServerEnabled,
  type McpCallRecord,
  type McpRemoteTool,
  type McpServerDescriptor,
} from '../core/mcpClient'
import type { AgentSpec } from '../core/types'

interface Props {
  agent: AgentSpec | null
  onAgentChange: (agent: AgentSpec) => void
  onNotice: (message: string) => void
}

interface PendingMcpApproval {
  server: McpServerDescriptor
  tool: McpRemoteTool
  input: string
}

function callStatusLabel(status: McpCallRecord['status']): string {
  if (status === 'success') return 'ناجح'
  if (status === 'blocked') return 'ممنوع'
  if (status === 'denied') return 'بانتظار/رفض الموافقة'
  return 'فشل'
}

function friendlyMcpError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    MCP_ENDPOINT_INVALID_URL: 'رابط MCP غير صالح.',
    MCP_ENDPOINT_HTTPS_REQUIRED: 'الخادم البعيد يجب أن يستعمل HTTPS. HTTP مسموح فقط لـ localhost أثناء التطوير.',
    MCP_ENDPOINT_EMBEDDED_CREDENTIALS_BLOCKED: 'يمنع وضع اسم مستخدم أو كلمة مرور داخل رابط MCP.',
    MCP_ENDPOINT_QUERY_OR_FRAGMENT_BLOCKED: 'الإصدار الحالي يمنع Query/Fragment في رابط MCP حتى لا تتسرب أسرار عبر الرابط.',
    MCP_ENDPOINT_PRIVATE_NETWORK_BLOCKED: 'تم منع عنوان شبكة خاصة لتقليل مخاطر الوصول غير المقصود إلى الشبكة الداخلية.',
    MCP_ENDPOINT_IPV6_REQUIRES_FUTURE_REVIEW: 'عناوين IPv6 البعيدة مؤجلة لمراجعة أمان لاحقة.',
    MCP_SERVER_ALREADY_REGISTERED: 'هذا الخادم مسجل بالفعل.',
    MCP_SERVER_LIMIT_REACHED: 'تم بلوغ الحد الحالي لخوادم MCP.',
    MCP_AUTH_REQUIRED_NOT_SUPPORTED_YET: 'الخادم يحتاج Authentication (مصادقة). لن نخزن Token (رمز وصول) قبل بناء مخزن أسرار آمن.',
    MCP_REQUEST_TIMEOUT: 'انتهت مهلة اتصال MCP.',
  }
  return labels[message] ?? `MCP: ${message}`
}

export default function McpCenter({ agent, onAgentChange, onNotice }: Props) {
  const [servers, setServers] = useState<McpServerDescriptor[]>(() => loadMcpServers())
  const [serverName, setServerName] = useState('MCP Server')
  const [endpoint, setEndpoint] = useState('https://')
  const [selectedServerId, setSelectedServerId] = useState(() => loadMcpServers()[0]?.id ?? '')
  const [remoteTools, setRemoteTools] = useState<McpRemoteTool[]>([])
  const [selectedToolId, setSelectedToolId] = useState('')
  const [input, setInput] = useState('{}')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<PendingMcpApproval | null>(null)
  const [log, setLog] = useState<McpCallRecord[]>([])

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedServerId) ?? null,
    [servers, selectedServerId],
  )
  const selectedTool = useMemo(
    () => remoteTools.find((tool) => tool.id === selectedToolId) ?? null,
    [remoteTools, selectedToolId],
  )

  function refreshLog() {
    setLog(agent ? loadMcpCallLog(agent.id) : [])
  }

  useEffect(() => {
    refreshLog()
    setPending(null)
  }, [agent?.id])

  function handleRegister() {
    try {
      const next = registerMcpServer(serverName, endpoint)
      setServers(next)
      setSelectedServerId(next[0]?.id ?? '')
      setRemoteTools([])
      setSelectedToolId('')
      onNotice('تم تسجيل MCP Server (خادم MCP) محلياً فقط. لم يحدث أي اتصال بالشبكة بعد.')
    } catch (error) {
      onNotice(friendlyMcpError(error))
    }
  }

  function handleEnabled(server: McpServerDescriptor, enabled: boolean) {
    const next = setMcpServerEnabled(server.id, enabled)
    setServers(next)
    if (!enabled && selectedServerId === server.id) {
      setRemoteTools([])
      setSelectedToolId('')
    }
    onNotice(enabled ? 'تم تفعيل الخادم. ما زال الاتصال يحتاج طلباً يدوياً.' : 'تم تعطيل الخادم ومنع طلبات MCP إليه.')
  }

  function handleRemove(server: McpServerDescriptor) {
    const next = removeMcpServer(server.id)
    setServers(next)
    if (selectedServerId === server.id) {
      setSelectedServerId(next[0]?.id ?? '')
      setRemoteTools([])
      setSelectedToolId('')
    }
    onNotice('تم حذف وصف خادم MCP من الهاتف. لم تُرسل أي عملية حذف إلى الخادم البعيد.')
  }

  async function handleDiscoverTools() {
    if (!selectedServer) return
    setLoading(true)
    setPending(null)
    try {
      await discoverMcpServer(selectedServer)
      const tools = await listMcpTools(selectedServer)
      setRemoteTools(tools)
      setSelectedToolId(tools[0]?.id ?? '')
      onNotice(`تم الاتصال يدوياً بخادم MCP واكتشاف ${tools.length} Tool (أداة). لم يتم تنفيذ أي أداة.`)
    } catch (error) {
      setRemoteTools([])
      setSelectedToolId('')
      onNotice(friendlyMcpError(error))
    } finally {
      setLoading(false)
    }
  }

  function toggleRemoteTool(tool: McpRemoteTool) {
    if (!agent) return
    const enabled = agent.toolPolicy.allowedTools.includes(tool.id)
    const next: AgentSpec = {
      ...agent,
      toolPolicy: {
        ...agent.toolPolicy,
        allowedTools: enabled
          ? agent.toolPolicy.allowedTools.filter((value) => value !== tool.id)
          : [...agent.toolPolicy.allowedTools, tool.id],
      },
    }
    onAgentChange(next)
  }

  async function runRemoteTool(approvedByHuman: boolean, request?: PendingMcpApproval) {
    if (!agent) return
    const target = request ?? (selectedServer && selectedTool ? { server: selectedServer, tool: selectedTool, input } : null)
    if (!target) return

    const result = await executeMcpTool(agent, target.server, target.tool, target.input, approvedByHuman)
    if (result.gate.status === 'approval_required' && !approvedByHuman) {
      setPending(target)
      onNotice('Remote MCP tools/call يحتاج موافقة بشرية صريحة في كل مرة. راجع الخادم، الأداة، ومدخل JSON ثم وافق أو ارفض.')
      return
    }

    setPending(null)
    refreshLog()
    if (result.record.status === 'success') {
      onNotice('تم MCP tools/call بعد موافقة بشرية، بتكلفة إلزامية مسجلة 0$.')
    } else {
      onNotice(friendlyMcpError(result.record.error || result.gate.reason))
    }
  }

  function denyPending() {
    setPending(null)
    onNotice('تم رفض MCP Tool Call (استدعاء أداة MCP). لم يُرسل tools/call إلى الخادم.')
  }

  function handleClearLog() {
    if (!agent) return
    clearMcpCallLog(agent.id)
    refreshLog()
    onNotice('تم مسح سجل MCP المحلي لهذا الوكيل.')
  }

  return (
    <div className="tool-console">
      <div className="card-heading">
        <div>
          <p className="section-kicker">MCP Client (عميل MCP)</p>
          <h3>Remote Tools (الأدوات البعيدة) — مقفلة افتراضياً</h3>
        </div>
        <span className="local-pill">2026-07-28</span>
      </div>

      <p className="disclaimer">
        لا اتصال تلقائياً ولا OAuth/Token حالياً. التسجيل محلي فقط؛ Discovery (الاكتشاف) يحتاج زرّاً يدوياً، وكل tools/call بعيد يحتاج Human Approval (موافقة بشرية) جديدة حتى لو كانت الأداة في Allowlist (قائمة السماح).
      </p>

      <div className="form-grid">
        <label>
          Server Name (اسم الخادم)
          <input value={serverName} onChange={(event) => setServerName(event.target.value)} maxLength={100} />
        </label>
        <label>
          MCP Endpoint (رابط MCP)
          <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off" />
        </label>
        <button className="primary-button" type="button" onClick={handleRegister} disabled={!serverName.trim() || !endpoint.trim()}>
          + Register MCP Server (تسجيل خادم MCP)
        </button>
      </div>

      {servers.length === 0 ? (
        <p className="empty-state">لا توجد خوادم MCP مسجلة على هذا الهاتف.</p>
      ) : (
        <div className="tool-permissions">
          {servers.map((server) => (
            <div className="tool-permission" key={server.id}>
              <input
                type="radio"
                name="selected-mcp-server"
                checked={selectedServerId === server.id}
                onChange={() => {
                  setSelectedServerId(server.id)
                  setRemoteTools([])
                  setSelectedToolId('')
                }}
              />
              <span>
                <strong>{server.name}</strong>
                <small>{server.endpoint}</small>
                <small>Protocol (البروتوكول): {server.protocolVersion} · {server.enabled ? 'Enabled (مفعّل)' : 'Disabled (معطّل)'}</small>
                <span className="approval-actions">
                  <button className="text-button" type="button" onClick={() => handleEnabled(server, !server.enabled)}>
                    {server.enabled ? 'تعطيل' : 'تفعيل'}
                  </button>
                  <button className="text-button" type="button" onClick={() => handleRemove(server)}>حذف محلي</button>
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      <button className="primary-button" type="button" disabled={!selectedServer?.enabled || loading} onClick={handleDiscoverTools}>
        {loading ? 'جاري Discovery (الاكتشاف)...' : '↻ Discover & List Tools (اكتشاف وعرض الأدوات)'}
      </button>

      {remoteTools.length > 0 && (
        <>
          {!agent ? (
            <p className="empty-state">اختر Agent (وكيلاً) لتحديد Allowlist (قائمة السماح) لأدوات MCP.</p>
          ) : (
            <div className="tool-permissions">
              {remoteTools.map((tool) => {
                const allowed = agent.toolPolicy.allowedTools.includes(tool.id)
                return (
                  <label className="tool-permission" key={tool.id}>
                    <input type="checkbox" checked={allowed} onChange={() => toggleRemoteTool(tool)} />
                    <span>
                      <strong>{tool.name}</strong>
                      <small>{tool.description}</small>
                      <small>Risk (الخطر): remote/external · Mandatory approval (موافقة إلزامية): نعم</small>
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          <label>
            MCP Tool (أداة MCP)
            <select value={selectedToolId} onChange={(event) => setSelectedToolId(event.target.value)}>
              {remoteTools.map((tool) => <option value={tool.id} key={tool.id}>{tool.name}</option>)}
            </select>
          </label>
          <label>
            Arguments JSON (مدخلات JSON)
            <textarea rows={4} value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} />
          </label>
          <button className="primary-button" type="button" disabled={!agent || !selectedTool || !selectedServer || !input.trim()} onClick={() => runRemoteTool(false)}>
            ▶ Request MCP Tool Call (طلب استدعاء MCP)
          </button>
        </>
      )}

      {pending && (
        <div className="approval-box" role="alert">
          <strong>Remote MCP Approval Required (موافقة MCP مطلوبة)</strong>
          <p>Server: {pending.server.name}</p>
          <p>Tool: {pending.tool.name}</p>
          <pre>{pending.input}</pre>
          <div className="approval-actions">
            <button className="primary-button" type="button" onClick={() => runRemoteTool(true, pending)}>✓ موافقة وإرسال tools/call</button>
            <button className="danger-button" type="button" onClick={denyPending}>✕ رفض</button>
          </div>
        </div>
      )}

      <div className="tool-log-heading">
        <strong>MCP Call Log (سجل MCP)</strong>
        {log.length > 0 && <button className="text-button" type="button" onClick={handleClearLog}>مسح السجل</button>}
      </div>

      {log.length === 0 ? (
        <p className="empty-state">لا توجد MCP tools/call مسجلة لهذا الوكيل.</p>
      ) : (
        <div className="tool-log-list">
          {log.slice(0, 10).map((record) => (
            <article className="tool-log-item" key={record.id}>
              <div className="run-meta">
                <span className={`status status-${record.status === 'success' ? 'success' : 'blocked'}`}>{callStatusLabel(record.status)}</span>
                <span>{record.serverName}</span>
                <span>{record.remoteToolName}</span>
                <span>التكلفة ${record.monetaryCostUsd.toFixed(2)}</span>
                {record.approvedByHuman && <span>Human Approved</span>}
              </div>
              <pre>{record.output || record.error}</pre>
              <details>
                <summary>Security Checks (فحوص الأمان)</summary>
                <ul>{record.checks.map((check) => <li key={check}>{check}</li>)}</ul>
              </details>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
