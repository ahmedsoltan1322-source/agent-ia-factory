import { useMemo, useState } from 'react'
import {
  applyFactoryRepair,
  buildFactoryRepairPreview,
  buildFactoryTestPlan,
  buildFactoryToolPlan,
  type FactoryRepairPreview,
  type FactoryTestPlan,
  type FactoryToolPlan,
} from '../core/factoryIntelligence'
import type { FactoryBlueprint } from '../core/factoryPlanner'

interface Props {
  blueprint: FactoryBlueprint
  onBlueprintChange: (blueprint: FactoryBlueprint) => void
  onNotice: (message: string) => void
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    FACTORY_REPAIR_HUMAN_APPROVAL_REQUIRED: 'يلزم Human Approval (موافقة بشرية) مستقلة قبل تطبيق Repair (الإصلاح).',
    FACTORY_REPAIR_INSTALLED_BLUEPRINT_FORBIDDEN: 'لا نعدّل Blueprint مثبتًا. أنشئ Blueprint جديدًا للمراجعة.',
    FACTORY_REPAIR_PREVIEW_TAMPERED_OR_STALE: 'Repair Preview تغيرت أو أصبحت قديمة؛ أعد بناء المعاينة أولاً.',
    FACTORY_REPAIR_MANUAL_REVIEW_REQUIRED: 'بعض المشاكل تحتاج مراجعة بشرية ولا يمكن إصلاحها تلقائيًا بأمان.',
  }
  return labels[message] ?? `Factory Intelligence (ذكاء المصنع): ${message}`
}

export default function FactoryIntelligenceCenter({ blueprint, onBlueprintChange, onNotice }: Props) {
  const [toolPlan, setToolPlan] = useState<FactoryToolPlan | null>(null)
  const [testPlan, setTestPlan] = useState<FactoryTestPlan | null>(null)
  const [repairPreview, setRepairPreview] = useState<FactoryRepairPreview | null>(null)
  const [repairApproved, setRepairApproved] = useState(false)

  const adapterRequired = useMemo(
    () => toolPlan?.requirements.filter((item) => item.disposition === 'adapter_required').length ?? 0,
    [toolPlan],
  )

  function buildTools(): void {
    const plan = buildFactoryToolPlan(blueprint)
    setToolPlan(plan)
    onNotice(`Tool Builder بنى ${plan.requirements.length} Tool Requirements محليًا. ${plan.requirements.filter((item) => item.disposition === 'existing').length} موجودة، و${plan.requirements.filter((item) => item.disposition === 'adapter_required').length} تحتاج Adapter مفحوصًا. لا Tool فُعّلت.`)
  }

  function buildTests(): void {
    const plan = buildFactoryTestPlan(blueprint)
    setTestPlan(plan)
    onNotice(`Test Builder بنى ${plan.cases.length} Test Cases محلية. لم يُشغّل أي Agent أو Tool أو MCP.`)
  }

  function previewRepair(): void {
    try {
      const preview = buildFactoryRepairPreview(blueprint)
      setRepairPreview(preview)
      setRepairApproved(false)
      onNotice(preview.changes.length
        ? `Auto-Repair جهز Preview فيها ${preview.changes.length} تغييرات. لم يُطبق شيء بعد.`
        : 'Auto-Repair فحص Blueprint ولم يجد إصلاحات لازمة. لا تغيير حدث.')
    } catch (error) {
      setRepairPreview(null)
      onNotice(friendlyError(error))
    }
  }

  function applyRepair(): void {
    if (!repairPreview) return
    try {
      const repaired = applyFactoryRepair(blueprint, repairPreview, repairApproved)
      onBlueprintChange(repaired)
      setRepairPreview(null)
      setRepairApproved(false)
      setToolPlan(null)
      setTestPlan(null)
      onNotice('تم تطبيق Repair الحتمي بعد موافقتك. لم يحدث Install أو Run أو Tool activation.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  return (
    <section className="factory-intelligence" aria-label="Factory Intelligence">
      <div className="factory-intelligence-head">
        <div>
          <span className="phase-pill">Phase 5B</span>
          <h4>Factory Intelligence (ذكاء المصنع)</h4>
        </div>
        <span className="safe-pill">Deterministic · Local · 0$</span>
      </div>

      <p className="disclaimer">
        Tool Builder يبني Requirements/Adapter Proposals فقط، وTest Builder يبني Test Plan فقط، وAuto-Repair يصلح Blueprint فقط بعد Preview + موافقة بشرية. لا كود خارجي، لا Tool Activation، لا Install، ولا Run تلقائي.
      </p>

      <div className="factory-intelligence-actions">
        <button type="button" onClick={buildTools}>Build Tool Plan (خطة الأدوات)</button>
        <button type="button" onClick={buildTests}>Build Test Plan (خطة الاختبارات)</button>
        <button type="button" onClick={previewRepair} disabled={blueprint.status === 'installed'}>Preview Auto-Repair (معاينة الإصلاح)</button>
      </div>

      {toolPlan && (
        <div className="factory-intelligence-panel">
          <strong>Tool Builder Plan</strong>
          <small>{toolPlan.requirements.length} requirements · adapter required: {adapterRequired} · cost ${toolPlan.monetaryCostUsd}</small>
          <div className="factory-tool-requirements">
            {toolPlan.requirements.map((item) => (
              <article key={item.id}>
                <strong>{item.roleName}</strong>
                <small>{item.requestedToolId ?? 'No tool required'} · {item.disposition}</small>
                <small>Risk ceiling: {item.riskCeiling} · Scopes: {item.scopes.join(', ') || 'none'}</small>
                {item.candidateAdapterIds.length > 0 && <small>Candidate Adapter: {item.candidateAdapterIds.join(', ')}</small>}
                <small>Auto activation: disabled · Human approval: required</small>
              </article>
            ))}
          </div>
        </div>
      )}

      {testPlan && (
        <div className="factory-intelligence-panel">
          <strong>Test Builder Plan</strong>
          <small>{testPlan.cases.length} cases · no automatic execution · cost ${testPlan.monetaryCostUsd}</small>
          <ul className="factory-tests">
            {testPlan.cases.map((test) => (
              <li key={test.id}>
                <strong>{test.dimension.toUpperCase()} · {test.title}</strong>
                <span>{test.assertion}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {repairPreview && (
        <div className="factory-intelligence-panel repair-preview">
          <strong>Auto-Repair Preview</strong>
          <small>Before valid: {String(repairPreview.before.valid)} · After valid: {String(repairPreview.after.valid)} · Safe to apply: {String(repairPreview.safeToApply)}</small>
          {repairPreview.changes.length === 0 ? <p>لا توجد تغييرات مقترحة.</p> : (
            <ul>{repairPreview.changes.map((change, index) => <li key={`${change.code}-${index}`}><strong>{change.code}</strong> — {change.description}</li>)}</ul>
          )}
          {repairPreview.manualBlockers.length > 0 && (
            <div className="approval-box"><strong>Manual Review Required</strong><ul>{repairPreview.manualBlockers.map((item) => <li key={item}>{item}</li>)}</ul></div>
          )}
          {repairPreview.safeToApply && repairPreview.changes.length > 0 && (
            <div className="factory-repair-approval">
              <label>
                <input type="checkbox" checked={repairApproved} onChange={(event) => setRepairApproved(event.target.checked)} />
                أوافق فقط على تطبيق تغييرات Blueprint المعروضة. لا Install ولا Run ولا Tool activation.
              </label>
              <button type="button" disabled={!repairApproved} onClick={applyRepair}>Apply Approved Repair (طبق الإصلاح)</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
