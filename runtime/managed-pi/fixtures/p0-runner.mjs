import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { syncBuiltinESMExports } from 'node:module'
import { createInterface } from 'node:readline'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Install before importing Pi so startup I/O is included in this bounded smoke.
let networkAttempts = 0
const denyNetwork = () => {
  networkAttempts++
  throw new Error('P0 fixture forbids network access')
}
globalThis.fetch = denyNetwork
net.Socket.prototype.connect = denyNetwork
http.request = denyNetwork
https.request = denyNetwork
tls.connect = denyNetwork
let externalReads = 0
const forbiddenRoots = process.argv.slice(3).map((path) => resolve(path).toLowerCase())
const checkRead = (path) => {
  if (typeof path === 'number' || path === undefined) {
    return
  }
  const value = resolve(path instanceof URL ? fileURLToPath(path) : String(path)).toLowerCase()
  if (forbiddenRoots.some((root) => value === root || value.startsWith(root + sep))) {
    externalReads++
    throw new Error('P0 fixture forbids external Pi resource reads')
  }
}
for (const api of [fs, fs.promises]) {
  for (const name of [
    'readFile',
    'readFileSync',
    'open',
    'openSync',
    'readdir',
    'readdirSync',
    'stat',
    'statSync',
    'lstat',
    'lstatSync',
    'access',
    'accessSync',
    'existsSync'
  ]) {
    const original = api[name]
    if (typeof original === 'function') {
      api[name] = function (path, ...args) {
        checkRead(path)
        return Reflect.apply(original, this, [path, ...args])
      }
    }
  }
}
syncBuiltinESMExports()

const expectedNode = JSON.parse(
  fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
).engines.node
assert.equal(process.versions.node, expectedNode)
const started = performance.now()
const { createManagedTextAgent } = await import('../agent.mjs')
const { AssistantMessageEventStream } = await import('@earendil-works/pi-ai')
const mode = process.argv[2]
assert.ok(mode === 'complete' || mode === 'cancel')
const model = {
  id: 'p0-fixture',
  name: 'P0 fixture',
  api: 'openai-responses',
  provider: 'hive-fixture',
  baseUrl: 'http://127.0.0.1:1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1024,
  maxTokens: 32
}
let calls = 0
let aborted = false
const agent = createManagedTextAgent({
  model,
  streamFn: (_model, context, options) => {
    calls++
    assert.deepEqual(context.tools, [])
    assert.equal(context.systemPrompt, '')
    assert.equal(options.apiKey, undefined)
    assert.ok(!JSON.stringify(context).includes('P0_POISON'))
    const stream = new AssistantMessageEventStream()
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'fixture' }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      timestamp: Date.now(),
      stopReason: 'stop',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      }
    }
    stream.push({ type: 'start', partial: message })
    stream.push({ type: 'text_delta', contentIndex: 0, delta: 'fixture', partial: message })
    if (mode === 'complete') {
      stream.push({ type: 'done', reason: 'stop', message })
      stream.end()
    } else {
      const abort = () => {
        aborted = true
        stream.push({
          type: 'error',
          reason: 'aborted',
          error: { ...message, stopReason: 'aborted' }
        })
        stream.end()
      }
      if (options.signal.aborted) {
        abort()
      } else {
        options.signal.addEventListener('abort', abort, { once: true })
      }
    }
    return stream
  }
})
const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  if (line === 'cancel') {
    agent.abort()
  }
})
const events = []
agent.subscribe((event) => {
  events.push(event.type)
  if (event.type === 'message_update') {
    process.stdout.write('{"type":"delta"}\n')
  }
})
try {
  await agent.prompt('P0 synthetic text')
  assert.equal(networkAttempts, 0)
  assert.equal(externalReads, 0)
  assert.equal(calls, 1)
  assert.equal(aborted, mode === 'cancel')
  assert.equal(agent.state.isStreaming, false)
  const forbidden = Object.keys(process.env).filter((key) =>
    /^(OPENAI|ANTHROPIC|AWS|GOOGLE|AZURE|COPILOT|ORCA_PI|NODE_OPTIONS|NODE_PATH|HTTP_PROXY|HTTPS_PROXY)/i.test(
      key
    )
  )
  assert.deepEqual(forbidden, [])
  assert.equal(process.env.PATH, join(process.env.HOME, 'bin'))
  process.stdout.write(
    `${JSON.stringify({
      type: 'result',
      node: process.versions.node,
      pid: process.pid,
      calls,
      aborted,
      events,
      tools: agent.state.tools.length,
      networkAttempts,
      externalReads,
      stopReason: agent.state.messages.at(-1)?.stopReason,
      elapsedMs: Math.round(performance.now() - started)
    })}\n`
  )
} finally {
  input.close()
  process.stdin.destroy()
}
