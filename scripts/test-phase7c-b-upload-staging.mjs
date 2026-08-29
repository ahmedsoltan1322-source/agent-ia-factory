import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const capsuleMod = await import(new URL('../src/core/browserUploadCapsule.ts', import.meta.url).href)
const auth = await import(new URL('../src/core/browserUploadStageAuth.ts', import.meta.url).href)
const storeMod = await import(new URL('../src/core/browserUploadStageStore.ts', import.meta.url).href)
const server = await import(new URL('../src/core/browserUploadStageServerCore.ts', import.meta.url).href)

const now = Date.now()
const secret = Buffer.alloc(32, 7).toString('base64url')
const tenantId = 'local-owner'
const origin = 'https://factory.example'
const root = await mkdtemp(path.join(os.tmpdir(), 'agentia-upload-stage-'))
const store = await storeMod.createFilesystemBrowserUploadStageStore(root)
const state = server.createUploadStageServerState()
const config = { tenantId, secret, allowedOrigin: origin, maxRequestsPerMinute: 12 }
const capsule = await capsuleMod.createBrowserUploadCapsule(new File(['name,count\nalpha,2\n'], 'report.csv', { type: 'text/csv' }), now)
const stageBody = JSON.stringify(capsule)

async function request(pathname, body, nonce, requestNow = now + 1_000) {
  const headers = await auth.createSignedUploadRequest(secret, tenantId, pathname, body, { nowMs: requestNow, nonce })
  return { headers, response: await server.handleUploadStageServerRequest(config, state, { method: 'POST', path: pathname, origin, headers, body }, store, requestNow) }
}

const nonce1 = 'AAAAAAAAAAAAAAAAAAAAAA'
const first = await request(auth.UPLOAD_STAGE_PATH, stageBody, nonce1)
assert.equal(first.response.status, 200)
await auth.verifySignedUploadResponse(secret, tenantId, auth.UPLOAD_STAGE_PATH, nonce1, 200, first.response.headers, first.response.body, now + 1_000)
const receipt1 = JSON.parse(first.response.body)
assert.match(receipt1.stageId, /^stage-[a-f0-9]{32}$/u)
assert.equal(receipt1.capsuleId, capsule.id)
assert.equal(receipt1.sha256, capsule.sha256)
assert.equal(receipt1.monetaryCostUsd, 0)

const resolved = await store.resolvePath(receipt1.stageId, now + 2_000)
assert.equal(await readFile(resolved.path, 'utf8'), capsule.utf8Text)
assert.equal((await stat(resolved.path)).mode & 0o777, 0o600)
assert.equal((await stat(root)).mode & 0o777, 0o700)

const replay = await server.handleUploadStageServerRequest(config, state, { method: 'POST', path: auth.UPLOAD_STAGE_PATH, origin, headers: first.headers, body: stageBody }, store, now + 2_000)
assert.equal(replay.status, 409)
await auth.verifySignedUploadResponse(secret, tenantId, auth.UPLOAD_STAGE_PATH, nonce1, 409, replay.headers, replay.body, now + 2_000)
assert.match(replay.body, /UPLOAD_AUTH_REPLAY/u)

const nonce2 = 'BBBBBBBBBBBBBBBBBBBBBB'
const second = await request(auth.UPLOAD_STAGE_PATH, stageBody, nonce2, now + 3_000)
assert.equal(second.response.status, 200)
const receipt2 = JSON.parse(second.response.body)
assert.equal(receipt2.stageId, receipt1.stageId)
assert.equal(receipt2.stagedAt, receipt1.stagedAt)

const tampered = await server.handleUploadStageServerRequest(config, state, { method: 'POST', path: auth.UPLOAD_STAGE_PATH, origin, headers: second.headers, body: stageBody.replace('alpha', 'omega') }, store, now + 3_500)
assert.equal(tampered.status, 401)

const wrongOriginHeaders = await auth.createSignedUploadRequest(secret, tenantId, auth.UPLOAD_STAGE_PATH, stageBody, { nowMs: now + 4_000, nonce: 'CCCCCCCCCCCCCCCCCCCCCC' })
const wrongOrigin = await server.handleUploadStageServerRequest(config, state, { method: 'POST', path: auth.UPLOAD_STAGE_PATH, origin: 'https://evil.example', headers: wrongOriginHeaders, body: stageBody }, store, now + 4_000)
assert.equal(wrongOrigin.status, 403)

const deleteBody = JSON.stringify({ stageId: receipt1.stageId })
const nonce3 = 'DDDDDDDDDDDDDDDDDDDDDD'
const deletion = await request(auth.UPLOAD_DELETE_PATH, deleteBody, nonce3, now + 5_000)
assert.equal(deletion.response.status, 200)
await auth.verifySignedUploadResponse(secret, tenantId, auth.UPLOAD_DELETE_PATH, nonce3, 200, deletion.response.headers, deletion.response.body, now + 5_000)
assert.equal(JSON.parse(deletion.response.body).deleted, true)
await assert.rejects(() => store.resolvePath(receipt1.stageId, now + 6_000), /UPLOAD_STAGE_NOT_FOUND/)

const expired = await capsuleMod.createBrowserUploadCapsule(new File(['public text'], 'expired.txt', { type: 'text/plain' }), now - capsuleMod.UPLOAD_CAPSULE_TTL_MS - 1_000)
const expiredBody = JSON.stringify(expired)
const expiredHeaders = await auth.createSignedUploadRequest(secret, tenantId, auth.UPLOAD_STAGE_PATH, expiredBody, { nowMs: now + 7_000, nonce: 'EEEEEEEEEEEEEEEEEEEEEE' })
const expiredResponse = await server.handleUploadStageServerRequest(config, state, { method: 'POST', path: auth.UPLOAD_STAGE_PATH, origin, headers: expiredHeaders, body: expiredBody }, store, now + 7_000)
assert.equal(expiredResponse.status, 400)
assert.match(expiredResponse.body, /BROWSER_UPLOAD_EXPIRED/u)

console.log('Phase 7C-B authenticated upload staging smoke: PASS')
console.log('HMAC request/response binding: PASS')
console.log('Replay nonce: rejected')
console.log('Same capsule retry: same stageId, no duplicate')
console.log('Tamper + wrong origin + expired capsule: rejected')
console.log('Staged file mode 0600; directory mode 0700: PASS')
console.log('Authenticated delete removes staged file: PASS')
console.log('Mandatory additional spend: 0 USD')
