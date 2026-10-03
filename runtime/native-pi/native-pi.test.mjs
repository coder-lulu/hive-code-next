import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import hiveProvider, { readHiveProvider } from './hive-provider.mjs'
import {
  shouldCompact,
  DEFAULT_COMPACTION_SETTINGS
} from './node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js'

test('native Pi uses each registered window for compaction when switching model sizes', () => {
  const provider = readHiveProvider({
    HIVECODE_AI_BASE_URL: 'http://127.0.0.1:123/v1',
    HIVECODE_AI_LOCAL_TOKEN: 'fixture',
    HIVECODE_AI_MODELS: JSON.stringify([
      { id: 'large', api: 'openai-responses', contextWindow: 200000, maxTokens: 32000 },
      { id: 'small', api: 'openai-completions', contextWindow: 64000, maxTokens: 8000 }
    ])
  })
  assert.equal(
    shouldCompact(50000, provider.models[0].contextWindow, DEFAULT_COMPACTION_SETTINGS),
    false
  )
  assert.equal(
    shouldCompact(50000, provider.models[1].contextWindow, DEFAULT_COMPACTION_SETTINGS),
    true
  )
  assert.equal(provider.models[0].maxTokens, 32000)
  assert.throws(
    () =>
      readHiveProvider({
        HIVECODE_AI_BASE_URL: 'http://127.0.0.1:123/v1',
        HIVECODE_AI_LOCAL_TOKEN: 'fixture',
        HIVECODE_AI_MODELS: JSON.stringify([
          { id: 'bad', api: 'openai-completions', contextWindow: 8000, maxTokens: 8000 }
        ])
      }),
    /Invalid HiveCode AI model catalog/
  )
})

const models = JSON.stringify([
  { id: 'fixture-model', api: 'openai-completions', contextWindow: 32768, maxTokens: 4096 }
])
test('inherited preload leaves helper entrypoints and workers untouched', () => {
  const preload = new URL('./launcher.mjs', import.meta.url).href
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      preload,
      '--input-type=module',
      '-e',
      `import { Worker } from 'node:worker_threads';
     const worker = new Worker('import { parentPort } from "node:worker_threads"; parentPort.postMessage(process.argv.slice(2))', { eval: true, type: 'module' });
     worker.on('message', (args) => console.log(JSON.stringify(args)));`
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      env: {
        ...process.env,
        HIVECODE_AI_MODELS: 'invalid-unused-catalog'
      }
    }
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), '[]')
})

test('managed runtime refuses standalone upstream updates', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      new URL('./launcher.mjs', import.meta.url).href,
      fileURLToPath(
        new URL('./node_modules/@earendil-works/pi-coding-agent/dist/cli.js', import.meta.url)
      ),
      'update'
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    }
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /runtime is managed by HiveCode/)
  assert.doesNotMatch(result.stderr, /pi\.dev|npm install/)
})

test('native extension presents the Hive header only in interactive sessions', () => {
  const previous = { ...process.env }
  Object.assign(process.env, {
    HIVECODE_AI_BASE_URL: 'http://127.0.0.1:123/v1',
    HIVECODE_AI_LOCAL_TOKEN: 'fixture',
    HIVECODE_AI_MODELS: models
  })
  try {
    let start
    hiveProvider({
      registerProvider() {},
      on(event, handler) {
        if (event === 'session_start') {
          start = handler
        }
      }
    })
    let header
    start(
      {},
      {
        hasUI: true,
        ui: {
          setHeader(factory) {
            header = factory()
          }
        }
      }
    )
    const lines = header.render(40).join('\n')
    assert.match(lines, /HiveCode AI/)
    assert.doesNotMatch(lines, /pi\.dev|Pi can explain|pi update/)
    start(
      {},
      {
        hasUI: false,
        ui: {
          setHeader() {
            assert.fail('RPC has no header')
          }
        }
      }
    )
  } finally {
    for (const name of ['HIVECODE_AI_BASE_URL', 'HIVECODE_AI_LOCAL_TOKEN', 'HIVECODE_AI_MODELS']) {
      if (previous[name] === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = previous[name]
      }
    }
  }
})

test('provider rejects non-loopback endpoints and missing authentication', () => {
  assert.throws(() => readHiveProvider({ HIVECODE_AI_BASE_URL: 'https://example.com/v1' }))
  assert.throws(() => readHiveProvider({ HIVECODE_AI_BASE_URL: 'http://127.0.0.1:123/v1' }))
  const provider = readHiveProvider({
    HIVECODE_AI_BASE_URL: 'http://127.0.0.1:123/v1',
    HIVECODE_AI_LOCAL_TOKEN: 'test',
    HIVECODE_AI_MODELS: models
  })
  assert.equal(provider.models[0].api, 'openai-completions')
})

test(
  'official Pi CLI executes a native read tool and continues the model turn',
  { timeout: 60000 },
  async () => {
    const root = resolve(
      fileURLToPath(new URL('../../logs/native-pi/tool-fixture', import.meta.url))
    )
    await mkdir(root, { recursive: true })
    await writeFile(resolve(root, 'sample.txt'), 'native-tools-preserved')
    const requests = []
    const server = createServer(async (request, response) => {
      let data = ''
      for await (const chunk of request) {
        data += chunk
      }
      const body = JSON.parse(data)
      requests.push(body)
      assert.equal(request.headers.authorization, 'Bearer local-fixture')
      const delta =
        requests.length === 1
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'read_fixture',
                  type: 'function',
                  function: {
                    name: 'read',
                    arguments: JSON.stringify({ path: resolve(root, 'sample.txt') })
                  }
                }
              ]
            }
          : { role: 'assistant', content: 'Native round trip complete' }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`
      )
    })
    await new Promise((accept) => server.listen(0, '127.0.0.1', accept))
    try {
      const child = spawn(
        process.execPath,
        [
          '--import',
          new URL('./launcher.mjs', import.meta.url).href,
          fileURLToPath(
            new URL('./node_modules/@earendil-works/pi-coding-agent/dist/cli.js', import.meta.url)
          ),
          '--offline',
          '--model',
          'fixture-model',
          '--print',
          '--mode',
          'json',
          '--no-session',
          '--tools',
          'read',
          'Read sample.txt'
        ],
        {
          cwd: root,
          windowsHide: true,
          env: {
            ...process.env,
            PI_CODING_AGENT_DIR: resolve(root, 'agent'),
            HIVECODE_AI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
            HIVECODE_AI_LOCAL_TOKEN: 'local-fixture',
            HIVECODE_AI_MODELS: models
          }
        }
      )
      child.stdin.end()
      let output = ''
      child.stdout.on('data', (chunk) => {
        output += chunk
      })
      child.stderr.on('data', (chunk) => {
        output += chunk
      })
      const timer = setTimeout(() => child.kill(), 45000)
      const exitCode = await new Promise((accept) => child.on('close', accept))
      clearTimeout(timer)
      assert.equal(exitCode, 0, output)
      assert.equal(requests.length, 2, output)
      assert.ok(requests[0].tools.some((tool) => tool.function.name === 'read'))
      assert.ok(
        requests[1].messages.some(
          (message) =>
            message.role === 'tool' &&
            JSON.stringify(message.content).includes('native-tools-preserved')
        )
      )
      assert.match(output, /Native round trip complete/)
    } finally {
      server.closeAllConnections()
      await new Promise((accept) => server.close(accept))
    }
  }
)
