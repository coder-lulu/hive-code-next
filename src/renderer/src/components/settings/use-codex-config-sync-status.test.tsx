// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexConfigSyncStatus } from '../../../../shared/codex-config-sync-types'
import { useCodexConfigSyncStatus } from './use-codex-config-sync-status'

const { watch, close } = vi.hoisted(() => ({ watch: vi.fn(), close: vi.fn() }))
vi.mock('./accounts-pane-config-sync', () => ({ watchCodexConfigSyncStatus: watch }))

beforeEach(() => {
  vi.clearAllMocks()
  watch.mockReturnValue(close)
})
afterEach(cleanup)

describe('account config sync status', () => {
  it.each([
    { remote: true, runtime: 'host' as const },
    { remote: false, runtime: 'wsl' as const }
  ])('clears host status and closes its watcher in $runtime / remote=$remote scope', (scope) => {
    const view = renderHook(
      ({ remote, runtime }: { remote: boolean; runtime: 'host' | 'wsl' }) =>
        useCodexConfigSyncStatus(remote, runtime, null, true),
      { initialProps: { remote: false, runtime: 'host' } }
    )
    const status: CodexConfigSyncStatus = {
      state: 'stalled',
      reason: 'managed-home-unavailable',
      systemConfigPath: '/home/user/.codex/config.toml'
    }
    act(() => watch.mock.calls[0][0](status))
    expect(view.result.current).toEqual(status)

    view.rerender(scope)
    expect(close).toHaveBeenCalledOnce()
    expect(watch).toHaveBeenCalledOnce()
    expect(view.result.current).toBeNull()
  })

  it('restarts on active-account and roster changes and closes on unmount', () => {
    const initialProps: { accountId: string | null; loaded: boolean } = {
      accountId: null,
      loaded: false
    }
    const view = renderHook(
      ({ accountId, loaded }: { accountId: string | null; loaded: boolean }) =>
        useCodexConfigSyncStatus(false, 'host', accountId, loaded),
      { initialProps }
    )
    view.rerender({ accountId: 'account-1', loaded: false })
    expect(watch).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
    view.rerender({ accountId: 'account-1', loaded: true })
    expect(watch).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(close).toHaveBeenCalledTimes(3)
  })
})
