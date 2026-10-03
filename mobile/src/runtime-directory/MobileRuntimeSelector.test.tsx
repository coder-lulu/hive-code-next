import { createElement, type ComponentProps } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import type { HostCatalogEntry } from '../transport/types'
import { MobileRuntimeSelector } from './MobileRuntimeSelector'

const fixture = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  select: vi.fn(),
  pair: vi.fn(),
  claim: vi.fn(),
  alert: vi.fn(),
  session: null as { authorityId: string; account: { accountId: string } } | null
}))
vi.mock('react-native', () => ({
  Alert: { alert: fixture.alert },
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Monitor: 'Monitor',
  ScanLine: 'ScanLine',
  X: 'X'
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: (props: { children: React.ReactNode }) =>
    createElement('Drawer', props, props.children)
}))
vi.mock('../transport/client-context', () => ({ useEnsureHostConnected: () => fixture.connect }))
vi.mock('../auth/mobile-auth-session', () => ({
  useMobileAuthSession: () => ({ session: fixture.session })
}))
function computer(id: string, account: boolean): HostCatalogEntry {
  return {
    id,
    name: id,
    endpoint: 'wss://test.invalid',
    credentialStatus: 'ready',
    lastConnected: 0,
    accessSources: account ? ['account-claimed'] : ['manual-pairing'],
    profile: {
      id,
      name: id,
      endpoint: 'wss://test.invalid',
      deviceToken: 'test-token',
      publicKeyB64: 'test-key',
      lastConnected: 0
    }
  }
}
const account = computer('账号电脑', true),
  local = computer('本地电脑', false)
let renderer: ReactTestRenderer | null = null
function props(
  overrides: Partial<ComponentProps<typeof MobileRuntimeSelector>> = {}
): ComponentProps<typeof MobileRuntimeSelector> {
  return {
    catalog: [local, account],
    accountOnly: true,
    connectionStates: {},
    onClose: fixture.close,
    onSelect: fixture.select,
    onPair: fixture.pair,
    onClaim: fixture.claim,
    selectedId: null,
    theme: lightTheme,
    visible: true,
    ...overrides
  }
}
function mount(overrides: Partial<ComponentProps<typeof MobileRuntimeSelector>> = {}) {
  act(() => {
    renderer = create(createElement(MobileRuntimeSelector, props(overrides)))
  })
}
function labels() {
  return renderer!.root
    .findAllByType('Text')
    .map((node) => node.children.join(''))
    .join('\n')
}
function row() {
  return renderer!.root
    .findAllByType('Pressable')
    .find((node) => String(node.props.accessibilityLabel).includes('账号电脑'))!
}
beforeEach(() => {
  vi.clearAllMocks()
  fixture.session = null
  fixture.connect.mockResolvedValue(true)
})
afterEach(() => act(() => renderer?.unmount()))

it('only shows claimed computers and commits selection after a successful connection and drawer dismissal', async () => {
  mount()
  expect(labels()).not.toContain('本地电脑')
  expect(labels()).not.toContain('配对新设备')
  await act(async () => row().props.onPress())
  expect(fixture.connect).toHaveBeenCalledWith(account.profile)
  expect(fixture.close).toHaveBeenCalledOnce()
  expect(fixture.select).not.toHaveBeenCalled()
  act(() => renderer!.root.findByType('Drawer').props.onAfterClose())
  expect(fixture.select).toHaveBeenCalledWith(account.id)
})

it('does not select a computer when connection fails or a pending result arrives after dismissal', async () => {
  fixture.connect.mockResolvedValueOnce(false)
  mount()
  await act(async () => row().props.onPress())
  expect(labels()).toContain('暂时无法连接')
  expect(fixture.select).not.toHaveBeenCalled()
  let resolve!: (value: boolean) => void
  fixture.connect.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  let pending!: Promise<void>
  act(() => {
    pending = row().props.onPress()
  })
  act(() => renderer!.update(createElement(MobileRuntimeSelector, props({ visible: false }))))
  await act(async () => {
    resolve(true)
    await pending
  })
  expect(fixture.close).not.toHaveBeenCalled()
  expect(fixture.select).not.toHaveBeenCalled()
})

