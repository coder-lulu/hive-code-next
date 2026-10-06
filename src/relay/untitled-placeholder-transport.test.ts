import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { FsHandler } from './fs-handler'
import { RelayContext } from './context'
import { RelayDispatcher, type MethodHandler, type RequestContext } from './dispatcher'
import { encodeJsonRpcFrame } from './protocol'
import {
  UntitledPlaceholderRetentionUnavailableError,
  type UntitledPlaceholderRetentionHost
} from '../shared/untitled-placeholder-retention-types'
import { SshFilesystemProvider } from '../main/providers/ssh-filesystem-provider'
import type { SshChannelMultiplexer } from '../main/ssh/ssh-channel-multiplexer'
import {
  resolveUntitledPlaceholderRetentionRoot,
  UntitledPlaceholderRecoveryLocationUnavailableError
} from '../shared/untitled-placeholder-recovery-directory'
import { runProcess } from '../shared/child-process/run-process'
import type * as RetentionModule from '../shared/untitled-placeholder-retention'

const factory = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../shared/untitled-placeholder-retention', async (importOriginal) => ({
  ...(await importOriginal<typeof RetentionModule>()),
  createUntitledPlaceholderRetentionHost: factory.create
}))

const recovery = {
  id: 'retention-1',
  originalPath: '/host/Untitled.md',
  retainedPath: '/host/private/payload',
  manifestPath: '/host/private.jsonl',
  restoredToOriginalPath: false
}
const params = { filePath: '/host/Untitled.md', ownerKey: 'editor-7' }
const ownedRoot = resolve('logs/final-repair-8/untitled-placeholder-transport/owned-fixtures')
const directories: string[] = []
const handlers: FsHandler[] = []
const providers: SshFilesystemProvider[] = []

function context(clientId = 41): RequestContext {
  return {
    clientId,
    isStale: () => false,
    isClientStale: () => false,
    sessionIdentity: {
      principal: 'fixture-authenticated-principal',
      authenticated: true,
      authenticationKind: 'endpoint-credential',
      allowSessionOwner: true
    }
  }
}

function retentionHost() {
  const leases = new Map<string, string>()
  const released = new Set<string>()
  const host = {
    create: vi.fn(async (_path: string, owner: string) => {
      if (released.has(owner)) {
        throw new Error('Owner released')
      }
      const token = randomUUID()
      leases.set(token, owner)
      return token
    }),
    discard: vi.fn(async (_path: string, owner: string, token: string) => {
      if (!leases.has(token)) {
        return { status: 'unavailable', reason: 'lease-unavailable' } as const
      }
      if (leases.get(token) !== owner) {
        return { status: 'unavailable', reason: 'lease-owner-mismatch' } as const
      }
      leases.delete(token)
      return { status: 'removed-placeholder', recovery } as const
    }),
    release: vi.fn(async (owner: string, token: string) => {
      if (leases.has(token) && leases.get(token) !== owner) {
        throw new Error('Owner mismatch')
      }
      leases.delete(token)
    }),
    releaseOwner: vi.fn(async (owner: string) => {
      released.add(owner)
      for (const [token, actualOwner] of leases) {
        if (actualOwner === owner) {
          leases.delete(token)
        }
      }
    })
  } satisfies UntitledPlaceholderRetentionHost
  return { host, leases }
}

