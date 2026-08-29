import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({ resolve(specifier, context, nextResolve) { try { return nextResolve(specifier, context) } catch (error) { if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[A-Za-z0-9]+$/u.test(specifier) && context.parentURL?.startsWith('file:')) { const candidate = new URL(`${specifier}.ts`, context.parentURL); if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true } } throw error } } })

class MemoryStorage { #map = new Map(); get length(){return this.#map.size} clear(){this.#map.clear()} getItem(k){return this.#map.has(k)?this.#map.get(k):null} key(i){return [...this.#map.keys()][i]??null} removeItem(k){this.#map.delete(k)} setItem(k,v){this.#map.set(String(k),String(v))} }
globalThis.localStorage = new MemoryStorage()

const mod = await import(new URL('../src/core/browserWriteJob.ts', import.meta.url).href)
let plan = mod.createBrowserWriteJob('safe form', 'https://httpbin.org/forms/post')
assert.equal(plan.approvedByHuman, false)
assert.equal(plan.policy.monetaryCostUsd, 0)
assert.equal(plan.policy.allowPayments, false)
assert.equal(plan.policy.allowUpload, false)
assert.equal(plan.policy.allowPutPatchDelete, false)

plan = mod.addBrowserWriteAction(plan, { id: 'fill', kind: 'fill_field', selector: 'input[name="custname"]', value: 'Agent IA Factory test' })
plan = mod.addBrowserWriteAction(plan, { id: 'submit', kind: 'submit_form', formSelector: 'form', expectedPathPrefix: '/post' })
plan = mod.addBrowserWriteAction(plan, { id: 'download', kind: 'download_file', selector: 'a.download', maxBytes: 50_000_000, allowedExtensions: ['.pdf', '.txt'] })
const download = plan.actions.find((item) => item.kind === 'download_file')
assert.equal(download.maxBytes, 5_000_000)
assert.equal(plan.approvedByHuman, false)

assert.throws(() => mod.addBrowserWriteAction(plan, { id: 'secret', kind: 'fill_field', selector: 'input[type="password"]', value: 'hello' }), /BROWSER_WRITE_SENSITIVE_SELECTOR_FORBIDDEN/)
assert.throws(() => mod.addBrowserWriteAction(plan, { id: 'card', kind: 'fill_field', selector: '#notes', value: '4111111111111111' }), /BROWSER_WRITE_SECRET_VALUE_FORBIDDEN/)
assert.throws(() => mod.createBrowserWriteJob('payment', 'https://example.com/checkout'), /BROWSER_WRITE_HIGH_RISK_TARGET_FORBIDDEN/)
assert.throws(() => mod.addBrowserWriteAction(plan, { id: 'bad-download', kind: 'download_file', selector: 'a', maxBytes: 1000, allowedExtensions: ['.exe'] }), /BROWSER_WRITE_DOWNLOAD_EXTENSION_FORBIDDEN/)
assert.throws(() => mod.exportBrowserWriteJob(plan), /BROWSER_WRITE_HUMAN_APPROVAL_REQUIRED/)

const approved = mod.approveBrowserWriteJob(plan, true)
const exported = JSON.parse(mod.exportBrowserWriteJob(approved))
assert.equal(exported.approvedByHuman, true)
assert.equal(exported.policy.maxPostRequests, 3)
assert.deepEqual(exported.policy.allowedNetworkMethods, ['GET','HEAD','OPTIONS','POST'])

const changed = mod.addBrowserWriteAction(approved, { id: 'screen-after', kind: 'screenshot', label: 'after' })
assert.equal(changed.approvedByHuman, false)

console.log('Phase 7B safe browser write contract smoke: PASS')
console.log('Payment/auth/secret fields: blocked')
console.log('PUT/PATCH/DELETE/upload: forbidden')
console.log('POST count: max 3 actions; executor uses one-shot permit per action')
console.log('Download type/size bounds: PASS')
console.log('Plan mutation revokes approval: PASS')
console.log('Mandatory additional spend: 0 USD')
