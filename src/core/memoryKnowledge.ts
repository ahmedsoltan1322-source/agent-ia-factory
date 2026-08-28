export type MemorySource = 'manual' | 'run'

export interface SessionMemoryItem {
  task: string
  output: string
  createdAt: string
}

export interface LongTermMemoryItem {
  id: string
  agentId: string
  text: string
  source: MemorySource
  createdAt: string
}

export interface KnowledgeChunk {
  id: string
  ordinal: number
  text: string
}

export interface KnowledgeDocument {
  id: string
  agentId: string
  name: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  chunks: KnowledgeChunk[]
}

export interface RetrievalHit {
  id: string
  kind: 'memory' | 'knowledge'
  label: string
  text: string
  score: number
}

const LONG_TERM_KEY = 'agent-ia-factory.long-term-memory.v1'
const KNOWLEDGE_KEY = 'agent-ia-factory.knowledge-documents.v1'

export const MAX_KNOWLEDGE_FILE_BYTES = 700_000
export const MAX_KNOWLEDGE_TOTAL_CHARS = 2_500_000
const MAX_LONG_TERM_PER_AGENT = 60
const CHUNK_SIZE = 1_100
const CHUNK_OVERLAP = 180

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      throw new Error('LOCAL_STORAGE_QUOTA_EXCEEDED')
    }
    throw error
  }
}

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function relevance(query: string, text: string): number {
  const normalizedQuery = normalize(query)
  const normalizedText = normalize(text)
  if (!normalizedQuery || !normalizedText) return 0

  const queryTokens = [...new Set(tokenize(query))]
  if (queryTokens.length === 0) return normalizedText.includes(normalizedQuery) ? 10 : 0

  const textTokens = tokenize(text)
  const counts = new Map<string, number>()
  for (const token of textTokens) counts.set(token, (counts.get(token) ?? 0) + 1)

  let matchedUnique = 0
  let termScore = 0
  for (const token of queryTokens) {
    const count = counts.get(token) ?? 0
    if (count > 0) matchedUnique += 1
    termScore += Math.min(count, 4)
  }

  const coverage = matchedUnique / queryTokens.length
  const phraseBoost = normalizedText.includes(normalizedQuery) ? 8 : 0
  const density = termScore / Math.max(8, Math.sqrt(textTokens.length + 1))
  return phraseBoost + coverage * 5 + density
}

function chunkText(text: string): KnowledgeChunk[] {
  const compact = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!compact) return []

  const chunks: KnowledgeChunk[] = []
  let start = 0
  let ordinal = 0

  while (start < compact.length && chunks.length < 500) {
    const hardEnd = Math.min(compact.length, start + CHUNK_SIZE)
    let end = hardEnd

    if (hardEnd < compact.length) {
      const slice = compact.slice(start, hardEnd)
      const paragraphBreak = slice.lastIndexOf('\n\n')
      const sentenceBreak = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('؟ '), slice.lastIndexOf('! '))
      const preferred = Math.max(paragraphBreak, sentenceBreak)
      if (preferred > CHUNK_SIZE * 0.55) end = start + preferred + 1
    }

    const value = compact.slice(start, end).trim()
    if (value) {
      chunks.push({
        id: id('chunk'),
        ordinal,
        text: value,
      })
      ordinal += 1
    }

    if (end >= compact.length) break
    start = Math.max(start + 1, end - CHUNK_OVERLAP)
  }

  return chunks
}

export function loadLongTermMemory(agentId?: string): LongTermMemoryItem[] {
  const all = readJson<LongTermMemoryItem[]>(LONG_TERM_KEY, [])
  return agentId ? all.filter((item) => item.agentId === agentId) : all
}

export function addLongTermMemory(agentId: string, text: string, source: MemorySource = 'manual'): LongTermMemoryItem[] {
  const clean = text.trim().slice(0, 4_000)
  if (!clean) return loadLongTermMemory(agentId)

  const all = loadLongTermMemory()
  const item: LongTermMemoryItem = {
    id: id('memory'),
    agentId,
    text: clean,
    source,
    createdAt: new Date().toISOString(),
  }

  const own = [item, ...all.filter((entry) => entry.agentId === agentId)].slice(0, MAX_LONG_TERM_PER_AGENT)
  const other = all.filter((entry) => entry.agentId !== agentId)
  writeJson(LONG_TERM_KEY, [...own, ...other])
  return own
}

export function rememberSuccessfulRun(agentId: string, task: string, output: string): LongTermMemoryItem[] {
  const condensed = `Task: ${task.trim().slice(0, 700)}\nResult: ${output.trim().slice(0, 1_800)}`
  return addLongTermMemory(agentId, condensed, 'run')
}

