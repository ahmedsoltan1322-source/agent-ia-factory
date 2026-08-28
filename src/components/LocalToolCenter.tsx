import { useEffect, useMemo, useState } from 'react'
import {
  clearToolCallLog,
  executeBuiltinTool,
  listBuiltinTools,
  loadToolCallLog,
  type ToolCallRecord,
} from '../core/toolSdk'
import type { AgentSpec } from '../core/types'

interface Props {
  agent: AgentSpec | null
  onAgentChange: (agent: AgentSpec) => void
  onNotice: (message: string) => void
}

interface PendingApproval {
  toolId: string
  input: string
}

function statusLabel(status: ToolCallRecord['status']): string {
  if (status === 'success') return 'ناجح'
  if (status === 'blocked') return 'ممنوع'
  if (status === 'denied') return 'بانتظار/رفض الموافقة'
  return 'فشل'
}

export default function LocalToolCenter({ agent, onAgentChange, onNotice }: Props) {
  const tools = useMemo(() => listBuiltinTools(), [])
  const [toolId, setToolId] = useState(tools[0]?.id ?? '')
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<PendingApproval | null>(null)
  const [log, setLog] = useState<ToolCallRecord[]>([])
  const selectedTool = tools.find((tool) => tool.id === toolId) ?? null

  function refreshLog() {
    setLog(agent ? loadToolCallLog(agent.id) : [])
  }

  useEffect(() => {
    refreshLog()
    setPending(null)
  }, [agent?.id])

  function toggleTool(id: string) {
    if (!agent) return
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

  async function runTool(approvedByHuman: boolean, request?: PendingApproval) {
    if (!agent) return
    const target = request ?? { toolId, input }
    const result = await executeBuiltinTool(agent, target.toolId, target.input, approvedByHuman)

    if (result.gate.status === 'approval_required' && !approvedByHuman) {
      setPending(target)
      onNotice('هذه الأداة تحتاج Human Approval (موافقة بشرية) قبل التنفيذ. راجع الطلب ثم وافق أو ارفض.')
      return
    }

    setPending(null)
    refreshLog()
    onNotice(result.record.status === 'success'
      ? `تم تنفيذ Tool (الأداة) محلياً بتكلفة $${result.record.monetaryCostUsd.toFixed(2)}.`
      : result.record.error || 'تم منع Tool Call (استدعاء الأداة).')
  }

  function clearLog() {
    if (!agent) return
    clearToolCallLog(agent.id)
    refreshLog()
    onNotice('تم مسح Tool Call Log (سجل استدعاءات الأدوات) لهذا الوكيل.')
  }

  return (
    <section className="card tool-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Local Tool SDK & Security (الأدوات المحلية والأمان)</p>
          <h2>Local Tool Registry (سجل الأدوات المحلية)</h2>
        </div>
        <span className="safe-pill">Deny by default</span>
      </div>

      {!agent ? <p className="empty-state">اختر Agent (وكيلاً) أولاً لإدارة صلاحيات أدواته.</p> : (
        <>
          <div className="tool-permissions">
            {tools.map((tool) => {
              const enabled = agent.toolPolicy.allowedTools.includes(tool.id)
              return (
                <label className="tool-permission" key={tool.id}>
                  <input type="checkbox" checked={enabled} onChange={() => toggleTool(tool.id)} />
                  <span>
                    <strong>{tool.name}</strong>
                    <small>{tool.description}</small>
                    <small>Risk: {tool.risk} · Scopes: {tool.scopes.join(', ')}</small>
                  </span>
                </label>
              )
            })}
          </div>

          <div className="tool-console">
            <label>Tool (الأداة)
              <select value={toolId} onChange={(event) => setToolId(event.target.value)}>
                {tools.map((tool) => <option value={tool.id} key={tool.id}>{tool.name}</option>)}
              </select>
            </label>
            <label>Input (المدخل)
              <textarea rows={3} value={input} onChange={(event) => setInput(event.target.value)} placeholder={selectedTool?.inputHint} />
            </label>
            <button className="primary-button" type="button" disabled={!selectedTool || !input.trim()} onClick={() => runTool(false)}>▶ Request Tool Call</button>
          </div>

          {pending && (
            <div className="approval-box" role="alert">
              <strong>Human Approval Required (موافقة بشرية مطلوبة)</strong>
              <p>Tool: {pending.toolId}</p><pre>{pending.input}</pre>
              <div className="approval-actions">
                <button className="primary-button" type="button" onClick={() => runTool(true, pending)}>✓ موافقة وتنفيذ</button>
                <button className="danger-button" type="button" onClick={() => { setPending(null); onNotice('تم رفض Human Approval ولم تُنفذ الأداة.') }}>✕ رفض</button>
              </div>
            </div>
          )}

          <div className="tool-log-heading"><strong>Tool Call Log (سجل الأدوات المحلية)</strong>{log.length > 0 && <button className="text-button" type="button" onClick={clearLog}>مسح السجل</button>}</div>
          {log.length === 0 ? <p className="empty-state">لا توجد Tool Calls مسجلة لهذا الوكيل.</p> : (
            <div className="tool-log-list">
              {log.slice(0, 10).map((record) => (
                <article className="tool-log-item" key={record.id}>
                  <div className="run-meta">
                    <span className={`status status-${record.status === 'success' ? 'success' : 'blocked'}`}>{statusLabel(record.status)}</span>
                    <span>{record.toolId}</span><span>التكلفة ${record.monetaryCostUsd.toFixed(2)}</span>{record.approvedByHuman && <span>Human Approved</span>}
                  </div>
                  <pre>{record.output || record.error}</pre>
                  <details><summary>Security Checks</summary><ul>{record.checks.map((check) => <li key={check}>{check}</li>)}</ul></details>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
