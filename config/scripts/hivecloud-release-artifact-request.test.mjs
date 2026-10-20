import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { runProcess } from '@orca/process-host'

const root = resolve(import.meta.dirname, '../../logs/release-artifact-request')
mkdirSync(root, { recursive: true })
const fixture = mkdtempSync(join(root, 'tls-'))
const certificate = join(fixture, 'localhost.pem')
const key = join(fixture, 'localhost.key')
const openssl =
  process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/usr/bin/openssl.exe')
    : 'openssl'

beforeAll(async () => {
  const result = await runProcess({
    program: openssl,
    args: [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      certificate,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
      '-addext',
      'basicConstraints=critical,CA:TRUE'
    ]
  })
  expect(result.code, result.stderr).toBe(0)
})

afterAll(() => rmSync(fixture, { recursive: true, force: true }))

// The child trusts only our generated local certificate in addition to Node's
// normal roots. Production transport has no TLS override or HTTP test switch.
const harness = String.raw`
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, openAsBlob, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
const [scenario, fixture, helper] = process.argv.slice(1)
const { artifactRequest } = await import(pathToFileURL(helper))
let calls = 0
let received = 0
let requestEnded = false
let sourceCancelled = false
let handler
const sockets = new Set()
const server = createServer({
  key: readFileSync(join(fixture, 'localhost.key')),
  cert: readFileSync(join(fixture, 'localhost.pem'))
}, (req, res) => {
  calls++
  req.on('error', () => {})
  res.on('error', () => {})
  handler(req, res)
})
server.on('connection', socket => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const url = 'https://localhost:' + server.address().port + '/artifact'
const options = (body = '{}', milliseconds = 2000) => ({
  method: 'POST', headers: { authorization: 'Bearer never-expose-this' },
  body, signal: AbortSignal.timeout(milliseconds)
})
const consume = (req, res, wait = 0) => {
  req.on('data', chunk => { received += chunk.length })
  req.on('end', () => {
    requestEnded = true
    setTimeout(() => res.end('{"ok":true}'), wait)
  })
}
class SlowBlob extends Blob {
  stream() {
    let count = 0
    return new ReadableStream({
      async pull(controller) {
        await delay(15)
        if (sourceCancelled) return
        if (scenario === 'source-error' && count++ === 1) {
          controller.error(new Error('secret-source-details'))
          return
        }
        controller.enqueue(new Uint8Array(1024))
      },
      cancel() { sourceCancelled = true }
    })
  }
}
try {
  if (scenario === 'exact-file') {
    const bytes = Buffer.alloc(1024 * 1024 + 7, 113)
    const path = join(fixture, 'artifact.bin')
    writeFileSync(path, bytes)
    let observedHash
    handler = (req, res) => {
      assert.equal(req.headers['content-length'], String(bytes.length))
      assert.equal(req.headers['accept-encoding'], 'identity')
      const hash = createHash('sha256')
      req.on('data', chunk => { received += chunk.length; hash.update(chunk) })
      req.on('end', () => { observedHash = hash.digest('hex'); res.end('{}') })
    }
    const response = await artifactRequest(url, options(await openAsBlob(path)))
    assert.equal(await response.text(), '{}')
    assert.equal(received, bytes.length)
    assert.equal(observedHash, createHash('sha256').update(bytes).digest('hex'))
  } else if (scenario === 'delayed-headers') {
    handler = (req, res) => consume(req, res, 5500)
    const started = Date.now()
    const response = await artifactRequest(url, options('{}', 9000))
    assert.equal(await response.text(), '{"ok":true}')
    assert.ok(Date.now() - started >= 5400)
    assert.ok(requestEnded)
  } else if (scenario === 'headers-deadline') {
    handler = (req, res) => consume(req, res, 500)
    await assert.rejects(artifactRequest(url, options('{}', 100)), /\(ABORTED\)/)
    assert.ok(requestEnded)
  } else if (scenario === 'abort-prestart') {
    const controller = new AbortController()
    controller.abort(new Error('secret-abort-reason'))
    await assert.rejects(artifactRequest(url, { ...options(), signal: controller.signal }), /\(ABORTED\)/)
    assert.equal(calls, 0)
  } else if (scenario === 'abort-response') {
    handler = (req, res) => {
      req.resume()
      req.on('end', () => { res.writeHead(200); res.write('partial') })
    }
    const response = await artifactRequest(url, options('{}', 150))
    await assert.rejects(response.text(), /\(ABORTED\)/)
  } else if (scenario === 'abort-upload' || scenario === 'early-success') {
    handler = (req, res) => {
      req.resume()
      if (scenario === 'early-success') {
        req.once('data', () => { res.writeHead(200); res.end('{}') })
      }
    }
    await assert.rejects(
      artifactRequest(url, options(new SlowBlob([Buffer.alloc(1024 * 1024)]), 150)),
      scenario === 'early-success' ? /\((ABORTED|NETWORK|SOURCE)\)/ : /\(ABORTED\)/
    )
    await delay(50)
    assert.ok(sourceCancelled)
  } else if (scenario === 'early-413' || scenario === 'early-503') {
    const status = Number(scenario.slice(-3))
    handler = (req, res) => {
      req.once('data', () => { res.writeHead(status); res.end('rejected') })
    }
    const response = await artifactRequest(url, options(new SlowBlob([Buffer.alloc(1024 * 1024)])))
    assert.equal(response.status, status)
    assert.equal(await response.text(), 'rejected')
    await delay(50)
    assert.ok(sourceCancelled)
  } else if (scenario === 'source-error') {
    handler = req => req.resume()
    await assert.rejects(
      artifactRequest(url, options(new SlowBlob([Buffer.alloc(1024 * 1024)]))),
      /\(SOURCE\)/
    )
  } else if (scenario === 'redirect') {
    handler = (req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(307, { location: url + '/must-not-follow' })
        res.end()
      })
    }
    await assert.rejects(artifactRequest(url, options()), /\(REDIRECT\)/)
    assert.equal(calls, 1)
  } else if (scenario === 'bad-certificate') {
    handler = (req, res) => consume(req, res)
    await assert.rejects(
      artifactRequest(url.replace('localhost', '127.0.0.1'), options()), /\(TLS\)/
    )
    assert.equal(calls, 0)
  } else if (scenario === 'cancel-oversize') {
    handler = (req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'content-length': String(2 * 1024 * 1024) })
        res.write('first')
      })
    }
    const response = await artifactRequest(url, options())
    assert.ok(Number(response.headers.get('content-length')) > 1024 * 1024)
    await response.body.cancel()
    await delay(50)
    assert.equal(sockets.size, 0)
  } else if (scenario === 'encoding') {
    handler = (req, res) => {
      req.resume()
      req.on('end', () => { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end('bad') })
    }
    await assert.rejects(artifactRequest(url, options()), /\(CONTENT_ENCODING\)/)
  } else if (scenario.startsWith('empty-')) {
    const status = Number(scenario.slice(-3))
    handler = (req, res) => {
      req.resume()
      req.on('end', () => { res.writeHead(status); res.end() })
    }
    const response = await artifactRequest(url, options())
    assert.equal(response.status, status)
    assert.equal(await response.text(), '')
  } else if (scenario === 'url-policy') {
    await assert.rejects(artifactRequest('http://localhost/', options()), /\(INVALID_URL\)/)
    await assert.rejects(artifactRequest('https://user:password@localhost/', options()), /\(INVALID_URL\)/)
    await assert.rejects(artifactRequest(url, { body: '{}' }), /\(MISSING_DEADLINE\)/)
    await assert.rejects(artifactRequest('secret-invalid-url', options()), /\(INVALID_REQUEST\)/)
    await assert.rejects(
      artifactRequest(url, { ...options(), method: 'secret\nmethod' }), /\(INVALID_REQUEST\)/
    )
    assert.equal(calls, 0)
  } else {
    throw new Error('Unknown test')
  }
  await delay(25)
  console.log('PASS ' + scenario)
} finally {
  for (const socket of sockets) socket.destroy()
  server.close()
}
`

it.each([
  'exact-file',
  'delayed-headers',
  'headers-deadline',
  'abort-prestart',
  'abort-response',
  'abort-upload',
  'early-success',
  'early-413',
  'early-503',
  'source-error',
  'redirect',
  'bad-certificate',
  'cancel-oversize',
  'encoding',
  'empty-204',
  'empty-205',
  'empty-304',
  'url-policy'
])('uses real trusted HTTPS with bounded transport: %s', async (scenario) => {
  const result = await runProcess({
    program: process.versions.bun ? 'node' : process.execPath,
    args: [
      '--input-type=module',
      '-e',
      harness,
      scenario,
      fixture,
      resolve(import.meta.dirname, 'hivecloud-release-artifact-request.mjs')
    ],
    env: { ...process.env, NODE_EXTRA_CA_CERTS: certificate }
  })
  expect(result.code, result.stderr).toBe(0)
  expect(result.stdout).toContain(`PASS ${scenario}`)
})
