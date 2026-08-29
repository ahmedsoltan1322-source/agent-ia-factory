import { useMemo, useState } from 'react'
import {
  addBrowserFileTransferOperation,
  approveBrowserFileTransferPlan,
  createBrowserFileTransferPlan,
  deleteBrowserFileTransferPlan,
  exportBrowserFileTransferPlan,
  loadBrowserFileTransferPlans,
  removeBrowserFileTransferOperation,
  saveBrowserFileTransferPlan,
  type BrowserFileTransferOperation,
  type BrowserFileTransferPlan,
} from '../core/browserFileTransfer'

interface Props { onNotice: (message: string) => void }
type AddKind = 'download_capture' | 'upload_preview'

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    BROWSER_TRANSFER_HUMAN_APPROVAL_REQUIRED: 'يلزم Human Approval (موافقة بشرية) قبل تصدير خطة النقل.',
    BROWSER_TRANSFER_CROSS_SITE_FORBIDDEN: 'Download URL يجب أن تبقى داخل نفس Host Family (عائلة المضيف).',
    BROWSER_TRANSFER_FILENAME_INVALID: 'اسم Upload Preview يجب أن يكون آمناً وينتهي بـ.txt.',
    BROWSER_TRANSFER_UPLOAD_PREVIEW_SIZE_INVALID: 'Upload Preview يجب أن تكون نصاً غير فارغ وحجمها ≤16KB.',
    BROWSER_TRANSFER_SECRET_VALUE_FORBIDDEN: 'المحتوى يبدو Secret/credential؛ Phase 7B تمنعه.',
    BROWSER_TRANSFER_PUBLIC_PREVIEW_VALUE_FORBIDDEN: 'Upload Preview تمنع URL/email/phone في هذه المرحلة.',
    BROWSER_TRANSFER_SENSITIVE_FIELD_FORBIDDEN: 'File selector يبدو حساساً وممنوعاً.',
    BROWSER_TRANSFER_OPERATION_LIMIT_REACHED: 'الحد 4 File Transfer Operations لكل خطة.',
  }
  return labels[message] ?? `File Transfer Boundary (حد نقل الملفات): ${message}`
}

