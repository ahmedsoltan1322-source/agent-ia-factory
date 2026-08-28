import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()

const required = [
  'package.json',
  'vite.config.ts',
  'index.html',
  'src/main.tsx',
  'src/App.tsx',
  'src/core/types.ts',
  'src/core/createAgent.ts',
  'src/core/runtime.ts',
  'src/core/storage.ts',
  'src/core/zeroCostGate.ts',
  'src/core/localModelClient.ts',
  'src/core/localQwenRuntime.ts',
  'src/workers/localModel.worker.ts',
  'docs/LOCAL_AI.md',
]

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    throw new Error(`Missing Phase 1 file: ${file}`)
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
const forbiddenPaidSdkDependencies = [
  'openai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
]

for (const dependency of forbiddenPaidSdkDependencies) {
  if (dependency in allDeps) {
    throw new Error(`Zero-Cost Gate: paid-provider SDK dependency is not allowed in Phase 1: ${dependency}`)
  }
}

if ('@huggingface/transformers' in allDeps) {
  throw new Error('Security Gate: rejected Transformers.js dependency must not return without a new reviewed security decision')
}

if (pkg.dependencies?.['@mlc-ai/web-llm'] !== '0.2.82') {
  throw new Error('Local AI dependency must remain exactly pinned to @mlc-ai/web-llm 0.2.82 until the reported regression is reviewed')
}

const sourceFiles = [
  'src/core/types.ts',
  'src/core/createAgent.ts',
  'src/core/zeroCostGate.ts',
  'src/core/runtime.ts',
  'src/core/localModelClient.ts',
  'src/core/localQwenRuntime.ts',
  'src/workers/localModel.worker.ts',
]

const source = sourceFiles
  .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n')

if (source.includes('allowPaid: true')) {
  throw new Error('Zero-Cost Gate: allowPaid=true is forbidden')
}

if (!source.includes('maxMonetarySpendUsd: 0')) {
  throw new Error('Zero-Cost Gate: safe default maxMonetarySpendUsd=0 is missing')
}

if (!source.includes('monetaryCostUsd: 0')) {
  throw new Error('Run records must explicitly report monetaryCostUsd=0 in Phase 1')
}

if (!source.includes("'local-qwen-webgpu'")) {
  throw new Error('Local Qwen runtime must be represented in the canonical runtime contract')
}

const worker = fs.readFileSync(path.join(root, 'src/workers/localModel.worker.ts'), 'utf8')
if (!worker.includes('WebWorkerMLCEngineHandler')) {
  throw new Error('Local AI worker must use the official WebLLM WebWorker handler')
}

const client = fs.readFileSync(path.join(root, 'src/core/localModelClient.ts'), 'utf8')
if (!client.includes('CreateWebWorkerMLCEngine')) {
  throw new Error('Local AI client must use the WebLLM WebWorker engine')
}
if (!client.includes("const MODEL_ID = 'Qwen3-0.6B-q4f16_1-MLC'")) {
  throw new Error('Local AI model must remain explicitly pinned to Qwen3-0.6B-q4f16_1-MLC for this phase')
}

console.log('Phase 1 policy validation: PASS')
console.log('Paid-provider SDK dependencies: none')
console.log('Rejected vulnerable Transformers.js dependency: absent')
console.log('Local AI: WebLLM 0.2.82 + Qwen3-0.6B-q4f16_1-MLC')
console.log('Mandatory monetary spend: 0 USD')
