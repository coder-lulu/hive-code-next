// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreflightStatus } from '../../../preload/api-types'
import type { Repo } from '../../../shared/repo-types'
import { useAppStore } from '../store'
import {
  useLandingPreflightRuntime,
  useStartupPreflightNotifications
} from './landing-preflight-runtime'

const toastWarning = vi.hoisted(() => vi.fn())
const toastDismiss = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: {
    dismiss: toastDismiss,
    warning: toastWarning
  }
}))

const refresh = vi.fn().mockResolvedValue(undefined)
const invalidate = vi.fn()
const openUrl = vi.fn().mockResolvedValue(undefined)

const status = (overrides: Partial<PreflightStatus> = {}): PreflightStatus => ({
  git: { installed: true },
  gh: { installed: false, authenticated: false },
  ...overrides
})

const githubRepo: Repo = {
  id: 'github',
  path: '/repos/github',
  displayName: 'github',
  badgeColor: '#000000',
  addedAt: 0,
  kind: 'git',
  upstream: { owner: 'orca', repo: 'orca' }
}

beforeEach(() => {
  vi.useFakeTimers()
  refresh.mockClear()
  invalidate.mockClear()
  openUrl.mockClear()
  toastDismiss.mockClear()
  toastWarning.mockClear()
  ;(window as unknown as { api: { shell: { openUrl: typeof openUrl } } }).api = {
    shell: { openUrl }
  }
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({
    settings: {},
    refreshPreflightStatus: refresh,
    invalidatePreflightStatus: invalidate
  } as never)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('landing preflight runtime boundary', () => {
  it('waits for startup settings before checking the execution host', () => {
    useAppStore.setState({ settings: null } as never)

    const view = renderHook(() => useLandingPreflightRuntime())

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
    view.unmount()
  })

  it('refreshes after an active runtime A to B switch without manual action', () => {
    const view = renderHook(() => useLandingPreflightRuntime())
    expect(refresh).toHaveBeenCalledTimes(1)

    act(() => {
      useAppStore.setState({
        settings: { activeRuntimeEnvironmentId: 'runtime-a' },
        runtimeStatusByEnvironmentId: new Map([
          ['runtime-a', { status: { runtimeId: 'a' }, connectionGeneration: 1 }]
        ])
      } as never)
    })
    act(() => {
      useAppStore.setState({
        settings: { activeRuntimeEnvironmentId: 'runtime-b' },
        runtimeStatusByEnvironmentId: new Map([
          ['runtime-b', { status: { runtimeId: 'b' }, connectionGeneration: 1 }]
        ])
      } as never)
    })

    expect(refresh).toHaveBeenCalledTimes(3)
    view.unmount()
  })

  it('invalidates on disconnect and refreshes exactly once on reconnect', () => {
    const view = renderHook(() => useLandingPreflightRuntime())
    act(() => {
      useAppStore.setState({
        settings: { activeRuntimeEnvironmentId: 'runtime-a' },
        runtimeStatusByEnvironmentId: new Map([
          ['runtime-a', { status: { runtimeId: 'a' }, connectionGeneration: 1 }]
        ])
      } as never)
    })
    refresh.mockClear()

    act(() => {
      useAppStore.setState({
        runtimeStatusByEnvironmentId: new Map([
          ['runtime-a', { status: null, connectionGeneration: 2 }]
        ])
      } as never)
    })
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()

    act(() => {
      useAppStore.setState({
        runtimeStatusByEnvironmentId: new Map([
          ['runtime-a', { status: { runtimeId: 'a-reconnected' }, connectionGeneration: 3 }]
        ])
      } as never)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('keeps the banner empty while the active remote runtime is still unknown', () => {
    useAppStore.setState({ settings: { activeRuntimeEnvironmentId: 'runtime-a' } } as never)

    const view = renderHook(() => useLandingPreflightRuntime())

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
    view.unmount()
  })

  it('keeps one active interval and removes listeners and polling on cleanup', () => {
    useAppStore.setState({ repos: [githubRepo], preflightStatus: status() })
    const addEventListener = vi.spyOn(document, 'addEventListener')
    const removeEventListener = vi.spyOn(document, 'removeEventListener')
    const addWindowListener = vi.spyOn(window, 'addEventListener')
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const view = renderHook(() => useLandingPreflightRuntime())

    expect(vi.getTimerCount()).toBe(1)
    act(() => {
      useAppStore.setState({ repos: [...useAppStore.getState().repos] })
    })
    expect(vi.getTimerCount()).toBe(1)
    act(() => vi.advanceTimersByTime(30_000))
    expect(refresh).toHaveBeenCalledWith({ force: true })

    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(removeWindowListener).toHaveBeenCalledWith('focus', expect.any(Function))
    expect(addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(addWindowListener).toHaveBeenCalledWith('focus', expect.any(Function))
    addEventListener.mockRestore()
    removeEventListener.mockRestore()
    addWindowListener.mockRestore()
    removeWindowListener.mockRestore()
  })
})

describe('startup preflight notifications', () => {
  it('announces a missing GitHub CLI once and keeps the install action available', () => {
    useAppStore.setState({ repos: [githubRepo], preflightStatus: status() })

    const view = renderHook(() => useStartupPreflightNotifications())

    expect(toastWarning).toHaveBeenCalledTimes(1)
    expect(toastWarning).toHaveBeenCalledWith(
      'GitHub CLI is not installed',
      expect.objectContaining({
        id: 'startup-preflight:gh',
        description: 'HiveCode uses the GitHub CLI (gh) to show pull requests, issues, and checks.',
        duration: 12000,
        action: expect.objectContaining({ label: 'Install GitHub CLI' })
      })
    )

    const options = toastWarning.mock.calls[0][1] as {
      action: { onClick: () => void }
    }
    options.action.onClick()
    expect(openUrl).toHaveBeenCalledWith('https://cli.github.com')

    act(() => {
      useAppStore.setState({ preflightStatus: status() })
    })
    expect(toastWarning).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('waits for a GitHub project to hydrate and dismisses a resolved startup notice', () => {
    useAppStore.setState({ preflightStatus: status() })
    const view = renderHook(() => useStartupPreflightNotifications())

    expect(toastWarning).not.toHaveBeenCalled()

    act(() => {
      useAppStore.setState({ repos: [githubRepo] })
    })
    expect(toastWarning).toHaveBeenCalledTimes(1)

    act(() => {
      useAppStore.setState({
        preflightStatus: status({
          gh: { installed: true, authenticated: true }
        })
      })
    })
    expect(toastDismiss).toHaveBeenCalledWith('startup-preflight:gh')

    act(() => {
      useAppStore.setState({ preflightStatus: status() })
    })
    expect(toastWarning).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
