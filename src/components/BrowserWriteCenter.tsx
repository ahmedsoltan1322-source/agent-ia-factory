import { useMemo, useState } from 'react'
import {
  addBrowserWriteAction,
  approveBrowserWriteJob,
  createBrowserWriteJob,
  exportBrowserWriteJob,
  removeBrowserWriteAction,
  saveBrowserWritePlan,
  type BrowserWriteAction,
  type BrowserWriteJobPlan,
} from '../core/browserWriteJob'

interface Props { onNotice: (message: string) => void }

type ActionKind = BrowserWriteAction['kind']

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    BROWSER_WRITE_HIGH_RISK_TARGET_FORBIDDEN: 'هذا المسار يبدو ماليًا أو حساسًا للحساب، لذلك 7B ترفضه.',
    BROWSER_WRITE_SENSITIVE_SELECTOR_FORBIDDEN: 'الحقل يبدو Password/Token/Card/OTP أو حساسًا.',
    BROWSER_WRITE_SECRET_VALUE_FORBIDDEN: 'القيمة تبدو Secret أو رقم بطاقة، ولن تُحفظ في الخطة.',
    BROWSER_WRITE_HUMAN_APPROVAL_REQUIRED: 'يلزم Human Approval (موافقة بشرية) قبل التصدير.',
    BROWSER_WRITE_DOWNLOAD_EXTENSION_FORBIDDEN: 'نوع الملف غير مسموح في التنزيل الآمن الحالي.',
  }
  return labels[message] ?? `Safe Browser Write: ${message}`
}

export default function BrowserWriteCenter({ onNotice }: Props) {
  const [name, setName] = useState('Safe form task')
  const [url, setUrl] = useState('https://httpbin.org/forms/post')
  const [plan, setPlan] = useState<BrowserWriteJobPlan | null>(null)
  const [kind, setKind] = useState<ActionKind>('fill_field')
  const [selector, setSelector] = useState('input[name="custname"]')
  const [value, setValue] = useState('Agent IA Factory test')
  const [pathPrefix, setPathPrefix] = useState('/post')
  const [extensions, setExtensions] = useState('.pdf,.txt,.csv,.json,.png,.jpg,.jpeg,.webp')

  const submitCount = useMemo(() => plan?.actions.filter((action) => action.kind === 'submit_form').length ?? 0, [plan])

  function createPlan() {
    try {
      const next = createBrowserWriteJob(name, url)
      setPlan(next); saveBrowserWritePlan(next)
      onNotice('تم إنشاء Write-Safe Plan محليًا. لا Browser execution حدث، والموافقة ما زالت false.')
    } catch (error) { onNotice(friendly(error)) }
  }

  function addAction() {
    if (!plan) return
    try {
      let action: BrowserWriteAction
      const id = `write-${Date.now()}`
      if (kind === 'fill_field') action = { id, kind, selector, value }
      else if (kind === 'submit_form') action = { id, kind, formSelector: selector || 'form', expectedPathPrefix: pathPrefix }
      else if (kind === 'download_file') action = { id, kind, selector, maxBytes: 5_000_000, allowedExtensions: extensions.split(',').map((item) => item.trim()).filter(Boolean) }
      else action = { id, kind, label: 'write-evidence' }
      const next = addBrowserWriteAction(plan, action)
      setPlan(next); saveBrowserWritePlan(next)
      onNotice('أُضيف Action وأُلغيت أي موافقة سابقة تلقائيًا.')
    } catch (error) { onNotice(friendly(error)) }
  }

  function removeAction(actionId: string) {
    if (!plan) return
    try { const next = removeBrowserWriteAction(plan, actionId); setPlan(next); saveBrowserWritePlan(next) } catch (error) { onNotice(friendly(error)) }
  }

  function toggleApproval(approved: boolean) {
    if (!plan) return
    try { const next = approveBrowserWriteJob(plan, approved); setPlan(next); saveBrowserWritePlan(next) } catch (error) { onNotice(friendly(error)) }
  }

  async function exportPlan() {
    if (!plan) return
    try {
      const json = exportBrowserWriteJob(plan)
      await navigator.clipboard.writeText(json)
      onNotice('تم نسخ Approved Write Plan. شغّل GitHub workflow يدويًا مع الموافقة الثانية؛ لا إرسال تلقائي من الهاتف.')
    } catch (error) { onNotice(friendly(error)) }
  }

  return (
    <section className="card browser-write-card" dir="rtl">
      <div className="card-heading">
        <div><p className="section-kicker">Phase 7B — Safe Browser Actions (إجراءات المتصفح الآمنة)</p><h2>Form Submit محدود + Download مضبوط</h2></div>
        <span className="safe-pill">POST one-shot · 0$</span>
      </div>
      <p className="disclaimer">هذه طبقة مستقلة عن 7A. لا Payment، لا Password/Token/OTP، لا PUT/PATCH/DELETE، لا Upload في هذه الدفعة، ولا تشغيل تلقائي من PWA.</p>

      <div className="browser-write-grid">
        <label>Plan name<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
        <label>HTTPS target<input value={url} maxLength={2000} onChange={(e) => setUrl(e.target.value)} /></label>
        <button type="button" onClick={createPlan}>Create Write-Safe Plan</button>
      </div>

      {plan && <>
        <div className="browser-write-policy">
          <strong>Policy</strong>
          <span>GET/HEAD/OPTIONS + one-shot POST</span><span>POST actions: {submitCount}/3</span><span>Downloads ≤ 5 MB</span><span>Uploads: blocked</span><span>Money/auth changes: blocked</span>
        </div>
        <div className="browser-write-grid">
          <label>Action<select value={kind} onChange={(e) => setKind(e.target.value as ActionKind)}><option value="fill_field">Fill field</option><option value="submit_form">Submit form</option><option value="download_file">Download file</option><option value="screenshot">Screenshot</option></select></label>
          {kind !== 'screenshot' && <label>Selector<input value={selector} onChange={(e) => setSelector(e.target.value)} /></label>}
          {kind === 'fill_field' && <label>Value<textarea rows={2} value={value} onChange={(e) => setValue(e.target.value)} /></label>}
          {kind === 'submit_form' && <label>Expected POST path prefix<input value={pathPrefix} onChange={(e) => setPathPrefix(e.target.value)} /></label>}
          {kind === 'download_file' && <label>Allowed extensions<input value={extensions} onChange={(e) => setExtensions(e.target.value)} /></label>}
          <button type="button" onClick={addAction}>Add Action</button>
        </div>

        <div className="browser-write-actions">
          {plan.actions.map((action) => <article key={action.id}><strong>{action.kind}</strong><code>{action.id}</code><button type="button" onClick={() => removeAction(action.id)}>Remove</button></article>)}
        </div>

        <label className="browser-write-approval"><input type="checkbox" checked={plan.approvedByHuman} onChange={(e) => toggleApproval(e.target.checked)} /> أوافق على هذه الخطة المحددة فقط. أفهم أن GitHub Workflow ستطلب موافقة ثانية قبل أي POST.</label>
        <button type="button" disabled={!plan.approvedByHuman} onClick={() => void exportPlan()}>Copy Approved Plan JSON</button>
      </>}
    </section>
  )
}
