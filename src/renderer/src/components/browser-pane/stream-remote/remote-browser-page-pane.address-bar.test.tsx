// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import type { BrowserPage } from '../../../../../shared/browser-workspace-types'
import { requestBrowserFocus } from '../host-guest/browser-focus'
import {
  REMOTE_BROWSER_STREAM_LIVE,
  REMOTE_BROWSER_STREAM_OPENING
} from './remote-browser-stream-status'
import {
  clearBrowserPageDeferredNavigation,
  deferBrowserPageNavigation
} from '../navigate/browser-page-deferred-navigation'

// The streamed pane's runtime machinery — stream, input, wheel, context menu, markup — is inert
// here: this suite is about the chrome the pane wraps around it, which owns focus and the URL field.
const mocks = vi.hoisted(() => ({
  frameUrl: { current: null as string | null },
  addressBarValue: { current: 'about:blank' },
  windowVisible: { current: true },
  streamStatus: { current: 'live' as 'live' | 'opening' },
  activationOrder: [] as string[]
}))

vi.mock('@/hooks/use-window-stream-visibility', () => ({
  useWindowStreamVisible: () => mocks.windowVisible.current
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({
  runtimeEnvironmentSupportsCapability: vi.fn(async () => false),
  callRuntimeRpc: vi.fn(async () => ({}))
}))

vi.mock('@/lib/workspace-browser-tab-open', () => ({
  openWorkspaceBrowserTab: vi.fn(async () => {})
}))

vi.mock('../annotate/markup-clipboard-delivery', () => ({
  deliverMarkupToClipboard: vi.fn(async () => {})
}))

vi.mock('../annotate/useMarkupMode', () => ({
  useMarkupMode: () => ({
    isActive: false,
    baseImage: null,
    state: 'idle',
    start: vi.fn(),
    cancel: vi.fn(),
    complete: vi.fn()
  })
}))

vi.mock('./use-remote-browser-page-lifecycle', () => ({
  useRemoteBrowserPageLifecycle: () => ({
    lifecycle: {
      session: { ensureRemotePage: vi.fn(), scheduleTabInfoRefresh: vi.fn() },
      tokens: {}
    },
    streamStatus:
      mocks.streamStatus.current === 'opening'
        ? REMOTE_BROWSER_STREAM_OPENING
        : REMOTE_BROWSER_STREAM_LIVE,
    frameUrl: mocks.frameUrl.current,
    frameMetadata: null,
    runtimeWorktree: 'worktree-a',
    runtimeTarget: () => null,
    createRemoteOperationToken: () => null,
    isCurrentRemoteOperationToken: () => false,
    clearStreamFrame: vi.fn(),
    closeMissingRemotePage: vi.fn(),
    mountedRef: { current: true },
    isActiveRef: { current: true },
    streamBridgeRef: { current: null },
    streamFrameUrlRef: { current: null },
    pendingFrameDecodeRef: { current: 0 },
    remoteViewportSizeRef: { current: null },
    remoteCssViewportSizeRef: { current: null },
    remoteViewportTimerRef: { current: null },
    setFrameUrl: vi.fn(),
    setFrameMetadata: vi.fn()
  })
}))

vi.mock('./use-remote-browser-page-stream', () => ({
  useRemoteBrowserPageStream: ({
    stagedPage,
    isActive
  }: {
    stagedPage: boolean
    isActive: boolean
  }) => {
    const windowVisibleForStream = mocks.windowVisible.current
    useEffect(() => {
      if (!stagedPage && isActive && windowVisibleForStream) {
        mocks.activationOrder.push('stream-open')
      }
    }, [stagedPage, isActive, windowVisibleForStream])
    return { reconnectRemoteStream: vi.fn() }
  }
}))

vi.mock('./use-remote-browser-page-input', () => ({
  useRemoteBrowserPageInputQueue: () => ({
    enqueueRemoteInput: vi.fn(),
    clearPendingRemoteWheel: vi.fn(),
    resetRemoteInputQueue: vi.fn(),
    pendingRemoteWheelRef: { current: null },
    remoteWheelFrameRef: { current: null },
    remoteWheelInFlightRef: { current: false }
  }),
  useRemoteBrowserPageInput: () => ({
    getRemoteImagePoint: () => null,
    handleRemotePointerDown: vi.fn(),
    handleRemotePointerUp: vi.fn(),
    handleRemoteScreenshotKeyDown: vi.fn()
  })
}))

vi.mock('./use-remote-browser-page-wheel', () => ({ useRemoteBrowserPageWheel: vi.fn() }))

vi.mock('./remote-browser-page-context-menu', () => ({
  RemoteBrowserPageContextMenu: () => null,
  useRemoteBrowserPageContextMenu: () => ({
    contextMenu: null,
    setContextMenu: vi.fn(),
    handleRemoteContextMenu: vi.fn()
  })
}))

vi.mock('./use-remote-browser-page-navigation', () => ({
  useRemoteBrowserPageNavigation: () => ({
    addressBarValue: mocks.addressBarValue.current,
    setAddressBarValue: vi.fn(),
    applyRemoteTabInfo: vi.fn(),
    scheduleRemoteTabInfoRefresh: vi.fn(),
    runRemoteNavigation: vi.fn(),
    navigateToUrl: (url: string) => mocks.activationOrder.push(`navigate:${url}`),
    submitAddressBar: vi.fn()
  })
}))

// Why: mirrors the real viewport's focus surfaces — the screencast <img> once a frame lands,
// and the viewport div that is all there is before the first one.
vi.mock('./remote-browser-page-viewport', () => ({
  RemoteBrowserPageViewport: ({
    remoteViewportRef,
    imageRef,
    frameUrl
  }: {
    remoteViewportRef: React.RefObject<HTMLDivElement | null>
    imageRef: React.RefObject<HTMLImageElement | null>
    frameUrl: string | null
  }) => (
    <div ref={remoteViewportRef} tabIndex={-1} data-testid="viewport">
      {frameUrl ? <img ref={imageRef} tabIndex={0} data-testid="frame" alt="" /> : null}
    </div>
  )
}))

import { RemoteBrowserPagePane } from './remote-browser-page-pane'

const PAGE_ID = 'page-a'

let frameCallbacks: FrameRequestCallback[] = []

function flushFrames(cycles = 8): void {
  for (let index = 0; index < cycles; index += 1) {
    const pending = frameCallbacks
    frameCallbacks = []
    for (const callback of pending) {
      callback(0)
    }
  }
}

function page(): BrowserPage {
  return {
    id: PAGE_ID,
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

function paneElement(isActive = true): React.JSX.Element {
  return (
    <TooltipProvider>
      <RemoteBrowserPagePane
        browserTab={page()}
        workspaceId="workspace-a"
        chromeShortcutScope="focused"
        runtimeEnvironmentId="environment-a"
        worktreeId="worktree-a"
        isActive={isActive}
        onUpdatePageState={vi.fn()}
        onSetUrl={vi.fn()}
      />
    </TooltipProvider>
  )
}

function renderPane(isActive = true): ReturnType<typeof render> {
  const view = render(paneElement(isActive))
  act(() => flushFrames())
  return view
}

function addressBar(): HTMLInputElement {
  return document.querySelector('[data-orca-browser-address-bar]') as HTMLInputElement
}

describe('RemoteBrowserPagePane address bar parity', () => {
  beforeEach(() => {
    frameCallbacks = []
    mocks.frameUrl.current = null
    mocks.addressBarValue.current = 'about:blank'
    mocks.windowVisible.current = true
    mocks.streamStatus.current = 'live'
    mocks.activationOrder.length = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { onFocusBrowserAddressBar: () => () => {} } }
    })
    useAppStore.setState({
      browserUrlHistory: [],
      pendingAddressBarFocusByPageId: {},
      pendingAddressBarFocusByTabId: {}
    })
  })

  afterEach(() => {
    cleanup()
    clearBrowserPageDeferredNavigation(PAGE_ID)
    useAppStore.setState({ remoteBrowserPageHandlesByPageId: {} })
    vi.unstubAllGlobals()
  })

  it('replays a staged URL only after the adopted page opens its stream', () => {
    deferBrowserPageNavigation(PAGE_ID, 'https://remote.internal/docs')
    useAppStore.setState({
      remoteBrowserPageHandlesByPageId: {
        [PAGE_ID]: { environmentId: 'environment-a', remotePageId: PAGE_ID, staged: true }
      }
    })

    renderPane()
    expect(mocks.activationOrder).toEqual([])

    act(() => {
      useAppStore.setState({
        remoteBrowserPageHandlesByPageId: {
          [PAGE_ID]: { environmentId: 'environment-a', remotePageId: PAGE_ID }
        }
      })
    })

    expect(mocks.activationOrder).toEqual(['stream-open', 'navigate:https://remote.internal/docs'])
  })

  it('waits for initial stream tab info before replaying a staged URL', () => {
    mocks.streamStatus.current = 'opening'
    deferBrowserPageNavigation(PAGE_ID, 'https://remote.internal/after-ready')
    useAppStore.setState({
      remoteBrowserPageHandlesByPageId: {
        [PAGE_ID]: { environmentId: 'environment-a', remotePageId: PAGE_ID, staged: true }
      }
    })
    const view = renderPane()

    act(() => {
      useAppStore.setState({
        remoteBrowserPageHandlesByPageId: {
          [PAGE_ID]: { environmentId: 'environment-a', remotePageId: PAGE_ID }
        }
      })
    })
    expect(mocks.activationOrder).toEqual(['stream-open'])

    mocks.streamStatus.current = 'live'
    act(() => view.rerender(paneElement()))
    expect(mocks.activationOrder).toEqual([
      'stream-open',
      'navigate:https://remote.internal/after-ready'
    ])
  })

  it('keeps the staged URL until an inactive adopted page becomes active', () => {
    deferBrowserPageNavigation(PAGE_ID, 'https://remote.internal/inactive')
    useAppStore.setState({
      remoteBrowserPageHandlesByPageId: {
        [PAGE_ID]: { environmentId: 'environment-a', remotePageId: PAGE_ID, staged: true }
      }
    })
    const view = renderPane(false)

    act(() => {
      useAppStore.setState({
        remoteBrowserPageHandlesByPageId: {
          [PAGE_ID]: { environmentId: 'environment-a', remotePageId: PAGE_ID }
        }
      })
    })
    expect(mocks.activationOrder).toEqual([])

    act(() => view.rerender(paneElement(true)))
    expect(mocks.activationOrder).toEqual([
      'stream-open',
      'navigate:https://remote.internal/inactive'
    ])
  })

  it('keeps the staged URL until a hidden window can open its stream', () => {
    mocks.windowVisible.current = false
    deferBrowserPageNavigation(PAGE_ID, 'https://remote.internal/hidden')
    useAppStore.setState({
      remoteBrowserPageHandlesByPageId: {
        [PAGE_ID]: { environmentId: 'environment-a', remotePageId: PAGE_ID, staged: true }
      }
    })
    const view = renderPane()

    act(() => {
      useAppStore.setState({
        remoteBrowserPageHandlesByPageId: {
          [PAGE_ID]: { environmentId: 'environment-a', remotePageId: PAGE_ID }
        }
      })
    })
    expect(mocks.activationOrder).toEqual([])

    mocks.windowVisible.current = true
    act(() => view.rerender(paneElement()))
    expect(mocks.activationOrder).toEqual([
      'stream-open',
      'navigate:https://remote.internal/hidden'
    ])
  })

  it('opens a new blank tab in the address bar with its text selected', () => {
    useAppStore.setState({
      pendingAddressBarFocusByPageId: { [PAGE_ID]: true },
      pendingAddressBarFocusByTabId: { [PAGE_ID]: true }
    })

    renderPane()

    const input = addressBar()
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('about:blank'.length)
  })

  it('offers the shared URL history as suggestions once the bar has focus', () => {
    useAppStore.setState({
      browserUrlHistory: [
        {
          url: 'https://maps.google.com/',
          normalizedUrl: 'maps.google.com',
          title: 'Google Maps',
          lastVisitedAt: Date.now(),
          visitCount: 4
        }
      ],
      pendingAddressBarFocusByPageId: { [PAGE_ID]: true },
      pendingAddressBarFocusByTabId: { [PAGE_ID]: true }
    })

    renderPane()

    expect(screen.getByText('Google Maps')).toBeTruthy()
  })

  it('does not steal focus from a page the user is already on', () => {
    mocks.addressBarValue.current = 'https://remote.internal/path'

    renderPane()

    expect(document.activeElement).not.toBe(addressBar())
  })

  it('sends a palette request aimed at the page to the streamed viewport', () => {
    act(() => requestBrowserFocus({ pageId: PAGE_ID, target: 'webview' }))

    renderPane()

    expect(document.activeElement).toBe(screen.getByTestId('viewport'))
  })

  it('hands focus to the screencast frame the moment the first one arrives', () => {
    act(() => requestBrowserFocus({ pageId: PAGE_ID, target: 'webview' }))
    const view = renderPane()
    expect(document.activeElement).toBe(screen.getByTestId('viewport'))

    mocks.frameUrl.current = 'blob:frame-1'
    act(() => view.rerender(paneElement()))

    // Why: the <img> is what carries remote key input, so focus parked on the viewport leaves
    // the keyboard dead until the user clicks.
    expect(document.activeElement).toBe(screen.getByTestId('frame'))
  })

  it('leaves a focused address bar alone when the first frame arrives', () => {
    useAppStore.setState({
      pendingAddressBarFocusByPageId: { [PAGE_ID]: true },
      pendingAddressBarFocusByTabId: { [PAGE_ID]: true }
    })
    const view = renderPane()
    expect(document.activeElement).toBe(addressBar())

    mocks.frameUrl.current = 'blob:frame-1'
    act(() => view.rerender(paneElement()))

    // Why: a blank tab paints its first frame while the user is still typing the URL, so the
    // handover only applies to focus that is sitting on the viewport with nowhere better to go.
    expect(document.activeElement).toBe(addressBar())
  })

  it('prefers the screencast frame over the viewport once one has painted', () => {
    mocks.frameUrl.current = 'blob:frame-1'
    act(() => requestBrowserFocus({ pageId: PAGE_ID, target: 'webview' }))

    renderPane()

    expect(document.activeElement).toBe(screen.getByTestId('frame'))
  })
})
