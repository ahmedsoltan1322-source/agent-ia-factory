import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import process from 'node:process'
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const deployment = await import(new URL('../src/core/deploymentEngine.ts', import.meta.url).href)
const auth = await import(new URL('../src/core/workerAuth.ts', import.meta.url).href)
const protocol = await import(new URL('../src/core/workerProtocol.ts', import.meta.url).href)
const durable = await import(new URL('../src/core/workerDurableStore.ts', import.meta.url).href)

const SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const ORIGIN = 'https://factory.example.test'
const TENANT = deployment.LOCAL_TENANT_ID

const agent = {
  specVersion: '0.1',
  id: 'agent-durable-worker-smoke',
  name: 'Durable Worker Smoke Agent',
  description: 'Crash-safe worker smoke',
  instructions: 'Use deterministic local demo only.',
  runtime: { adapter: 'local-demo' },
  modelPolicy: { mode: 'local_only', allowPaid: false },
  toolPolicy: { defaultAction: 'deny', allowedTools: [] },
  memoryPolicy: { session: false, longTerm: false, shared: false },
  approvalPolicy: { externalWrite: 'ask', delete: 'ask', financial: 'deny', securityChange: 'ask' },
  budgetPolicy: { maxMonetarySpendUsd: 0, maxRunSeconds: 60, maxToolCalls: 0 },
  evaluationPolicy: { requiredBeforeProduction: true, minimumPassRate: 0.95, securityTestsRequired: true },
}

function buildBundle(task, key) {
  const now = new Date().toISOString()
  const seeded = deployment.enqueueDurableJob([], {
    tenantId: TENANT,
    kind: 'agent_run',
    idempotencyKey: key,
    payload: { agentId: agent.id, task },
  }, now)
  const claimed = deployment.claimNextDurableJob(seeded.jobs, TENANT, protocol.REFERENCE_WORKER_ID, now, 5 * 60_000)
  assert.ok(claimed.claimed?.lease)
  return protocol.buildPortableWorkerBundle(claimed.claimed, agent, TENANT, now)
}

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

