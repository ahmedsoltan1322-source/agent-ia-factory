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

const sourceFiles = [
  'src/core/types.ts',
  'src/core/createAgent.ts',
  'src/core/zeroCostGate.ts',
  'src/core/runtime.ts',
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

if (!source.includes("monetaryCostUsd: 0")) {
  throw new Error('Run records must explicitly report monetaryCostUsd=0 in Phase 1')
}

console.log('Phase 1 policy validation: PASS')
console.log('Paid-provider SDK dependencies: none')
console.log('Mandatory monetary spend: 0 USD')
