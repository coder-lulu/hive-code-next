import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditHostScreen from '../app/h/[hostId]/edit'

const dependencies = vi.hoisted(() => ({
  back: vi.fn(),
  refreshHostClient: vi.fn(),
  loadHosts: vi.fn(),
  primeHosts: vi.fn(),
  queueDisplayNameUpdate: vi.fn(),
  directoryScope: { authorityId: 'hive-primary', accountId: 'account-a' },
  directoryEntries: [] as unknown[],
  pendingDisplayNames: new Map<string, string | null>(),
  directoryStatus: 'ready',
  updateHostNameAndEndpoint: vi.fn(),
  hostId: 'host-1' as string | undefined
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}))

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ hostId: dependencies.hostId }),
  useRouter: () => ({ back: dependencies.back })
}))

vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft'
}))

vi.mock('./theme/mobile-theme-provider', async () => {
  const { lightTheme } = await import('./theme/mobile-theme')
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemeStyles: (factory: (theme: typeof lightTheme) => unknown) => factory(lightTheme)
  }
})

vi.mock('./transport/host-store', () => ({
  loadHosts: dependencies.loadHosts,
  updateHostNameAndEndpoint: dependencies.updateHostNameAndEndpoint
}))

vi.mock('./transport/client-context', () => ({
  usePrimeHosts: () => dependencies.primeHosts,
  useRefreshHostClient: () => dependencies.refreshHostClient
}))

vi.mock('./runtime-directory/account-runtime-directory-provider', () => ({
  useAccountRuntimeDirectory: () => ({
    state: {
      status: dependencies.directoryStatus,
      scope: dependencies.directoryScope,
      entries: dependencies.directoryEntries
    },
    pendingDisplayNames: dependencies.pendingDisplayNames,
    queueDisplayNameUpdate: dependencies.queueDisplayNameUpdate
  })
}))

const HOST_FIXTURE = {
  id: 'host-1',
  name: 'Desk',
  endpoint: 'ws://192.168.1.10:6768',
  deviceToken: 'token',
  publicKeyB64: 'public-key',
  lastConnected: 1
}

const CLOUD_RUNTIME_FIXTURE = {
  runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cloudDisplayName: 'Cloud Desk',
  cloudDisplayNameVersion: 3,
  deviceName: 'Reported Desk',
  status: 'CLAIMED',
  runtimeVersion: '1.0.0',
  runtimeProtocolVersion: 3,
  capabilities: [],
  resourceVersion: 7,
  createdAt: '2026-09-01T00:00:00Z',
  claimedAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  lastHeartbeatAt: null,
  presence: 'ONLINE',
  readiness: 'READY',
  readinessReasonCode: null,
  freeDiskBytes: null,
  connectionCapabilities: []
}

async function renderEditHostRoute(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(EditHostScreen))
    await Promise.resolve()
  })
  if (!renderer) {
    throw new Error('Edit host route did not render')
  }
  return renderer
}

function setFieldValue(
  renderer: ReactTestRenderer,
  accessibilityLabel: 'Name' | 'Address',
  value: string
): void {
  const input = renderer.root
    .findAllByType('TextInput')
    .find((node) => node.props.accessibilityLabel === accessibilityLabel)
  if (!input) {
    throw new Error(`${accessibilityLabel} input not found`)
  }
  act(() => {
    input.props.onChangeText(value)
  })
}

function findSaveButton(renderer: ReactTestRenderer) {
  const button = renderer.root
    .findAllByType('Pressable')
    .find((node) => node.props.accessibilityLabel === 'Save host')
  if (!button) {
    throw new Error('Save button not found')
  }
  return button
}