function downloadPlan(plan: BrowserFileTransferPlan): void {
  const blob = new Blob([exportBrowserFileTransferPlan(plan)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `browser-file-transfer-${plan.id}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function operationLabel(operation: BrowserFileTransferOperation): string {
  if (operation.kind === 'download_capture') return `Download Capture · ≤${Math.round(operation.maxBytes / 1000)}KB · ${operation.url}`
  return `Upload Preview · ${operation.filename} · ${new TextEncoder().encode(operation.content).length} bytes · no external upload`
}

export default function BrowserFileTransferCenter({ onNotice }: Props) {
  const [plans, setPlans] = useState<BrowserFileTransferPlan[]>(() => loadBrowserFileTransferPlans())
  const [selectedId, setSelectedId] = useState(() => loadBrowserFileTransferPlans()[0]?.id ?? '')
  const [name, setName] = useState('نقل ملف عام ضمن حدود آمنة')
  const [targetUrl, setTargetUrl] = useState('https://example.com/')
  const [addKind, setAddKind] = useState<AddKind>('download_capture')
  const [downloadUrl, setDownloadUrl] = useState('https://example.com/')
  const [maxBytes, setMaxBytes] = useState(1_000_000)
  const [selector, setSelector] = useState('input[type="file"]')
  const [filename, setFilename] = useState('preview.txt')
  const [content, setContent] = useState('Public preview text only')

  const selected = useMemo(() => plans.find((plan) => plan.id === selectedId) ?? null, [plans, selectedId])

  function createPlan(): void {
    try {
      const plan = createBrowserFileTransferPlan(name, targetUrl)
      setPlans(saveBrowserFileTransferPlan(plan))
      setSelectedId(plan.id)
      setDownloadUrl(plan.targetUrl)
      onNotice('تم إنشاء File Transfer Plan محلياً. لا Download/Upload حدث، والموافقة غير مفعلة.')
    } catch (error) { onNotice(friendlyError(error)) }
  }

  function update(plan: BrowserFileTransferPlan, message: string): void {
    try {
      setPlans(saveBrowserFileTransferPlan(plan))
      setSelectedId(plan.id)
      onNotice(message)
    } catch (error) { onNotice(friendlyError(error)) }
  }

  function addOperation(): void {
    if (!selected) return
    const id = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    try {
      const operation: BrowserFileTransferOperation = addKind === 'download_capture'
        ? { id, kind: 'download_capture', url: downloadUrl, maxBytes }
        : { id, kind: 'upload_preview', selector, filename, mimeType: 'text/plain', content }
      update(addBrowserFileTransferOperation(selected, operation), 'تمت إضافة File Operation وسُحبت الموافقة السابقة لأن الخطة تغيرت.')
    } catch (error) { onNotice(friendlyError(error)) }
  }

  function removeOperation(operationId: string): void {
    if (!selected) return
    try { update(removeBrowserFileTransferOperation(selected, operationId), 'تم حذف File Operation وسحب الموافقة السابقة.') } catch (error) { onNotice(friendlyError(error)) }
  }

  function approve(approved: boolean): void {
    if (!selected) return
    try {
      update(approveBrowserFileTransferPlan(selected, approved), approved
        ? 'تمت الموافقة على هذه النسخة فقط. ما زال يلزم Approval ثانية داخل GitHub Actions.'
        : 'تم سحب الموافقة من File Transfer Plan.')
    } catch (error) { onNotice(friendlyError(error)) }
  }

  function exportPlan(): void {
    if (!selected) return
    try {
      downloadPlan(selected)
      onNotice('تم تصدير Approved File Transfer JSON. التنفيذ يدوي فقط عبر Safe Browser File Transfer workflow.')
    } catch (error) { onNotice(friendlyError(error)) }
  }

  function removePlan(planId: string): void {
    const next = deleteBrowserFileTransferPlan(planId)
    setPlans(next)
    if (selectedId === planId) setSelectedId(next[0]?.id ?? '')
    onNotice('تم حذف File Transfer Plan من الهاتف.')
  }

  return (
    <section className="card browser-transfer-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 7B — Safe File Transfer Boundary (حد نقل الملفات)</p>
          <h2>تنزيل محدود + Upload Preview بلا رفع خارجي</h2>
        </div>
        <span className="safe-pill">Same Host · Bounded · No Submit</span>
      </div>

      <p className="disclaimer">
        Phase 7A لم تتغير وتبقى Read-Only. هذا مسار مستقل: Download Capture حقيقية عبر HTTPS GET فقط، بينما Upload Preview تربط ملف text/plain صغيراً بحقل file داخل Chrome مع JavaScript معطّل، لكن لا POST ولا Submit ولا External Upload.
      </p>

      <div className="browser-create-grid">
        <label>Plan Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
        <label>Target HTTPS Host<input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} maxLength={2000} inputMode="url" /></label>
        <button className="primary-button" type="button" onClick={createPlan}>+ Create File Transfer Plan</button>
      </div>

      {plans.length > 0 && <label>Saved Transfer Plans<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>}

      {selected && (
        <div className="browser-transfer-plan">
          <div className="browser-policy-grid">
            <div><span>Network</span><strong>GET / HEAD / OPTIONS</strong></div>
            <div><span>Download</span><strong>≤5MB · MIME/Magic gated</strong></div>
            <div><span>External Upload</span><strong>Blocked</strong></div>
            <div><span>Upload Preview</span><strong>text/plain ≤16KB</strong></div>
            <div><span>Cookies/Auth/Redirects</span><strong>Blocked</strong></div>
            <div><span>Cost</span><strong>$0 mandatory</strong></div>
          </div>

          <div className="browser-actions-list">
            {selected.operations.map((operation, index) => (
              <article key={operation.id}>
                <div><span>{index + 1}</span><strong>{operationLabel(operation)}</strong></div>
                <button className="danger-button" type="button" onClick={() => removeOperation(operation.id)}>حذف</button>
              </article>
            ))}
          </div>

          <div className="browser-transfer-add">
            <label>Operation<select value={addKind} onChange={(event) => setAddKind(event.target.value as AddKind)}><option value="download_capture">Download Capture</option><option value="upload_preview">Upload Preview — no external upload</option></select></label>
            {addKind === 'download_capture' ? (
              <>
                <label>Same-host HTTPS Download URL<input value={downloadUrl} onChange={(event) => setDownloadUrl(event.target.value)} inputMode="url" maxLength={2000} /></label>
                <label>Max Bytes (1KB–5MB)<input type="number" min={1024} max={5_000_000} step={1024} value={maxBytes} onChange={(event) => setMaxBytes(Number(event.target.value))} /></label>
              </>
            ) : (
              <>
                <label>File Input Selector<input value={selector} onChange={(event) => setSelector(event.target.value)} maxLength={300} /></label>
                <label>Safe .txt Filename<input value={filename} onChange={(event) => setFilename(event.target.value)} maxLength={84} /></label>
                <label>Public Preview Text<textarea rows={4} value={content} onChange={(event) => setContent(event.target.value)} maxLength={16_384} /></label>
              </>
            )}
            <button className="text-button" type="button" onClick={addOperation}>+ Add File Operation</button>
          </div>

          <label className="browser-approval">
            <input type="checkbox" checked={selected.approvedByHuman} onChange={(event) => approve(event.target.checked)} />
            <span>أوافق على هذه File Transfer Plan فقط. Download مقيدة، وUpload هي Preview داخل DOM بلا External Upload أو Submit. أي تعديل يسحب الموافقة.</span>
          </label>

          <div className="browser-plan-buttons">
            <button className="primary-button" type="button" disabled={!selected.approvedByHuman} onClick={exportPlan}>Export Approved Transfer JSON</button>
            <button className="danger-button" type="button" onClick={() => removePlan(selected.id)}>حذف الخطة</button>
          </div>

          <div className="browser-run-note"><strong>Manual Execution Only</strong><p>شغّل Workflow `Safe Browser File Transfer` يدوياً والصق JSON، ثم فعّل approved=true كموافقة ثانية. Download artifacts تحتفظ بها Actions ليوم واحد، وUpload Preview content لا تُطبع في Report.</p></div>
        </div>
      )}
    </section>
  )
}
