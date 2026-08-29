import { useMemo, useState } from 'react'
import {
  activateMarketplaceToolAdapter,
  assignActivatedMarketplaceToolToAgent,
  deactivateMarketplaceToolAdapter,
  executeActivatedMarketplaceTool,
  loadActivatedMarketplaceTools,
  removeActivatedMarketplaceToolFromAgent,
  type ActivatedMarketplaceTool,
} from '../core/adapterActivation'
import { listAdapterDescriptors } from '../core/adapterSdk'
import { importSignedToolPackage, loadRegisteredMarketplaceTools, type VerifiedToolPackage } from '../core/toolMarketplace'
import type { ToolCallRecord } from '../core/toolSdk'
import type { AgentSpec } from '../core/types'

interface Props {
  agent: AgentSpec | null
  onAgentChange: (agent: AgentSpec) => void
  onNotice: (message: string) => void
}

interface PendingCall {
  toolId: string
  input: string
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    ADAPTER_ACTIVATION_HUMAN_APPROVAL_REQUIRED: 'يلزم إقرار بشري مستقل قبل تفعيل Adapter-backed Tool.',
    ADAPTER_ACTIVATION_MARKETPLACE_REGISTRATION_REQUIRED: 'سجّل Tool Package أولًا كـDisabled في Phase 10C Marketplace.',
    ADAPTER_ACTIVATION_PACKAGE_REGISTRY_MISMATCH: 'الحزمة لا تطابق Marketplace Registration (التسجيل) المحفوظة.',
    ADAPTER_NOT_REGISTERED: 'Adapter ID غير موجود داخل Static Reviewed Registry (السجل المدمج المفحوص).',
    ADAPTER_TOOL_ID_UNSUPPORTED: 'هذا Adapter لا يدعم Tool ID المطلوبة.',
    ADAPTER_SCOPE_UNSUPPORTED: 'الصلاحيات المطلوبة أوسع من صلاحيات Adapter المفحوصة.',
    ADAPTER_RISK_EXCEEDS_REVIEWED_CEILING: 'Risk (الخطر) يتجاوز الحد الذي تمت مراجعة Adapter عليه.',
    ADAPTER_AGENT_ALLOWLIST_APPROVAL_REQUIRED: 'يلزم إقرار مستقل قبل إضافة Tool إلى Agent Allowlist.',
    ADAPTER_AGENT_ALLOWLIST_REMOVE_APPROVAL_REQUIRED: 'يلزم إقرار مستقل قبل إزالة Tool من Agent Allowlist.',
    ADAPTER_DEACTIVATION_HUMAN_APPROVAL_REQUIRED: 'يلزم إقرار مستقل قبل إلغاء التفعيل.',
    TOOL_SIGNATURE_INVALID: 'توقيع Tool Package غير صالح.',
  }
  return labels[message] ?? `Adapter SDK (حزمة الموصلات): ${message}`
}

function callStatus(record: ToolCallRecord | null): string {
  if (!record) return '—'
  if (record.status === 'success') return 'Success (ناجح)'
  if (record.status === 'denied') return 'Approval Required / Denied'
  if (record.status === 'blocked') return 'Blocked (ممنوع)'
  return 'Failed (فشل)'
}