async function pressSave(renderer: ReactTestRenderer): Promise<void> {
  const button = findSaveButton(renderer)
  await act(async () => {
    button.props.onPress()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function findText(renderer: ReactTestRenderer, match: string): boolean {
  return renderer.root.findAllByType('Text').some((node) => {
    const children = node.props.children
    if (typeof children === 'string') {
      return children.includes(match)
    }
    if (Array.isArray(children)) {
      return children.join('').includes(match)
    }
    return false
  })
}

describe('edit host handleSave', () => {
  beforeEach(() => {
    dependencies.hostId = 'host-1'
    dependencies.back.mockReset()
    dependencies.refreshHostClient.mockReset()
    dependencies.loadHosts.mockReset().mockResolvedValue([HOST_FIXTURE])
    dependencies.primeHosts.mockReset()
    dependencies.updateHostNameAndEndpoint.mockReset().mockResolvedValue(undefined)
    dependencies.queueDisplayNameUpdate.mockReset().mockResolvedValue(undefined)
    dependencies.directoryEntries = []
    dependencies.directoryScope = { authorityId: 'hive-primary', accountId: 'account-a' }
    dependencies.pendingDisplayNames = new Map()
    dependencies.directoryStatus = 'ready'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rename-only save updates only the name and does not reconnect', async () => {
    const storedEndpoint = 'wss://Desk.Example.com/%6Fruntime?route=%72ed'
    dependencies.loadHosts.mockResolvedValueOnce([{ ...HOST_FIXTURE, endpoint: storedEndpoint }])
    const renderer = await renderEditHostRoute()
    setFieldValue(renderer, 'Address', '  wss://%64esk.example.com:443  ')
    setFieldValue(renderer, 'Name', 'Home Desk')

    expect(findText(renderer, `Connects to ${storedEndpoint}`)).toBe(true)
    await pressSave(renderer)

    expect(dependencies.updateHostNameAndEndpoint).toHaveBeenCalledWith('host-1', {
      personalName: 'Home Desk'
    })
    expect(dependencies.refreshHostClient).not.toHaveBeenCalled()
    expect(dependencies.back).toHaveBeenCalledTimes(1)

    act(() => renderer.unmount())
  })

  it('initializes a claimed local host from the effective account name and queues explicit edits', async () => {
    dependencies.directoryEntries = [CLOUD_RUNTIME_FIXTURE]
    dependencies.pendingDisplayNames = new Map([
      [CLOUD_RUNTIME_FIXTURE.runtimeRecordId, 'Pending Desk']
    ])
    dependencies.loadHosts.mockResolvedValueOnce([
      { ...HOST_FIXTURE, runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId }
    ])
    const renderer = await renderEditHostRoute()
    const nameInput = renderer.root
      .findAllByType('TextInput')
      .find((node) => node.props.accessibilityLabel === 'Name')

    expect(nameInput?.props.value).toBe('Pending Desk')
    expect(dependencies.queueDisplayNameUpdate).not.toHaveBeenCalled()
    setFieldValue(renderer, 'Name', 'Shared Desk')
    await pressSave(renderer)

    expect(dependencies.updateHostNameAndEndpoint).toHaveBeenCalledWith('host-1', {
      personalName: 'Shared Desk'
    })
    expect(dependencies.queueDisplayNameUpdate).toHaveBeenCalledWith({
      runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId,
      desiredName: 'Shared Desk',
      expectedScope: { authorityId: 'hive-primary', accountId: 'account-a' },
      expectedResourceVersion: 7,
      expectedCloudDisplayNameVersion: 3
    })
    act(() => renderer.unmount())
  })

  it('drops an account A draft before editing the same Runtime under account B', async () => {
    dependencies.directoryEntries = [CLOUD_RUNTIME_FIXTURE]
    dependencies.loadHosts.mockResolvedValue([
      { ...HOST_FIXTURE, runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId }
    ])
    const renderer = await renderEditHostRoute()
    setFieldValue(renderer, 'Name', 'Account A stale draft')

    dependencies.directoryScope = { authorityId: 'hive-primary', accountId: 'account-b' }
    dependencies.directoryEntries = [
      {
        ...CLOUD_RUNTIME_FIXTURE,
        resourceVersion: 8,
        cloudDisplayName: 'Account B Desk',
        cloudDisplayNameVersion: 4
      }
    ]
    await act(async () => {
      renderer.update(createElement(EditHostScreen))
      await Promise.resolve()
      await Promise.resolve()
    })

    const nameInput = renderer.root
      .findAllByType('TextInput')
      .find((node) => node.props.accessibilityLabel === 'Name')
    expect(nameInput?.props.value).toBe('Account B Desk')
    expect(dependencies.queueDisplayNameUpdate).not.toHaveBeenCalled()

    setFieldValue(renderer, 'Name', 'Account B New Name')
    await pressSave(renderer)
    expect(dependencies.queueDisplayNameUpdate).toHaveBeenCalledWith({
      runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId,
      desiredName: 'Account B New Name',
      expectedScope: { authorityId: 'hive-primary', accountId: 'account-b' },
      expectedResourceVersion: 8,
      expectedCloudDisplayNameVersion: 4
    })
    act(() => renderer.unmount())
  })

  it('keeps the durable local rename and reports a failed cloud queue write', async () => {
    dependencies.directoryEntries = [CLOUD_RUNTIME_FIXTURE]
    dependencies.loadHosts.mockResolvedValue([
      { ...HOST_FIXTURE, runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId }
    ])
    dependencies.queueDisplayNameUpdate.mockRejectedValueOnce(new Error('storage full'))
    const renderer = await renderEditHostRoute()
    setFieldValue(renderer, 'Name', 'Local durable name')
    await pressSave(renderer)

    expect(dependencies.updateHostNameAndEndpoint).toHaveBeenCalledWith('host-1', {
      personalName: 'Local durable name'
    })
    expect(findText(renderer, '已保存到本机，但无法排队 HiveCloud 同步')).toBe(true)
    expect(dependencies.back).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('waits for the account directory before binding a claimed local host', async () => {
    dependencies.directoryStatus = 'loading'
    dependencies.loadHosts.mockResolvedValue([
      { ...HOST_FIXTURE, runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId }
    ])
    const renderer = await renderEditHostRoute()
    expect(renderer.root.findAllByType('TextInput')).toHaveLength(0)

    dependencies.directoryStatus = 'ready'
    dependencies.directoryEntries = [CLOUD_RUNTIME_FIXTURE]
    await act(async () => {
      renderer.update(createElement(EditHostScreen))
      await Promise.resolve()
      await Promise.resolve()
    })
    setFieldValue(renderer, 'Name', 'Directory-bound name')
    await pressSave(renderer)

    expect(dependencies.queueDisplayNameUpdate).toHaveBeenCalledWith({
      runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId,
      desiredName: 'Directory-bound name',
      expectedScope: { authorityId: 'hive-primary', accountId: 'account-a' },
      expectedResourceVersion: 7,
      expectedCloudDisplayNameVersion: 3
    })
    act(() => renderer.unmount())
  })

  it('warns and keeps an explicit rename local when the account directory failed', async () => {
    dependencies.directoryStatus = 'error'
    dependencies.loadHosts.mockResolvedValueOnce([
      { ...HOST_FIXTURE, runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId }
    ])
    const renderer = await renderEditHostRoute()

    expect(findText(renderer, '此次名称只保存到本机，不会排队云同步')).toBe(true)
    setFieldValue(renderer, 'Name', 'Offline local name')
    await pressSave(renderer)

    expect(dependencies.updateHostNameAndEndpoint).toHaveBeenCalledWith('host-1', {
      personalName: 'Offline local name'
    })
    expect(dependencies.queueDisplayNameUpdate).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('does not normalize or upload a legacy local name during an endpoint-only save', async () => {
    dependencies.loadHosts.mockResolvedValueOnce([{ ...HOST_FIXTURE, name: 'Cafe\u0301' }])
    const renderer = await renderEditHostRoute()
    setFieldValue(renderer, 'Address', '192.168.1.20:6768')
    await pressSave(renderer)

    expect(dependencies.updateHostNameAndEndpoint).toHaveBeenCalledWith('host-1', {
      endpoint: 'ws://192.168.1.20:6768'
    })
    expect(dependencies.queueDisplayNameUpdate).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('renames an account-only Runtime without creating a local pairing or address field', async () => {
    dependencies.hostId = CLOUD_RUNTIME_FIXTURE.runtimeRecordId
    dependencies.loadHosts.mockResolvedValue([])
    dependencies.directoryEntries = [CLOUD_RUNTIME_FIXTURE]
    const renderer = await renderEditHostRoute()

    expect(
      renderer.root
        .findAllByType('TextInput')
        .some((node) => node.props.accessibilityLabel === 'Address')
    ).toBe(false)
    setFieldValue(renderer, 'Name', 'Phone Alias')
    await pressSave(renderer)

    expect(dependencies.updateHostNameAndEndpoint).not.toHaveBeenCalled()
    expect(dependencies.queueDisplayNameUpdate).toHaveBeenCalledWith({
      runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId,
      desiredName: 'Phone Alias',
      expectedScope: { authorityId: 'hive-primary', accountId: 'account-a' },
      expectedResourceVersion: 7,
      expectedCloudDisplayNameVersion: 3
    })
    expect(dependencies.back).toHaveBeenCalledTimes(1)
    act(() => renderer.unmount())
  })

  it('clears only the cloud alias and immediately falls back to the local paired name', async () => {
    dependencies.directoryEntries = [CLOUD_RUNTIME_FIXTURE]
    dependencies.loadHosts.mockResolvedValue([
      { ...HOST_FIXTURE, runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId }
    ])
    const renderer = await renderEditHostRoute()
    const clearButton = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Clear HiveCloud name')
    if (!clearButton) {
      throw new Error('Clear HiveCloud name button not found')
    }

    await act(async () => {
      await clearButton.props.onPress()
    })

    expect(dependencies.queueDisplayNameUpdate).toHaveBeenCalledWith({
      runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId,
      desiredName: null,
      expectedScope: { authorityId: 'hive-primary', accountId: 'account-a' },
      expectedResourceVersion: 7,
      expectedCloudDisplayNameVersion: 3
    })
    expect(dependencies.updateHostNameAndEndpoint).not.toHaveBeenCalled()
    const nameInput = renderer.root
      .findAllByType('TextInput')
      .find((node) => node.props.accessibilityLabel === 'Name')
    expect(nameInput?.props.value).toBe('Desk')
    expect(dependencies.back).toHaveBeenCalledOnce()
    act(() => renderer.unmount())
  })

  it('falls back to the reported device name when an account-only alias is cleared', async () => {
    dependencies.hostId = CLOUD_RUNTIME_FIXTURE.runtimeRecordId
    dependencies.directoryEntries = [CLOUD_RUNTIME_FIXTURE]
    dependencies.loadHosts.mockResolvedValue([])
    const renderer = await renderEditHostRoute()
    const clearButton = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Clear HiveCloud name')
    if (!clearButton) {
      throw new Error('Clear HiveCloud name button not found')
    }

    await act(async () => {
      await clearButton.props.onPress()
    })

    const nameInput = renderer.root
      .findAllByType('TextInput')
      .find((node) => node.props.accessibilityLabel === 'Name')
    expect(nameInput?.props.value).toBe('Reported Desk')
    expect(dependencies.updateHostNameAndEndpoint).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('keeps the clear action recoverable when its durable queue write rejects', async () => {
    dependencies.directoryEntries = [CLOUD_RUNTIME_FIXTURE]
    dependencies.loadHosts.mockResolvedValue([
      { ...HOST_FIXTURE, runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId }
    ])
    dependencies.queueDisplayNameUpdate.mockRejectedValueOnce(new Error('storage unavailable'))
    const renderer = await renderEditHostRoute()
    const clearButton = renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Clear HiveCloud name')
    if (!clearButton) {
      throw new Error('Clear HiveCloud name button not found')
    }

    await act(async () => {
      clearButton.props.onPress()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(dependencies.queueDisplayNameUpdate).toHaveBeenCalledWith({
      runtimeRecordId: CLOUD_RUNTIME_FIXTURE.runtimeRecordId,
      desiredName: null,
      expectedScope: { authorityId: 'hive-primary', accountId: 'account-a' },
      expectedResourceVersion: 7,
      expectedCloudDisplayNameVersion: 3
    })
    expect(dependencies.updateHostNameAndEndpoint).not.toHaveBeenCalled()
    expect(dependencies.back).not.toHaveBeenCalled()
    expect(
      renderer.root
        .findAllByType('Text')
        .some(
          (node) =>
            node.props.accessibilityRole === 'alert' &&
            node.props.accessibilityLiveRegion === 'polite' &&
            node.props.children === '无法排队清除 HiveCloud 名称。请稍后重试。'
        )
    ).toBe(true)
    const nameInput = renderer.root
      .findAllByType('TextInput')
      .find((node) => node.props.accessibilityLabel === 'Name')
    expect(nameInput?.props.value).toBe('Cloud Desk')
    expect(
      renderer.root
        .findAllByType('Pressable')
        .find((node) => node.props.accessibilityLabel === 'Clear HiveCloud name')?.props.disabled
    ).toBe(false)
    act(() => renderer.unmount())
  })

  it('endpoint-only save updates only the endpoint and reconnects', async () => {
    const renderer = await renderEditHostRoute()
    setFieldValue(renderer, 'Address', '192.168.1.20:6768')
    await pressSave(renderer)

    expect(dependencies.updateHostNameAndEndpoint).toHaveBeenCalledWith('host-1', {
      endpoint: 'ws://192.168.1.20:6768'
    })
    expect(dependencies.refreshHostClient).toHaveBeenCalledWith('host-1')
    expect(dependencies.back).toHaveBeenCalledTimes(1)

    act(() => renderer.unmount())
  })

  it('saves name and endpoint together in one call, then reconnects', async () => {
    const renderer = await renderEditHostRoute()
    setFieldValue(renderer, 'Name', 'Home Desk')
    setFieldValue(renderer, 'Address', '192.168.1.20:6768')
    await pressSave(renderer)

    expect(dependencies.updateHostNameAndEndpoint).toHaveBeenCalledTimes(1)
    expect(dependencies.updateHostNameAndEndpoint).toHaveBeenCalledWith('host-1', {
      personalName: 'Home Desk',
      endpoint: 'ws://192.168.1.20:6768'
    })
    expect(dependencies.refreshHostClient).toHaveBeenCalledWith('host-1')
    expect(dependencies.back).toHaveBeenCalledTimes(1)

    act(() => renderer.unmount())
  })

  it('navigates back without saving or reconnecting when nothing changed', async () => {
    const renderer = await renderEditHostRoute()
    await pressSave(renderer)

    expect(dependencies.updateHostNameAndEndpoint).not.toHaveBeenCalled()
    expect(dependencies.refreshHostClient).not.toHaveBeenCalled()
    expect(dependencies.back).toHaveBeenCalledTimes(1)

    act(() => renderer.unmount())
  })

  it('shows the error and does not navigate back or reconnect when the save rejects', async () => {
    dependencies.updateHostNameAndEndpoint.mockRejectedValueOnce(new Error('Host not found'))
    const renderer = await renderEditHostRoute()
    setFieldValue(renderer, 'Name', 'Home Desk')
    await pressSave(renderer)

    expect(findText(renderer, 'Host not found')).toBe(true)
    expect(dependencies.refreshHostClient).not.toHaveBeenCalled()
    expect(dependencies.back).not.toHaveBeenCalled()

    act(() => renderer.unmount())
  })

  it('still navigates back when the post-save re-prime fails', async () => {
    dependencies.loadHosts
      .mockResolvedValueOnce([HOST_FIXTURE])
      .mockRejectedValueOnce(new Error('boom'))
    const renderer = await renderEditHostRoute()
    setFieldValue(renderer, 'Name', 'Home Desk')
    await pressSave(renderer)

    expect(dependencies.primeHosts).not.toHaveBeenCalled()
    expect(dependencies.back).toHaveBeenCalledTimes(1)

    act(() => renderer.unmount())
  })

  it('ignores a second Save trigger while a save is already in flight', async () => {
    let resolveSave: () => void = () => {}
    dependencies.updateHostNameAndEndpoint.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
    )
    const renderer = await renderEditHostRoute()
    setFieldValue(renderer, 'Name', 'Home Desk')
    const button = findSaveButton(renderer)

    await act(async () => {
      button.props.onPress()
      button.props.onPress()
      await Promise.resolve()
    })

    expect(dependencies.updateHostNameAndEndpoint).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSave()
      await Promise.resolve()
      await Promise.resolve()
    })

    act(() => renderer.unmount())
  })
})

describe('edit host load() error states', () => {
  beforeEach(() => {
    dependencies.hostId = 'host-1'
    dependencies.back.mockReset()
    dependencies.refreshHostClient.mockReset()
    dependencies.loadHosts.mockReset().mockResolvedValue([HOST_FIXTURE])
    dependencies.primeHosts.mockReset()
    dependencies.updateHostNameAndEndpoint.mockReset().mockResolvedValue(undefined)
    dependencies.queueDisplayNameUpdate.mockReset().mockResolvedValue(undefined)
    dependencies.directoryEntries = []
    dependencies.pendingDisplayNames = new Map()
    dependencies.directoryStatus = 'ready'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows "Missing host." when hostId is absent', async () => {
    dependencies.hostId = undefined
    const renderer = await renderEditHostRoute()

    expect(findText(renderer, 'Missing host.')).toBe(true)
    expect(renderer.root.findAllByType('TextInput')).toHaveLength(0)

    act(() => renderer.unmount())
  })

  it('shows a not-saved message when the host is not in the loaded list', async () => {
    dependencies.loadHosts.mockReset().mockResolvedValue([])
    const renderer = await renderEditHostRoute()

    expect(findText(renderer, 'This host was removed from this phone.')).toBe(true)
    expect(renderer.root.findAllByType('TextInput')).toHaveLength(0)

    act(() => renderer.unmount())
  })

  it('surfaces the error message when loadHosts rejects', async () => {
    dependencies.loadHosts.mockReset().mockRejectedValue(new Error('storage unreadable'))
    const renderer = await renderEditHostRoute()

    expect(findText(renderer, 'storage unreadable')).toBe(true)
    expect(renderer.root.findAllByType('TextInput')).toHaveLength(0)

    act(() => renderer.unmount())
  })
})