function transport(callContext = context(), actualHost?: UntitledPlaceholderRetentionHost) {
  const retained = retentionHost()
  factory.create.mockReturnValueOnce(actualHost ?? retained.host)
  const requests = new Map<string, MethodHandler>()
  const detached = new Set<(clientId: number) => void>()
  const dispatcher = {
    onRequest: vi.fn((method: string, handler: MethodHandler) => requests.set(method, handler)),
    onNotification: vi.fn(),
    notify: vi.fn(),
    notifyClient: vi.fn(),
    onClientDetached: vi.fn((listener: (clientId: number) => void) => {
      detached.add(listener)
      return () => detached.delete(listener)
    })
  }
  const handler = new FsHandler(dispatcher as unknown as RelayDispatcher, new RelayContext(), {
    subscribe: vi.fn(),
    forgetRoot: vi.fn(),
    dispose: vi.fn()
  })
  handlers.push(handler)
  const request = async (method: string, args: Record<string, unknown>, c = callContext) => {
    const run = requests.get(method)
    if (!run) {
      throw new Error(`Missing actual FsHandler route: ${method}`)
    }
    return run(args, c)
  }
  const mux = {
    request: vi.fn((method: string, args: Record<string, unknown>) => request(method, args)),
    onNotification: vi.fn(() => () => {}),
    notify: vi.fn(),
    isDisposed: vi.fn(() => false)
  }
  const provider = new SshFilesystemProvider(
    'owned-transport',
    mux as unknown as SshChannelMultiplexer
  )
  providers.push(provider)
  return {
    ...retained,
    handler,
    request,
    provider,
    mux,
    detach: (id: number) => {
      for (const listener of detached) {
        listener(id)
      }
    }
  }
}

beforeEach(() => factory.create.mockReset())
afterEach(async () => {
  for (const provider of providers.splice(0)) {
    provider.dispose()
  }
  await Promise.all(handlers.splice(0).map((handler) => handler.dispose()))
  for (const directory of directories.splice(0)) {
    const within = relative(ownedRoot, directory)
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
      throw new Error('Owned transport fixture escaped its logs root')
    }
    await rm(directory, { recursive: true, force: true })
  }
})

