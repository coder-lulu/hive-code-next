import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { hiveModelPreferenceArgs, persistHiveModelSelection } from './model-preference.mjs'

const root = fileURLToPath(new URL('../../logs/native-pi/model-preference/', import.meta.url))

async function fixture(settings = {}) {
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(resolve(root, 'account-'))
  await writeFile(resolve(directory, 'settings.json'), JSON.stringify(settings))
  return {
    PI_CODING_AGENT_DIR: directory,
    HIVECODE_AI_MODELS: JSON.stringify([{ id: 'gpt-5.6-luna' }, { id: 'gpt-6-sol' }]),
    HIVECODE_AI_DEFAULT_MODEL: ''
  }
}

test('new launch restores Pi model choice across process settings reloads', async () => {
  const environment = await fixture({ defaultProvider: 'hivecode', defaultModel: 'gpt-6-sol' })
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(hiveModelPreferenceArgs([], environment, root), ['--model', 'gpt-6-sol'])
  }
  assert.deepEqual(hiveModelPreferenceArgs([], await fixture(), root), ['--model', 'gpt-5.6-luna'])
})

test('account selection seeds a new account but cannot override its native model preference', async () => {
  const environment = await fixture()
  environment.HIVECODE_AI_DEFAULT_MODEL = 'gpt-6-sol'
  assert.deepEqual(hiveModelPreferenceArgs([], environment, root), ['--model', 'gpt-6-sol'])
  const saved = await fixture({ defaultProvider: 'hivecode', defaultModel: 'gpt-6-sol' })
  saved.HIVECODE_AI_DEFAULT_MODEL = 'gpt-5.6-luna'
  assert.deepEqual(hiveModelPreferenceArgs([], saved, root), ['--model', 'gpt-6-sol'])
})

test('unavailable saved models fail explicitly instead of silently choosing catalog first', async () => {
  const environment = await fixture({ defaultProvider: 'hivecode', defaultModel: 'removed' })
  assert.throws(
    () => hiveModelPreferenceArgs([], environment, root),
    /Saved Hive model removed is unavailable/
  )
  assert.deepEqual(hiveModelPreferenceArgs(['--model', 'gpt-6-sol'], environment, root), [])
})

test('resume retains Pi transcript model authority instead of overriding it with defaults', async () => {
  const environment = await fixture({ defaultProvider: 'hivecode', defaultModel: 'gpt-5.6-luna' })
  for (const args of [
    ['--session', 'saved.jsonl'],
    ['--session-id', 'id'],
    ['--fork', 'saved.jsonl'],
    ['--continue'],
    ['-c'],
    ['--resume'],
    ['-r']
  ]) {
    assert.deepEqual(hiveModelPreferenceArgs(args, environment, root), [])
  }
})

test('version checks do not require login or create model preferences', () => {
  assert.deepEqual(hiveModelPreferenceArgs(['--version'], {}, root), [])
})

test('only authorized user selections persist in their own account, without changing other settings', async () => {
  const first = await fixture({ theme: 'dark', compaction: { enabled: false } })
  const second = await fixture()
  const select = (source, id = 'gpt-6-sol', provider = 'hivecode') => ({
    source,
    model: { provider, id }
  })
  await persistHiveModelSelection(select('restore'), root, first)
  await persistHiveModelSelection(select('set', 'gpt-6-sol', 'other'), root, first)
  assert.deepEqual(hiveModelPreferenceArgs([], first, root), ['--model', 'gpt-5.6-luna'])
  await assert.rejects(
    persistHiveModelSelection(select('set', 'unauthorized'), root, first),
    /unauthorized/
  )
  await assert.rejects(
    persistHiveModelSelection(select('set'), root, { ...first, PI_CODING_AGENT_DIR: '' }),
    /account-scoped/
  )
  await persistHiveModelSelection(select('cycle'), root, first)
  assert.deepEqual(hiveModelPreferenceArgs([], first, root), ['--model', 'gpt-6-sol'])
  assert.deepEqual(hiveModelPreferenceArgs([], second, root), ['--model', 'gpt-5.6-luna'])
  const settings = JSON.parse(
    await readFile(resolve(first.PI_CODING_AGENT_DIR, 'settings.json'), 'utf8')
  )
  assert.equal(settings.theme, 'dark')
  assert.deepEqual(settings.compaction, { enabled: false })
})

