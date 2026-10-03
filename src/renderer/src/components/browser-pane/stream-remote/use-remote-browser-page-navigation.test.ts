// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { BrowserPage } from '../../../../../shared/browser-workspace-types'
import { useRemoteBrowserPageNavigation } from './use-remote-browser-page-navigation'
import type { RemoteBrowserStreamLifecycle } from './remote-browser-stream-lifecycle'
import { remoteBrowserStreamUnreachableNotice } from './remote-browser-stream-status'

vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: vi.fn(async () => ({})),
  RuntimeRpcCallError: class RuntimeRpcCallError extends Error {}
}))

function page(): BrowserPage {
  return {
    id: 'page-a',
    workspaceId: 'workspace-a',
    worktreeId: 'worktree-a',
    url: 'about:blank',
    title: 'New Tab',
    loading: false,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    createdAt: 1
  }
}

function renderNavigation(
  overrides: Partial<Parameters<typeof useRemoteBrowserPageNavigation>[0]> = {}
): ReturnType<typeof renderHook<ReturnType<typeof useRemoteBrowserPageNavigation>, void>> {
  return renderHook(() =>
    useRemoteBrowserPageNavigation({
      browserTab: page(),
      stagedPage: false,
      addressBarValue: 'about:blank',
      setAddressBarValueFromPage: vi.fn(),
      lifecycle: {
        session: { ensureRemotePage: vi.fn(), scheduleTabInfoRefresh: vi.fn() }
      } as unknown as RemoteBrowserStreamLifecycle,
      runtimeWorktree: 'worktree-a',
      runtimeTarget: () => null,
      createRemoteOperationToken: () => null,
      isCurrentRemoteOperationToken: () => false,
      closeMissingRemotePage: vi.fn(),
      onSetUrl: vi.fn(),
      onUpdatePageState: vi.fn(),
      setPaneNotice: vi.fn(),
      setPaneBusy: vi.fn(),
      ...overrides
    })
  )
}