describe('untitled placeholder transport authority', () => {
  it('proves the real dispatcher separates request cancellation from client generation replacement', async () => {
    vi.useFakeTimers()
    const dispatcher = new RelayDispatcher(() => {}, undefined, context().sessionIdentity)
    const requests: RequestContext[] = []
    const resume: (() => void)[] = []
    try {
      dispatcher.onRequest('test.pending', async (_params, c) => {
        requests.push(c)
        await new Promise<void>((resolvePending) => {
          resume.push(resolvePending)
        })
      })
      dispatcher.feed(encodeJsonRpcFrame({ jsonrpc: '2.0', id: 1, method: 'test.pending' }, 1, 0))
      dispatcher.feed(encodeJsonRpcFrame({ jsonrpc: '2.0', id: 2, method: 'test.pending' }, 2, 0))
      await vi.advanceTimersByTimeAsync(0)
      expect(requests).toHaveLength(2)
      dispatcher.feed(
        encodeJsonRpcFrame(
          {
            jsonrpc: '2.0',
            method: 'rpc.cancel',
            params: { id: 1 }
          },
          3,
          0
        )
      )
      expect(requests[0].signal?.aborted).toBe(true)
      expect(requests[0].isStale()).toBe(true)
      expect(requests[1].isStale()).toBe(false)
      expect(requests.map((c) => c.isClientStale?.())).toEqual([false, false])
      dispatcher.setWrite(() => {})
      expect(requests.map((c) => c.isClientStale?.())).toEqual([true, true])
    } finally {
      for (const resolvePending of resume) {
        resolvePending()
      }
      await vi.advanceTimersByTimeAsync(0)
      dispatcher.dispose()
      vi.useRealTimers()
    }
  })

  it('binds the opaque caller owner to actual authenticated client and host incarnation', async () => {
    const t = transport()
    const token = await t.provider.createUntitledPlaceholder(params.filePath, params.ownerKey)
    expect(factory.create).toHaveBeenCalledWith({
      resolveRetentionRoot: resolveUntitledPlaceholderRetentionRoot
    })
    expect(t.mux.request).toHaveBeenCalledWith('fs.createUntitledPlaceholder', params)
    const owner = t.host.create.mock.calls[0][1]
    expect(JSON.parse(owner)).toEqual([
      expect.any(String),
      41,
      expect.any(String),
      'fixture-authenticated-principal',
      'editor-7'
    ])
    expect(owner).not.toBe(params.ownerKey)
    expect(
      await t.request(
        'fs.discardUntitledPlaceholder',
        { ...params, leaseToken: token },
        context(42)
      )
    ).toEqual({ status: 'unavailable', reason: 'lease-owner-mismatch' })
    expect(
      await t.provider.discardUntitledPlaceholder(params.filePath, 'another-editor', token!)
    ).toEqual({ status: 'unavailable', reason: 'lease-owner-mismatch' })
    expect(t.leases.has(token!)).toBe(true)
    expect(
      await t.provider.discardUntitledPlaceholder(params.filePath, params.ownerKey, token!)
    ).toEqual({ status: 'removed-placeholder', recovery })
    expect(t.host.discard.mock.calls.at(-1)?.[1]).toBe(owner)
  })

  it.each([
    { ...params, filePath: 17 },
    { ...params, filePath: '\0' },
    { ...params, ownerKey: '' },
    { ...params, clientId: 42 }
  ])('rejects invalid create request schema before touching the host: %j', async (args) => {
    const t = transport()
    await expect(t.request('fs.createUntitledPlaceholder', args)).rejects.toThrow()
    expect(t.host.create).not.toHaveBeenCalled()
  })

  it.each(['absent', 'unauthenticated', 'unproved', 'stale', 'missing-generation'] as const)(
    'does not mint leases for %s transport authority',
    async (kind) => {
      const c = context()
      if (kind === 'absent') {
        c.sessionIdentity = undefined
      }
      if (kind === 'unauthenticated') {
        c.sessionIdentity!.authenticated = false
      }
      if (kind === 'unproved') {
        c.sessionIdentity!.authenticationKind = 'unproved'
      }
      if (kind === 'stale') {
        c.isStale = () => true
      }
      if (kind === 'missing-generation') {
        c.isClientStale = undefined
      }
      const t = transport(c)
      await expect(
        t.provider.createUntitledPlaceholder(params.filePath, params.ownerKey)
      ).rejects.toThrow()
      expect(t.host.create).not.toHaveBeenCalled()
      expect(t.mux.request).not.toHaveBeenCalledWith('fs.createFile', expect.anything())
    }
  )

  it('releases exactly detached client owners and keeps another client lease', async () => {
    const t = transport()
    const first = await t.request('fs.createUntitledPlaceholder', params, context(41))
    const second = await t.request('fs.createUntitledPlaceholder', params, context(42))
    const [owner41, owner42] = t.host.create.mock.calls.map((call) => call[1])
    t.detach(41)
    await vi.waitFor(() => expect(t.host.releaseOwner).toHaveBeenCalledWith(owner41))
    expect(t.host.releaseOwner).not.toHaveBeenCalledWith(owner42)
    expect(t.leases.has(first as string)).toBe(false)
    expect(t.leases.has(second as string)).toBe(true)
  })

  it('rekeys a replaced client generation using the dedicated real client predicate', async () => {
    let stale = false
    const t = transport({ ...context(), isStale: () => stale, isClientStale: () => stale })
    const first = await t.request('fs.createUntitledPlaceholder', params)
    stale = true
    const second = await t.request('fs.createUntitledPlaceholder', params, context())
    const [oldOwner, newOwner] = t.host.create.mock.calls.map((call) => call[1])
    expect(JSON.parse(oldOwner)[2]).not.toBe(JSON.parse(newOwner)[2])
    await vi.waitFor(() => expect(t.host.releaseOwner).toHaveBeenCalledWith(oldOwner))
    expect(
      await t.request('fs.discardUntitledPlaceholder', { ...params, leaseToken: first }, context())
    ).toEqual({ status: 'unavailable', reason: 'lease-unavailable' })
    expect(t.leases.has(second as string)).toBe(true)
  })

  it('keeps leases from different FsHandler incarnations independent', async () => {
    const first = transport()
    const second = transport()
    const token = await first.provider.createUntitledPlaceholder(params.filePath, params.ownerKey)
    await second.provider.createUntitledPlaceholder(params.filePath, params.ownerKey)
    expect(JSON.parse(first.host.create.mock.calls[0][1])[0]).not.toBe(
      JSON.parse(second.host.create.mock.calls[0][1])[0]
    )
    expect(
      await second.provider.discardUntitledPlaceholder(params.filePath, params.ownerKey, token!)
    ).toEqual({ status: 'unavailable', reason: 'lease-unavailable' })
    await first.handler.dispose()
    expect(first.leases.size).toBe(0)
    expect(second.leases.size).toBe(1)
    await expect(first.request('fs.createUntitledPlaceholder', params)).rejects.toThrow(
      'unavailable'
    )
  })

  it('releases an undelivered token without releasing a sibling lease of the same owner', async () => {
    let settle: Parameters<NonNullable<RequestContext['onResponseSettled']>>[0] | undefined
    const c = context()
    const t = transport(c)
    const sibling = await t.request('fs.createUntitledPlaceholder', params)
    c.onResponseSettled = (callback) => {
      settle = callback
    }
    const lost = await t.request('fs.createUntitledPlaceholder', params)
    settle?.({ ok: false, error: new Error('Actual response write rejected') })
    await vi.waitFor(() => expect(t.leases.has(lost as string)).toBe(false))
    expect(t.leases.has(sibling as string)).toBe(true)
    expect(t.host.release).toHaveBeenCalledWith(t.host.create.mock.calls[1][1], lost)
  })

  it('releases a late-created lease before rejecting a stale client', async () => {
    let stale = false
    let resume: (() => void) | undefined
    const t = transport({ ...context(), isStale: () => stale })
    const original = t.host.create.getMockImplementation()!
    t.host.create.mockImplementationOnce(async (file, owner) => {
      await new Promise<void>((resolvePending) => {
        resume = resolvePending
      })
      return original(file, owner)
    })
    const pending = t.request('fs.createUntitledPlaceholder', params)
    stale = true
    resume?.()
    await expect(pending).rejects.toThrow('unavailable')
    expect(t.host.release).toHaveBeenCalledWith(t.host.create.mock.calls[0][1], expect.any(String))
    expect(t.leases.size).toBe(0)
  })

  it('cancels one pending create without revoking a successful sibling on the same client owner', async () => {
    let canceled = false
    let resume: (() => void) | undefined
    const firstContext = { ...context(), isStale: () => canceled, isClientStale: () => false }
    const t = transport(firstContext)
    const original = t.host.create.getMockImplementation()!
    t.host.create.mockImplementationOnce(async (file, owner) => {
      await new Promise<void>((resolvePending) => {
        resume = resolvePending
      })
      return original(file, owner)
    })
    const first = t.request('fs.createUntitledPlaceholder', params, firstContext)
    canceled = true
    const siblingParams = { ...params, filePath: '/host/Untitled-2.md' }
    const sibling = await t.request('fs.createUntitledPlaceholder', siblingParams, context())
    expect(t.host.create.mock.calls[0][1]).toBe(t.host.create.mock.calls[1][1])
    resume?.()
    await expect(first).rejects.toThrow('unavailable')
    expect(t.host.releaseOwner).not.toHaveBeenCalled()
    expect(t.leases.has(sibling as string)).toBe(true)
    expect(
      await t.request(
        'fs.discardUntitledPlaceholder',
        {
          ...siblingParams,
          leaseToken: sibling
        },
        context()
      )
    ).toEqual({ status: 'removed-placeholder', recovery })
  })
})