async function startServer(stateDir) {
  const port = await reservePort()
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
  let output = ''
  server.stdout.setEncoding('utf8')
  server.stderr.setEncoding('utf8')
  server.stdout.on('data', (chunk) => { output += chunk })
  server.stderr.on('data', (chunk) => { output += chunk })
  const startedAt = Date.now()
  while (!output.includes('Agent IA Worker listening on')) {
    if (server.exitCode !== null) throw new Error(`WORKER_SERVER_EXITED:${output}`)
    if (Date.now() - startedAt > 5_000) throw new Error(`WORKER_SERVER_START_TIMEOUT:${output}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return { server, port, getOutput: () => output }
}

async function stopServer(server) {
  server.kill('SIGTERM')
  await Promise.race([
    once(server, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ])
}

const stateDir = await mkdtemp(join(tmpdir(), 'agent-ia-durable-worker-'))
const bundle = buildBundle('اختبر استرجاع الإيصال بعد إعادة تشغيل العامل', `durable-restart-${Date.now()}`)
const body = protocol.exportWorkerBundle(bundle)

const firstServer = await startServer(stateDir)
let firstResponse
try {
  const signed = await auth.createSignedWorkerRequest(SECRET, TENANT, body)
  firstResponse = await requestLoopback(firstServer.port, signed, body)
  assert.equal(firstResponse.status, 200, `${firstResponse.status} ${firstResponse.body} ${firstServer.getOutput()}`)
  await auth.verifySignedWorkerResponse(
    SECRET,
    TENANT,
    signed['x-agent-ia-nonce'],
    firstResponse.status,
    signedResponseHeadersFromNode(firstResponse.headers),
    firstResponse.body,
    Date.now(),
  )
} finally {
  await stopServer(firstServer.server)
}

const firstReceipt = protocol.importWorkerReceipt(firstResponse.body)
assert.equal(protocol.validateWorkerReceipt(firstReceipt, bundle).run.status, 'success')

const filesAfterCompletion = (await readdir(stateDir)).filter((name) => name.endsWith('.json'))
assert.equal(filesAfterCompletion.length, 1)
const completedPath = join(stateDir, filesAfterCompletion[0])
const completedInfo = await stat(completedPath)
assert.equal(completedInfo.mode & 0o777, 0o600)
const completedRaw = await readFile(completedPath, 'utf8')
assert.ok(!completedRaw.includes(SECRET))
assert.ok(completedRaw.includes('"status":"completed"'))

const secondServer = await startServer(stateDir)
let secondResponse
try {
  const signed = await auth.createSignedWorkerRequest(SECRET, TENANT, body)
  secondResponse = await requestLoopback(secondServer.port, signed, body)
  assert.equal(secondResponse.status, 200, `${secondResponse.status} ${secondResponse.body} ${secondServer.getOutput()}`)
  await auth.verifySignedWorkerResponse(
    SECRET,
    TENANT,
    signed['x-agent-ia-nonce'],
    secondResponse.status,
    signedResponseHeadersFromNode(secondResponse.headers),
    secondResponse.body,
    Date.now(),
  )
} finally {
  await stopServer(secondServer.server)
}
assert.equal(secondResponse.body, firstResponse.body)
const secondReceipt = protocol.importWorkerReceipt(secondResponse.body)
assert.equal(secondReceipt.run.id, firstReceipt.run.id)

const crashBundle = buildBundle('اختبر حالة الحجز غير المحسومة بعد الانقطاع', `durable-crash-${Date.now()}`)
const crashBody = protocol.exportWorkerBundle(crashBundle)
const crashSignedForDigest = await auth.createSignedWorkerRequest(SECRET, TENANT, crashBody)
const storeBeforeCrash = await durable.createFilesystemWorkerExecutionStore(stateDir)
const reserved = await storeBeforeCrash.reserve({
  bundleId: crashBundle.bundleId,
  tenantId: TENANT,
  bodyDigest: crashSignedForDigest['x-agent-ia-content-sha256'],
  leaseExpiresAt: crashBundle.expiresAt,
  nowMs: Date.now(),
})
assert.equal(reserved.state, 'reserved-new')

const crashServer = await startServer(stateDir)
let crashResponse
try {
  const signed = await auth.createSignedWorkerRequest(SECRET, TENANT, crashBody)
  crashResponse = await requestLoopback(crashServer.port, signed, crashBody)
  assert.equal(crashResponse.status, 409, `${crashResponse.status} ${crashResponse.body} ${crashServer.getOutput()}`)
  await auth.verifySignedWorkerResponse(
    SECRET,
    TENANT,
    signed['x-agent-ia-nonce'],
    crashResponse.status,
    signedResponseHeadersFromNode(crashResponse.headers),
    crashResponse.body,
    Date.now(),
  )
} finally {
  await stopServer(crashServer.server)
}
assert.ok(crashResponse.body.includes('WORKER_SERVER_UNCERTAIN_EXECUTION'))

await assert.rejects(
  () => storeBeforeCrash.reserve({
    bundleId: crashBundle.bundleId,
    tenantId: TENANT,
    bodyDigest: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    leaseExpiresAt: crashBundle.expiresAt,
    nowMs: Date.now(),
  }),
  /WORKER_STORE_BUNDLE_CONFLICT/,
)

const corruptBundle = buildBundle('اختبر رفض سجل تخزين تالف', `durable-corrupt-${Date.now()}`)
const corruptBody = protocol.exportWorkerBundle(corruptBundle)
const corruptSigned = await auth.createSignedWorkerRequest(SECRET, TENANT, corruptBody)
const beforeFiles = new Set(await readdir(stateDir))
await storeBeforeCrash.reserve({
  bundleId: corruptBundle.bundleId,
  tenantId: TENANT,
  bodyDigest: corruptSigned['x-agent-ia-content-sha256'],
  leaseExpiresAt: corruptBundle.expiresAt,
  nowMs: Date.now(),
})
const afterFiles = (await readdir(stateDir)).filter((name) => name.endsWith('.json'))
const corruptName = afterFiles.find((name) => !beforeFiles.has(name))
assert.ok(corruptName)
await writeFile(join(stateDir, corruptName), '{broken-json', { encoding: 'utf8', mode: 0o600 })
const storeAfterCorruption = await durable.createFilesystemWorkerExecutionStore(stateDir)
await assert.rejects(
  () => storeAfterCorruption.reserve({
    bundleId: corruptBundle.bundleId,
    tenantId: TENANT,
    bodyDigest: corruptSigned['x-agent-ia-content-sha256'],
    leaseExpiresAt: corruptBundle.expiresAt,
    nowMs: Date.now(),
  }),
  /WORKER_STORE_RECORD_CORRUPT/,
)

console.log('Phase 9D crash-safe durable worker smoke: PASS')
console.log('Completed Receipt survives full Node server restart: PASS')
console.log('Same Bundle after restart returns identical Run ID: PASS')
console.log('Reserved-without-Receipt after crash: fail-closed, no automatic re-execution')
console.log('Bundle digest conflict: rejected')
console.log('Corrupt durable record: rejected fail-closed')
console.log('State record file mode: 0600')
console.log('Pairing secret is not persisted in worker state')
console.log('External network/tools: none')
console.log('Mandatory additional spend: 0 USD')