export function deleteLongTermMemory(memoryId: string): void {
  const next = loadLongTermMemory().filter((item) => item.id !== memoryId)
  writeJson(LONG_TERM_KEY, next)
}

export function clearLongTermMemory(agentId: string): void {
  const next = loadLongTermMemory().filter((item) => item.agentId !== agentId)
  writeJson(LONG_TERM_KEY, next)
}

export function loadKnowledgeDocuments(agentId?: string): KnowledgeDocument[] {
  const all = readJson<KnowledgeDocument[]>(KNOWLEDGE_KEY, [])
  return agentId ? all.filter((document) => document.agentId === agentId) : all
}

export function ingestKnowledgeText(
  agentId: string,
  name: string,
  mimeType: string,
  text: string,
  sizeBytes: number,
): KnowledgeDocument[] {
  if (sizeBytes > MAX_KNOWLEDGE_FILE_BYTES) throw new Error('KNOWLEDGE_FILE_TOO_LARGE')
  const chunks = chunkText(text)
  if (chunks.length === 0) throw new Error('KNOWLEDGE_FILE_EMPTY')

  const all = loadKnowledgeDocuments()
  const existingChars = all.reduce(
    (total, document) => total + document.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
    0,
  )
  const incomingChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
  if (existingChars + incomingChars > MAX_KNOWLEDGE_TOTAL_CHARS) {
    throw new Error('KNOWLEDGE_TOTAL_LIMIT_REACHED')
  }

  const document: KnowledgeDocument = {
    id: id('knowledge'),
    agentId,
    name: name.slice(0, 180),
    mimeType: mimeType || 'text/plain',
    sizeBytes,
    createdAt: new Date().toISOString(),
    chunks,
  }

  const next = [document, ...all]
  writeJson(KNOWLEDGE_KEY, next)
  return next.filter((item) => item.agentId === agentId)
}

export function deleteKnowledgeDocument(documentId: string): void {
  const next = loadKnowledgeDocuments().filter((item) => item.id !== documentId)
  writeJson(KNOWLEDGE_KEY, next)
}

export function clearKnowledgeDocuments(agentId: string): void {
  const next = loadKnowledgeDocuments().filter((item) => item.agentId !== agentId)
  writeJson(KNOWLEDGE_KEY, next)
}

export function retrieveLocalContext(agentId: string, query: string, limit = 6): RetrievalHit[] {
  const memoryHits: RetrievalHit[] = loadLongTermMemory(agentId).map((item) => ({
    id: item.id,
    kind: 'memory',
    label: item.source === 'run' ? 'Long-Term Run Memory' : 'Long-Term Memory',
    text: item.text,
    score: relevance(query, item.text),
  }))

  const knowledgeHits: RetrievalHit[] = loadKnowledgeDocuments(agentId).flatMap((document) =>
    document.chunks.map((chunk) => ({
      id: chunk.id,
      kind: 'knowledge' as const,
      label: `${document.name} · chunk ${chunk.ordinal + 1}`,
      text: chunk.text,
      score: relevance(query, chunk.text),
    })),
  )

  return [...memoryHits, ...knowledgeHits]
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, Math.min(limit, 10)))
}

export function buildAugmentedTask(
  task: string,
  sessionMemory: SessionMemoryItem[],
  retrieved: RetrievalHit[],
): string {
  const recentSession = sessionMemory.slice(-4)
  if (recentSession.length === 0 && retrieved.length === 0) return task

  const sections: string[] = [
    'نفذ المهمة التالية. استعمل الذاكرة والسياق المعرفي فقط عندما يكونان مناسبين، ولا تخترع معلومة غير موجودة فيهما.',
    `\n[CURRENT TASK]\n${task}`,
  ]

  if (recentSession.length > 0) {
    sections.push(
      `\n[SESSION MEMORY — ذاكرة الجلسة]\n${recentSession
        .map((item, index) => `${index + 1}. Task: ${item.task}\nResult: ${item.output}`)
        .join('\n\n')}`,
    )
  }

  if (retrieved.length > 0) {
    sections.push(
      `\n[RETRIEVED LOCAL CONTEXT — سياق محلي مسترجع]\n${retrieved
        .map((hit, index) => `${index + 1}. [${hit.label}]\n${hit.text}`)
        .join('\n\n')}`,
    )
  }

  return sections.join('\n')
}

export function exportMemoryBundle(agentId: string): string {
  return JSON.stringify(
    {
      schema: 'agent-ia-factory-memory-export-v1',
      exportedAt: new Date().toISOString(),
      agentId,
      longTermMemory: loadLongTermMemory(agentId),
      knowledgeDocuments: loadKnowledgeDocuments(agentId),
    },
    null,
    2,
  )
}

export function clearAllAgentMemory(agentId: string): void {
  clearLongTermMemory(agentId)
  clearKnowledgeDocuments(agentId)
}