describe('SSH placeholder capability outcomes', () => {
  it('creates an actual ordinary primary-channel file while explicitly returning no lease', async () => {
    await mkdir(ownedRoot, { recursive: true })
    const directory = await mkdtemp(join(ownedRoot, 'unproved-primary-'))
    directories.push(directory)
    const file = join(directory, 'Untitled.md')
    const t = transport({
      ...context(),
      sessionIdentity: {
        principal: 'unproved:41',
        authenticated: false,
        allowSessionOwner: false,
        authenticationKind: 'unproved'
      }
    })
    await expect(t.provider.createUntitledPlaceholder(file, params.ownerKey)).resolves.toBeNull()
    expect(await readFile(file, 'utf8')).toBe('')
    expect(t.host.create).not.toHaveBeenCalled()
    await expect(
      t.provider.discardUntitledPlaceholder(file, params.ownerKey, 'guessed-token')
    ).rejects.toThrow('Authenticated placeholder owner is unavailable')
    expect(await readFile(file, 'utf8')).toBe('')
  })

  it('uses the real host and keeps full recovery records inside owned noncommittable Git metadata', async () => {
    await mkdir(ownedRoot, { recursive: true })
    const directory = await mkdtemp(join(ownedRoot, 'real-host-'))
    directories.push(directory)
    const initialized = await runProcess({
      program: 'git',
      args: ['init', '--quiet'],
      cwd: directory,
      timeoutMs: 10_000
    })
    expect(initialized.code).toBe(0)
    const actual = await vi.importActual<typeof RetentionModule>(
      '../shared/untitled-placeholder-retention'
    )
    const realHost = actual.createUntitledPlaceholderRetentionHost({
      resolveRetentionRoot: resolveUntitledPlaceholderRetentionRoot
    })
    const t = transport(context(), realHost)
    const file = join(directory, 'Untitled.md')
    const token = await t.provider.createUntitledPlaceholder(file, params.ownerKey)
    expect(await readFile(file, 'utf8')).toBe('')
    const result = await t.provider.discardUntitledPlaceholder(file, params.ownerKey, token!)
    expect(result.status).toBe('removed-placeholder')
    if (result.status !== 'removed-placeholder') {
      throw new Error('Real transport did not safely capture the placeholder')
    }
    expect(result.recovery.originalPath).toBe(file)
    expect(relative(join(directory, '.git'), result.recovery.retainedPath)).toMatch(
      /^hivecode-untitled-placeholder-recovery[\\/]/
    )
    expect(await readFile(result.recovery.retainedPath, 'utf8')).toBe('')
    expect(await readFile(result.recovery.manifestPath, 'utf8')).toContain('created')
    const status = await runProcess({
      program: 'git',
      args: ['status', '--porcelain', '--untracked-files=all'],
      cwd: directory,
      timeoutMs: 10_000
    })
    expect(status.code).toBe(0)
    expect(status.stdout).toBe('')
  })

  it('creates a real ordinary file on only legacy MethodNotFound and returns no lease', async () => {
    await mkdir(ownedRoot, { recursive: true })
    const directory = await mkdtemp(join(ownedRoot, 'legacy-'))
    directories.push(directory)
    const file = join(directory, 'Untitled.md')
    const t = transport()
    const forward = t.mux.request.getMockImplementation()!
    t.mux.request.mockImplementation((method, args) =>
      method === 'fs.createUntitledPlaceholder'
        ? Promise.reject(Object.assign(new Error('Method not found'), { code: -32601 }))
        : forward(method, args)
    )
    await expect(t.provider.createUntitledPlaceholder(file, params.ownerKey)).resolves.toBeNull()
    expect(await readFile(file, 'utf8')).toBe('')
    expect(t.mux.request.mock.calls.map((call) => call[0])).toEqual([
      'fs.createUntitledPlaceholder',
      'fs.createFile'
    ])
    expect(t.host.create).not.toHaveBeenCalled()
  })

  it('propagates create, discard and release failures without stat or delete fallback', async () => {
    const t = transport()
    const failure = Object.assign(new Error('Disconnected transport'), {
      code: 'connection-closed'
    })
    t.mux.request.mockRejectedValue(failure)
    await expect(
      t.provider.createUntitledPlaceholder(params.filePath, params.ownerKey)
    ).rejects.toBe(failure)
    await expect(
      t.provider.discardUntitledPlaceholder(params.filePath, params.ownerKey, 'token')
    ).rejects.toBe(failure)
    await expect(t.provider.releaseUntitledPlaceholder(params.ownerKey, 'token')).rejects.toBe(
      failure
    )
    expect(t.mux.request.mock.calls.map((call) => call[0])).toEqual([
      'fs.createUntitledPlaceholder',
      'fs.discardUntitledPlaceholder',
      'fs.releaseUntitledPlaceholder'
    ])
  })

  it.each(['fs.discardUntitledPlaceholder', 'fs.releaseUntitledPlaceholder'])(
    'rejects old relay %s rather than claiming success',
    async (method) => {
      const t = transport()
      const failure = Object.assign(new Error('Method not found'), { code: -32601 })
      t.mux.request.mockRejectedValue(failure)
      const pending =
        method === 'fs.discardUntitledPlaceholder'
          ? t.provider.discardUntitledPlaceholder(params.filePath, params.ownerKey, 'token')
          : t.provider.releaseUntitledPlaceholder(params.ownerKey, 'token')
      await expect(pending).rejects.toBe(failure)
      expect(t.mux.request).toHaveBeenCalledTimes(1)
    }
  )

  it('rejects malformed remote success and keeps all four full result variants', async () => {
    const t = transport()
    t.mux.request.mockResolvedValueOnce({ status: 'removed-placeholder' })
    await expect(
      t.provider.discardUntitledPlaceholder(params.filePath, params.ownerKey, 'token')
    ).rejects.toThrow()
    const outcomes = [
      { status: 'removed-placeholder', recovery },
      { status: 'preserved', reason: 'not-empty' },
      { status: 'recovery-required', reason: 'restore-failed', recovery },
      { status: 'unavailable', reason: 'lease-unavailable' }
    ]
    for (const result of outcomes) {
      t.mux.request.mockResolvedValueOnce(result)
      expect(
        await t.provider.discardUntitledPlaceholder(params.filePath, params.ownerKey, 'token')
      ).toEqual(result)
    }
  })

  it('rejects disposed providers before requests and releases an already created token', async () => {
    const t = transport()
    const token = await t.provider.createUntitledPlaceholder(params.filePath, params.ownerKey)
    t.provider.dispose()
    await vi.waitFor(() => expect(t.leases.has(token!)).toBe(false))
    t.mux.request.mockClear()
    await expect(
      t.provider.createUntitledPlaceholder(params.filePath, params.ownerKey)
    ).rejects.toThrow('disposed')
    await expect(
      t.provider.discardUntitledPlaceholder(params.filePath, params.ownerKey, token!)
    ).rejects.toThrow('disposed')
    await expect(t.provider.releaseUntitledPlaceholder(params.ownerKey, token!)).rejects.toThrow(
      'disposed'
    )
    expect(t.mux.request).not.toHaveBeenCalled()
  })

  it('releases an exact late token before rejecting provider disposal during create', async () => {
    let resume: (() => void) | undefined
    const t = transport()
    const original = t.host.create.getMockImplementation()!
    t.host.create.mockImplementationOnce(async (file, owner) => {
      await new Promise<void>((resolvePending) => {
        resume = resolvePending
      })
      return original(file, owner)
    })
    const pending = t.provider.createUntitledPlaceholder(params.filePath, params.ownerKey)
    t.provider.dispose()
    resume?.()
    await expect(pending).rejects.toThrow('disposed')
    expect(t.mux.request.mock.calls.at(-1)?.[0]).toBe('fs.releaseUntitledPlaceholder')
    expect(t.leases.size).toBe(0)
  })
})

