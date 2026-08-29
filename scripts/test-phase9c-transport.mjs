import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import process from 'node:process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const deployment = await import(new URL('../src/core/deploymentEngine.ts', import.meta.url).href)
const auth = await import(new URL('../src/core/workerAuth.ts', import.meta.url).href)
const protocol = await import(new URL('../src/core/workerProtocol.ts', import.meta.url).href)
const serverCore = await import(new URL('../src/core/workerServerCore.ts', import.meta.url).href)
const transport = await import(new URL('../src/core/workerTransport.ts', import.meta.url).href)

const SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const ORIGIN = 'https://factory.example.test'
const TENANT = deployment.LOCAL_TENANT_ID

assert.equal(auth.validateWorkerTransportSecret(SECRET), SECRET)
assert.throws(() => auth.validateWorkerTransportSecret('weak-secret'), /WORKER_AUTH_SECRET_INVALID/)
assert.equal(transport.validateAuthenticatedWorkerEndpoint('https://worker.example.test/'), 'https://worker.example.test')
assert.throws(() => transport.validateAuthenticatedWorkerEndpoint('http://worker.example.test'), /WORKER_ENDPOINT_HTTPS_REQUIRED/)
assert.throws(() => transport.validateAuthenticatedWorkerEndpoint('https://user:pass@worker.example.test'), /WORKER_ENDPOINT_CREDENTIAL_OR_QUERY_FORBIDDEN/)
assert.throws(() => transport.validateAuthenticatedWorkerEndpoint('https://worker.example.test/?token=x'), /WORKER_ENDPOINT_CREDENTIAL_OR_QUERY_FORBIDDEN/)
assert.equal(serverCore.validateWorkerAllowedOrigin(ORIGIN), ORIGIN)
assert.throws(() => serverCore.validateWorkerAllowedOrigin('*'), /WORKER_SERVER_ALLOWED_ORIGIN_INVALID/)

const authNow = Date.now()
const authBody = JSON.stringify({ smoke: true })
const signedAuth = await auth.createSignedWorkerRequest(SECRET, TENANT, authBody, { nowMs: authNow })
const verifiedAuth = await auth.verifySignedWorkerRequest(SECRET, TENANT, signedAuth, authBody, { nowMs: authNow })
assert.equal(verifiedAuth.tenantId, TENANT)
assert.equal(verifiedAuth.nonce, signedAuth['x-agent-ia-nonce'])
await assert.rejects(
  () => auth.verifySignedWorkerRequest(SECRET, TENANT, signedAuth, `${authBody}x`, { nowMs: authNow }),
  /WORKER_AUTH_BODY_DIGEST_MISMATCH/,
)
await assert.rejects(
  () => auth.verifySignedWorkerRequest(SECRET, TENANT, signedAuth, authBody, { nowMs: authNow + 91_000 }),
  /WORKER_AUTH_TIMESTAMP_STALE/,
)

const responseBody = JSON.stringify({ ok: true })
const signedResponse = await auth.createSignedWorkerResponse(SECRET, TENANT, signedAuth['x-agent-ia-nonce'], 200, responseBody, authNow)
await auth.verifySignedWorkerResponse(SECRET, TENANT, signedAuth['x-agent-ia-nonce'], 200, signedResponse, responseBody, authNow)
await assert.rejects(
  () => auth.verifySignedWorkerResponse(SECRET, TENANT, signedAuth['x-agent-ia-nonce'], 200, signedResponse, `${responseBody}x`, authNow),
  /WORKER_AUTH_RESPONSE_DIGEST_MISMATCH/,
)

const agent = {
  specVersion: '0.1',
  id: 'agent-transport-smoke',
  name: 'Transport Smoke Agent',
  description: 'Authenticated transport smoke',
  instructions: 'Use deterministic local demo only.',
  runtime: { adapter: 'local-demo' },
  modelPolicy: { mode: 'local_only', allowPaid: false },
  toolPolicy: { defaultAction: 'deny', allowedTools: [] },
  memoryPolicy: { session: false, longTerm: false, shared: false },
  approvalPolicy: { externalWrite: 'ask', delete: 'ask', financial: 'deny', securityChange: 'ask' },
  budgetPolicy: { maxMonetarySpendUsd: 0, maxRunSeconds: 60, maxToolCalls: 0 },
  evaluationPolicy: { requiredBeforeProduction: true, minimumPassRate: 0.95, securityTestsRequired: true },
}

