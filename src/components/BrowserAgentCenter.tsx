import { useMemo, useState } from 'react'
import {
  addBrowserAction,
  approveBrowserJob,
  createSafeBrowserJob,
  deleteBrowserPlan,
  exportBrowserJob,
  loadBrowserPlans,
  removeBrowserAction,
  saveBrowserPlan,
  type BrowserAction,
  type BrowserJobPlan,
} from '../core/browserJob'

interface Props {
  onNotice: (message: string) => void
}

type AddKind = 'follow_link' | 'fill_preview' | 'read_text' | 'extract_links' | 'screenshot'

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    BROWSER_URL_INVALID: 'رابط الموقع غير صالح.',
    BROWSER_HTTPS_REQUIRED: 'Browser Agent يقبل HTTPS فقط في هذه المرحلة.',
    BROWSER_URL_CREDENTIALS_FORBIDDEN: 'لا تضع username/password داخل الرابط.',
    BROWSER_PRIVATE_OR_IP_HOST_FORBIDDEN: 'localhost والشبكات الخاصة وعناوين IP المباشرة ممنوعة.',
    BROWSER_SENSITIVE_QUERY_FORBIDDEN: 'الرابط يحتوي Query (معامل رابط) يبدو سرياً مثل token/session/password.',
    BROWSER_SELECTOR_REQUIRED: 'اكتب Selector (محدد العنصر) أولاً.',
    BROWSER_SENSITIVE_FIELD_FORBIDDEN: 'الحقول الحساسة مثل password/token/card/OTP ممنوعة في Phase 7A.',
    BROWSER_SECRET_VALUE_FORBIDDEN: 'تم منع قيمة تبدو سراً أو رقم بطاقة/اعتماد.',
    BROWSER_FILL_VALUE_REQUIRED: 'اكتب قيمة Preview (المعاينة).',
    BROWSER_ACTION_LIMIT_REACHED: 'الحد 10 Actions (إجراءات) لكل خطة.',
    BROWSER_HUMAN_APPROVAL_REQUIRED: 'يلزم Human Approval (موافقة بشرية) قبل تصدير خطة التنفيذ.',
  }
  return labels[message] ?? `Browser Agent (وكيل المتصفح): ${message}`
}

function actionLabel(action: BrowserAction): string {
  if (action.kind === 'read_text') return `Read Text (قراءة): ${action.selector}`
  if (action.kind === 'extract_links') return `Extract Links (استخراج روابط): ${action.selector}`
  if (action.kind === 'follow_link') return `Follow Link (متابعة رابط): ${action.selector}`
  if (action.kind === 'fill_preview') return `Fill Preview (ملء معاينة): ${action.selector}`
  return `Screenshot (لقطة): ${action.label}`
}

