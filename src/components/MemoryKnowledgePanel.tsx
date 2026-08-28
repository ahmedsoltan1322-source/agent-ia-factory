import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import {
  MAX_KNOWLEDGE_FILE_BYTES,
  addLongTermMemory,
  clearAllAgentMemory,
  deleteKnowledgeDocument,
  deleteLongTermMemory,
  exportMemoryBundle,
  ingestKnowledgeText,
  loadKnowledgeDocuments,
  loadLongTermMemory,
  type KnowledgeDocument,
  type LongTermMemoryItem,
  type SessionMemoryItem,
} from '../core/memoryKnowledge'

interface Props {
  agentId: string
  sessionMemory: SessionMemoryItem[]
  revision: number
  onClearSession: () => void
  onNotice: (message: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 100 * 1024 ? 1 : 0)} KB`
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('KNOWLEDGE_FILE_TOO_LARGE')) return 'الملف أكبر من الحد المحلي المسموح به لهذه المرحلة.'
  if (message.includes('KNOWLEDGE_FILE_EMPTY')) return 'لم أجد نصاً قابلاً للفهرسة داخل الملف.'
  if (message.includes('KNOWLEDGE_TOTAL_LIMIT_REACHED')) return 'وصل مخزن المعرفة المحلي إلى حده الحالي. احذف ملفات قديمة ثم أعد المحاولة.'
  if (message.includes('LOCAL_STORAGE_QUOTA_EXCEEDED')) return 'مساحة التخزين المحلية في المتصفح ممتلئة. احذف بعض الذاكرة أو الملفات.'
  return `تعذر حفظ المعرفة محلياً: ${message}`
}

export default function MemoryKnowledgePanel({ agentId, sessionMemory, revision, onClearSession, onNotice }: Props) {
  const [manualMemory, setManualMemory] = useState('')
  const [longTerm, setLongTerm] = useState<LongTermMemoryItem[]>([])
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])

  function refresh() {
    if (!agentId) {
      setLongTerm([])
      setDocuments([])
      return
    }
    setLongTerm(loadLongTermMemory(agentId))
    setDocuments(loadKnowledgeDocuments(agentId))
  }

  useEffect(() => {
    refresh()
  }, [agentId, revision])

  const totalChunks = useMemo(
    () => documents.reduce((sum, document) => sum + document.chunks.length, 0),
    [documents],
  )

  function handleSaveMemory() {
    if (!agentId) return
    try {
      setLongTerm(addLongTermMemory(agentId, manualMemory, 'manual'))
      setManualMemory('')
      onNotice('تم حفظ Long-Term Memory (الذاكرة طويلة الأمد) محلياً على الجهاز.')
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !agentId) return

    if (file.size > MAX_KNOWLEDGE_FILE_BYTES) {
      onNotice(`الملف كبير لهذه المرحلة. الحد الحالي ${formatBytes(MAX_KNOWLEDGE_FILE_BYTES)} لكل ملف.`)
      return
    }

    const allowed = ['.txt', '.md', '.json', '.csv']
    const lowerName = file.name.toLowerCase()
    if (!allowed.some((extension) => lowerName.endsWith(extension))) {
      onNotice('في Phase 2 الحالية نقبل ملفات TXT وMD وJSON وCSV النصية فقط، بدون رفعها إلى خادم.')
      return
    }

    try {
      const text = await file.text()
      setDocuments(ingestKnowledgeText(agentId, file.name, file.type, text, file.size))
      onNotice(`تمت فهرسة ${file.name} محلياً وإضافته إلى Knowledge (المعرفة).`)
    } catch (error) {
      onNotice(friendlyError(error))
    }
  }

  function handleDeleteMemory(memoryId: string) {
    deleteLongTermMemory(memoryId)
    refresh()
    onNotice('تم حذف عنصر الذاكرة.')
  }

  function handleDeleteDocument(documentId: string) {
    deleteKnowledgeDocument(documentId)
    refresh()
    onNotice('تم حذف ملف المعرفة وفهرسته المحلية.')
  }

  function handleExport() {
    if (!agentId) return
    const blob = new Blob([exportMemoryBundle(agentId)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `agent-memory-${agentId}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    onNotice('تم إنشاء Export (تصدير) للذاكرة والمعرفة من جهازك.')
  }

  function handleClearAll() {
    if (!agentId) return
    clearAllAgentMemory(agentId)
    onClearSession()
    refresh()
    onNotice('تم حذف Session Memory (ذاكرة الجلسة) وLong-Term Memory (الذاكرة الطويلة) وKnowledge (المعرفة) لهذا الوكيل.')
  }

  return (
    <section className="card memory-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">Memory & Knowledge (الذاكرة والمعرفة)</p>
          <h2>سياق محلي للوكيل</h2>
        </div>
        <span className="local-pill">Local 0$</span>
      </div>

      {!agentId ? (
        <p className="empty-state">اختر Agent (وكيلاً) أولاً لإدارة ذاكرته ومعرفته.</p>
      ) : (
        <>
          <div className="memory-stats">
            <div><span>Session Memory (ذاكرة الجلسة)</span><strong>{sessionMemory.length}</strong></div>
            <div><span>Long-Term Memory (ذاكرة طويلة)</span><strong>{longTerm.length}</strong></div>
            <div><span>Knowledge Files (ملفات المعرفة)</span><strong>{documents.length}</strong></div>
            <div><span>Indexed Chunks (المقاطع المفهرسة)</span><strong>{totalChunks}</strong></div>
          </div>

          <div className="memory-section">
            <label>
              إضافة Memory (ذاكرة) يدوية
              <textarea
                rows={3}
                value={manualMemory}
                onChange={(event) => setManualMemory(event.target.value)}
                placeholder="مثال: المستخدم يفضّل الإجابات العربية المختصرة..."
              />
            </label>
            <button className="primary-button" type="button" disabled={!manualMemory.trim()} onClick={handleSaveMemory}>
              + حفظ في Long-Term Memory (الذاكرة الطويلة)
            </button>
          </div>

          <div className="memory-section">
            <label className="file-picker">
              Knowledge File (ملف معرفة نصي)
              <input type="file" accept=".txt,.md,.json,.csv,text/plain,text/markdown,application/json,text/csv" onChange={handleFile} />
            </label>
            <p className="disclaimer">
              TXT / MD / JSON / CSV فقط. الحد الحالي {formatBytes(MAX_KNOWLEDGE_FILE_BYTES)} للملف. القراءة والفهرسة تتمان داخل المتصفح ولا نرفع الملف إلى خادم.
            </p>
          </div>

          {longTerm.length > 0 && (
            <div className="memory-list">
              <strong className="mini-title">Long-Term Memory (الذاكرة طويلة الأمد)</strong>
              {longTerm.slice(0, 8).map((item) => (
                <article className="memory-item" key={item.id}>
                  <div>
                    <span className="memory-source">{item.source === 'run' ? 'Run Memory (من تشغيل)' : 'Manual (يدوي)'}</span>
                    <p>{item.text}</p>
                  </div>
                  <button className="danger-button" type="button" onClick={() => handleDeleteMemory(item.id)}>حذف</button>
                </article>
              ))}
            </div>
          )}

          {documents.length > 0 && (
            <div className="memory-list">
              <strong className="mini-title">Knowledge Files (ملفات المعرفة)</strong>
              {documents.map((documentItem) => (
                <article className="memory-item" key={documentItem.id}>
                  <div>
                    <strong>{documentItem.name}</strong>
                    <p>{formatBytes(documentItem.sizeBytes)} · {documentItem.chunks.length} chunks (مقاطع)</p>
                  </div>
                  <button className="danger-button" type="button" onClick={() => handleDeleteDocument(documentItem.id)}>حذف</button>
                </article>
              ))}
            </div>
          )}

          <div className="memory-actions">
            <button className="text-button" type="button" onClick={handleExport}>Export Memory (تصدير الذاكرة)</button>
            <button className="danger-button" type="button" onClick={handleClearAll}>حذف ذاكرة هذا الوكيل كلها</button>
          </div>
        </>
      )}
    </section>
  )
}