const liveNow = new Date().toISOString()
const seeded = deployment.enqueueDurableJob([], {
  tenantId: TENANT,
  kind: 'agent_run',
  idempotencyKey: `transport-smoke-${Date.now()}`,
  payload: { agentId: agent.id, task: 'اختبر النقل الموثّق دون شبكة خارجية' },
}, liveNow)
const claimed = deployment.claimNextDurableJob(seeded.jobs, TENANT, protocol.REFERENCE_WORKER_ID, liveNow, 5 * 60_000)
assert.ok(claimed.claimed?.lease)
const bundle = protocol.buildPortableWorkerBundle(claimed.claimed, agent, TENANT, liveNow)
const bundleBody = protocol.exportWorkerBundle(bundle)

const pureState = serverCore.createAuthenticatedWorkerServerState()
const pureConfig = { tenantId: TENANT, secret: SECRET, allowedOrigin: ORIGIN, maxRequestsPerMinute: 10 }
const pureNow = Date.now()
const pureSigned = await auth.createSignedWorkerRequest(SECRET, TENANT, bundleBody, { nowMs: pureNow })
const pureRequest = {
  method: 'POST',
  path: auth.WORKER_EXECUTE_PATH,
  origin: ORIGIN,
  headers: pureSigned,
  body: bundleBody,
}
const pureFirst = await serverCore.handleAuthenticatedWorkerServerRequest(pureConfig, pureState, pureRequest, pureNow)
assert.equal(pureFirst.status, 200)
await auth.verifySignedWorkerResponse(
  SECRET,
  TENANT,
  pureSigned['x-agent-ia-nonce'],
  pureFirst.status,
  pureFirst.headers,
  pureFirst.body,
  Date.now(),
)
const pureReceipt = protocol.importWorkerReceipt(pureFirst.body)
assert.equal(protocol.validateWorkerReceipt(pureReceipt, bundle).run.status, 'success')

const replay = await serverCore.handleAuthenticatedWorkerServerRequest(pureConfig, pureState, pureRequest, Date.now())
assert.equal(replay.status, 409)
await auth.verifySignedWorkerResponse(SECRET, TENANT, pureSigned['x-agent-ia-nonce'], replay.status, replay.headers, replay.body, Date.now())
assert.ok(replay.body.includes('WORKER_AUTH_REPLAY'))

const retrySigned = await auth.createSignedWorkerRequest(SECRET, TENANT, bundleBody)
const retry = await serverCore.handleAuthenticatedWorkerServerRequest(pureConfig, pureState, {
  ...pureRequest,
  headers: retrySigned,
}, Date.now())
assert.equal(retry.status, 200)
const retryReceipt = protocol.importWorkerReceipt(retry.body)
assert.equal(retryReceipt.run.id, pureReceipt.run.id)
assert.equal(retry.body, pureFirst.body)

const wrongOrigin = await serverCore.handleAuthenticatedWorkerServerRequest(pureConfig, serverCore.createAuthenticatedWorkerServerState(), {
  ...pureRequest,
  origin: 'https://evil.example.test',
}, Date.now())
assert.equal(wrongOrigin.status, 403)
assert.equal(wrongOrigin.headers['access-control-allow-origin'], undefined)

const tampered = await serverCore.handleAuthenticatedWorkerServerRequest(pureConfig, serverCore.createAuthenticatedWorkerServerState(), {
  ...pureRequest,
  body: `${bundleBody} `,
}, Date.now())
assert.equal(tampered.status, 401)

async function reservePort() {
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const address = probe.address()
  if (!address || typeof address === 'string') throw new Error('LOOPBACK_PORT_UNAVAILABLE')
  const port = address.port
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return port
}

function requestLoopback(port, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: auth.WORKER_EXECUTE_PATH,
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json;charset=utf-8',
        accept: 'application/json',
        ...headers,
      },
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

