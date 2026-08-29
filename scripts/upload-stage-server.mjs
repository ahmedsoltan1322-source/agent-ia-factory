import http from 'node:http'
import process from 'node:process'
import { createUploadStageServerState, handleUploadStageServerRequest } from '../src/core/browserUploadStageServerCore.ts'
import { createFilesystemBrowserUploadStageStore } from '../src/core/browserUploadStageStore.ts'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 8790
const MAX_HEADER_COUNT = 48
const MAX_BODY_BYTES = 64_000

function env(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`UPLOAD_STAGE_SERVER_ENV_REQUIRED:${name}`)
  return value
}
function parsePort(raw) {
  if (!raw) return DEFAULT_PORT
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('UPLOAD_STAGE_SERVER_PORT_INVALID')
  return port
}
function normalizedHeaders(req) {
  if (req.rawHeaders.length / 2 > MAX_HEADER_COUNT) throw new Error('UPLOAD_STAGE_SERVER_HEADER_LIMIT')
  const headers = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) throw new Error('UPLOAD_STAGE_SERVER_MULTI_HEADER_FORBIDDEN')
    headers[key.toLowerCase()] = String(value)
  }
  return headers
}
async function readBody(req) {
  let total = 0
  const chunks = []
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.length
    if (total > MAX_BODY_BYTES) throw new Error('UPLOAD_STAGE_SERVER_BODY_LIMIT')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const config = {
  tenantId: process.env.AGENT_IA_TENANT_ID?.trim() || 'local-owner',
  secret: env('AGENT_IA_WORKER_SECRET_B64URL'),
  allowedOrigin: env('AGENT_IA_ALLOWED_ORIGIN'),
  maxRequestsPerMinute: process.env.AGENT_IA_UPLOAD_MAX_REQUESTS_PER_MINUTE ? Number(process.env.AGENT_IA_UPLOAD_MAX_REQUESTS_PER_MINUTE) : undefined,
}
const store = await createFilesystemBrowserUploadStageStore(env('AGENT_IA_UPLOAD_STAGE_DIR'))
const state = createUploadStageServerState()
const port = parsePort(process.env.AGENT_IA_UPLOAD_STAGE_PORT)

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', `http://${HOST}:${port}`)
    const headers = normalizedHeaders(req)
    const origin = headers.origin ?? ''
    const body = method === 'POST' ? await readBody(req) : ''
    const response = await handleUploadStageServerRequest(config, state, { method, path: url.pathname, origin, headers, body }, store, Date.now())
    res.writeHead(response.status, response.headers)
    res.end(response.body)
    console.log(`upload-stage status=${response.status} method=${method} path=${url.pathname}`)
  } catch (error) {
    const code = error instanceof Error ? error.message.split(':')[0] : 'UPLOAD_STAGE_SERVER_INTERNAL_ERROR'
    res.writeHead(code === 'UPLOAD_STAGE_SERVER_BODY_LIMIT' ? 413 : 400, { 'cache-control': 'no-store', 'content-type': 'application/json;charset=utf-8', 'x-content-type-options': 'nosniff' })
    res.end(JSON.stringify({ error: code }))
    console.log(`upload-stage status=${code === 'UPLOAD_STAGE_SERVER_BODY_LIMIT' ? 413 : 400} method=${req.method ?? 'GET'} path=rejected`)
  }
})
server.requestTimeout = 30_000
server.headersTimeout = 10_000
server.keepAliveTimeout = 5_000
server.maxHeadersCount = MAX_HEADER_COUNT
server.listen(port, HOST, () => {
  console.log(`Agent IA Upload Stage Server listening on http://${HOST}:${port}`)
  console.log('Remote exposure requires trusted HTTPS reverse proxy; direct public HTTP is unsupported.')
  console.log('File contents are never written to logs.')
})
function shutdown(signal) {
  console.log(`Upload stage shutdown requested: ${signal}`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
