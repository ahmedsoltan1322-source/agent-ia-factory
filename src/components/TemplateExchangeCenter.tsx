import { useMemo, useRef, useState } from 'react'
import {
  installFactoryBlueprint,
  loadFactoryBlueprints,
  saveFactoryBlueprint,
  type FactoryBlueprint,
} from '../core/factoryPlanner'
import {
  MAX_AGENT_TEMPLATE_JSON_CHARS,
  createAgentTemplatePackage,
  exportAgentTemplatePackage,
  importAgentTemplatePackage,
  templatePackageToBlueprint,
  type AgentTemplatePackage,
} from '../core/ecosystemTemplate'
import type { AgentSpec } from '../core/types'

interface Props {
  onAgentChange: (agent: AgentSpec) => void
  onAgentsChange: (agents: AgentSpec[]) => void
  onNotice: (message: string) => void
}

function downloadJson(name: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function defaultTemplateId(blueprint: FactoryBlueprint | undefined): string {
  const domain = blueprint?.domain ?? 'general'
  return `template-${domain}-${Date.now()}`
}

export default function TemplateExchangeCenter({ onAgentChange, onAgentsChange, onNotice }: Props) {
  const [blueprints, setBlueprints] = useState<FactoryBlueprint[]>(() => loadFactoryBlueprints())
  const [selectedBlueprintId, setSelectedBlueprintId] = useState(() => blueprints[0]?.id ?? '')
  const [templateId, setTemplateId] = useState(() => defaultTemplateId(blueprints[0]))
  const [templateName, setTemplateName] = useState(() => blueprints[0]?.teamName ?? 'قالب فريق وكلاء')
  const [templateDescription, setTemplateDescription] = useState('')
  const [importedPackage, setImportedPackage] = useState<AgentTemplatePackage | null>(null)
  const [importedBlueprint, setImportedBlueprint] = useState<FactoryBlueprint | null>(null)
  const [installApproved, setInstallApproved] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const selectedBlueprint = useMemo(
    () => blueprints.find((blueprint) => blueprint.id === selectedBlueprintId),
    [blueprints, selectedBlueprintId],
  )

  function handleBlueprintChange(id: string): void {
    setSelectedBlueprintId(id)
    const blueprint = blueprints.find((item) => item.id === id)
    if (blueprint) {
      setTemplateId(defaultTemplateId(blueprint))
      setTemplateName(blueprint.teamName)
    }
  }

  async function handleExport(): Promise<void> {
    if (!selectedBlueprint) {
      onNotice('لا يوجد Factory Blueprint (مخطط مصنع) صالح للتصدير بعد.')
      return
    }
    setBusy(true)
    try {
      const pkg = await createAgentTemplatePackage(selectedBlueprint, {
        templateId,
        version: '1.0.0',
        name: templateName,
        description: templateDescription,
      })
      const raw = exportAgentTemplatePackage(pkg)
      if (raw.length > MAX_AGENT_TEMPLATE_JSON_CHARS) throw new Error('TEMPLATE_PACKAGE_SIZE_LIMIT')
      downloadJson(`${pkg.template.templateId}.agent-template.json`, raw)
      onNotice('تم Export (تصدير) القالب مع SHA-256 Integrity (بصمة سلامة). الملف لا يحتوي أسرارًا ولا يشغّل شيئًا عند فتحه.')
    } catch (error) {
      onNotice(`تعذر Export (التصدير): ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleImportFile(file: File | undefined): Promise<void> {
    if (!file) return
    setBusy(true)
    setInstallApproved(false)
    setImportedPackage(null)
    setImportedBlueprint(null)
    try {
      if (file.size > MAX_AGENT_TEMPLATE_JSON_CHARS) throw new Error('TEMPLATE_IMPORT_FILE_TOO_LARGE')
      const raw = await file.text()
      const pkg = await importAgentTemplatePackage(raw)
      const blueprint = templatePackageToBlueprint(pkg)
      setImportedPackage(pkg)
      setImportedBlueprint(blueprint)
      onNotice('Import Preview (معاينة الاستيراد) نجحت وSHA-256 مطابق. لم يتم حفظ أو تثبيت أو تشغيل أي Agent بعد.')
    } catch (error) {
      onNotice(`تم رفض Import (الاستيراد): ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  function handleSaveBlueprint(): void {
    if (!importedBlueprint || !importedPackage) return
    try {
      const next = saveFactoryBlueprint(importedBlueprint)
      setBlueprints(next)
      setSelectedBlueprintId(importedBlueprint.id)
      onNotice('تم حفظ القالب كمخطط محلي Verified (متحقق) فقط. لم يتم إنشاء Agents أو تشغيل Workflow.')
    } catch (error) {
      onNotice(`تعذر حفظ القالب: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function handleInstall(): void {
    if (!importedBlueprint || !installApproved) {
      onNotice('يلزم Human Approval (موافقة بشرية) صريحة قبل تثبيت القالب.')
      return
    }
    try {
      const result = installFactoryBlueprint(importedBlueprint, true)
      setBlueprints(loadFactoryBlueprints())
      onAgentsChange(result.allAgents)
      if (result.agents[0]) onAgentChange(result.agents[0])
      setInstallApproved(false)
      onNotice(`تم تثبيت ${result.agents.length} Agent (وكيل) وWorkflow واحد. Tools بقيت Denied by Default ولا يوجد Auto-Run.`)
    } catch (error) {
      onNotice(`تعذر تثبيت القالب: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <section className="card template-exchange-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 10A — Ecosystem (النظام البيئي)</p>
          <h2>Agent Templates + Safe Import/Export</h2>
        </div>
        <span className="safe-pill">SHA-256 · 0$</span>
      </div>

      <p className="template-disclosure">
        Template Package (حزمة القالب) هي وصف قابل للمشاركة فقط. Import لا يثبت ولا يشغّل شيئًا تلقائيًا، ولا يفعل Tool/MCP. أي تغيير في محتوى الحزمة بعد التصدير يكسر Integrity (السلامة) ويُرفض.
      </p>

      <div className="template-grid">
        <div className="template-panel">
          <h3>Export Template (تصدير قالب)</h3>
          {blueprints.length === 0 ? (
            <p className="empty-state">أنشئ Factory Blueprint من Agent Factory أولًا.</p>
          ) : (
            <>
              <label>
                Blueprint (المخطط)
                <select value={selectedBlueprintId} onChange={(event) => handleBlueprintChange(event.target.value)}>
                  {blueprints.map((blueprint) => <option key={blueprint.id} value={blueprint.id}>{blueprint.teamName}</option>)}
                </select>
              </label>
              <label>
                Template ID (معرّف القالب)
                <input value={templateId} maxLength={120} onChange={(event) => setTemplateId(event.target.value)} />
              </label>
              <label>
                Name (الاسم)
                <input value={templateName} maxLength={120} onChange={(event) => setTemplateName(event.target.value)} />
              </label>
              <label>
                Description (الوصف)
                <textarea value={templateDescription} rows={3} maxLength={1500} onChange={(event) => setTemplateDescription(event.target.value)} />
              </label>
              <button className="primary-button" type="button" disabled={busy} onClick={() => void handleExport()}>
                Export Verified JSON (تصدير JSON متحقق)
              </button>
            </>
          )}
        </div>

        <div className="template-panel">
          <h3>Import Preview (معاينة الاستيراد)</h3>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={(event) => void handleImportFile(event.target.files?.[0])}
          />
          <small>الحد الأقصى {Math.floor(MAX_AGENT_TEMPLATE_JSON_CHARS / 1000)} KB. لا Network Fetch (جلب شبكي) في Phase 10A.</small>

          {importedPackage && importedBlueprint && (
            <div className="template-preview">
              <div className="template-facts">
                <div><span>Integrity</span><strong>SHA-256 ✓</strong></div>
                <div><span>Template</span><strong>{importedPackage.template.name}</strong></div>
                <div><span>Version</span><strong>{importedPackage.template.version}</strong></div>
                <div><span>Runtime</span><strong>{importedPackage.template.runtimeAdapter}</strong></div>
                <div><span>Agents</span><strong>{importedPackage.template.roles.length}</strong></div>
                <div><span>Mandatory Spend</span><strong>$0</strong></div>
              </div>

              <details>
                <summary>Roles (الأدوار) وSuggested Tools (الأدوات المقترحة)</summary>
                <ul>
                  {importedPackage.template.roles.map((role) => (
                    <li key={role.id}>
                      <strong>{role.name}</strong> — {role.purpose}
                      <br />
                      <small>Suggested only: {role.suggestedToolIds.length ? role.suggestedToolIds.join(', ') : 'none'}</small>
                    </li>
                  ))}
                </ul>
              </details>

              <button className="secondary-button" type="button" onClick={handleSaveBlueprint}>
                Save Verified Blueprint Only (حفظ المخطط فقط)
              </button>

              <label className="template-approval">
                <input type="checkbox" checked={installApproved} onChange={(event) => setInstallApproved(event.target.checked)} />
                أوافق صراحة على إنشاء Agents وWorkflow من هذا القالب. أفهم أن Tools تبقى معطلة وأن Workflow لن يعمل تلقائيًا.
              </label>
              <button className="primary-button" type="button" disabled={!installApproved} onClick={handleInstall}>
                Human-Approved Install (تثبيت بموافقة بشرية)
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}