async function ordinaryFixture(label: string): Promise<string> {
  await mkdir(ownedRoot, { recursive: true })
  const directory = await mkdtemp(join(ownedRoot, `${label}-`))
  directories.push(directory)
  return join(directory, 'Untitled.md')
}

describe('relay ordinary creation after a proved unavailable recovery location', () => {
  it('uses the real factory before source creation and falls back to real exclusive creation without a lease', async () => {
    const file = await ordinaryFixture('no-location')
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const actual = await vi.importActual<typeof RetentionModule>(
      '../shared/untitled-placeholder-retention'
    )
    const locationError = new UntitledPlaceholderRecoveryLocationUnavailableError()
    const realHost = actual.createUntitledPlaceholderRetentionHost({
      resolveRetentionRoot: async () => {
        throw locationError
      }
    })
    const created = vi.spyOn(realHost, 'create')
    const t = transport(context(), realHost)
    await expect(t.provider.createUntitledPlaceholder(file, params.ownerKey)).resolves.toBeNull()
    expect(await readFile(file, 'utf8')).toBe('')
    expect(created).toHaveBeenCalledTimes(1)
    await expect(created.mock.results[0].value).rejects.toMatchObject({
      creationStage: 'resolve-location',
      creationOutcome: 'not-attempted',
      manifestPath: undefined,
      code: undefined,
      cause: locationError
    })
    expect(t.leases.size).toBe(0)
    expect(t.mux.request.mock.calls.map((call) => call[0])).toEqual([
      'fs.createUntitledPlaceholder'
    ])
  })

  it.each([
    { kind: 'owner', stage: 'owner', outcome: 'not-attempted' },
    { kind: 'path', stage: 'canonical-path', outcome: 'not-attempted' },
    { kind: 'ACL', stage: 'resolve-location', outcome: 'not-attempted' },
    { kind: 'generic', stage: 'resolve-location', outcome: 'not-attempted' },
    { kind: 'unknown', stage: 'resolve-location', outcome: 'unknown' },
    { kind: 'manifest', stage: 'resolve-location', outcome: 'not-attempted' },
    { kind: 'EEXIST', stage: 'resolve-location', outcome: 'not-attempted' },
    { kind: 'after-wx', stage: 'prove-source', outcome: 'created' },
    { kind: 'serialized', stage: 'resolve-location', outcome: 'not-attempted' }
  ] as const)(
    'never broadens $kind refusal into an ordinary write',
    async ({ kind, stage, outcome }) => {
      const file = await ordinaryFixture('refusal')
      const location = new UntitledPlaceholderRecoveryLocationUnavailableError()
      const cause =
        kind === 'generic'
          ? new Error(location.message)
          : kind === 'ACL'
            ? Object.assign(new Error('ACL refused'), { code: 'EACCES' })
            : kind === 'EEXIST'
              ? Object.assign(location, { code: 'EEXIST' })
              : location
      const wrapped = new UntitledPlaceholderRetentionUnavailableError(
        kind === 'manifest' ? join(file, 'manifest') : undefined,
        cause,
        stage,
        outcome
      )
      const refusal =
        kind === 'serialized'
          ? {
              name: wrapped.name,
              creationStage: stage,
              creationOutcome: outcome,
              manifestPath: undefined,
              cause: { name: location.name }
            }
          : wrapped
      const t = transport()
      t.host.create.mockRejectedValueOnce(refusal)
      await expect(t.provider.createUntitledPlaceholder(file, params.ownerKey)).rejects.toBe(
        refusal
      )
      await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(t.mux.request.mock.calls.map((call) => call[0])).toEqual([
        'fs.createUntitledPlaceholder'
      ])
    }
  )

  it('keeps already created source bytes when later retention fails', async () => {
    const file = await ordinaryFixture('created-before-failure')
    const refusal = new UntitledPlaceholderRetentionUnavailableError(
      undefined,
      new UntitledPlaceholderRecoveryLocationUnavailableError(),
      'commit-lease',
      'created'
    )
    const t = transport()
    t.host.create.mockImplementationOnce(async () => {
      await writeFile(file, 'created before the retention failure', { flag: 'wx' })
      throw refusal
    })
    await expect(t.provider.createUntitledPlaceholder(file, params.ownerKey)).rejects.toBe(refusal)
    expect(await readFile(file, 'utf8')).toBe('created before the retention failure')
  })

  it.each(['canceled', 'generation-replaced', 'unauthenticated'] as const)(
    'rechecks %s authority before ordinary creation after a typed refusal',
    async (kind) => {
      const file = await ordinaryFixture('stale-no-location')
      let canceled = false
      let changed = false
      const c = { ...context(), isStale: () => canceled, isClientStale: () => changed }
      const t = transport(c)
      t.host.create.mockImplementationOnce(async () => {
        canceled = kind === 'canceled'
        changed = kind === 'generation-replaced'
        if (kind === 'unauthenticated') {
          c.sessionIdentity!.authenticated = false
        }
        throw new UntitledPlaceholderRetentionUnavailableError(
          undefined,
          new UntitledPlaceholderRecoveryLocationUnavailableError(),
          'resolve-location',
          'not-attempted'
        )
      })
      await expect(t.provider.createUntitledPlaceholder(file, params.ownerKey)).rejects.toThrow(
        'unavailable'
      )
      await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('uses the real factory owner reproof to reject a revoked owner before fallback', async () => {
    const file = await ordinaryFixture('revoked-no-location')
    const actual = await vi.importActual<typeof RetentionModule>(
      '../shared/untitled-placeholder-retention'
    )
    let rejectLocation: (() => void) | undefined
    const realHost = actual.createUntitledPlaceholderRetentionHost({
      resolveRetentionRoot: () =>
        new Promise((_, reject) => {
          rejectLocation = () => reject(new UntitledPlaceholderRecoveryLocationUnavailableError())
        })
    })
    const created = vi.spyOn(realHost, 'create')
    const t = transport(context(), realHost)
    const pending = t.provider.createUntitledPlaceholder(file, params.ownerKey)
    await vi.waitFor(() => expect(rejectLocation).toEqual(expect.any(Function)))
    const release = realHost.releaseOwner(created.mock.calls[0][1])
    rejectLocation?.()
    await expect(pending).rejects.toMatchObject({
      creationStage: 'owner',
      creationOutcome: 'not-attempted'
    })
    await release
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains a concurrent writer and propagates real wx failure instead of returning null', async () => {
    const file = await ordinaryFixture('concurrent-no-location')
    const actual = await vi.importActual<typeof RetentionModule>(
      '../shared/untitled-placeholder-retention'
    )
    const realHost = actual.createUntitledPlaceholderRetentionHost({
      resolveRetentionRoot: async () => {
        await writeFile(file, 'concurrent writer contents', { flag: 'wx' })
        throw new UntitledPlaceholderRecoveryLocationUnavailableError()
      }
    })
    const t = transport(context(), realHost)
    await expect(t.provider.createUntitledPlaceholder(file, params.ownerKey)).rejects.toMatchObject(
      { code: 'EEXIST' }
    )
    expect(await readFile(file, 'utf8')).toBe('concurrent writer contents')
  })
})

describe('SSH placeholder creation reply validation', () => {
  it.each([
    { label: 'object success', reply: { ok: true } },
    { label: 'empty token', reply: '' },
    { label: 'oversized token', reply: 'x'.repeat(257) }
  ])('rejects $label without ordinary creation or tracking a lease', async ({ reply }) => {
    const t = transport()
    t.mux.request.mockResolvedValueOnce(reply)
    await expect(
      t.provider.createUntitledPlaceholder(params.filePath, params.ownerKey)
    ).rejects.toThrow()
    t.provider.dispose()
    expect(t.mux.request).toHaveBeenCalledTimes(1)
    expect(t.mux.request).toHaveBeenCalledWith('fs.createUntitledPlaceholder', params)
    expect(t.host.create).not.toHaveBeenCalled()
    expect(t.leases.size).toBe(0)
  })

  it('accepts the exact wire token length boundary and releases the same token and owner', async () => {
    const t = transport()
    const token = 'x'.repeat(256)
    t.mux.request.mockResolvedValueOnce(token)
    await expect(
      t.provider.createUntitledPlaceholder(params.filePath, params.ownerKey)
    ).resolves.toBe(token)
    await t.provider.releaseUntitledPlaceholder(params.ownerKey, token)
    expect(t.mux.request.mock.calls).toEqual([
      ['fs.createUntitledPlaceholder', params],
      ['fs.releaseUntitledPlaceholder', { ownerKey: params.ownerKey, leaseToken: token }]
    ])
  })
})
