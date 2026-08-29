import { useRef, useState } from 'react'
import {
  MAX_COMMUNITY_CATALOG_JSON_CHARS,
  importCommunityCatalogPackage,
  matchTemplatePackageToCatalog,
  type CommunityCatalogEntry,
  type CommunityCatalogPackage,
} from '../core/communityCatalog'
import { importAgentTemplatePackage, MAX_AGENT_TEMPLATE_JSON_CHARS } from '../core/ecosystemTemplate'
import {
  getCatalogPublisherTrustStatus,
  pinCatalogPublisherTrust,
  revokePublisherTrust,
  type PublisherTrustResult,
} from '../core/publisherTrust'

interface Props {
  onNotice: (message: string) => void
}

function trustLabel(status: PublisherTrustResult['status'] | null): string {
  if (status === 'trusted') return 'Trusted (موثوق محليًا)'
  if (status === 'key-changed') return 'KEY CHANGED (المفتاح تغيّر)'
  return 'Untrusted (غير موثوق بعد)'
}

function shortFingerprint(value: string): string {
  if (value.length < 18) return value
  return `${value.slice(0, 9)}…${value.slice(-9)}`
}

export default function CommunityCatalogCenter({ onNotice }: Props) {
  const [catalog, setCatalog] = useState<CommunityCatalogPackage | null>(null)
  const [trust, setTrust] = useState<PublisherTrustResult | null>(null)
  const [trustApproved, setTrustApproved] = useState(false)
  const [replaceApproved, setReplaceApproved] = useState(false)
  const [revokeApproved, setRevokeApproved] = useState(false)
  const [matchedEntry, setMatchedEntry] = useState<CommunityCatalogEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const catalogInput = useRef<HTMLInputElement>(null)
  const templateInput = useRef<HTMLInputElement>(null)

  async function refreshTrust(pkg: CommunityCatalogPackage): Promise<void> {
    setTrust(await getCatalogPublisherTrustStatus(pkg))
  }

  async function handleCatalogFile(file: File | undefined): Promise<void> {
    if (!file) return
    setBusy(true)
    setCatalog(null)
    setTrust(null)
    setMatchedEntry(null)
    setTrustApproved(false)
    setReplaceApproved(false)
    setRevokeApproved(false)
    try {
      if (file.size > MAX_COMMUNITY_CATALOG_JSON_CHARS) throw new Error('CATALOG_IMPORT_FILE_TOO_LARGE')
      const verified = await importCommunityCatalogPackage(await file.text())
      setCatalog(verified.package)
      await refreshTrust(verified.package)
      onNotice('Catalog Signature (توقيع الدليل) صالح. هذا يثبت أن نفس Ed25519 Key وقّع المحتوى، لكنه لا يمنح Publisher Trust تلقائيًا.')
    } catch (error) {
      onNotice(`تم رفض Community Catalog (الدليل المجتمعي): ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
      if (catalogInput.current) catalogInput.current.value = ''
    }
  }

  async function handlePinTrust(): Promise<void> {
    if (!catalog || !trustApproved) {
      onNotice('يلزم Human Approval (موافقة بشرية) صريحة قبل تثبيت بصمة Publisher (الناشر).')
      return
    }
    try {
      const replace = trust?.status === 'key-changed' && replaceApproved
      const result = await pinCatalogPublisherTrust(catalog, true, replace)
      setTrust(result)
      setTrustApproved(false)
      setReplaceApproved(false)
      setRevokeApproved(false)
      onNotice('تم Pin (تثبيت) بصمة الناشر محليًا. لا Private Key ولا Token تم حفظه، ولم يتم تثبيت أي Template.')
    } catch (error) {
      onNotice(`تعذر تعديل Publisher Trust: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function handleRevokeTrust(): void {
    if (!catalog || !revokeApproved) {
      onNotice('يلزم Human Approval (موافقة بشرية) صريحة لإلغاء ثقة الناشر.')
      return
    }
    try {
      revokePublisherTrust(catalog.publisher.id, true)
      setTrust({ verified: { package: catalog, signatureVerified: true, publisherFingerprint: catalog.publisher.keyFingerprint }, status: 'untrusted', trustedRecord: null })
      setRevokeApproved(false)
      setTrustApproved(false)
      onNotice('تم Revoke Trust (إلغاء الثقة) محليًا. القالب أو الدليل لم يُحذف ولم يُشغّل شيء.')
    } catch (error) {
      onNotice(`تعذر إلغاء الثقة: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function handleTemplateMatch(file: File | undefined): Promise<void> {
    if (!file || !catalog) return
    setBusy(true)
    setMatchedEntry(null)
    try {
      if (file.size > MAX_AGENT_TEMPLATE_JSON_CHARS) throw new Error('TEMPLATE_IMPORT_FILE_TOO_LARGE')
      const template = await importAgentTemplatePackage(await file.text())
      const entry = matchTemplatePackageToCatalog(template, catalog)
      if (!entry) throw new Error('CATALOG_TEMPLATE_DIGEST_NOT_LISTED')
      setMatchedEntry(entry)
      onNotice(`Template Match (مطابقة القالب) ناجحة: ${entry.templateId}@${entry.templateVersion}. المطابقة لا تثبت القالب ولا تشغّله.`)
    } catch (error) {
      onNotice(`فشلت مطابقة Template مع Catalog: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
      if (templateInput.current) templateInput.current.value = ''
    }
  }

  return (
    <section className="card community-catalog-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Phase 10B — Publisher Trust + Community Catalog</p>
          <h2>دليل قوالب موقّع، والثقة بيدك</h2>
        </div>
        <span className="safe-pill">Ed25519 · Manual Trust · 0$</span>
      </div>

      <p className="catalog-disclosure">
        Signature Valid (توقيع صالح) لا تعني Trusted Publisher (ناشر موثوق). كل Catalog يحمل Public Key (مفتاحًا عامًا) وبصمته، لكن المصنع لا يثق به إلا بعد موافقتك الصريحة على Fingerprint (البصمة). تغيير المفتاح لاحقًا يظهر كحالة خطرة ولا يُقبل تلقائيًا.
      </p>

      <div className="catalog-import-row">
        <label>
          Import Signed Catalog (استورد دليلًا موقّعًا)
          <input
            ref={catalogInput}
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => void handleCatalogFile(event.target.files?.[0])}
          />
        </label>
        <small>Local File Only (ملف محلي فقط). لا Fetch تلقائي من GitHub ولا Marketplace Install.</small>
      </div>

      {catalog && trust && (
        <>
          <div className="catalog-trust-grid">
            <div><span>Signature</span><strong>Ed25519 ✓</strong></div>
            <div><span>Publisher</span><strong>{catalog.publisher.displayName}</strong></div>
            <div><span>Publisher ID</span><strong>{catalog.publisher.id}</strong></div>
            <div><span>Fingerprint</span><strong title={catalog.publisher.keyFingerprint}>{shortFingerprint(catalog.publisher.keyFingerprint)}</strong></div>
            <div><span>Trust Status</span><strong className={`catalog-trust-${trust.status}`}>{trustLabel(trust.status)}</strong></div>
            <div><span>Entries</span><strong>{catalog.catalog.entries.length}</strong></div>
          </div>

          {trust.status === 'key-changed' && (
            <div className="catalog-danger">
              <strong>Publisher Key Changed (مفتاح الناشر تغيّر)</strong>
              <p>المفتاح الجديد لا يرث الثقة من المفتاح القديم. البصمة الموثوقة سابقًا: {trust.trustedRecord?.fingerprint ?? 'غير متاحة'}.</p>
              <label>
                <input type="checkbox" checked={replaceApproved} onChange={(event) => setReplaceApproved(event.target.checked)} />
                أفهم أن هذا Key Rotation (تغيير مفتاح) وأوافق صراحة على استبدال المفتاح القديم بالجديد.
              </label>
            </div>
          )}

          {trust.status !== 'trusted' ? (
            <div className="catalog-trust-actions">
              <label>
                <input type="checkbox" checked={trustApproved} onChange={(event) => setTrustApproved(event.target.checked)} />
                تحققت من Fingerprint (البصمة) عبر قناة أثق بها وأوافق على Pin هذا Publisher محليًا.
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={!trustApproved || (trust.status === 'key-changed' && !replaceApproved)}
                onClick={() => void handlePinTrust()}
              >
                {trust.status === 'key-changed' ? 'Replace Trusted Key (استبدل المفتاح الموثوق)' : 'Trust Publisher Fingerprint (وثّق بصمة الناشر)'}
              </button>
            </div>
          ) : (
            <div className="catalog-trust-actions">
              <label>
                <input type="checkbox" checked={revokeApproved} onChange={(event) => setRevokeApproved(event.target.checked)} />
                أوافق على Revoke Trust (إلغاء الثقة) لهذا الناشر.
              </label>
              <button type="button" className="secondary-button" disabled={!revokeApproved} onClick={handleRevokeTrust}>
                Revoke Publisher Trust (ألغِ ثقة الناشر)
              </button>
            </div>
          )}

          <div className="catalog-entry-list">
            {catalog.catalog.entries.map((entry) => (
              <article className="catalog-entry" key={`${entry.templateId}@${entry.templateVersion}`}>
                <div className="catalog-entry-head">
                  <strong>{entry.title}</strong>
                  <span>{entry.licenseSpdx}</span>
                </div>
                <p>{entry.summary || 'لا يوجد وصف إضافي.'}</p>
                <small>{entry.templateId}@{entry.templateVersion}</small>
                <code>{entry.source.repository}@{entry.source.commit.slice(0, 12)}…/{entry.source.path}</code>
                <small>Template Digest: {shortFingerprint(entry.templateDigest)}</small>
              </article>
            ))}
          </div>

          <div className="catalog-match-box">
            <h3>Verify Template Against Catalog (طابق قالبًا مع الدليل)</h3>
            <input
              ref={templateInput}
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(event) => void handleTemplateMatch(event.target.files?.[0])}
            />
            <p>المطابقة تتحقق من Template ID + Version + SHA-256 Digest فقط. لا تثبيت ولا تشغيل ولا Tool Activation.</p>
            {matchedEntry && <strong className="catalog-match-ok">✓ مطابق: {matchedEntry.templateId}@{matchedEntry.templateVersion}</strong>}
          </div>
        </>
      )}
    </section>
  )
}
