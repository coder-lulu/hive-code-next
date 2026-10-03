import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'
import {
  nativeHiveConsoleInput,
  nativeHiveModels,
  nativeHiveSessionArgs,
  runHiveAi
} from './hive-ai'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  spawn: vi.fn(),
  mkdir: vi.fn(),
  realpath: vi.fn(),
  fstatSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn()
}))
vi.mock('node:fs', () => ({
  fstatSync: mocks.fstatSync,
  openSync: mocks.openSync,
  closeSync: mocks.closeSync
}))
vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  mkdir: mocks.mkdir,
  realpath: mocks.realpath
}))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./runtime/metadata', () => ({ getDefaultUserDataPath: () => '/fixture' }))
const launch = {
  token: 'b'.repeat(43),
  baseUrl: 'http://127.0.0.1:43210/v1',
  runtimeDirectory: '/runtime',
  agentDirectory: '/isolated-account',
  models: [
    {
      modelId: 'm',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      protocols: ['CHAT_COMPLETIONS' as const]
    }
  ],
  selection: null
}
let originalExitCode: typeof process.exitCode
it('passes each model capability to Pi without a shared fallback', () => {
  const mapped = nativeHiveModels(
    [
      { modelId: 'large', protocols: ['RESPONSES'], contextWindow: 200000, maxOutputTokens: 32000 },
      {
        modelId: 'small',
        protocols: ['CHAT_COMPLETIONS'],
        contextWindow: 64000,
        maxOutputTokens: 8000
      },
      {
        modelId: 'unknown',
        protocols: ['CHAT_COMPLETIONS'],
        contextWindow: null,
        maxOutputTokens: null
      }
    ],
    null
  )
  expect(
    mapped.map(({ id, contextWindow, maxTokens }) => ({ id, contextWindow, maxTokens }))
  ).toEqual([
    { id: 'large', contextWindow: 200000, maxTokens: 32000 },
    { id: 'small', contextWindow: 64000, maxTokens: 8000 }
  ])
})
beforeEach(() => {
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.realpath.mockImplementation(async (path: string) => resolve(path))
  originalExitCode = process.exitCode
  vi.useFakeTimers()
  mocks.readFile.mockResolvedValue(
    JSON.stringify({ baseUrl: 'http://127.0.0.1:43210', token: 'a'.repeat(43) })
  )
})
afterEach(() => {
  process.exitCode = originalExitCode
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
it('does not preserve a selected protocol that disappeared from catalog', () => {
  expect(
    nativeHiveModels(launch.models, {
      modelId: 'm',
      protocol: 'RESPONSES',
      snapshotRevision: 'a'.repeat(64)
    })[0].api
  ).toBe('openai-completions')
})
it.each([false, true])(
  'cancels a refused launch body without masking the error (cancel rejects: %s)',
  async (rejectCancel) => {
    const cancel = vi.fn(() => {
      if (rejectCancel) {
        throw new Error('cancel failed')
      }
    })
    const response = new Response(new ReadableStream({ cancel }), { status: 403 })
    const fetcher = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetcher)

    await expect(runHiveAi([], '/project')).rejects.toThrow(
      'HiveCode AI cannot start. Check your Hive login and available models.'
    )
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.mkdir).not.toHaveBeenCalled()
  }
)

it('stops native process on revoked lease and releases the capability', async () => {
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(() => {
      child.emit('exit', 1)
      return true
    })
  })
  mocks.spawn.mockReturnValue(child)
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/launch')) {
      return Response.json(launch)
    }
    if (init?.method === 'DELETE') {
      return Response.json({})
    }
    return Response.json({}, { status: 401 })
  })
  vi.stubGlobal('fetch', fetcher)
  const result = runHiveAi(['--mode', 'rpc'], '/project')
  await vi.advanceTimersByTimeAsync(5000)
  await result
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  expect(fetcher).toHaveBeenCalledWith(
    'http://127.0.0.1:43210/lease',
    expect.objectContaining({ method: 'DELETE' })
  )
  expect(mocks.spawn).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining(['--mode', 'rpc']),
    expect.objectContaining({
      env: expect.objectContaining({
        PI_CODING_AGENT_DIR: '/isolated-account',
        HIVECODE_AI_LOCAL_TOKEN: launch.token
      })
    })
  )
  expect(vi.getTimerCount()).toBe(0)
})
it('releases a lease when starting the native process fails', async () => {
  mocks.spawn.mockImplementationOnce(() => {
    throw new Error('missing runtime')
  })
  const fetcher = vi.fn(async (url: string) => Response.json(url.endsWith('/launch') ? launch : {}))
  vi.stubGlobal('fetch', fetcher)
  await expect(runHiveAi([], '/project')).rejects.toThrow('missing runtime')
  expect(fetcher).toHaveBeenCalledWith(
    'http://127.0.0.1:43210/lease',
    expect.objectContaining({ method: 'DELETE' })
  )
})

