import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import net from 'node:net'

let networkAttempts = 0
const denyNetwork = () => {
  networkAttempts++
  throw new Error('fixture forbids network')
}
globalThis.fetch = denyNetwork
net.Socket.prototype.connect = denyNetwork
const runtime = createRequire(import.meta.url)(process.argv[2])
const mode = process.argv[3]
const protocol = process.argv[4] ?? 'CHAT_COMPLETIONS'
const control = new AbortController()
let calls = 0
let aborted = false
let secondReads = 0
const events = []
const input = {
  sessionId: 'ha-session:00000000-0000-4000-8000-000000000001',
  generationId: 'ha-generation:00000000-0000-4000-8000-000000000002',
  text: 'owned synthetic turn',
  history: [],
  signal: control.signal,
  modelSelection: { modelId: 'explicit-model', protocol, snapshotRevision: 'a'.repeat(64) },
  executionBinding: {
    schemaVersion: 1,
    packRevision: 'b'.repeat(64),
    profileId: 'personal',
    protocol,
    toolPolicy: 'empty',
    maxInputTokens: 16000,
    maxOutputTokens: 2000
  }
}
if (mode === 'history') {
  input.history = [
    { role: 'user', text: 'earlier question' },
    { role: 'assistant', text: 'confirmed answer' }
  ]
}
if (mode === 'adapter') {
  Object.assign(input, JSON.parse(process.argv[5]), { signal: control.signal })
}
const streamFn = (model, context, options) => {
  calls++
  assert.equal(model.id, input.modelSelection.modelId)
  assert.equal(model.api, protocol === 'RESPONSES' ? 'openai-responses' : 'openai-completions')
  assert.deepEqual(context.tools, [])
  assert.equal(context.systemPrompt, '')
  assert.deepEqual(
    context.messages.map(({ role, content }) => ({ role, text: content[0].text })),
    [...input.history, { role: 'user', text: input.text }]
  )
  assert.equal(options.apiKey, undefined)
  assert.equal(options.maxTokens, 2000)
  if (mode === 'mutate-model') {
    model.id = 'tampered'
  }
  if (mode === 'throw') {
    throw new Error('UPSTREAM_SECRET')
  }
  const stream = runtime.createAssistantMessageEventStream()
  const message = (text, stopReason = 'stop') => ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: Date.now(),
    stopReason,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  })
  const partial = message('')
  if (!mode.endsWith('-no-start')) {
    stream.push({ type: 'start', partial })
  }
  let text = [
    'empty',
    'empty-no-blocks',
    'final-only',
    'final-null-text',
    'final-missing-text',
    'final-without-terminal'
  ].includes(mode)
    ? ''
    : 'hello'
  if (mode === 'overflow') {
    text = '汉'.repeat(350000)
  }
  if (mode === 'event-limit') {
    text = 'x'
  }
  if (text) {
    stream.push({
      type:
        mode === 'thinking' || mode === 'thinking-no-start'
          ? 'thinking_delta'
          : mode === 'tool-no-start'
            ? 'toolcall_delta'
            : 'text_delta',
      contentIndex: 0,
      delta: text,
      partial: message(text)
    })
  }
  if (mode === 'event-limit') {
    for (let index = 1; index < 1000; index++) {
      stream.push({ type: 'text_delta', contentIndex: 0, delta: 'x', partial })
    }
  }
  if (mode === 'backpressure') {
    stream.push({
      type: 'text_delta',
      contentIndex: 0,
      delta: ' world',
      get partial() {
        secondReads++
        return message('hello world')
      }
    })
    text = 'hello world'
  }
  if (mode === 'cancel' || mode === 'return') {
    options.signal.addEventListener(
      'abort',
      () => {
        aborted = true
        stream.push({ type: 'error', reason: 'aborted', error: message(text, 'aborted') })
        stream.end()
      },
      { once: true }
    )
  } else {
    const final = message(
      mode === 'mismatch'
        ? 'different'
        : mode === 'empty-mismatch'
          ? ''
          : mode === 'final-only'
            ? 'final'
            : text,
      mode === 'error' ? 'error' : mode === 'length' ? 'length' : 'stop'
    )
    if (mode === 'wrong-model') {
      final.model = 'another-model'
    }
    if (mode === 'tool') {
      final.content = [{ type: 'toolCall', id: 'never-execute', name: 'poison', arguments: {} }]
    }
    if (mode === 'final-null-text') {
      final.content = [{ type: 'text', text: null }]
    }
    if (mode === 'final-missing-text') {
      final.content = [{ type: 'text' }]
    }
    if (mode === 'empty-no-blocks') {
      final.content = []
    }
    if (mode === 'final-without-terminal') {
      stream.end(final)
    } else if (mode === 'error' || mode === 'error-final-stop') {
      final.errorMessage = 'UPSTREAM_SECRET'
      stream.push({ type: 'error', reason: 'error', error: final })
    } else {
      stream.push({
        type: 'done',
        reason: mode === 'done-reason-mismatch' ? 'length' : final.stopReason,
        message: final
      })
    }
    stream.end()
  }
  return stream
}
if (mode === 'pre-cancel') {
  control.abort()
}
const iterable = runtime.runManagedTextGeneration({
  input,
  streamFn: mode === 'missing-stream' ? undefined : streamFn
})
const iterator = iterable[Symbol.asyncIterator]()
let error
try {
  while (true) {
    const next = await iterator.next()
    if (next.done) {
      break
    }
    events.push(next.value)
    if (mode === 'cancel') {
      control.abort()
    }
    if (mode === 'return') {
      await iterator.return()
      break
    }
    if (mode === 'backpressure' && events.length === 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(secondReads, 0)
    }
  }
} catch (caught) {
  error = caught.message
  assert.ok(!error.includes('UPSTREAM_SECRET'))
}
assert.equal(networkAttempts, 0)
assert.ok(calls <= 1)
process.stdout.write(
  `${JSON.stringify({
    mode,
    protocol,
    calls,
    aborted,
    networkAttempts,
    textEvents: events.filter((event) => event.type === 'text').length,
    text:
      mode === 'overflow' || mode === 'event-limit'
        ? undefined
        : events
            .filter((event) => event.type === 'text')
            .map((event) => event.text)
            .join(''),
    terminal: events.at(-1)?.type,
    sequences: mode === 'event-limit' ? undefined : events.map((event) => event.sequence),
    error,
    secondReads,
    events: mode === 'adapter' ? events : undefined
  })}\n`
)
