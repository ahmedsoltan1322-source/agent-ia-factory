import { useState } from 'react'
import { createBrowserUploadCapsule, type BrowserUploadCapsule } from '../core/browserUploadCapsule'

interface Props { onNotice: (message: string) => void }

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    BROWSER_UPLOAD_EXTENSION_FORBIDDEN: 'يسمح الآن فقط TXT/CSV/JSON غير التنفيذية.',
    BROWSER_UPLOAD_MEDIA_TYPE_FORBIDDEN: 'نوع MIME للملف غير مسموح.',
    BROWSER_UPLOAD_SIZE_FORBIDDEN: 'حجم الملف يجب أن يكون بين 1 byte و32KB.',
    BROWSER_UPLOAD_SECRET_LIKE_CONTENT_FORBIDDEN: 'الملف يبدو أنه يحتوي Secret/Token/Password؛ تم رفضه محليًا.',
    BROWSER_UPLOAD_PAYMENT_OR_IDENTITY_CONTENT_FORBIDDEN: 'الملف يبدو أنه يحتوي بيانات دفع أو هوية حساسة؛ تم رفضه.',
    BROWSER_UPLOAD_PERSONAL_CONTACT_CONTENT_FORBIDDEN: 'الملف يحتوي بريدًا أو رقم هاتف؛ 7C-A تقبل محتوى عامًا غير حساس فقط.',
    BROWSER_UPLOAD_UTF8_REQUIRED: 'الملف يجب أن يكون نص UTF‑8 صالحًا.',
    BROWSER_UPLOAD_JSON_INVALID: 'ملف JSON غير صالح.',
  }
  return labels[message] ?? `Safe Upload (الرفع الآمن): ${message}`
}

export default function BrowserUploadCenter({ onNotice }: Props) {
  const [capsule, setCapsule] = useState<BrowserUploadCapsule | null>(null)

  async function inspect(file: File | undefined) {
    if (!file) return
    try {
      const next = await createBrowserUploadCapsule(file)
      setCapsule(next)
      onNotice('تم فحص الملف محليًا وإنشاء Upload Capsule مؤقتة. لم يُرسل الملف لأي خادم أو GitHub.')
    } catch (error) {
      setCapsule(null)
      onNotice(friendly(error))
    }
  }

  return (
    <section className="card browser-upload-card" dir="rtl">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 7C-A — Safe File Staging (تجهيز الملف الآمن)</p>
          <h2>افحص الملف على الهاتف قبل أي Upload</h2>
        </div>
        <span className="safe-pill">Local scan · no network</span>
      </div>
      <p className="disclaimer">
        هذه ليست عملية Upload بعد. 7C-A تنشئ Capsule (كبسولة) مؤقتة فقط بعد فحص الملف محليًا. TXT/CSV/JSON فقط، ≤32KB، ومحتوى عام غير حساس.
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
          <small>Secrets/PII/payment data: blocked · executable content: blocked · cost: $0</small>
        </div>
      )}
    </section>
  )
}
