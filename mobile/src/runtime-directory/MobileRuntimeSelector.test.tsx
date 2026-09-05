import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import type { HostCatalogEntry, HostProfile } from '../transport/types'
import { MobileRuntimeSelector } from './MobileRuntimeSelector'

const connection = vi.hoisted(() => ({ ensure: vi.fn() }))
const drawer = vi.hoisted(() => ({ onAfterClose: null as null | (() => void) }))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Monitor: 'Monitor',
  ScanLine: 'ScanLine',
  X: 'X'
}))

vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: (props: { children?: ReactNode; onAfterClose?: () => void }) => {
    drawer.onAfterClose = props.onAfterClose ?? null
    return props.children
  }
}))

vi.mock('../transport/client-context', () => ({
  useEnsureHostConnected: () => connection.ensure
}))

function profile(id: string): HostProfile {
  return {
    id,
    name: id,
    endpoint: `ws://${id}`,
    deviceToken: `token-${id}`,
    publicKeyB64: `key-${id}`,
    lastConnected: 0
  }
}

function runtime(id: string, overrides: Partial<HostCatalogEntry> = {}): HostCatalogEntry {
  return {
    id,
    name: id,
    endpoint: `ws://${id}`,
    publicKeyB64: `key-${id}`,
    lastConnected: 0,
    credentialStatus: 'ready',
    profile: profile(id),
    ...overrides
  }
}

function runtimeRows(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root
    .findAllByType('Pressable')
    .filter((node) => node.props.accessibilityRole === 'radio')
}

describe('MobileRuntimeSelector', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    drawer.onAfterClose = null
    connection.ensure.mockReset()
  })

  it('keeps the drawer open until the selected runtime is connected', async () => {
    let finishConnection: (connected: boolean) => void = () => {}
    connection.ensure.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishConnection = resolve
      })
    )
    const onClose = vi.fn()
    const onSelect = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileRuntimeSelector, {
          catalog: [runtime('desktop')],
          connectionStates: { desktop: 'disconnected' },
          onClose,
          onPair: vi.fn(),
          onSelect,
          selectedId: null,
          theme: lightTheme,
          visible: true
        })
      )
    })

    act(() => runtimeRows(renderer!)[0]!.props.onPress())
    expect(connection.ensure).toHaveBeenCalledWith(profile('desktop'))
    expect(renderer!.root.findAllByType('ActivityIndicator')).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()

    await act(async () => finishConnection(true))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()

    act(() => drawer.onAfterClose?.())
    expect(onSelect).toHaveBeenCalledWith('desktop')
  })

  it('does not navigate to a runtime without a usable profile', () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileRuntimeSelector, {
          catalog: [
            runtime('cloud-only', {
              accountPresence: 'ONLINE',
              credentialStatus: 'cloud-unavailable',
              profile: null
            })
          ],
          connectionStates: {},
          onClose,
          onPair: vi.fn(),
          onSelect,
          selectedId: null,
          theme: lightTheme,
          visible: true
        })
      )
    })

    const [row] = runtimeRows(renderer!)
    expect(row!.props.disabled).toBe(true)
    expect(row!.props.accessibilityState.disabled).toBe(true)
    expect(connection.ensure).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows a retryable error without closing when connection confirmation fails', async () => {
    connection.ensure.mockResolvedValue(false)
    const onClose = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileRuntimeSelector, {
          catalog: [runtime('desktop')],
          connectionStates: { desktop: 'disconnected' },
          onClose,
          onPair: vi.fn(),
          onSelect: vi.fn(),
          selectedId: null,
          theme: lightTheme,
          visible: true
        })
      )
    })

    await act(async () => runtimeRows(renderer!)[0]!.props.onPress())
    const messages = renderer!.root
      .findAllByType('Text')
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    expect(messages).toContain('desktop 暂时无法连接，请重试或选择其他 Runtime。')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores a late connection result after the selector is externally closed', async () => {
    let finishConnection: (connected: boolean) => void = () => {}
    connection.ensure.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishConnection = resolve
      })
    )
    const props = {
      catalog: [runtime('desktop')],
      connectionStates: { desktop: 'disconnected' as const },
      onClose: vi.fn(),
      onPair: vi.fn(),
      onSelect: vi.fn(),
      selectedId: null,
      theme: lightTheme
    }
    act(() => {
      renderer = create(createElement(MobileRuntimeSelector, { ...props, visible: true }))
    })
    act(() => runtimeRows(renderer!)[0]!.props.onPress())
    act(() => {
      renderer!.update(createElement(MobileRuntimeSelector, { ...props, visible: false }))
    })

    await act(async () => finishConnection(true))
    expect(props.onClose).not.toHaveBeenCalled()
    expect(props.onSelect).not.toHaveBeenCalled()
  })
})
