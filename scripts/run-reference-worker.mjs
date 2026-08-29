import { readFile, stat, writeFile } from 'node:fs/promises'
import process from 'node:process'
import {
  MAX_WORKER_BUNDLE_CHARS,
  exportWorkerReceipt,
  importWorkerBundle,
} from '../src/core/workerProtocol.ts'
import { runReferenceWorkerBundle } from '../src/core/referenceWorker.ts'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const inputPath = argument('--input')
const outputPath = argument('--output')
if (!inputPath || !outputPath) {
  throw new Error('USAGE: node scripts/run-reference-worker.mjs --input bundle.json --output receipt.json')
}

const info = await stat(inputPath)
if (!info.isFile() || info.size < 1 || info.size > MAX_WORKER_BUNDLE_CHARS) throw new Error('REFERENCE_WORKER_INPUT_SIZE_INVALID')
const raw = await readFile(inputPath, 'utf8')
const bundle = importWorkerBundle(raw, new Date().toISOString())
const receipt = await runReferenceWorkerBundle(bundle, new Date().toISOString())
const serialized = exportWorkerReceipt(receipt)
await writeFile(outputPath, serialized, { encoding: 'utf8', mode: 0o600 })

console.log(`Reference Worker: PASS job=${receipt.jobId} status=${receipt.run.status} cost=${receipt.monetaryCostUsd}USD tools=${receipt.run.toolCalls}`)
console.log('Transport: offline-file; automatic network: false; automatic tools: false')
