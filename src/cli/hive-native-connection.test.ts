import { afterEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { mkdir, mkdtemp, writeFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { startHiveNativeConnection, type HiveNativeLaunch } from './hive-native-connection'
import { spawnProcess } from '../shared/child-process/run-process'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).toReversed()) {
    await close()
  }
})

async function fixture(stream?: (body: string) => string) {
  const root = resolve('logs/native-pi/connection-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'connection-'))
  const metadataPath = join(directory, 'bridge.json')
  const scope = join(directory, 'account-a')
  const onRevoked = vi.fn()
  let sequence = 0
  async function broker(agentDirectory = scope) {
    const bootstrap = String(++sequence).repeat(43)
    const token = String.fromCharCode(96 + sequence).repeat(43)
    const received: string[] = []
    let auth = true
    let destroyed = false
    const server = createServer(async (request, response) => {
      const launchRequest = request.url === '/launch'
      if (
        !auth ||
        request.headers.authorization !== `Bearer ${launchRequest ? bootstrap : token}`
      ) {
        response.writeHead(401).end('{}')
        return
      }
      if (launchRequest) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(launch))
      } else if (request.url === '/lease') {
        response.end('{}')
      } else {
        let body = ''
        for await (const chunk of request) {
          body += chunk
        }
        received.push(body)
        response.setHeader('content-type', 'text/event-stream')
        response.end(stream?.(body) ?? 'data: same-session\n\n')
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('No broker address')
    }
    const metadata = { baseUrl: `http://127.0.0.1:${address.port}`, token: bootstrap }
    const launch: HiveNativeLaunch = {
      baseUrl: `${metadata.baseUrl}/v1`,
      token,
      agentDirectory,
      runtimeDirectory: directory,
      models: [],
      selection: null
    }
    await writeFile(metadataPath, JSON.stringify(metadata))
    const close = async () => {
      if (destroyed) {
        return
      }
      destroyed = true
      server.closeAllConnections()
      await new Promise<void>((accept) => server.close(() => accept()))
    }
    cleanups.push(close)
    return {
      metadata,
      launch,
      received,
      close,
      revoke: () => {
        auth = false
      }
    }
  }
  const first = await broker()
  const connection = await startHiveNativeConnection({ metadataPath, ...first, onRevoked })
  cleanups.push(() => connection.close())
  const request = (text: string, path = '/chat/completions', extraHeaders = {}) =>
    fetch(`${connection.baseUrl}${path}`, {
      method: 'POST',
      body: text,
      headers: { Authorization: `Bearer ${first.launch.token}`, ...extraHeaders }
    })
  return { first, broker, onRevoked, request, connection, scope }
}

it('keeps the native endpoint across desktop downtime and rebinds without replaying a turn', async () => {
  const f = await fixture()
  expect(await (await f.request('first-turn')).text()).toContain('same-session')
  await f.first.close()
  const unavailable = await f.request('interrupted-turn')
  expect(unavailable.status).toBe(503)
  expect(f.onRevoked).not.toHaveBeenCalled()
  const replacement = await f.broker()
  expect(await (await f.request('next-turn')).text()).toContain('same-session')
  expect(f.first.received).toEqual(['first-turn'])
  expect(replacement.received).toEqual(['next-turn'])
  expect(f.onRevoked).not.toHaveBeenCalled()
})

it('terminates on explicit authorization revocation and never renews that session', async () => {
  const f = await fixture()
  f.first.revoke()
  expect((await f.request('denied')).status).toBe(401)
  expect(f.onRevoked).toHaveBeenCalledTimes(1)
  await f.broker()
  expect((await f.request('still-denied')).status).toBe(401)
  expect(f.onRevoked).toHaveBeenCalledTimes(1)
})

it('refuses restart under a different account or authority without forwarding chat', async () => {
  const f = await fixture()
  await f.first.close()
  const replacement = await f.broker(`${f.scope}-different-authority`)
  expect((await f.request('private-history')).status).toBe(401)
  expect(replacement.received).toEqual([])
  expect(f.onRevoked).toHaveBeenCalledTimes(1)
})

it('shares one lease refresh across simultaneous inference requests after restart', async () => {
  const f = await fixture()
  await f.first.close()
  const replacement = await f.broker()
  const responses = await Promise.all(['one', 'two'].map((text) => f.request(text)))
  expect(responses.map((response) => response.status)).toEqual([200, 200])
  expect(replacement.received.sort()).toEqual(['one', 'two'])
  expect(f.onRevoked).not.toHaveBeenCalled()
})

it('accepts a new same-account broker after the previous broker has invalidated its leases', async () => {
  const f = await fixture()
  f.first.revoke()
  const replacement = await f.broker()
  expect((await f.request('continued')).status).toBe(200)
  expect(replacement.received).toEqual(['continued'])
  expect(f.onRevoked).not.toHaveBeenCalled()
})

it('rejects browser-origin traffic, wrong capabilities and non-inference routes', async () => {
  const f = await fixture()
  expect((await f.request('x', '/responses', { Origin: 'https://evil.test' })).status).toBe(401)
  expect((await f.request('x', '/responses', { Authorization: 'Bearer wrong' })).status).toBe(401)
  expect((await f.request('x', '/launch')).status).toBe(404)
  expect(f.first.received).toEqual([])
})

it('the real native Pi retains its PID, session, tool result and history across broker restart', async () => {
  const bodies: { messages: { role: string; content: unknown }[] }[] = []
  const f = await fixture((body) => {
    const parsed = JSON.parse(body)
    bodies.push(parsed)
    const delta =
      bodies.length === 1
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'read_fixture',
                type: 'function',
                function: {
                  name: 'read',
                  arguments: JSON.stringify({ path: join(f.scope, 'sample.txt') })
                }
              }
            ]
          }
        : { role: 'assistant', content: 'P5_CONTINUITY_OK' }
    return `data: ${JSON.stringify({
      id: 'fixture',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'fixture-model',
      choices: [{ index: 0, delta, finish_reason: bodies.length === 1 ? 'tool_calls' : 'stop' }]
    })}\n\ndata: [DONE]\n\n`
  })
  await mkdir(f.scope, { recursive: true })
  await writeFile(join(f.scope, 'sample.txt'), 'NATIVE_TOOL_HISTORY_PRESERVED')
  const sessions = join(f.scope, 'sessions')
  const child = spawnProcess({
    program: process.execPath,
    args: [
      '--import',
      pathToFileURL(resolve('runtime/native-pi/launcher.mjs')).href,
      resolve('runtime/native-pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
      '--offline',
      '--mode',
      'rpc',
      '--model',
      'fixture-model',
      '--session-dir',
      sessions,
      '--tools',
      'read'
    ],
    cwd: f.scope,
    stdio: 'pipe',
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: f.scope,
      HIVECODE_AI_BASE_URL: f.connection.baseUrl,
      HIVECODE_AI_LOCAL_TOKEN: f.first.launch.token,
      HIVECODE_AI_MODELS: JSON.stringify([
        { id: 'fixture-model', api: 'openai-completions', contextWindow: 32768, maxTokens: 4096 }
      ])
    }
  })
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
  })
  let output = ''
  let pending = ''
  let turnEnded: (() => void) | undefined
  child.stderr?.on('data', (chunk) => {
    output += chunk
  })
  child.stdout?.on('data', (chunk) => {
    output += chunk
    pending += chunk
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      try {
        if (JSON.parse(line).type === 'agent_end') {
          turnEnded?.()
        }
      } catch {
        /* Pi diagnostics */
      }
    }
  })
  const turn = async (message: string) => {
    await new Promise<void>((accept, reject) => {
      const timer = setTimeout(() => reject(new Error(`Native turn timed out: ${output}`)), 20000)
      turnEnded = () => {
        clearTimeout(timer)
        accept()
      }
      child.stdin?.write(`${JSON.stringify({ type: 'prompt', message })}\n`)
    })
  }
  const pid = child.pid
  await turn('Read sample.txt')
  const before = await readdir(sessions)
  expect(bodies).toHaveLength(2)
  expect(JSON.stringify(bodies[1].messages)).toContain('NATIVE_TOOL_HISTORY_PRESERVED')
  await f.first.close()
  expect((await f.request('probe-only')).status).toBe(503)
  expect(child.exitCode).toBeNull()
  const replacement = await f.broker()
  await turn('Continue the same conversation')
  expect(child.pid).toBe(pid)
  expect(child.exitCode).toBeNull()
  expect(await readdir(sessions)).toEqual(before)
  expect(before.filter((file) => file.endsWith('.jsonl'))).toHaveLength(1)
  expect(replacement.received).toHaveLength(1)
  expect(JSON.stringify(bodies[2].messages)).toContain('NATIVE_TOOL_HISTORY_PRESERVED')
  expect(JSON.stringify(bodies[2].messages)).toContain('Read sample.txt')
  expect(output).toContain('P5_CONTINUITY_OK')
  expect(f.onRevoked).not.toHaveBeenCalled()
}, 45000)