function downloadPlan(plan: BrowserJobPlan): void {
  const text = exportBrowserJob(plan)
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `browser-job-${plan.id}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function BrowserAgentCenter({ onNotice }: Props) {
  const [plans, setPlans] = useState<BrowserJobPlan[]>(() => loadBrowserPlans())
  const [selectedId, setSelectedId] = useState(() => loadBrowserPlans()[0]?.id ?? '')
  const [name, setName] = useState('فحص صفحة ويب بأمان')
  const [targetUrl, setTargetUrl] = useState('https://example.com/')
  const [addKind, setAddKind] = useState<AddKind>('follow_link')
  const [selector, setSelector] = useState('a')
  const [value, setValue] = useState('نص معاينة غير حساس')

  const selected = useMemo(() => plans.find((plan) => plan.id === selectedId) ?? null, [plans, selectedId])

  function createPlan() {
    try {
      const plan = createSafeBrowserJob(name, targetUrl)
      setPlans(saveBrowserPlan(plan))
      setSelectedId(plan.id)
      onNotice('تم إنشاء Browser Plan (خطة المتصفح) محلياً. لا يوجد أي اتصال بالموقع ولم يبدأ أي Browser Run.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function updatePlan(plan: BrowserJobPlan, message: string) {
    try {
      setPlans(saveBrowserPlan(plan))
      setSelectedId(plan.id)
      onNotice(message)
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function addAction() {
    if (!selected) return
    try {
      const id = `action-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      let action: BrowserAction
      if (addKind === 'follow_link') action = { id, kind: 'follow_link', selector }
      else if (addKind === 'fill_preview') action = { id, kind: 'fill_preview', selector, value }
      else if (addKind === 'read_text') action = { id, kind: 'read_text', selector, maxChars: 8_000 }
      else if (addKind === 'extract_links') action = { id, kind: 'extract_links', selector, maxItems: 30 }
      else action = { id, kind: 'screenshot', label: value || 'screen' }
      updatePlan(addBrowserAction(selected, action), 'تمت إضافة Action (إجراء) إلى الخطة، وسُحبت الموافقة السابقة إن وجدت لأن الخطة تغيرت.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function approve(approved: boolean) {
    if (!selected) return
    try {
      updatePlan(
        approveBrowserJob(selected, approved),
        approved
          ? 'تمت الموافقة على هذه النسخة من الخطة فقط. التنفيذ ما زال لا يبدأ تلقائياً.'
          : 'تم سحب الموافقة من Browser Plan.',
      )
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function removeAction(actionId: string) {
    if (!selected) return
    try {
      updatePlan(removeBrowserAction(selected, actionId), 'تم حذف الإجراء وسحب الموافقة السابقة لأن الخطة تغيرت.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function removePlan(planId: string) {
    const next = deleteBrowserPlan(planId)
    setPlans(next)
    if (selectedId === planId) setSelectedId(next[0]?.id ?? '')
    onNotice('تم حذف Browser Plan من الهاتف.')
  }

  function exportPlan() {
    if (!selected) return
    try {
      downloadPlan(selected)
      onNotice('تم تصدير Browser Job JSON. لا يوجد تشغيل تلقائي؛ الملف مخصص لـGitHub Actions الآمنة في Phase 7A.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  return (
    <section className="card browser-agent-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 7A — Safe Browser Agent (وكيل المتصفح الآمن)</p>
          <h2>خطط للقراءة والمعاينة قبل التنفيذ</h2>
        </div>
        <span className="safe-pill">Read-Only Network</span>
      </div>

      <p className="disclaimer">
        Phase 7A تمنع Submit (الإرسال)، Download (التنزيل)، Upload (الرفع)، الأسرار، والعمليات الشبكية التي تكتب بيانات. المسموح في Executor هو GET/HEAD/OPTIONS فقط. Fill Preview يغيّر قيمة العنصر داخل الصفحة للمعاينة دون Input/Change Events ودون Submit.
      </p>

      <div className="browser-create-grid">
        <label>
          Plan Name (اسم الخطة)
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </label>
        <label>
          HTTPS Target (الموقع)
          <input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} maxLength={2000} inputMode="url" />
        </label>
        <button className="primary-button" type="button" onClick={createPlan}>+ Create Safe Plan (إنشاء خطة آمنة)</button>
      </div>

      {plans.length > 0 && (
        <div className="browser-plan-picker">
          <label>
            Saved Plans (الخطط المحفوظة)
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
          </label>
        </div>
      )}

      {selected && (
        <div className="browser-plan">
          <div className="browser-policy-grid">
            <div><span>Network</span><strong>GET / HEAD / OPTIONS</strong></div>
            <div><span>Submit</span><strong>Blocked</strong></div>
            <div><span>Downloads</span><strong>Blocked</strong></div>
            <div><span>Uploads</span><strong>Blocked</strong></div>
            <div><span>Secrets</span><strong>Blocked</strong></div>
            <div><span>Cost</span><strong>$0 mandatory</strong></div>
          </div>

          <div className="browser-target"><strong>{selected.name}</strong><small>{selected.targetUrl}</small></div>

          <div className="browser-actions-list">
            {selected.actions.map((action, index) => (
              <article key={action.id}>
                <div><span>{index + 1}</span><strong>{actionLabel(action)}</strong></div>
                <button className="danger-button" type="button" onClick={() => removeAction(action.id)}>حذف</button>
              </article>
            ))}
          </div>

          <div className="browser-add-action">
            <label>
              Action (الإجراء)
              <select value={addKind} onChange={(event) => setAddKind(event.target.value as AddKind)}>
                <option value="read_text">Read Text (قراءة نص)</option>
                <option value="extract_links">Extract Links (استخراج روابط)</option>
                <option value="follow_link">Follow Safe Link (متابعة رابط آمن)</option>
                <option value="fill_preview">Fill Preview (ملء للمعاينة فقط)</option>
                <option value="screenshot">Screenshot (لقطة شاشة)</option>
              </select>
            </label>
            {addKind !== 'screenshot' && (
              <label>
                CSS Selector (محدد العنصر)
                <input value={selector} onChange={(event) => setSelector(event.target.value)} maxLength={300} />
              </label>
            )}
            {(addKind === 'fill_preview' || addKind === 'screenshot') && (
              <label>
                {addKind === 'fill_preview' ? 'Preview Value (قيمة المعاينة)' : 'Screenshot Label (اسم اللقطة)'}
                <input value={value} onChange={(event) => setValue(event.target.value)} maxLength={500} />
              </label>
            )}
            <button className="text-button" type="button" onClick={addAction}>+ Add Action (إضافة)</button>
          </div>

          <label className="browser-approval">
            <input type="checkbox" checked={selected.approvedByHuman} onChange={(event) => approve(event.target.checked)} />
            <span>أوافق على هذه الخطة المحددة للتنفيذ اليدوي في GitHub Actions. لا تتضمن Submit/شراء/حذف/رفع/تنزيل/أسرار.</span>
          </label>

          <div className="browser-plan-buttons">
            <button className="primary-button" type="button" disabled={!selected.approvedByHuman} onClick={exportPlan}>Export Approved Job JSON (تصدير الخطة)</button>
            <button className="danger-button" type="button" onClick={() => removePlan(selected.id)}>حذف الخطة</button>
          </div>

          <div className="browser-run-note">
            <strong>Execution (التنفيذ)</strong>
            <p>لا يوجد GitHub Token داخل PWA ولا Auto-Dispatch. التنفيذ يتم عبر Workflow يدوي `Safe Browser Job` في GitHub Actions، ويطلب Approval إضافية عند التشغيل. هذه الطبقة المقصودة تمنع التطبيق من تشغيل متصفح سحابي في الخلفية من تلقاء نفسه.</p>
          </div>
        </div>
      )}
    </section>
  )
}
