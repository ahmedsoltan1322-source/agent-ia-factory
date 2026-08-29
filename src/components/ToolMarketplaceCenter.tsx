import { useMemo, useState } from 'react'
import {
  importSignedToolPackage,
  loadRegisteredMarketplaceTools,
  previewMarketplaceTool,
  registerMarketplaceToolDisabled,
  removeMarketplaceTool,
  type MarketplaceToolPreview,
  type VerifiedToolPackage,
} from '../core/toolMarketplace'
import {
  getVerifiedPublisherIdentityTrustStatus,
  pinVerifiedPublisherIdentityTrust,
  type PublisherTrustStatus,
  type VerifiedPublisherIdentity,
} from '../core/publisherTrust'

interface Props {
  onNotice: (message: string) => void
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const labels: Record<string, string> = {
    TOOL_JSON_INVALID: 'ملف Tool Package ليس JSON صالحًا.',
    TOOL_IMPORT_SIZE_LIMIT: 'ملف الأداة تجاوز حد الحجم الآمن.',
    TOOL_SIGNATURE_INVALID: 'توقيع Tool Package غير صالح أو تم تعديل الملف بعد التوقيع.',
    TOOL_PUBLISHER_TRUST_REQUIRED: 'يجب توثيق بصمة الناشر أولاً قبل تسجيل الأداة.',
    TOOL_REGISTRATION_HUMAN_APPROVAL_REQUIRED: 'يلزم إقرار بشري صريح قبل تسجيل الأداة.',
    PUBLISHER_TRUST_HUMAN_APPROVAL_REQUIRED: 'يلزم إقرار صريح قبل توثيق بصمة الناشر.',
    PUBLISHER_KEY_CHANGE_REQUIRES_EXPLICIT_REPLACE: 'مفتاح الناشر تغيّر؛ يلزم إقرار مستقل لاستبدال المفتاح الموثوق.',
    TOOL_LICENSE_NOT_ALLOWED: 'ترخيص الأداة غير موجود في Baseline المحافظ للسوق.',
    TEMPLATE_SECRET_LIKE_CONTENT: 'تم رفض الحزمة لأن بياناتها تحتوي نمطًا يشبه Secret/Token.',
    TOOL_RISK_UNDERSTATED_FOR_SCOPE: 'Risk (درجة الخطر) أقل من الصلاحيات التي تطلبها الأداة.',
  }
  return labels[message] ?? `Tool Marketplace (سوق الأدوات): ${message}`
}

function identityFor(verified: VerifiedToolPackage): VerifiedPublisherIdentity {
  return {
    signatureVerified: true,
    publisher: {
      id: verified.package.publisher.id,
      displayName: verified.package.publisher.displayName,
      publicKey: verified.package.publisher.publicKey,
      keyFingerprint: verified.package.publisher.keyFingerprint,
    },
  }
}

function trustLabel(status: PublisherTrustStatus | null): string {
  if (status === 'trusted') return 'Trusted Publisher (ناشر موثوق)'
  if (status === 'key-changed') return 'Key Changed (المفتاح تغيّر)'
  return 'Untrusted Publisher (ناشر غير موثوق)'
}