it.each([null, { modelId: 'm', protocol: 'CHAT_COMPLETIONS', snapshotRevision: 'a'.repeat(64) }])(
  'leaves model preference and session restoration to Pi while forwarding the account default %j',
  async (selection) => {
    mocks.spawn.mockImplementationOnce(() => {
      throw new Error('captured native launch')
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(url.endsWith('/launch') ? { ...launch, selection } : {})
      )
    )
    await expect(runHiveAi(['--session', 'owned-session-id'], '/project')).rejects.toThrow(
      'captured native launch'
    )
    const [, args, options] = mocks.spawn.mock.calls[0]
    expect(args).not.toContain('--model')
    expect(args).toEqual([
      '--import',
      pathToFileURL(join(launch.runtimeDirectory, 'launcher.mjs')).href,
      join(launch.runtimeDirectory, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
      '--session-dir',
      resolve(launch.agentDirectory, 'sessions'),
      '--session',
      'owned-session-id'
    ])
    expect(options.env.HIVECODE_AI_DEFAULT_MODEL).toBe(selection?.modelId ?? '')
  }
)

it('rejects a selected model with unknown capacity without silently switching models', async () => {
  const unknown = {
    ...launch,
    models: [
      ...launch.models,
      {
        modelId: 'unknown',
        protocols: ['CHAT_COMPLETIONS'],
        contextWindow: null,
        maxOutputTokens: null
      }
    ],
    selection: {
      modelId: 'unknown',
      protocol: 'CHAT_COMPLETIONS',
      snapshotRevision: 'a'.repeat(64)
    }
  }
  const fetcher = vi.fn(async (url: string) =>
    Response.json(url.endsWith('/launch') ? unknown : {})
  )
  vi.stubGlobal('fetch', fetcher)
  await expect(runHiveAi([], '/project')).rejects.toThrow('model limits are not configured')
  expect(mocks.spawn).not.toHaveBeenCalled()
  expect(fetcher).toHaveBeenCalledWith(
    'http://127.0.0.1:43210/lease',
    expect.objectContaining({ method: 'DELETE' })
  )
})

it('respects selected chat protocol and defaults to responses when authorized', () => {
  const models = [
    {
      modelId: 'm',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      protocols: ['CHAT_COMPLETIONS' as const, 'RESPONSES' as const]
    }
  ]
  expect(nativeHiveModels(models, null)[0].api).toBe('openai-responses')
  expect(
    nativeHiveModels(models, {
      modelId: 'm',
      protocol: 'CHAT_COMPLETIONS',
      snapshotRevision: 'a'.repeat(64)
    })[0].api
  ).toBe('openai-completions')
})
it('lists authorized models without starting Pi and always releases the lease', async () => {
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  const fetcher = vi.fn(async (url: string) => Response.json(url.endsWith('/launch') ? launch : {}))
  vi.stubGlobal('fetch', fetcher)
  await runHiveAi(['--list-models'], '/project')
  expect(mocks.spawn).not.toHaveBeenCalled()
  const text = String(output.mock.calls[0][0])
  expect(JSON.parse(text).models[0].selector).toBe('hivecode/m')
  expect(text).not.toContain(launch.token)
  expect(fetcher).toHaveBeenCalledWith(
    'http://127.0.0.1:43210/lease',
    expect.objectContaining({ method: 'DELETE' })
  )
})

it('scopes resume and UUID lookup while rejecting cross-account paths and directory overrides', async () => {
  const agent = resolve('/isolated-account')
  const root = join(agent, 'sessions')
  expect(await nativeHiveSessionArgs(['--resume'], agent, '/project')).toEqual([
    '--session-dir',
    root,
    '--resume'
  ])
  expect(await nativeHiveSessionArgs(['--session', 'abcd'], agent, '/project')).toEqual([
    '--session-dir',
    root,
    '--session',
    'abcd'
  ])
  expect(
    await nativeHiveSessionArgs(['--session', join(root, 'owned.jsonl')], agent, '/project')
  ).toContain(join(root, 'owned.jsonl'))
  await expect(
    nativeHiveSessionArgs(['--session', '/other-account/session.jsonl'], agent, '/project')
  ).rejects.toThrow('outside')
  await expect(
    nativeHiveSessionArgs(['--fork', '/other-account/session.jsonl'], agent, '/project')
  ).rejects.toThrow('outside')
  await expect(
    nativeHiveSessionArgs(['--session-dir', '/other'], agent, '/project')
  ).rejects.toThrow('scoped')
  mocks.realpath.mockImplementation(async (path: string) =>
    path.endsWith('linked.jsonl') ? resolve('/other-account/secret.jsonl') : resolve(path)
  )
  await expect(
    nativeHiveSessionArgs(['--session', join(root, 'linked.jsonl')], agent, '/project')
  ).rejects.toThrow('outside')
})

it('restores Electron Windows console input without altering print or RPC pipes', () => {
  vi.stubGlobal('process', {
    ...process,
    platform: 'win32',
    versions: { ...process.versions, electron: '43.7.0' },
    stdin: { isTTY: false },
    stdout: { isTTY: true }
  })
  mocks.fstatSync.mockReturnValue({ isCharacterDevice: () => true })
  mocks.openSync.mockReturnValue(99)
  expect(nativeHiveConsoleInput(['prompt'])).toBe(99)
  expect(mocks.openSync).toHaveBeenCalledWith('\\\\.\\CONIN$', 'r+')
  for (const args of [['--print'], ['-p'], ['--mode', 'rpc'], ['--mode=json']]) {
    expect(nativeHiveConsoleInput(args)).toBeNull()
  }
  mocks.fstatSync.mockReturnValue({ isCharacterDevice: () => false })
  expect(nativeHiveConsoleInput(['prompt'])).toBeNull()
  expect(mocks.openSync).toHaveBeenCalledTimes(1)
})
