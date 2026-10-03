import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteRuntimeSharedConnectionDiagnostics } from '../../../../shared/remote-runtime-shared-control-types'
import { refreshRuntimeEnvironmentStatus } from './runtime-status-refresh'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('refreshRuntimeEnvironmentStatus diagnostics', () => {
  it('publishes shared-control diagnostics from failed status probes', async () => {
    const remoteControl = diagnostics('ready')
    const getStatus = vi.fn().mockResolvedValue({
      id: 'status.get',
      ok: false,
      error: {
        code: 'runtime_unavailable',
        message: 'offline',
        data: { remoteControl }
      },
      _meta: { runtimeId: null }
    })
    vi.stubGlobal('window', {
      api: { runtimeEnvironments: { getStatus } }
    })
    const publish = vi.fn()

    const applySnapshot = vi.fn()

    await expect(
      refreshRuntimeEnvironmentStatus('env-a', 5_000, publish, applySnapshot)
    ).resolves.toBe(false)

    expect(getStatus).toHaveBeenCalledWith({ selector: 'env-a', timeoutMs: 5_000 })
    expect(publish).toHaveBeenCalledWith({
      status: null,
      remoteControl,
      checkedAt: expect.any(Number)
    })
  })

  it('ignores an older probe that resolves after a newer route result', async () => {
    const first = deferred<ReturnType<typeof successfulStatusResponse>>()
    const second = deferred<ReturnType<typeof successfulStatusResponse>>()
    const getStatus = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    vi.stubGlobal('window', {
      api: { runtimeEnvironments: { getStatus } }
    })
    const publish = vi.fn()
    const applySnapshot = vi.fn()

    const older = refreshRuntimeEnvironmentStatus('env-a', 5_000, publish, applySnapshot)
    const newer = refreshRuntimeEnvironmentStatus('env-a', 5_000, publish, applySnapshot)
    second.resolve(successfulStatusResponse('new-runtime'))
    await expect(newer).resolves.toBe(true)
    first.resolve(successfulStatusResponse('old-runtime'))
    await expect(older).resolves.toBe(false)

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0].status.runtimeId).toBe('new-runtime')
  })
})

function successfulStatusResponse(runtimeId = 'runtime-a') {
  return {
    id: 'status.get',
    ok: true as const,
    result: {
      runtimeId,
      rendererGraphEpoch: 0,
      graphStatus: 'ready' as const,
      authoritativeWindowId: null,
      liveTabCount: 0,
      liveLeafCount: 0
    },
    _meta: { runtimeId }
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function diagnostics(
  state: RemoteRuntimeSharedConnectionDiagnostics['state']
): RemoteRuntimeSharedConnectionDiagnostics {
  return {
    state,
    pendingRequestCount: 0,
    subscriptionCount: 1,
    reconnectAttempt: 0,
    lastConnectedAt: 123,
    lastClose: null,
    lastError: null
  }
}