async function selectNativeModel(environment) {
  const child = spawn(
    process.execPath,
    [
      '--import',
      new URL('./launcher.mjs', import.meta.url).href,
      fileURLToPath(
        new URL('./node_modules/@earendil-works/pi-coding-agent/dist/cli.js', import.meta.url)
      ),
      '--offline',
      '--mode',
      'rpc',
      '--no-session'
    ],
    {
      cwd: root,
      windowsHide: true,
      env: { ...process.env, ...environment }
    }
  )
  const closed = new Promise((accept) => child.on('close', accept))
  let output = ''
  let timer
  try {
    await new Promise((accept, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Native model selection timed out: ${output}`)),
        10000
      )
      child.on('error', reject)
      child.stderr.on('data', (chunk) => {
        output += chunk
      })
      let pending = ''
      child.stdout.on('data', (chunk) => {
        pending += chunk
        const lines = pending.split('\n')
        pending = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('{')) {
            continue
          }
          const event = JSON.parse(line)
          if (event.type === 'response' && event.command === 'set_model') {
            if (event.success) {
              accept()
            } else {
              reject(new Error(JSON.stringify(event)))
            }
          }
        }
      })
      child.stdin.write(
        `${JSON.stringify({ type: 'set_model', provider: 'hivecode', modelId: 'gpt-6-sol' })}\n`
      )
    })
  } finally {
    clearTimeout(timer)
    child.kill()
    await closed
  }
}

test(
  'real native model selection persists Sol for a new process and retains its transcript model on resume',
  { timeout: 30000 },
  async () => {
    const environment = await fixture()
    const requested = []
    const server = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) {
        body += chunk
      }
      const input = JSON.parse(body)
      requested.push(input.model)
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'saved model works' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
      )
    })
    await new Promise((accept) => server.listen(0, '127.0.0.1', accept))
    const sessionDirectory = resolve(environment.PI_CODING_AGENT_DIR, 'sessions')
    await mkdir(sessionDirectory)
    const run = async (resume) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          new URL('./launcher.mjs', import.meta.url).href,
          fileURLToPath(
            new URL('./node_modules/@earendil-works/pi-coding-agent/dist/cli.js', import.meta.url)
          ),
          '--offline',
          '--print',
          '--mode',
          'json',
          '--session-dir',
          sessionDirectory,
          ...(resume ? ['--continue'] : []),
          'Reply briefly'
        ],
        {
          cwd: root,
          windowsHide: true,
          env: {
            ...process.env,
            ...environment,
            HIVECODE_AI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
            HIVECODE_AI_LOCAL_TOKEN: 'local-fixture',
            HIVECODE_AI_MODELS: JSON.stringify(
              ['gpt-5.6-luna', 'gpt-6-sol'].map((id) => ({
                id,
                api: 'openai-completions',
                contextWindow: 32768,
                maxTokens: 4096
              }))
            )
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
      const timer = setTimeout(() => child.kill(), 10000)
      const code = await new Promise((accept) => child.on('close', accept))
      clearTimeout(timer)
      assert.equal(code, 0, output)
      assert.match(output, /saved model works/)
    }
    try {
      await selectNativeModel({
        ...environment,
        HIVECODE_AI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
        HIVECODE_AI_LOCAL_TOKEN: 'local-fixture',
        HIVECODE_AI_MODELS: JSON.stringify(
          ['gpt-5.6-luna', 'gpt-6-sol'].map((id) => ({
            id,
            api: 'openai-completions',
            contextWindow: 32768,
            maxTokens: 4096
          }))
        )
      })
      assert.deepEqual(hiveModelPreferenceArgs([], environment, root), ['--model', 'gpt-6-sol'])
      await run(false)
      await writeFile(
        resolve(environment.PI_CODING_AGENT_DIR, 'settings.json'),
        JSON.stringify({ defaultProvider: 'hivecode', defaultModel: 'gpt-5.6-luna' })
      )
      await run(true)
      assert.deepEqual(requested, ['gpt-6-sol', 'gpt-6-sol'])
    } finally {
      server.closeAllConnections()
      await new Promise((accept) => server.close(accept))
    }
  }
)
