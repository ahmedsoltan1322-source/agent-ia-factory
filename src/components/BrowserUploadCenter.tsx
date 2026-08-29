import { useState } from 'react'
import { createBrowserUploadCapsule, type BrowserUploadCapsule } from '../core/browserUploadCapsule'
import { deleteStagedBrowserUploadOverAuthenticatedHttps, stageBrowserUploadCapsuleOverAuthenticatedHttps } from '../core/browserUploadStageTransport'
import type { BrowserUploadStageReceipt } from '../core/browserUploadStageStore'

interface Props { onNotice: (message: string) => void }

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    BROWSER_UPLOAD_EXTENSION_FORBIDDEN: 'يسمح الآن فقط TXT/CSV/JSON غير التنفيذية.',
    BROWSER_UPLOAD_MEDIA_TYPE_FORBIDDEN: 'نوع MIME للملف غير مسموح.',
    BROWSER_UPLOAD_SIZE_FORBIDDEN: 'حجم الملف يجب أن يكون بين 1 byte و32KB.',
    BROWSER_UPLOAD_SECRET_LIKE_CONTENT_FORBIDDEN: 'الملف يبدو أنه يحتوي Secret/Token/Password؛ تم رفضه محليًا.',
    BROWSER_UPLOAD_PAYMENT_OR_IDENTITY_CONTENT_FORBIDDEN: 'الملف يبدو أنه يحتوي بيانات دفع أو هوية حساسة؛ تم رفضه.',
    BROWSER_UPLOAD_PERSONAL_CONTACT_CONTENT_FORBIDDEN: 'الملف يحتوي بريدًا أو رقم هاتف؛ baseline تقبل محتوى عامًا غير حساس فقط.',
    BROWSER_UPLOAD_UTF8_REQUIRED: 'الملف يجب أن يكون نص UTF‑8 صالحًا.',
    BROWSER_UPLOAD_JSON_INVALID: 'ملف JSON غير صالح.',
    WORKER_ENDPOINT_HTTPS_REQUIRED: 'Endpoint يجب أن يكون HTTPS.',
    WORKER_AUTH_SECRET_INVALID: 'Pairing Secret غير صالح؛ يلزم Secret عشوائي 32-byte Base64URL.',
    UPLOAD_TRANSPORT_UNCERTAIN_TIMEOUT: 'انتهت المهلة والنتيجة غير محسومة. لا إعادة تلقائية؛ يمكنك إعادة نفس Capsule يدويًا، والخادم سيعيد نفس stageId إذا كانت موجودة.',
    BROWSER_UPLOAD_EXPIRED: 'انتهت صلاحية Capsule؛ اختر الملف من جديد وأعد الفحص المحلي.',
  }
  return labels[message] ?? `Safe Upload (الرفع الآمن): ${message}`
}

export default function BrowserUploadCenter({ onNotice }: Props) {
  const [capsule, setCapsule] = useState<BrowserUploadCapsule | null>(null)
  const [endpoint, setEndpoint] = useState('')
  const [secret, setSecret] = useState('')
  const [approved, setApproved] = useState(false)
  const [stage, setStage] = useState<BrowserUploadStageReceipt | null>(null)
  const [deleteApproved, setDeleteApproved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function inspect(file: File | undefined) {
    if (!file) return
    try {
      const next = await createBrowserUploadCapsule(file)
      setCapsule(next)
      setStage(null)
      setApproved(false)
      onNotice('تم فحص الملف محليًا وإنشاء Upload Capsule مؤقتة. لم يُرسل الملف لأي خادم أو GitHub.')
    } catch (error) {
      setCapsule(null)
      setStage(null)
      onNotice(friendly(error))
    }
  }

  async function stageFile() {
    if (!capsule || !approved || busy) return
    setBusy(true)
    try {
      const receipt = await stageBrowserUploadCapsuleOverAuthenticatedHttps(endpoint, secret, capsule)
      setStage(receipt)
      setApproved(false)
      onNotice('تم نقل Capsule عبر HTTPS/HMAC وتخزينها مؤقتًا على Self-Host Worker. لم تبدأ Browser Upload بعد.')
    } catch (error) {
      onNotice(friendly(error))
    } finally { setBusy(false) }
  }

  async function removeStage() {
    if (!stage || !deleteApproved || busy) return
    setBusy(true)
    try {
      await deleteStagedBrowserUploadOverAuthenticatedHttps(endpoint, secret, stage.stageId)
      setStage(null)
      setDeleteApproved(false)
      onNotice('تم حذف الملف المؤقت من Self-Host Worker عبر طلب موثّق.')
    } catch (error) {
      onNotice(friendly(error))
    } finally { setBusy(false) }
  }

  return (
    <section className="card browser-upload-card" dir="rtl">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 7C-B — Authenticated Upload Staging (تجهيز الرفع الموثّق)</p>
          <h2>افحص محليًا ثم انقل الملف مؤقتًا للعامل الذاتي</h2>
        </div>
        <span className="safe-pill">HTTPS + HMAC · ephemeral · 0$</span>
      </div>
      <p className="disclaimer">
        7C-B تنقل الملف بعد الفحص إلى Self-Host Worker فقط. لا Browser <code>setInputFiles</code> ولا إرسال للموقع الهدف في هذه المرحلة. Pairing Secret يبقى في ذاكرة الواجهة فقط ولا يُحفظ.
      </p>
      <label className="file-button">
        Choose public non-sensitive text file
        <input type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json" onChange={(event) => void inspect(event.target.files?.[0])} />
      </label>
      {capsule && (
        <div className="browser-upload-preview">
          <strong>{capsule.fileName}</strong>
          <span>{capsule.mediaType} · {capsule.sizeBytes} bytes</span>
          <code>SHA-256: {capsule.sha256}</code>
          <span>Expires: {new Date(capsule.expiresAt).toLocaleString('ar')}</span>
          <small>Secrets/contact/payment data: blocked · executable content: blocked · cost: $0</small>
        </div>
      )}

      {capsule && !stage && (
        <div className="browser-upload-stage-form">
          <label>Self-Host Worker HTTPS Endpoint<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://worker.example.com" autoCapitalize="none" autoCorrect="off" /></label>
          <label>Pairing Secret (memory only)<input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" /></label>
          <label className="browser-upload-approval"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> أوافق صراحة على نقل هذه Capsule المحددة إلى العامل الذاتي فقط. لا أوافق على Browser Upload للموقع بعد.</label>
          <button type="button" disabled={!approved || !endpoint.trim() || !secret.trim() || busy} onClick={() => void stageFile()}>{busy ? 'جارٍ النقل…' : 'Stage on Self-Host Worker (تجهيز مؤقت)'}</button>
        </div>
      )}

      {stage && (
        <div className="browser-upload-stage-receipt">
          <strong>Staged safely (مخزن مؤقتًا)</strong>
          <code>{stage.stageId}</code>
          <span>{stage.fileName} · {stage.sizeBytes} bytes</span>
          <span>Expires: {new Date(stage.expiresAt).toLocaleString('ar')}</span>
          <small>Browser upload: not executed · monetary cost: $0</small>
          <label className="browser-upload-approval"><input type="checkbox" checked={deleteApproved} onChange={(event) => setDeleteApproved(event.target.checked)} /> أوافق على حذف النسخة المؤقتة من العامل.</label>
          <button type="button" disabled={!deleteApproved || busy} onClick={() => void removeStage()}>Delete staged file (حذف الملف المؤقت)</button>
        </div>
      )}
    </section>
  )
}
