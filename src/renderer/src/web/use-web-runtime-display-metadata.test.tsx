// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudLaunchBootstrap } from './cloud-launch-bootstrap'
import { useWebRuntimeDisplayMetadata } from './use-web-runtime-display-metadata'
import { configureWebRuntimeBootstrap, webRuntimeState } from './preload-api/web-runtime-session'
import { WebAccountSession } from './account-runtime-relay/web-account-session'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  close: vi.fn(),
  constructed: vi.fn(),
  publish: vi.fn(),
  exchange: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ setRuntimeEnvironments: mocks.publish }) }
}))
vi.mock('./cloud-launch-bootstrap', () => ({ exchangeCloudLaunchCredential: mocks.exchange }))
vi.mock('./web-runtime-client', () => ({
  WebRuntimeClient: class {
    constructor() {
      mocks.constructed()
    }
    call = mocks.call
    close = mocks.close
    configureStatusOwner = vi.fn()
  }
}))

const metadata = {
  runtimeRecordId: '423e4567-e89b-42d3-a456-426614174000',
  resourceVersion: 9,
  ownershipEpoch: 8,
  cloudDisplayName: '已确认名称',
  cloudDisplayNameVersion: 2,
  deviceName: '设备'
}
const cloud = (): CloudLaunchBootstrap => ({
  protocolVersion: 'cloud-launch/v1',
  managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
  runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
  websocketUrl: 'wss://runtime.example/_hive/runtime-rpc',
  serverPublicKeyB64: 'public-key',
  sessionToken: 'A'.repeat(43),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  runtimeDisplayMetadata: metadata
})
const response = (bootstrap: CloudLaunchBootstrap, name = '新名称') => ({
  id: 'metadata',
  ok: true,
  result: {
    protocolVersion: 'web-session-display-metadata/v1',
    managedWebSessionId: bootstrap.managedWebSessionId,
    runtimeSessionId: bootstrap.runtimeSessionId,
    status: 'ACTIVE',
    controlVersion: 1,
    runtimeDisplayMetadata: {
      ...bootstrap.runtimeDisplayMetadata,
      cloudDisplayName: name,
      cloudDisplayNameVersion: 3
    }
  },
  _meta: { runtimeId: 'identity' }
})
const failure = (code: string, retryAfterMs?: number) => ({
  id: 'metadata',
  ok: false,
  error: { code, message: 'unavailable', data: { retryAfterMs } }
})
const tick = (ms = 30_000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
const visible = () =>
  act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })

function workFixture() {
  const bootstrap = cloud()
  configureWebRuntimeBootstrap(bootstrap)
  mocks.call.mockResolvedValue(response(bootstrap))
  const closeClients = vi.fn()
  const reload = vi.fn()
  const view = renderHook(() => useWebRuntimeDisplayMetadata(null, bootstrap, closeClients, reload))
  return { bootstrap, view, closeClients, reload }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime('2026-10-03T08:00:00Z')
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  configureWebRuntimeBootstrap()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('Work Web bound name refresh', () => {
  it('reads only in the foreground, refreshes on visibility, and renames without replaying launch or reconnecting', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const owner = workFixture()
    await tick(60_000)
    expect(mocks.call).not.toHaveBeenCalled()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    await visible()
    expect(mocks.call).toHaveBeenCalledWith(
      'cloudRuntime.displayMetadata',
      {},
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(owner.view.result.current).toBe('synced')
    expect(webRuntimeState.activeEnvironment?.name).toBe('新名称')
    await tick()
    expect(mocks.constructed).toHaveBeenCalledTimes(1)
    expect(mocks.close).not.toHaveBeenCalled()
    expect(mocks.exchange).not.toHaveBeenCalled()
    expect(owner.reload).not.toHaveBeenCalled()
  })

  it('deduplicates timer/visibility reads and aborts the pending request on cleanup', async () => {
    const owner = workFixture()
    let settle!: (value: unknown) => void
    mocks.call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve
        })
    )
    await tick()
    await visible()
    await tick()
    expect(mocks.call).toHaveBeenCalledTimes(1)
    const options: unknown = mocks.call.mock.calls[0]![2]
    if (
      !options ||
      typeof options !== 'object' ||
      !('signal' in options) ||
      !(options.signal instanceof AbortSignal)
    ) {
      throw new Error('metadata call must carry its AbortSignal')
    }
    owner.view.unmount()
    expect(options.signal.aborted).toBe(true)
    await act(async () => {
      settle(response(owner.bootstrap))
    })
    expect(webRuntimeState.activeEnvironment?.name).toBe('已确认名称')
    expect(mocks.exchange).not.toHaveBeenCalled()
  })

  it('honors Retry-After and restores the synced state after a later authoritative read', async () => {
    const owner = workFixture()
    mocks.call.mockResolvedValueOnce(failure('rate_limited', 60_000))
    await tick()
    expect(owner.view.result.current).toBe('unverifiable')
    expect(webRuntimeState.activeEnvironment?.name).toBe('已确认名称')
    await visible()
    await tick()
    expect(mocks.call).toHaveBeenCalledTimes(1)
    await tick()
    expect(mocks.call).toHaveBeenCalledTimes(2)
    expect(owner.view.result.current).toBe('synced')
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it.each([
    'runtime_display_metadata_proof_rejected',
    'runtime_display_metadata_request_invalid',
    'unauthorized',
    'service_unavailable'
  ])('retains the Work and confirmed name when %s cannot verify metadata', async (code) => {
    const owner = workFixture()
    mocks.call.mockResolvedValueOnce(failure(code))
    await tick()
    expect(owner.view.result.current).toBe('unverifiable')
    expect(webRuntimeState.activeEnvironment?.name).toBe('已确认名称')
    expect(mocks.close).not.toHaveBeenCalled()
    expect(owner.reload).not.toHaveBeenCalled()
    await tick()
    expect(owner.view.result.current).toBe('synced')
  })

  it('treats malformed responses and offline reachability as unverifiable instead of binding revocation', async () => {
    const owner = workFixture()
    mocks.call.mockResolvedValueOnce({
      ...response(owner.bootstrap),
      result: { arbitrary: 'schema' }
    })
    await tick()
    expect(owner.view.result.current).toBe('unverifiable')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await tick()
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.close).not.toHaveBeenCalled()
    expect(webRuntimeState.activeEnvironment?.name).toBe('已确认名称')
  })

  it('clears the name and client only on authenticated binding invalidation, without consuming another ticket', async () => {
    const owner = workFixture()
    mocks.call.mockResolvedValueOnce(failure('runtime_display_metadata_binding_invalid'))
    await tick()
    expect(owner.view.result.current).toBe('expired')
    expect(webRuntimeState.activeEnvironment).toBeNull()
    expect(mocks.close).toHaveBeenCalledTimes(1)
    await visible()
    await tick()
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.exchange).not.toHaveBeenCalled()
    expect(owner.reload).not.toHaveBeenCalled()
  })

  it('ignores a pending response after the bootstrap and ownership change', async () => {
    const initial = cloud()
    configureWebRuntimeBootstrap(initial)
    let settle!: (value: unknown) => void
    mocks.call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve
        })
    )
    const view = renderHook(
      ({ bootstrap }) => useWebRuntimeDisplayMetadata(null, bootstrap, mocks.close, mocks.exchange),
      { initialProps: { bootstrap: initial } }
    )
    await tick()
    const replacement = {
      ...initial,
      runtimeDisplayMetadata: { ...metadata, ownershipEpoch: 9, cloudDisplayName: '重新认领' }
    }
    configureWebRuntimeBootstrap(replacement)
    view.rerender({ bootstrap: replacement })
    await act(async () => {
      settle(response(initial, '旧名称'))
    })
    expect(webRuntimeState.activeEnvironment?.name).toBe('重新认领')
    expect(mocks.publish).not.toHaveBeenCalledWith([expect.objectContaining({ name: '旧名称' })])
  })
})

describe('account Web metadata uses the current authenticated BFF Runtime', () => {
  it('confirms authentication before reading the Runtime and preserves a transient directory failure', async () => {
    const runtime = { ...metadata, status: 'CLAIMED' as const }
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    const auth = () => json({ authenticated: true, csrfToken: 'current-account' })
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(auth())
      .mockResolvedValueOnce(auth())
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(auth())
      .mockResolvedValueOnce(
        json({ ...runtime, cloudDisplayName: '账号新名称', cloudDisplayNameVersion: 3 })
      )
    const session = new WebAccountSession(fetchImpl, 'https://console.hivekernel.com')
    await session.restore()
    const close = vi.fn()
    const client = { call: mocks.call, close, subscribe: vi.fn() }
    const account = { runtime, session, client }
    configureWebRuntimeBootstrap(undefined, account)
    const reload = vi.fn()
    const view = renderHook(() => useWebRuntimeDisplayMetadata(account, null, close, reload))
    await tick()
    expect(fetchImpl.mock.calls[1]![0]).toContain('/bff/user/auth/session')
    expect(fetchImpl.mock.calls[2]![0]).toContain(`/bff/user/runtimes/${runtime.runtimeRecordId}`)
    expect(view.result.current).toBe('unverifiable')
    expect(close).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    await tick()
    expect(view.result.current).toBe('synced')
    expect(webRuntimeState.activeEnvironment?.name).toBe('账号新名称')
    expect(mocks.call).not.toHaveBeenCalled()
  })
})