export default function ToolMarketplaceCenter({ onNotice }: Props) {
  const [verified, setVerified] = useState<VerifiedToolPackage | null>(null)
  const [preview, setPreview] = useState<MarketplaceToolPreview | null>(null)
  const [trustStatus, setTrustStatus] = useState<PublisherTrustStatus | null>(null)
  const [trustApproval, setTrustApproval] = useState(false)
  const [replaceApproval, setReplaceApproval] = useState(false)
  const [registerApproval, setRegisterApproval] = useState(false)
  const [removeApproval, setRemoveApproval] = useState(false)
  const [registryRevision, setRegistryRevision] = useState(0)

  const registered = useMemo(() => {
    void registryRevision
    return loadRegisteredMarketplaceTools()
  }, [registryRevision])

  async function onImport(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      const imported = await importSignedToolPackage(await file.text())
      const nextPreview = await previewMarketplaceTool(imported)
      setVerified(imported)
      setPreview(nextPreview)
      setTrustStatus(nextPreview.trustStatus)
      setTrustApproval(false)
      setReplaceApproval(false)
      setRegisterApproval(false)
      onNotice('Tool Package تم التحقق من توقيعها محليًا. لم يتم تسجيل أو تشغيل أي أداة.')
    } catch (error) {
      setVerified(null)
      setPreview(null)
      setTrustStatus(null)
      onNotice(friendlyError(error))
    }
  }

  function trustPublisher(): void {
    if (!verified) return
    try {
      const result = pinVerifiedPublisherIdentityTrust(identityFor(verified), trustApproval, replaceApproval)
      setTrustStatus(result.status)
      setTrustApproval(false)
      setReplaceApproval(false)
      onNotice('تم تثبيت Public Key Fingerprint للناشر يدويًا. هذا لا يسجل الأداة ولا يفعّلها.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  async function refreshTrust(): Promise<void> {
    if (!verified) return
    try {
      const status = getVerifiedPublisherIdentityTrustStatus(identityFor(verified))
      setTrustStatus(status.status)
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  async function registerDisabled(): Promise<void> {
    if (!verified) return
    try {
      const record = await registerMarketplaceToolDisabled(verified, registerApproval)
      setRegisterApproval(false)
      setRegistryRevision((value) => value + 1)
      setPreview(await previewMarketplaceTool(verified))
      onNotice(`${record.name}: سُجلت Disabled فقط. لا Agent Allowlist ولا Runtime Activation حدثا.`)
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function removeTool(packageDigest: string): void {
    try {
      removeMarketplaceTool(packageDigest, removeApproval)
      setRemoveApproval(false)
      setRegistryRevision((value) => value + 1)
      onNotice('حُذف الوصف من Marketplace Registry فقط؛ لم يتم تشغيل أي شيء.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  const manifest = verified?.package.tool ?? null

  return (
    <section className="card tool-marketplace-card" dir="rtl">
      <div className="section-heading">
        <div>
          <span className="phase-pill">Phase 10C</span>
          <h2>Tool Marketplace Architecture (سوق الأدوات الآمن)</h2>
        </div>
        <span className="zero-cost-badge">Signed · Disabled by Default · 0$</span>
      </div>

      <p className="muted">
        السوق يستقبل Tool Manifest (وصف أداة) موقّعًا فقط. لا JavaScript من الإنترنت، لا Auto Install، لا Auto Activation، ولا تنفيذ.
      </p>

      <label className="file-button tool-marketplace-import">
        Import Signed Tool Package (استورد حزمة أداة موقعة)
        <input
          type="file"
          accept="application/json,.json,.agent-tool.json"
          onChange={(event) => void onImport(event.target.files?.[0])}
        />
      </label>

      {verified && manifest ? (
        <div className="tool-marketplace-preview">
          <div className="marketplace-grid">
            <div><strong>Tool</strong><span>{manifest.name}</span></div>
            <div><strong>ID / Version</strong><span>{manifest.toolId} · {manifest.version}</span></div>
            <div><strong>Risk</strong><span>{manifest.risk}</span></div>
            <div><strong>License</strong><span>{manifest.licenseSpdx}</span></div>
            <div><strong>Adapter</strong><span>{manifest.implementation.adapterId}</span></div>
            <div><strong>Spend</strong><span>{manifest.policy.maxMonetarySpendUsd}$</span></div>
          </div>

          <p><strong>Scopes (الصلاحيات المطلوبة):</strong> {manifest.scopes.join(' · ')}</p>
          <p><strong>Publisher:</strong> {verified.package.publisher.displayName} ({verified.package.publisher.id})</p>
          <code className="fingerprint-code">{verified.publisherFingerprint}</code>
          <p className={`trust-state trust-${trustStatus ?? 'untrusted'}`}>{trustLabel(trustStatus)}</p>
          <p className="muted">Signature Valid (توقيع صالح) ≠ Trusted Publisher (ناشر موثوق) ≠ Runtime Activation (تفعيل تشغيل).</p>

          {trustStatus !== 'trusted' ? (
            <div className="approval-panel">
              <label>
                <input type="checkbox" checked={trustApproval} onChange={(event) => setTrustApproval(event.target.checked)} />
                راجعت Fingerprint عبر قناة أثق بها وأوافق على توثيق هذا المفتاح.
              </label>
              {trustStatus === 'key-changed' ? (
                <label>
                  <input type="checkbox" checked={replaceApproval} onChange={(event) => setReplaceApproval(event.target.checked)} />
                  أوافق صراحة على استبدال المفتاح الموثوق السابق لهذا Publisher ID.
                </label>
              ) : null}
              <button type="button" onClick={trustPublisher}>Trust Publisher Fingerprint (وثّق بصمة الناشر)</button>
            </div>
          ) : (
            <button type="button" className="secondary" onClick={() => void refreshTrust()}>Recheck Trust (أعد فحص الثقة)</button>
          )}

          <div className="approval-panel">
            <label>
              <input type="checkbox" checked={registerApproval} onChange={(event) => setRegisterApproval(event.target.checked)} />
              أوافق على تسجيل هذا Tool Manifest كـDisabled فقط، دون تفعيل أو إضافة لأي Agent.
            </label>
            <button type="button" onClick={() => void registerDisabled()}>
              Register Disabled Tool (سجّل الأداة معطلة)
            </button>
          </div>

          <p className="marketplace-lock">
            Runtime Activation مقفلة في Phase 10C. تحتاج Phase 10D Adapter SDK + Adapter مفحوص + موافقة تفعيل مستقلة + Agent Allowlist صريحة.
          </p>
          {preview?.alreadyRegistered ? <p className="success-note">هذه الحزمة موجودة في السجل المحلي كـDisabled.</p> : null}
        </div>
      ) : null}

      <div className="marketplace-registry">
        <h3>Disabled Marketplace Registry (سجل السوق المعطل)</h3>
        {registered.length === 0 ? <p className="muted">لا توجد أدوات مسجلة.</p> : null}
        {registered.map((item) => (
          <article key={item.packageDigest} className="marketplace-tool-row">
            <div>
              <strong>{item.name}</strong>
              <small>{item.toolId}@{item.toolVersion} · {item.risk} · {item.adapterId}</small>
              <small>activationAllowed=false · cost={item.monetaryCostUsd}$</small>
            </div>
            <button type="button" className="danger secondary" onClick={() => removeTool(item.packageDigest)}>Remove (احذف)</button>
          </article>
        ))}
        {registered.length > 0 ? (
          <label className="remove-approval">
            <input type="checkbox" checked={removeApproval} onChange={(event) => setRemoveApproval(event.target.checked)} />
            أوافق على حذف Tool Manifest من السجل عند الضغط على Remove.
          </label>
        ) : null}
      </div>
    </section>
  )
}