function signedResponseHeadersFromNode(headers) {
  const value = (name) => Array.isArray(headers[name]) ? headers[name][0] ?? '' : headers[name] ?? ''
  return {
    'x-agent-ia-protocol': value('x-agent-ia-protocol'),
    'x-agent-ia-tenant': value('x-agent-ia-tenant'),
    'x-agent-ia-timestamp': value('x-agent-ia-timestamp'),
    'x-agent-ia-request-nonce': value('x-agent-ia-request-nonce'),
    'x-agent-ia-content-sha256': value('x-agent-ia-content-sha256'),
    'x-agent-ia-signature': value('x-agent-ia-signature'),
  }
}

const port = await reservePort()
const stateDir = await mkdtemp(join(tmpdir(), 'agent-ia-worker-state-'))
const server = spawn(process.execPath, ['scripts/worker-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AGENT_IA_WORKER_SECRET_B64URL: SECRET,
    AGENT_IA_ALLOWED_ORIGIN: ORIGIN,
    AGENT_IA_TENANT_ID: TENANT,
    AGENT_IA_LISTEN_PORT: String(port),
    AGENT_IA_WORKER_STATE_DIR: stateDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverOutput = ''
server.stdout.setEncoding('utf8')
server.stderr.setEncoding('utf8')
server.stdout.on('data', (chunk) => { serverOutput += chunk })
server.stderr.on('data', (chunk) => { serverOutput += chunk })

try {
  const startedAt = Date.now()
  while (!serverOutput.includes('Agent IA Worker listening on')) {
    if (server.exitCode !== null) throw new Error(`WORKER_SERVER_EXITED:${serverOutput}`)
    if (Date.now() - startedAt > 5_000) throw new Error(`WORKER_SERVER_START_TIMEOUT:${serverOutput}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  const loopSigned = await auth.createSignedWorkerRequest(SECRET, TENANT, bundleBody)
  const loopFirst = await requestLoopback(port, loopSigned, bundleBody)
  assert.equal(loopFirst.status, 200, `${loopFirst.status} ${loopFirst.body} ${serverOutput}`)
  await auth.verifySignedWorkerResponse(
    SECRET,
    TENANT,
    loopSigned['x-agent-ia-nonce'],
    loopFirst.status,
    signedResponseHeadersFromNode(loopFirst.headers),
    loopFirst.body,
    Date.now(),
  )
  const loopReceipt = protocol.importWorkerReceipt(loopFirst.body)
  assert.equal(protocol.validateWorkerReceipt(loopReceipt, bundle).run.status, 'success')

  const loopReplay = await requestLoopback(port, loopSigned, bundleBody)
  assert.equal(loopReplay.status, 409)

  const loopRetrySigned = await auth.createSignedWorkerRequest(SECRET, TENANT, bundleBody)
  const loopRetry = await requestLoopback(port, loopRetrySigned, bundleBody)
  assert.equal(loopRetry.status, 200)
  const loopRetryReceipt = protocol.importWorkerReceipt(loopRetry.body)
  assert.equal(loopRetryReceipt.run.id, loopReceipt.run.id)
} finally {
  server.kill('SIGTERM')
  await Promise.race([
    once(server, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ])
}

assert.ok(!serverOutput.includes(SECRET))
assert.ok(!serverOutput.includes(bundle.job.payload.task))
assert.ok(serverOutput.includes('http://127.0.0.1:'))
assert.ok(serverOutput.includes('Durable worker state: enabled'))

console.log('Phase 9C authenticated transport smoke: PASS')
console.log('HMAC-SHA256 request and response signatures: PASS')
console.log('Timestamp skew + body tamper rejection: PASS')
console.log('Replay nonce rejection: PASS')
console.log('Same Bundle manual retry returns cached Receipt: PASS')
console.log('Exact CORS origin, no wildcard: PASS')
console.log('Real loopback Node worker server wiring: PASS')
console.log('Server logs exclude secret/task content: PASS')
console.log('Automatic retry/background networking: forbidden')
console.log('Mandatory additional spend: 0 USD')