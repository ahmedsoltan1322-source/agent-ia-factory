import { useEffect, useMemo, useState } from 'react'
import {
  clearMcpCallLog,
  executeMcpTool,
  listMcpServers,
  loadMcpCallLog,
  type McpCallRecord,
} from '../core/mcpRegistry'
import type { AgentSpec } from '../core/types'

interface Props {
  agent: AgentSpec | null
  onAgentChange: (agent: AgentSpec) => void
  onNotice: (message: string) => void
}

interface PendingApproval {
  serverId: string
  toolId: string
  input: string
}

function statusLabel(status: McpCallRecord['status']): string {
  if (status === 'success') return 'ناجح'
  if (status === 'blocked') return 'ممنوع'
  if (status === 'denied') return 'بانتظار/رفض الموافقة'
  return 'فشل'
}

export default function McpCenter({ agent, onAgentChange, onNotice }: Props) {
  const servers = useMemo(() => listMcpServers(), [])
  const firstServer = servers[0] ?? null
  const firstTool = firstServer?.tools[0] ?? null
  const [serverId, setServerId] = useState(firstServer?.id ?? '')
  const [toolId, setToolId] = useState(firstTool?.id ?? '')
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<PendingApproval | null>(null)
  const [log, setLog] = useState<McpCallRecord[]>([])

  const selectedServer = servers.find((server) => server.id === serverId) ?? null
  const selectedTool = selectedServer?.tools.find((tool) => tool.id === toolId) ?? null

  function refreshLog() {
    setLog(agent ? loadMcpCallLog(agent.id) : [])
  }

  useEffect(() => {
    refreshLog()
    setPending(null)
  }, [agent?.id])

  function handleServerChange(nextServerId: string) {
    setServerId(nextServerId)
    const nextServer = servers.find((server) => server.id === nextServerId)
    setToolId(nextServer?.tools[0]?.id ?? '')
  }

  function toggleTool(id: string) {
    if (!agent) return
    const allowed = agent.toolPolicy.allowedTools.includes(id)
    const next: AgentSpec = {
      ...agent,
      toolPolicy: {
        ...agent.toolPolicy,
        allowedTools: allowed
          ? agent.toolPolicy.allowedTools.filter((value) => value !== id)
          : [...agent.toolPolicy.allowedTools, id],
      },
    }
    onAgentChange(next)
  }

  async function runMcp(approvedByHuman: boolean, request?: PendingApproval) {
    if (!agent) return
    const target = request ?? { serverId, toolId, input }
    const result = await executeMcpTool(
      agent,
      target.serverId,
      target.toolId,
      target.input,
      approvedByHuman,
      0,
    )

    if (result.gate.status === 'approval_required' && !approvedByHuman) {
      setPending(target)
      onNotice('MCP Tool (أداة MCP) تحتاج Human Approval (موافقة بشرية) قبل التنفيذ.')
      return
    }

    setPending(null)
    refreshLog()
    if (result.record.status === 'success') {
      onNotice('تم تنفيذ MCP Tool (أداة MCP) داخل Local Sandbox (المختبر المحلي) بتكلفة $0.')
    } else {
      onNotice(result.record.error || 'تم منع استدعاء MCP بواسطة Security Gate (بوابة الأمان).')
    }
  }

  function clearLog() {
    if (!agent) return
    clearMcpCallLog(agent.id)
    refreshLog()
    onNotice('تم مسح MCP Audit Log (سجل تدقيق MCP) لهذا الوكيل.')
  }

  return (
    <section className="card mcp-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">MCP Security Layer (طبقة أمان MCP)</p>
          <h2>MCP Registry (سجل خوادم MCP)</h2>
        </div>
        <span className="safe-pill">Local only · Deny external</span>
      </div>

      {!agent ? (
        <p className="empty-state">اختر Agent (وكيلاً) أولاً لإدارة صلاحيات MCP.</p>
      ) : (
        <>
          <div className="mcp-server-list">
            {servers.map((server) => (
              <article className="mcp-server" key={server.id}>
                <div className="mcp-server-head">
                  <strong>{server.name}</strong>
                  <span className="local-pill">{server.transport}</span>
                </div>
                <p>{server.description}</p>
                <small>
                  Network (الشبكة): {server.networkAccess ? 'مطلوبة' : 'ممنوعة'} · Default (الافتراضي): معطّل · Protocol: MCP
                </small>
                <div className="mcp-tool-permissions">
                  {server.tools.map((tool) => {
                    const enabled = agent.toolPolicy.allowedTools.includes(tool.id)
                    return (
                      <label className="tool-permission" key={tool.id}>
                        <input type="checkbox" checked={enabled} onChange={() => toggleTool(tool.id)} />
                        <span>
                          <strong>{tool.name}</strong>
                          <small>{tool.description}</small>
                          <small>Risk (الخطر): {tool.risk} · Scopes (الصلاحيات): {tool.scopes.join(', ')}</small>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </article>
            ))}
          </div>

          <div className="mcp-console">
            <label>
              MCP Server (خادم MCP)
              <select value={serverId} onChange={(event) => handleServerChange(event.target.value)}>
                {servers.map((server) => <option value={server.id} key={server.id}>{server.name}</option>)}
              </select>
            </label>
            <label>
              MCP Tool (أداة MCP)
              <select value={toolId} onChange={(event) => setToolId(event.target.value)}>
                {selectedServer?.tools.map((tool) => <option value={tool.id} key={tool.id}>{tool.name}</option>)}
              </select>
            </label>
            <label>
              Input (المدخل)
              <textarea
                rows={3}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={selectedTool?.inputHint}
              />
            </label>
            <button className="primary-button" type="button" disabled={!selectedTool || !input.trim()} onClick={() => runMcp(false)}>
              ▶ Test MCP Call (اختبار استدعاء MCP)
            </button>
            <p className="disclaimer">
              Phase 3B تسمح فقط بـ Local MCP Sandbox (مختبر MCP محلي). Streamable HTTP (اتصال شبكي) وstdio (طرفية) ممنوعان حتى نضيف فحص الهوية، Origins (الأصول)، الأسرار، وحدود الشبكة.
            </p>
          </div>

          {pending && (
            <div className="approval-box" role="alert">
              <strong>Human Approval Required (موافقة بشرية مطلوبة)</strong>
              <p>{pending.toolId}</p>
              <pre>{pending.input}</pre>
              <div className="approval-actions">
                <button className="primary-button" type="button" onClick={() => runMcp(true, pending)}>✓ موافقة وتنفيذ</button>
                <button className="danger-button" type="button" onClick={() => { setPending(null); onNotice('تم رفض MCP Call ولم ينفذ.') }}>✕ رفض</button>
              </div>
            </div>
          )}

          <div className="tool-log-heading">
            <strong>MCP Audit Log (سجل تدقيق MCP)</strong>
            {log.length > 0 && <button className="text-button" type="button" onClick={clearLog}>مسح السجل</button>}
          </div>

          {log.length === 0 ? (
            <p className="empty-state">لا توجد MCP Calls (استدعاءات MCP) لهذا الوكيل.</p>
          ) : (
            <div className="tool-log-list">
              {log.slice(0, 10).map((record) => (
                <article className="tool-log-item" key={record.id}>
                  <div className="run-meta">
                    <span className={`status status-${record.status === 'success' ? 'success' : 'blocked'}`}>{statusLabel(record.status)}</span>
                    <span>{record.serverId}</span>
                    <span>{record.toolId}</span>
                    <span>التكلفة $0.00</span>
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
        </>
      )}
    </section>
  )
}
