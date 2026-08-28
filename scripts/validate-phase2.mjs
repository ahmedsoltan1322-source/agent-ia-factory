import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()

const required = [
  'src/core/memoryKnowledge.ts',
  'src/components/MemoryKnowledgePanel.tsx',
  'src/memory.css',
  'docs/MEMORY_KNOWLEDGE.md',
]

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    throw new Error(`Missing Phase 2 file: ${file}`)
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
const forbiddenRemoteMemoryDependencies = [
  '@pinecone-database/pinecone',
  'chromadb',
  'weaviate-client',
  '@supabase/supabase-js',
  'firebase',
  'pouchdb',
]

for (const dependency of forbiddenRemoteMemoryDependencies) {
  if (dependency in dependencies) {
    throw new Error(`Phase 2 local-memory policy forbids remote/external memory dependency: ${dependency}`)
  }
}

const memoryCore = fs.readFileSync(path.join(root, 'src/core/memoryKnowledge.ts'), 'utf8')
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const panel = fs.readFileSync(path.join(root, 'src/components/MemoryKnowledgePanel.tsx'), 'utf8')

if (!memoryCore.includes("localStorage.setItem")) {
  throw new Error('Phase 2 must persist long-term memory locally in this phase')
}

if (memoryCore.includes('fetch(') || memoryCore.includes('XMLHttpRequest')) {
  throw new Error('Memory/knowledge core must not upload or fetch remote memory in Phase 2')
}

if (!memoryCore.includes('MAX_KNOWLEDGE_FILE_BYTES = 700_000')) {
  throw new Error('Knowledge file size safety limit is missing or changed without review')
}

if (!memoryCore.includes('retrieveLocalContext') || !memoryCore.includes('buildAugmentedTask')) {
  throw new Error('Local retrieval/RAG functions are required')
}

if (!app.includes('retrieveLocalContext') || !app.includes('rememberSuccessfulRun')) {
  throw new Error('Agent runs must be connected to local retrieval and long-term memory')
}

if (!panel.includes('Export Memory') || !panel.includes('clearAllAgentMemory')) {
  throw new Error('Memory export/delete controls are required')
}

if (!app.includes('Maximum Spend (أقصى إنفاق)</span><strong>$0</strong>')) {
  throw new Error('Phase 2 UI must retain the explicit zero-cost policy')
}

console.log('Phase 2 memory & knowledge validation: PASS')
console.log('Remote vector/database SDK dependencies: none')
console.log('Knowledge retrieval: local only')
console.log('Memory export/delete controls: present')
console.log('Mandatory monetary spend: 0 USD')