it('keeps an offline claimed computer visible but unselectable', async () => {
  mount({ catalog: [{ ...account, credentialStatus: 'cloud-offline', profile: null }] })
  expect(labels()).toContain('离线')
  expect(row().props.disabled).toBe(true)
  await act(async () => row().props.onPress())
  expect(fixture.connect).not.toHaveBeenCalled()
})

it('keeps claim separate from manual pairing when the account directory is empty', () => {
  mount({ catalog: [] })
  const action = renderer!.root
    .findAllByType('Pressable')
    .find((node) => node.props.accessibilityLabel === '认领电脑')!
  act(() => action.props.onPress())
  act(() => renderer!.root.findByType('Drawer').props.onAfterClose())
  expect(fixture.claim).toHaveBeenCalledOnce()
  expect(fixture.pair).not.toHaveBeenCalled()
})

it.each([false, true])(
  'only offers pairing and opens it after the selector closes, including the empty directory (%s)',
  (empty) => {
    mount({ accountOnly: false, catalog: empty ? [] : [local, account] })
    expect(labels()).not.toContain('设备管理')
    act(() => renderer!.root.findByProps({ accessibilityLabel: '配对新设备' }).props.onPress())
    expect(fixture.close).toHaveBeenCalledOnce()
    expect(fixture.pair).not.toHaveBeenCalled()
    act(() => renderer!.root.findByType('Drawer').props.onAfterClose())
    expect(fixture.pair).toHaveBeenCalledOnce()
    expect(fixture.select).not.toHaveBeenCalled()
    expect(fixture.claim).not.toHaveBeenCalled()
  }
)

const accountRoute = (resourceVersion: number): HostCatalogEntry => ({
  ...account,
  profile: {
    ...account.profile!,
    accountRuntime: { runtimeRecordId: 'cloud-runtime', resourceVersion, createConnection: vi.fn() }
  }
})
const changedCatalog = (change: string) =>
  change === 'removed'
    ? []
    : [
        {
          ...account,
          ...(change === 'unavailable'
            ? { credentialStatus: 'cloud-offline' as const, profile: null }
            : {
                profile: { ...account.profile!, deviceToken: 'replacement-token' }
              })
        }
      ]

it.each(['removed', 'unavailable', 'credentials', 'selection'])(
  'does not accept a late connection confirmation after %s changes',
  async (change) => {
    let resolve!: (connected: boolean) => void
    fixture.connect.mockReturnValueOnce(
      new Promise<boolean>((reply) => {
        resolve = reply
      })
    )
    mount()
    let pending!: Promise<void>
    act(() => {
      pending = row().props.onPress()
    })
    act(() =>
      renderer!.update(
        createElement(
          MobileRuntimeSelector,
          props(
            change === 'selection' ? { selectedId: local.id } : { catalog: changedCatalog(change) }
          )
        )
      )
    )
    await act(async () => {
      resolve(true)
      await pending
    })
    expect(fixture.close).not.toHaveBeenCalled()
    expect(fixture.select).not.toHaveBeenCalled()
    if (change !== 'selection') {
      expect(labels()).toContain('重新选择')
    }
  }
)

it.each(['removed', 'unavailable', 'credentials', 'selection'])(
  'revalidates a selected computer after drawer dismissal when %s changes',
  async (change) => {
    mount()
    await act(async () => row().props.onPress())
    expect(fixture.close).toHaveBeenCalledOnce()
    act(() =>
      renderer!.update(
        createElement(
          MobileRuntimeSelector,
          props({
            visible: false,
            ...(change === 'selection'
              ? { selectedId: local.id }
              : { catalog: changedCatalog(change) })
          })
        )
      )
    )
    act(() => renderer!.root.findByType('Drawer').props.onAfterClose())
    expect(fixture.select).not.toHaveBeenCalled()
    if (change !== 'selection') {
      expect(fixture.alert).toHaveBeenCalledOnce()
    }
  }
)