describe('useRemoteBrowserPageNavigation history recording', () => {
  beforeEach(() => {
    useAppStore.setState({ browserUrlHistory: [] })
  })

  afterEach(() => cleanup())

  it('files an observed remote navigation into the URL history the address bar suggests from', () => {
    const { result } = renderNavigation()

    act(() =>
      result.current.applyRemoteTabInfo({
        url: 'https://remote.internal/docs',
        title: 'Remote docs'
      })
    )

    expect(useAppStore.getState().browserUrlHistory).toEqual([
      expect.objectContaining({ url: 'https://remote.internal/docs', title: 'Remote docs' })
    ])
  })

  it('files one entry however often the same page is re-read', () => {
    const { result } = renderNavigation()

    // Why: a settled scroll, click or keystroke re-reads tab info, so an unconditional filing
    // would rewrite the store — and re-render every address bar — on plain interaction.
    for (let index = 0; index < 20; index += 1) {
      act(() =>
        result.current.applyRemoteTabInfo({ url: 'https://remote.internal/docs', title: 'Docs' })
      )
    }

    expect(useAppStore.getState().browserUrlHistory).toEqual([
      expect.objectContaining({ url: 'https://remote.internal/docs', visitCount: 1 })
    ])
  })

  it('files again once the page really moves', () => {
    const { result } = renderNavigation()

    act(() => result.current.applyRemoteTabInfo({ url: 'https://remote.internal/a', title: 'A' }))
    act(() => result.current.applyRemoteTabInfo({ url: 'https://remote.internal/b', title: 'B' }))
    act(() => result.current.applyRemoteTabInfo({ url: 'https://remote.internal/a', title: 'A' }))

    expect(
      useAppStore.getState().browserUrlHistory.map((entry) => [entry.url, entry.visitCount])
    ).toEqual([
      ['https://remote.internal/b', 1],
      ['https://remote.internal/a', 2]
    ])
  })

  it('picks up a title that only arrives on a later read of the same page', () => {
    const { result } = renderNavigation()

    act(() => result.current.applyRemoteTabInfo({ url: 'https://remote.internal/docs', title: '' }))
    act(() =>
      result.current.applyRemoteTabInfo({
        url: 'https://remote.internal/docs',
        title: 'Remote docs'
      })
    )

    expect(useAppStore.getState().browserUrlHistory).toEqual([
      expect.objectContaining({ title: 'Remote docs' })
    ])
  })

  it('never files a blank page, which is what a new tab reports before it navigates', () => {
    const { result } = renderNavigation()

    act(() => result.current.applyRemoteTabInfo({ url: 'about:blank', title: '' }))

    expect(useAppStore.getState().browserUrlHistory).toHaveLength(0)
  })

  it('redacts a Kagi session token before it reaches history', () => {
    const { result } = renderNavigation()

    act(() =>
      result.current.applyRemoteTabInfo({
        url: 'https://kagi.com/search?q=orca&token=secret-session',
        title: 'Kagi'
      })
    )

    const [entry] = useAppStore.getState().browserUrlHistory
    expect(entry.url).not.toContain('secret-session')
  })

  it('settles loading without showing a website failure when the remote page cannot be prepared', async () => {
    const onUpdatePageState = vi.fn()
    const setPaneNotice = vi.fn()
    const token = {
      tabId: 'page-a',
      environmentId: 'environment-a',
      remotePageId: null,
      generation: 1
    }
    const { result } = renderNavigation({
      lifecycle: {
        session: {
          ensureRemotePage: vi.fn(async () => {
            throw new Error('cloud unavailable')
          }),
          scheduleTabInfoRefresh: vi.fn()
        }
      } as unknown as RemoteBrowserStreamLifecycle,
      runtimeTarget: () => ({ kind: 'environment', environmentId: 'environment-a' }),
      createRemoteOperationToken: () => token,
      isCurrentRemoteOperationToken: () => true,
      onUpdatePageState,
      setPaneNotice
    })

    await act(async () => {
      await result.current.runRemoteNavigation('browser.goto', 'https://remote.internal/docs')
    })

    expect(onUpdatePageState).toHaveBeenCalledWith(
      'page-a',
      expect.objectContaining({
        loading: false,
        loadError: null
      })
    )
    expect(setPaneNotice).toHaveBeenCalledWith({
      kind: 'consequence',
      text: remoteBrowserStreamUnreachableNotice()
    })
  })

  it('does not leave an active tab loading when its runtime target is unavailable', async () => {
    const onUpdatePageState = vi.fn()
    const setPaneNotice = vi.fn()
    const { result } = renderNavigation({ onUpdatePageState, setPaneNotice })

    await act(async () => {
      await result.current.runRemoteNavigation('browser.goto', 'https://remote.internal/docs')
    })

    expect(onUpdatePageState).toHaveBeenCalledWith(
      'page-a',
      expect.objectContaining({ loading: false, loadError: null })
    )
    expect(setPaneNotice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'direct' }))
  })

  it.each([
    ['browser_navigation_failed', 'Navigation failed'],
    ['browser_error', 'Failed to navigate browser page remote-page-a: ERR_NAME_NOT_RESOLVED']
  ])('keeps a website failure reported as %s', async (code, message) => {
    vi.mocked(callRuntimeRpc).mockRejectedValueOnce(Object.assign(new Error(message), { code }))
    const onUpdatePageState = vi.fn()
    const token = {
      tabId: 'page-a',
      environmentId: 'environment-a',
      remotePageId: null,
      generation: 1
    }
    const { result } = renderNavigation({
      lifecycle: {
        session: {
          ensureRemotePage: vi.fn(async () => 'remote-page-a'),
          scheduleTabInfoRefresh: vi.fn()
        }
      } as unknown as RemoteBrowserStreamLifecycle,
      runtimeTarget: () => ({ kind: 'environment', environmentId: 'environment-a' }),
      createRemoteOperationToken: () => token,
      isCurrentRemoteOperationToken: () => true,
      onUpdatePageState
    })

    await act(async () => {
      await result.current.runRemoteNavigation('browser.goto', 'https://unreachable.invalid')
    })

    expect(onUpdatePageState).toHaveBeenCalledWith(
      'page-a',
      expect.objectContaining({
        loading: false,
        loadError: expect.objectContaining({ validatedUrl: 'https://unreachable.invalid' })
      })
    )
  })

  it('does not mislabel a browser.goto transport error as a website failure', async () => {
    vi.mocked(callRuntimeRpc).mockRejectedValueOnce(new Error('hive_runtime_cloud_request_failed'))
    const onUpdatePageState = vi.fn()
    const setPaneNotice = vi.fn()
    const token = {
      tabId: 'page-a',
      environmentId: 'environment-a',
      remotePageId: null,
      generation: 1
    }
    const { result } = renderNavigation({
      lifecycle: {
        session: {
          ensureRemotePage: vi.fn(async () => 'remote-page-a'),
          scheduleTabInfoRefresh: vi.fn()
        }
      } as unknown as RemoteBrowserStreamLifecycle,
      runtimeTarget: () => ({ kind: 'environment', environmentId: 'environment-a' }),
      createRemoteOperationToken: () => token,
      isCurrentRemoteOperationToken: () => true,
      onUpdatePageState,
      setPaneNotice
    })

    await act(async () => {
      await result.current.runRemoteNavigation('browser.goto', 'https://remote.internal/docs')
    })

    expect(onUpdatePageState).toHaveBeenCalledWith(
      'page-a',
      expect.objectContaining({ loading: false, loadError: null })
    )
    expect(setPaneNotice).toHaveBeenCalledWith({
      kind: 'consequence',
      text: remoteBrowserStreamUnreachableNotice()
    })
  })

  it('preserves a browser history error without showing a website failure', async () => {
    vi.mocked(callRuntimeRpc).mockRejectedValueOnce(
      Object.assign(new Error('No previous history entry.'), { code: 'browser_navigation_failed' })
    )
    const onUpdatePageState = vi.fn()
    const setPaneNotice = vi.fn()
    const { result } = renderNavigation({
      lifecycle: {
        session: {
          ensureRemotePage: vi.fn(async () => 'remote-page-a'),
          scheduleTabInfoRefresh: vi.fn()
        }
      } as unknown as RemoteBrowserStreamLifecycle,
      runtimeTarget: () => ({ kind: 'environment', environmentId: 'environment-a' }),
      createRemoteOperationToken: () => ({
        tabId: 'page-a',
        environmentId: 'environment-a',
        remotePageId: null,
        generation: 1
      }),
      isCurrentRemoteOperationToken: () => true,
      onUpdatePageState,
      setPaneNotice
    })

    await act(async () => {
      await result.current.runRemoteNavigation('browser.back')
    })

    expect(onUpdatePageState).toHaveBeenCalledWith(
      'page-a',
      expect.objectContaining({ loading: false, loadError: null })
    )
    expect(setPaneNotice).toHaveBeenCalledWith({
      kind: 'consequence',
      text: 'No previous history entry.'
    })
  })
})
