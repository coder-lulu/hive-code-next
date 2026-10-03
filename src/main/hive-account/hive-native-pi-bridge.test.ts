import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { startHiveNativePiBridge } from './hive-native-pi-bridge'
import type { HiveRuntimeCloudAuthorization } from './hive-account-publication'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).toReversed()) {
    await close()
  }
})
async function fixture(holdStream = false) {
  const requests: { authorization?: string; body: string; path?: string }[] = []
  const stream =
    'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"read","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n'
  const cloud = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) {
      body += chunk
    }
    requests.push({ authorization: request.headers.authorization, body, path: request.url })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (holdStream) {
      response.write(stream.split('data: [DONE]')[0])
    } else {
      response.end(stream)
    }
  })
  cloud.listen(0, '127.0.0.1')
  await once(cloud, 'listening')
  cleanups.push(async () => {
    cloud.closeAllConnections()
    await new Promise<void>((accept) => cloud.close(() => accept()))
  })
  const address = cloud.address()
  if (!address || typeof address === 'string') {
    throw new Error('No mock Cloud')
  }
  await mkdir(resolve('logs/native-pi/bridge-tests'), { recursive: true })
  const directory = await mkdtemp(resolve('logs/native-pi/bridge-tests/account-'))
  let auth: HiveRuntimeCloudAuthorization | null = {
    accessToken: 'cloud-private',
    accountId: 'account-a',
    authorityId: 'authority-a',
    sessionExpiresAt: Date.now() + 3600000,
    sessionGeneration: 1
  }
  let listener: (value: HiveRuntimeCloudAuthorization | null) => void = () => {}
  const readAiModels = vi.fn(async () => ({
    accountId: 'account-a',
    catalog: {
      models: [
        {
          modelId: 'model',
          contextWindow: 200000,
          maxOutputTokens: 8192,
          protocols: ['CHAT_COMPLETIONS' as const]
        }
      ],
      snapshotRevision: 'a'.repeat(64),
      asOf: new Date().toISOString(),
      scope: 'ACCOUNT' as const
    },
    selection: null
  }))
  const bridge = await startHiveNativePiBridge({
    userDataPath: directory,
    resourcesDirectory: directory,
    cloudOrigin: () => `http://127.0.0.1:${address.port}`,
    fetch,
    account: {
      getRuntimeCloudAuthorization: () => auth,
      subscribeRuntimeCloudAuthorization: (callback) => {
        listener = callback
        return () => {}
      },
      readAiModels
    }
  })
  cleanups.push(() => bridge.close())
  const metadata = JSON.parse(await readFile(join(directory, 'hive-native/bridge.json'), 'utf8'))
  const launch = async () =>
    fetch(`${metadata.baseUrl}/launch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${metadata.token}` }
    })
  const call = (token: string, path = '/v1/chat/completions', init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return fetch(`${metadata.baseUrl}${path}`, {
      method: 'POST',
      ...init,
      headers
    })
  }
  return {
    requests,
    stream,
    metadata,
    launch,
    call,
    readAiModels,
    changeAuth: (next: HiveRuntimeCloudAuthorization | null) => {
      auth = next
      listener(auth)
    },
    getAuth: () => auth
  }
}
describe('native Pi bridge authority and wire protocol', () => {
  it('forwards long-context payloads above 1 MiB but bounds authenticated requests at 16 MiB', async () => {
    const f = await fixture()
    const launch = await (await f.launch()).json()
    const body = JSON.stringify({
      model: 'model',
      messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }]
    })
    const accepted = await f.call(launch.token, '/v1/chat/completions', { body })
    expect(accepted.status).toBe(200)
    await accepted.text()
    expect(f.requests[0].body).toBe(body)
    const rejected = await f.call(launch.token, '/v1/chat/completions', {
      body: 'x'.repeat(16 * 1024 * 1024 + 1)
    })
    expect(rejected.status).toBe(413)
    await rejected.text()
    expect(f.requests).toHaveLength(1)
  })
  it('forwards native tool JSON and SSE without translation and keeps Cloud token out of launch', async () => {
    const f = await fixture()
    const launch = await (await f.launch()).json()
    expect(JSON.stringify(launch)).not.toContain('cloud-private')
    const body = JSON.stringify({
      model: 'model',
      messages: [{ role: 'tool', tool_call_id: 'x', content: 'file result' }],
      tools: [{ type: 'function', function: { name: 'read' } }],
      stream: true
    })
    const result = await f.call(launch.token, '/v1/chat/completions', { body })
    expect(await result.text()).toBe(f.stream)
    expect(f.requests).toEqual([
      {
        authorization: 'Bearer cloud-private',
        body,
        path: '/hive/v1/ai/native/v1/chat/completions'
      }
    ])
    expect((await f.call(launch.token, '/v1/responses', { body: '{"input":[]}' })).status).toBe(200)
  })
  it('rejects browser origins, forged host, bootstrap inference and unsupported routes', async () => {
    const f = await fixture()
    const launch = await (await f.launch()).json()
    const browserHeaders: HeadersInit[] = [
      { Origin: 'https://evil.example' },
      { 'Sec-Fetch-Site': 'same-origin' }
    ]
    for (const headers of browserHeaders) {
      expect((await f.call(launch.token, '/v1/chat/completions', { headers })).status).toBe(403)
    }
    const forgedHostStatus = await new Promise<number | undefined>((accept, reject) => {
      const outgoing = request(
        `${f.metadata.baseUrl}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { Host: 'evil.example', Authorization: `Bearer ${launch.token}` }
        },
        (incoming) => {
          incoming.resume()
          accept(incoming.statusCode)
        }
      )
      outgoing.on('error', reject)
      outgoing.end()
    })
    expect(forgedHostStatus).toBe(403)
    expect((await f.call(f.metadata.token)).status).toBe(401)
    expect((await f.call('invalid')).status).toBe(401)
    expect((await f.call(launch.token, '/admin')).status).toBe(404)
    expect(f.requests).toHaveLength(0)
  })
  it('uses refreshed token but revokes lease after logout or authority change', async () => {
    const f = await fixture()
    const launch = await (await f.launch()).json()
    f.changeAuth({ ...f.getAuth()!, accessToken: 'refreshed' })
    expect((await f.call(launch.token, '/v1/responses', { body: '{}' })).status).toBe(200)
    expect(f.requests[0].authorization).toBe('Bearer refreshed')
    f.changeAuth({ ...f.getAuth()!, authorityId: 'different' })
    expect((await f.call(launch.token, '/lease', { method: 'GET' })).status).toBe(401)
    const second = await (await f.launch()).json()
    expect(second.agentDirectory).not.toBe(launch.agentDirectory)
    f.changeAuth(null)
    expect((await f.call(second.token)).status).toBe(401)
    expect((await f.launch()).status).toBe(401)
  })
  it('aborts an already streaming response when authority is revoked', async () => {
    const f = await fixture(true)
    const launch = await (await f.launch()).json()
    const response = await f.call(launch.token, '/v1/chat/completions', { body: '{}' })
    const reader = response.body!.getReader()
    expect((await reader.read()).done).toBe(false)
    f.changeAuth(null)
    await expect(reader.read()).rejects.toThrow()
  })
  it('expires abandoned leases and refreshes active CLI heartbeat', async () => {
    const f = await fixture()
    const launch = await (await f.launch()).json()
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now')
    clock.mockReturnValue(now + 15000)
    expect((await f.call(launch.token, '/lease', { method: 'GET' })).status).toBe(200)
    clock.mockReturnValue(now + 25000)
    expect((await f.call(launch.token, '/lease', { method: 'GET' })).status).toBe(200)
    clock.mockReturnValue(now + 46000)
    expect((await f.call(launch.token, '/lease', { method: 'GET' })).status).toBe(401)
  })
  it('releases lease explicitly and rejects a catalog returned across logout', async () => {
    const f = await fixture()
    const launch = await (await f.launch()).json()
    expect((await f.call(launch.token, '/lease', { method: 'DELETE' })).status).toBe(200)
    expect((await f.call(launch.token)).status).toBe(401)
    f.readAiModels.mockImplementationOnce(async () => {
      f.changeAuth(null)
      return {
        accountId: 'account-a',
        catalog: {
          models: [],
          snapshotRevision: 'a'.repeat(64),
          asOf: new Date().toISOString(),
          scope: 'ACCOUNT'
        },
        selection: null
      }
    })
    expect((await f.launch()).status).toBe(401)
  })
})