it('allows a directory metadata refresh without discarding valid connection confirmation', async () => {
  mount()
  await act(async () => row().props.onPress())
  act(() =>
    renderer!.update(
      createElement(
        MobileRuntimeSelector,
        props({
          visible: false,
          catalog: [
            {
              ...account,
              name: '新名称',
              lastConnected: 100,
              profile: { ...account.profile!, name: '新名称', lastConnected: 100 }
            }
          ]
        })
      )
    )
  )
  act(() => renderer!.root.findByType('Drawer').props.onAfterClose())
  expect(fixture.select).toHaveBeenCalledExactlyOnceWith(account.id)
})

it('does not execute a deferred pairing action after selector unmount', () => {
  mount({ accountOnly: false })
  act(() => renderer!.root.findByProps({ accessibilityLabel: '配对新设备' }).props.onPress())
  const afterClose = renderer!.root.findByType('Drawer').props.onAfterClose
  act(() => {
    renderer!.unmount()
    renderer = null
  })
  act(() => afterClose())
  expect(fixture.pair).not.toHaveBeenCalled()
})

it('rejects connection confirmation when the account relay route version changes', async () => {
  let resolve!: (connected: boolean) => void
  fixture.connect.mockReturnValueOnce(
    new Promise<boolean>((reply) => {
      resolve = reply
    })
  )
  mount({ catalog: [accountRoute(1)] })
  let pending!: Promise<void>
  act(() => {
    pending = row().props.onPress()
  })
  act(() =>
    renderer!.update(createElement(MobileRuntimeSelector, props({ catalog: [accountRoute(2)] })))
  )
  await act(async () => {
    resolve(true)
    await pending
  })
  expect(fixture.close).not.toHaveBeenCalled()
  expect(fixture.select).not.toHaveBeenCalled()
  expect(labels()).toContain('重新选择')
})

it('permits a refreshed relay callback when the connection target and route version stay the same', async () => {
  mount({ catalog: [accountRoute(1)] })
  await act(async () => row().props.onPress())
  act(() =>
    renderer!.update(
      createElement(MobileRuntimeSelector, props({ visible: false, catalog: [accountRoute(1)] }))
    )
  )
  act(() => renderer!.root.findByType('Drawer').props.onAfterClose())
  expect(fixture.select).toHaveBeenCalledExactlyOnceWith(account.id)
})

it('clears a pending connection when the account changes while the selector stays open', async () => {
  let resolve!: (connected: boolean) => void
  fixture.session = { authorityId: 'cloud', account: { accountId: 'a' } }
  fixture.connect.mockReturnValueOnce(
    new Promise<boolean>((reply) => {
      resolve = reply
    })
  )
  mount()
  let pending!: Promise<void>
  act(() => {
    pending = row().props.onPress()
  })
  fixture.session = { authorityId: 'cloud', account: { accountId: 'b' } }
  act(() => renderer!.update(createElement(MobileRuntimeSelector, props())))
  expect(row().props.disabled).toBe(false)
  await act(async () => {
    resolve(true)
    await pending
  })
  expect(fixture.select).not.toHaveBeenCalled()
  expect(fixture.close).not.toHaveBeenCalled()
})

it('cancels a deferred pairing action across an account switch, even when switching back', () => {
  fixture.session = { authorityId: 'cloud', account: { accountId: 'a' } }
  mount({ accountOnly: false })
  act(() => renderer!.root.findByProps({ accessibilityLabel: '配对新设备' }).props.onPress())
  fixture.session = { authorityId: 'cloud', account: { accountId: 'b' } }
  act(() => renderer!.update(createElement(MobileRuntimeSelector, props({ visible: false }))))
  fixture.session = { authorityId: 'cloud', account: { accountId: 'a' } }
  act(() => renderer!.update(createElement(MobileRuntimeSelector, props({ visible: false }))))
  act(() => renderer!.root.findByType('Drawer').props.onAfterClose())
  expect(fixture.pair).not.toHaveBeenCalled()
})