export default function AdapterSdkCenter({ agent, onAgentChange, onNotice }: Props) {
  const adapters = useMemo(() => listAdapterDescriptors(), [])
  const [verified, setVerified] = useState<VerifiedToolPackage | null>(null)
  const [activationApproval, setActivationApproval] = useState(false)
  const [allowlistApproval, setAllowlistApproval] = useState(false)
  const [removeAllowlistApproval, setRemoveAllowlistApproval] = useState(false)
  const [deactivationApproval, setDeactivationApproval] = useState(false)
  const [revision, setRevision] = useState(0)
  const [selectedToolId, setSelectedToolId] = useState('')
  const [input, setInput] = useState('مرحبا بالعالم')
  const [pending, setPending] = useState<PendingCall | null>(null)
  const [lastCall, setLastCall] = useState<ToolCallRecord | null>(null)

  const activeTools = useMemo(() => {
    void revision
    return loadActivatedMarketplaceTools()
  }, [revision])

  const registrations = useMemo(() => {
    void revision
    return loadRegisteredMarketplaceTools()
  }, [revision])

  const selectedActivation = activeTools.find((item) => item.toolId === selectedToolId) ?? activeTools[0] ?? null

  async function importPackage(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      const imported = await importSignedToolPackage(await file.text())
      setVerified(imported)
      setSelectedToolId(imported.package.tool.toolId)
      setActivationApproval(false)
      onNotice('Tool Package verified. لا تفعيل حدث؛ راجع Adapter ثم وافق بصورة مستقلة.')
    } catch (error) {
      setVerified(null)
      onNotice(friendlyError(error))
    }
  }

  async function activate(): Promise<void> {
    if (!verified) return
    try {
      const activation = await activateMarketplaceToolAdapter(verified, activationApproval)
      setActivationApproval(false)
      setSelectedToolId(activation.toolId)
      setRevision((value) => value + 1)
      onNotice(`${activation.name}: Adapter activation تم محليًا. لم تُضف الأداة لأي Agent بعد.`)
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function addToAgent(tool: ActivatedMarketplaceTool): void {
    if (!agent) return
    try {
      const next = assignActivatedMarketplaceToolToAgent(agent, tool.toolId, allowlistApproval)
      setAllowlistApproval(false)
      onAgentChange(next)
      onNotice('تمت إضافة Tool إلى Agent Allowlist بموافقة منفصلة. Call Gate ما زالت مطلوبة عند كل استدعاء.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function removeFromAgent(tool: ActivatedMarketplaceTool): void {
    if (!agent) return
    try {
      const next = removeActivatedMarketplaceToolFromAgent(agent, tool.toolId, removeAllowlistApproval)
      setRemoveAllowlistApproval(false)
      onAgentChange(next)
      onNotice('تمت إزالة Tool من Agent Allowlist؛ التفعيل العام للAdapter لم يتغير.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function deactivate(tool: ActivatedMarketplaceTool): void {
    try {
      deactivateMarketplaceToolAdapter(tool.toolId, deactivationApproval)
      setDeactivationApproval(false)
      setRevision((value) => value + 1)
      setPending(null)
      onNotice('تم إلغاء Adapter activation. أي Allowlist قديمة لا تمنح تنفيذًا لأن Tool لم تعد Active.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  async function requestCall(approvedByHuman: boolean, request?: PendingCall): Promise<void> {
    if (!agent) return
    const target = request ?? { toolId: selectedActivation?.toolId ?? '', input }
    if (!target.toolId || !target.input.trim()) return
    const result = await executeActivatedMarketplaceTool(agent, target.toolId, target.input, approvedByHuman)
    if (result.gate.status === 'approval_required' && !approvedByHuman) {
      setPending(target)
      onNotice('هذا Adapter Tool Call يحتاج Human Approval حسب Risk Policy الخاصة بالوكيل.')
      return
    }
    setPending(null)
    setLastCall(result.record)
    onNotice(result.record.status === 'success'
      ? `Adapter Tool Call نجحت داخل Capability Sandbox بتكلفة $${result.record.monetaryCostUsd.toFixed(2)}.`
      : result.record.error || 'Adapter Tool Call لم تُنفذ.')
  }

  const importedRegistered = verified
    ? registrations.some((item) => item.packageDigest === verified.packageDigest)
    : false

  return (
    <section className="card adapter-sdk-card" dir="rtl">
      <div className="section-heading">
        <div>
          <span className="phase-pill">Phase 10D</span>
          <h2>Plugin/Adapter SDK (حزمة تطوير الموصلات)</h2>
        </div>
        <span className="zero-cost-badge">Static Reviewed Adapters · 0$</span>
      </div>

      <p className="muted">
        لا يتم تحميل Plugin Code (كود إضافة) من Marketplace. التفعيل يربط Manifest موقعة بـAdapter مدمجة ومفحوصة مسبقًا داخل المصنع.
      </p>

      <div className="adapter-registry-grid">
        {adapters.map((adapter) => (
          <article key={adapter.id} className="adapter-descriptor">
            <strong>{adapter.name}</strong>
            <small>{adapter.id}@{adapter.version} · {adapter.kind}</small>
            <small>network={adapter.networkMode} · secrets={String(adapter.secretAccess)} · cost={adapter.monetaryCostUsd}$</small>
            <small>{adapter.capabilities.join(' · ')}</small>
          </article>
        ))}
      </div>

      <label className="file-button">
        Import Registered Tool Package (استورد حزمة Tool المسجلة)
        <input type="file" accept="application/json,.json,.agent-tool.json" onChange={(event) => void importPackage(event.target.files?.[0])} />
      </label>

      {verified ? (
        <div className="adapter-activation-panel">
          <p><strong>{verified.package.tool.name}</strong> · adapter={verified.package.tool.implementation.adapterId}</p>
          <p>Marketplace registration: <strong>{importedRegistered ? 'موجودة Disabled' : 'غير موجودة'}</strong></p>
          <label>
            <input type="checkbox" checked={activationApproval} onChange={(event) => setActivationApproval(event.target.checked)} />
            أوافق صراحة على تفعيل هذا Tool↔Adapter binding فقط. لا Agent Allowlist تتغير بهذه الخطوة.
          </label>
          <button type="button" onClick={() => void activate()}>Activate Reviewed Adapter Binding (فعّل الربط المفحوص)</button>
        </div>
      ) : null}

      <div className="active-adapter-tools">
        <h3>Activated Adapter Tools (الأدوات المرتبطة بموصلات)</h3>
        {activeTools.length === 0 ? <p className="muted">لا توجد Adapter-backed Tools مفعلة.</p> : null}
        {activeTools.map((tool) => {
          const inAgent = Boolean(agent?.toolPolicy.allowedTools.includes(tool.toolId))
          return (
            <article key={tool.toolId} className="active-adapter-tool">
              <div>
                <strong>{tool.name}</strong>
                <small>{tool.toolId}@{tool.toolVersion}</small>
                <small>{tool.adapterId}@{tool.adapterVersion} · {tool.risk} · {tool.scopes.join(', ')}</small>
              </div>
              {agent ? (
                <div className="adapter-actions">
                  {!inAgent ? (
                    <>
                      <label><input type="checkbox" checked={allowlistApproval} onChange={(event) => setAllowlistApproval(event.target.checked)} /> موافقة Add to Agent</label>
                      <button type="button" onClick={() => addToAgent(tool)}>Add to Agent Allowlist</button>
                    </>
                  ) : (
                    <>
                      <span className="success-note">موجودة في Agent Allowlist</span>
                      <label><input type="checkbox" checked={removeAllowlistApproval} onChange={(event) => setRemoveAllowlistApproval(event.target.checked)} /> موافقة Remove</label>
                      <button type="button" className="secondary" onClick={() => removeFromAgent(tool)}>Remove from Agent</button>
                    </>
                  )}
                </div>
              ) : <small>اختر Agent لإدارة Allowlist.</small>}
              <div className="adapter-actions">
                <label><input type="checkbox" checked={deactivationApproval} onChange={(event) => setDeactivationApproval(event.target.checked)} /> موافقة Deactivate</label>
                <button type="button" className="danger secondary" onClick={() => deactivate(tool)}>Deactivate Adapter Binding</button>
              </div>
            </article>
          )
        })}
      </div>

      {agent && selectedActivation ? (
        <div className="adapter-call-console">
          <label>Activated Tool
            <select value={selectedActivation.toolId} onChange={(event) => setSelectedToolId(event.target.value)}>
              {activeTools.map((tool) => <option key={tool.toolId} value={tool.toolId}>{tool.name}</option>)}
            </select>
          </label>
          <label>Input
            <textarea rows={3} value={input} onChange={(event) => setInput(event.target.value)} placeholder={selectedActivation.inputHint} />
          </label>
          <button type="button" onClick={() => void requestCall(false)} disabled={!input.trim()}>Request Adapter Tool Call</button>
          <p className="muted">Status: {callStatus(lastCall)}</p>
          {lastCall ? <pre>{lastCall.output || lastCall.error}</pre> : null}
        </div>
      ) : null}

      {pending ? (
        <div className="approval-box" role="alert">
          <strong>Per-call Human Approval Required (موافقة لكل استدعاء)</strong>
          <p>{pending.toolId}</p>
          <pre>{pending.input}</pre>
          <div className="approval-actions">
            <button type="button" onClick={() => void requestCall(true, pending)}>Approve & Execute</button>
            <button type="button" className="danger" onClick={() => { setPending(null); onNotice('تم رفض Adapter Tool Call؛ لا تنفيذ حدث.') }}>Reject</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
